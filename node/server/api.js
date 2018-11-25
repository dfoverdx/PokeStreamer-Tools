import express from 'express';
import useragent from 'useragent';
import EventEmitter from 'events';

import { getLocaleString } from './helpers';
import { API as APIConstants } from './constants';
import Config from './config';
import PM from './pokemon/pokemon-manager';
import Pokemon from './pokemon/pokemon';
import Slot from './slot/slot';
import SoulLink from './soullink/soullink';
import Nuzlocke from './nuzlocke/nuzlocke';
import DiscordClient from './soullink/discord-client';

const {
    KeepAliveIntervalMS,
    CleanConnectionIntervalMS
} = APIConstants;

let slotConnections = new Set(),
    slConnections = new Set(),
    deadConnectionInterval,
    router;

class API extends EventEmitter {
    constructor() {
        super();

        this.Router = this.Router.bind(this);
    }
    
    init(app) {
        router = new express.Router();
        router.get(/^\/slot\/([1-6]|all)$/i, getSlot);
        router.get('/reset', reset);
        router.post('/update', update);

        if (Nuzlocke.enabled) {
            // Nuzlocke/SoulLink manager
            router.ws('/dashboard', getDashboard);
            
            // TODO
            // router.ws('/graveyard', getGraveyard);
        }
        
        clearInterval(cleanDeadConnections);
        setInterval(cleanDeadConnections, CleanConnectionIntervalMS);
    }

    Router(req, res, next) {
        router(req, res, next);
    }
}

function cleanDeadConnections() {
    let deadConnections = 0;
    for (let conn of slotConnections) {
        if (conn.res.connection.destroyed) {
            deadConnections++;
            slotConnections.delete(conn);
        }
    }
    
    if (deadConnections) {
        console.debug(`Removed ${deadConnections} dead connections.`);
    }
}

function sseKeepAlive() {
    if (!this.res.connection.destroyed) {
        this.res.sseSend('// noop');
    } else {
        clearInterval(this.keepAlive);
    }
}

function getSlot(req, res, next) {
    if (!res.sseSetup()) {
        // happens when the host is the wrong origin
        return;
    }
    
    let locale = getLocaleString(req),
        slot, 
        conn = {
            userAgent: useragent.parse(req.headers['user-agent']).toAgent(),
            time: new Date().toLocaleTimeString(locale),
            res: res,
        };

    conn.keepAlive = setInterval(sseKeepAlive.bind(conn), KeepAliveIntervalMS);

    if (req.params[0] === 'all') {
        slot = 'all';
        console.info(`Acquired connection for all slots.  User-agent: ${conn.userAgent}.`);
        
        res.sseSend(PM.slots);
    } else {
        slot = parseInt(req.params[0]) - 1;
        console.info(`Acquired connection for slot ${slot}.  User-agent: ${conn.userAgent}.`);
        
        res.sseSend(PM.slots[slot]);
    }
    
    conn.slot = slot;
    slotConnections.add(conn);
    
    req.on('close', (function () {
        console.debug(`Connection closed.`);
        slotConnections.delete(this);
        console.debug(`Remaining open connections: ${slotConnections.size}`);
    }).bind(conn));
    
    console.debug(`Open connections: ${slotConnections.size}`);
    next();
}

function reset(req, res, next) {
    console.log('Sending reset to all slot connections');
    let sentTo = 0;
    for (let conn of slotConnections) {
        conn.res.sseSend('reset');
        sentTo++;
    }
    
    console.debug(`Sent reset to ${sentTo} connections`);
    
    res.sendStatus(200);
}

async function update(req, res, next) {
    console.info(`Received update on from Lua script`);
    // console.debug(JSON.stringify(req.body, null, 2));
    
    let hadError = false;
    let slotsToSend = [];
    
    try
    {
        for (let data of req.body) {
            let { slot, box, changeId, pokemon } = data,
                isBox = !!box;
            slot--;
            box && box--;

            if (pokemon === undefined) {
                // shouldn't happen
                continue;
            } else if (pokemon) {
                pokemon.generation = parseInt(req.header('Pokemon-Generation'));
                pokemon.gameVersion = req.header('Pokemon-Game');
            }

            let pkmn = pokemon ? new Pokemon(pokemon) : null;
            if (!pkmn) {
                if (!isBox) {
                    slotsToSend.push(PM.setSlotEmpty(slot));
                } else {
                    continue;
                }
            } else {
                pkmn = await PM.registerPokemon(pkmn);

                let s = PM.setSlot(slot, new Slot(slot, pkmn.pid, box));
                slotsToSend.push(s);
            }
        }
    } catch (ex) {
        console.error(ex);
        hadError = true;
    }
    
    if (!hadError) {
        res.sendStatus(200);
        next();
    } else {
        res.sendStatus(400);
        next();
    }

    sendSlots(slotsToSend.filter(s => !s.isBox));

    let messages = slotsToSend.map(s => {
        if (!s || !s.pokemon || s.pokemon.isEmpty) { 
            return null; 
        }

        if (!s.pokemon.previouslyKnown) {
            return {
                messageType: 'add-pokemon',
                pokemon: s.pokemon
            };
        } else if (s.pokemon.previouslyKnown.species !== s.pokemon.species) {
            return {
                messageType: 'update-link',
                pid: s.pid,
                pokemon: s.pokemon
            };
        } else if (s.pokemon.sendKill) {
            return {
                messageType: 'kill-pokemon',
                pid: s.pokemon.pid
            };
        }

        return null;
    }).filter(msg => msg !== null);

    sendSLMessages(messages);
}

DiscordClient.on('connection-status-change', (status, partnerStatus) => {
    sendSLMessages({ messageType: 'discord-status', status, partnerStatus });
});

SoulLink.on('update', links => {
    let slMessages = [];
    for (let [pid, link] of Array.from(links.entries())) {
        if (!PM.knownPokemon[pid]) {
            // happens when our partner knows about one of our pokemon that we do not
            // register an empty pokemon so that when we do learn of ours, it gets sent out to the proper clients
            let empty = new Pokemon();
            empty.pid = pid;
            PM.registerPokemon(empty);
            continue;
        }

        if (!PM.knownPokemon[pid].previouslyKnown) {
            slMessages.push({
                messageType: 'add-pokemon',
                pokemon: PM.knownPokemon[pid],
            });
        }

        slMessages.push({
            messageType: 'update-link',
            pid,
            link
        });
    }

    sendSLMessages(slMessages);

    let slotsToSend = [];
    for (let slot of PM.slots) {
        if (!slot || !slot.pokemon || slot.pokemon.pid === -1 || !links.has(slot.pokemon.pid)) { 
            continue; 
        }

        slotsToSend.push(slot);
    }

    sendSlots(slotsToSend);
}).on('add-unlinked-partner-pokemon', pokemon => {
    sendSLMessages({
        messageType: 'add-unlinked-partner-pokemon',
        pokemon: pokemon
    });
}).on('partner-new-game', () => {
    // clear all data
    sendSLMessages({
        messageType: 'new-game'
    });

    // send our pokemon back
    for (let conn of slConnections) {
        sendSLConnAllPokemon(conn, false);
    }
}).on('error', e => {
    sendSLMessages({
        messageType: 'error',
        pid: e.pid,
        errorMessage: e.errorMessage
    });
});

Nuzlocke.on('revivedPokemon', async pid => {
    let pokemon = PM.knownPokemon[pid];
    pokemon.dead = false;
    pokemon.isVoid = false;
    await PM.registerPokemon(pokemon);
    if (SoulLink.autoLinking && pokemon.linkPid) {
        let link = PM.knownSLPokemon[pokemon.linkPid];
        link.dead = false;
        link.isVoid = false;
        PM.registerPartnerPokemon(link);
        // note: don't need to send pokemon via SoulLink as it happens in PM.registerPokemon()
    }

    sendSLMessages({
        messageType: 'revive-pokemon',
        pid
    });
    
    sendSlots(PM.slots.filter(s => s && s.pid === pid));
});

Nuzlocke.on('addedVoidPokemon', async pid => {
    let pokemon = PM.knownPokemon[pid];
    await PM.registerPokemon(pokemon);
    sendSLMessages({
        messageType: 'void-pokemon',
        pid
    });

    let slot = PM.slots.filter(s => s && s.pid === pid);
    if (slot.length) {
        slot[0].pokemon.isVoid = true;
        sendSlots(slot);
    }
});

Nuzlocke.on('addedDeadPokemon', async pid => {
    let pokemon = PM.knownPokemon[pid];
    await PM.registerPokemon(pokemon);
    sendSLMessages({
        messageType: 'kill-pokemon',
        pid
    });

    let slot = PM.slots.filter(s => s && s.pid === pid);
    if (slot.length) {
        slot[0].pokemon.dead = true;
        sendSlots(slot);
    }
});

function sendSLMessages(messages, predicate) {
    for (let msg of Array.makeArray(messages)) {
        if (!predicate || predicate(msg)) {
            for (let conn of slConnections) {
                conn.send(JSON.stringify(msg));
            }
        }
    }
}

function sendSlots(slotsToSend) {
    if (!slotsToSend.length) {
        return;
    }

    for (let conn of slotConnections) {
        if (conn.slot === 'all') {
            conn.res.sseSend(slotsToSend);
        } else {
            conn.res.sseSend(PM.slots[conn.slot]);
        }
    }
}

function getDashboard(ws, req) {
    console.debug('Setting up Dashboard WebSocket connection');
    ws.on('open', function () {
        console.info('Connection opened');
    });

    ws.on('message', async function (e) {
        try {
            let msg = JSON.parse(e);
            console.debug(`Received ${msg.messageType} message from client`);
            switch (msg.messageType) {
                case 'update-link':
                    SoulLink.setLink(msg.pid, msg.link);
                    break;

                case 'unlink':
                    SoulLink.setLink(msg.pid, null);
                    break;

                case 'revive-pokemon':
                    Nuzlocke.revivePokemon(msg.pid);
                    break;

                case 'void-pokemon':
                    Nuzlocke.addVoidPokemon(msg.pid);
                    break;

                case 'kill-pokemon':
                    // called by SoulLink manager when a link's pokemon is dead
                    Nuzlocke.addDeadPokemon(msg.pid);
                    break;

                case 'refresh':
                    sendSLConnAllPokemon(this, true);
                    break;

                case 'new-game':
                    PM.reset();
                    Nuzlocke.reset();
                    SoulLink.reset();
                    sendSlots('reset');
                    sendSLMessages({ messageType: 'new-game' });
                    break;

                case 'set-static-pokemon':
                    let pokemon = PM.knownPokemon[msg.pid].clone();
                    pokemon.static = msg.setStatic;
                    await PM.registerPokemon(pokemon);
                    sendSLMessages(msg);
                    break;

                default:
                    console.error(`Unknown message type sent from SoulLink Manager: ${msg.messageType}`);
                    break;
            }
        } catch (err) {
            console.error(`Invalid message from SoulLink manager:\n${e}`);
            console.debug(err.stack);
        }
    });

    ws.on('close', (function () {
        console.debug('WebSocket connection closed');
        slConnections.delete(this);
    }).bind(ws));

    slConnections.add(ws);

    if (SoulLink.linkingMethod === 'discord') {
        ws.send(JSON.stringify({ 
            messageType: 'discord-status', 
            status: DiscordClient.connectionStatus,
            partnerStatus: DiscordClient.partnerConnectionStatus
        }));
    }

    sendSLConnAllPokemon(ws, true);
}

function sendSLConnAllPokemon(ws, isRefresh) {
    ws.send(JSON.stringify({ 
        messageType: 'discord-status', 
        status: DiscordClient.connectionStatus,
        partnerStatus: DiscordClient.partnerConnectionStatus 
    }));
    
    Object.values(PM.knownPokemon).map(p => ({
        messageType: 'add-pokemon',
        pokemon: p,
        isRefresh: isRefresh
    })).forEach(msg => ws.send(JSON.stringify(msg)));

    Object.values(PM.knownSLPokemon).filter(p => !p.linkPid).map(p => ({
        messageType: 'add-unlinked-partner-pokemon',
        pokemon: p,
        isRefresh: isRefresh
    })).forEach(msg => ws.send(JSON.stringify(msg)));

    ws.send(JSON.stringify({
        messageType: 'refresh-done'
    }));
}

const api = new API();
export default api;