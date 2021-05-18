import Discord from 'discord.js';
import EventEmitter from 'events';
import { TimeoutError } from '../../common/error';
import CleanupProcess from '../cleanup-process';
import Config from '../config';
import { parseMessage } from './message';
import SoulLink from './soullink';

const MAX_MESSAGE_LENGTH = 2000;

class DiscordClient extends EventEmitter {
    constructor() {
        super();
        this._client = null;
        this._channel = null;
        this._channelId = null;
        this._partnerBot = null;
        this._messageQueue = [];
        this._messageBatchInterval = 0;
        this._reconnectionTimeout = 0;

        Config.on('update', this._handleConfigChange.bind(this));
        this._updateBot = this._updateBot.bind(this);
        CleanupProcess(this.close);
    }

    async open() {
        if (!SoulLink.enabled) {
            console.error('SoulLink is not enabled in config.json.  Aborting.');
            return;
        }

        if (SoulLink.linkingMethod !== 'discord') {
            console.error(`SoulLink linking method is not set to 'discord' in config.json.  Aborting.`);
            return;
        }

        if (this._client &&
            this._client.ws.connection !== null &&
            this._client.status !== Discord.Constants.Status.DISCONNECTED) {
            console.warn('Discord client is already initialized.  Skipping.');
            return;
        }

        console.info('Opening Discord connection...');

        let discordConfig = Config.soulLink.linking.discord,
            c = this._createClient(),
            cc = discordConfig.channel;

        try {
            await this._client.login(discordConfig.botToken);

            if (!c.user.bot) {
                console.error(`Discord user ${c.user.tag} is not a bot!  If Discord catches you doing this, your account may be terminated.  You have been warned.`);
            } else {
                console.info(`Logged into Discord as ${c.user.tag}`);
            }
        } catch (err) {
            console.error(`Login to client failed:\n${err})`);
            return;
        }

        try {
            let match = /([^#]+)#(.+)$/.exec(cc);
            if (!match) {
                throw new Error(`Invalid channel specified in config.json: ${cc}.  Channel must be of the form 'your-discord-server#your-private-channel'.`);
            }

            let [ , g, ch ] = match;

            let guild = c.guilds.find('name', g);
            if (!guild) {
                throw new Error(`ERROR: Could not find Discord server '${g}'.  Likely there was a typo in the server name or the user token you specified does not have access to the server.`);
            }

            if (!guild.available) {
                throw new Error(`ERROR: Specified server '${g}' is not currently available due to a server outage.`);
            }

            let channel = this._channel = guild.channels.find('name', ch);
            if (!channel) {
                throw new Error(`ERROR: Could not find channel '${ch}' on Discord server '${g}'.  Likely there was a typo in your channel name or the user token you specified does not have access to the channel.`);
            }

            this._channelId = channel.id;
            console.log(`Listening to ${g}#${ch} (id: ${channel.id})`);
        } catch (err) {
            console.error(err);
            this.emit('connection-status-change', 'close');
            return;
        }

        try {
            this._setPartnerBot();
        } catch (err) {
            console.error(err);
            this.emit('connection-status-change', this.connectionStatus, 'offline');
            return;
        }
    }

    async close() {
        if (this._client) {
            console.log('Discord client is closing.');
            await this._client.destroy();
            this._client = null;
            clearInterval(this._messageBatchInterval);
        }
    }

    async destroy() {
        await this.close();
        this.removeAllListeners();
    }

    get connectionStatus() {
        if (!SoulLink.enabled || SoulLink.linkingMethod !== 'discord') {
            return 'disabled';
        }

        if (this._client) {
            try {
                switch (this._client.status) {
                    case Discord.Constants.Status.CONNECTING:
                    case Discord.Constants.Status.RECONNECTING:
                    case Discord.Constants.Status.IDLE:
                        return 'connecting';

                    case Discord.Constants.Status.READY:
                        return 'open';

                    case Discord.Constants.Status.DISCONNECTED:
                        return 'closed';

                    case Discord.Constants.Status.NEARLY:
                        return 'I have no idea...';
                }
            } catch (err) {
                // sometimes there's an error if connectionStatus is called after this._client is created but before
                // the Discord Client, itself, has initialized
                return 'connecting';
            }
        }

        return 'closed';
    }

    get partnerConnectionStatus() {
        if (!this.connectionStatus === 'open' || !this._partnerBot) {
            return 'offline';
        }

        return this._partnerBot.presence.status;
    }

    async waitForMessage(messageType, ttl = 3000) {
        return new Promise((resolve, reject) => {
            this.matchOnce(messageType, msg => msg.messageType === messageType, resolve, ttl,
                () => reject(new TimeoutError({ msg: `Waiting for message timed out after ${ttl / 1000} seconds`, ttl })));
        });
    }

    send(msg) {
        this._messageQueue.push(msg);
    }

    async _sendBatch() {
        if (!this._messageQueue.length) {
            return;
        }

        let msg = this._messageQueue;

        // empty the queue so that new messages may be added while we wait for a response from the client that our
        // message was sent
        // if the send fails, reinsert the failed message queue in front of the new messages
        this._messageQueue = [];
        if (this._partnerBot && this.partnerConnectionStatus === 'online') {
            try {
                let msgStr = JSON.stringify(msg);
                if (msgStr.length < MAX_MESSAGE_LENGTH) {
                    return await this._channel.send(msgStr);
                } else {
                    let msgFile = new Message.MessageFile(msgStr);
                    let result = await this._channel.send(msgFile, {
                        files: [msgFile.attachment]
                    });
                }
            } catch (err) {
                console.error(`Failed to send message via Discord client:\n${err}`);
                this._messageQueue = msg.concat(this._messageQueue);
            }
        } else {
            console.debug(`Partner's bot is offline.  Added message to queue.`);
        }
    }

    async _handleMessage(msg) {
        if (msg.channel.id !== this._channelId || msg.author.id !== this._partnerBot.id) {
            // either it's not the channel we're listening to, or our partner did not send this message
            return;
        }

        if (!msg.content) {
            // empty message
            return;
        }

        try
        {
            let message = await parseMessage(msg.content);
            if (Array.isArray(message)) {
                message.forEach(m => {
                    console.debug(`Received ${m.messageType} message from Discord partner`);
                    this.emit(m.messageType, m);
                });
            } else {
                console.debug(`Received ${message.messageType} message from Discord partner`);
                this.emit(message.messageType, message);
            }
        } catch (err) {
            console.dir(err);
            return;
        }
    }

    _handleConfigChange(p, n) {
        let pLink = p.soulLink.linking,
            nLink = n.soulLink.linking;

        if (p.soulLink.enabled !== n.soulLink.enabled ||
            pLink.method !== nLink.method ||
            nLink.method === 'discord' && pLink.discord.channel !== nLink.discord.channel) {
            if (n.soulLink.enabled && nLink.method === 'discord') {
                console.info(`SoulLink was enabled in config with Discord linking method.  Connecting to Discord...`);
                this.open();
            } else {
                console.info(`SoulLink was disabled or linking method was changed to manual.  Disconnecting from Discord...`);
                this.close();
            }
        }
    }

    _createClient() {
        let c = this._client = new Discord.Client();
        c.on('ready', () => {
            console.debug(`Discord client connected as '${c.user.tag}', client id: ${c.user.id}.`);
            this.emit('connection-status-change', 'open', this.partnerConnectionStatus);
            this._messageBatchInterval = setInterval(this._sendBatch.bind(this), 1000);
        });

        c.on('message', this._handleMessage.bind(this));

        c.on('reconnecting', () => {
            console.warn('Discord client lost connection.  Reconnecting...');
            this.emit('connection-status-change', 'reconnecting');
            clearTimeout(this._reconnectionTimeout);
            clearInterval(this._messageBatchInterval);
            this._reconnectionTimeout = setTimeout(() => {
                if (this.connectionStatus === 'open') {
                    this.emit('connection-status-change', 'open', this.partnerConnectionStatus);
                    this._messageBatchInterval = setInterval(this._sendBatch.bind(this), 1000);
                }
            }, 5600); // use the time value used in Discord.JS's WebSocketConnection.reconnect() + 100ms
        });

        c.on('disconnect', () => {
            console.debug('Discord Client disconnected');
            this.emit('connection-status-change', 'closed');
        });

        c.on('error', err => {
            console.error(`ERROR in connection to Discord: ${err.message}`);
            clearTimeout(this._reconnectionTimeout);
            this.emit('connection-error');
        });

        return c;
    }

    _updateBot(oldBot, newBot) {
        if (newBot.id !== this._partnerBot.id) {
            return;
        }

        this._partnerBot = newBot;
        let botStatus = newBot.presence.status;
        if (botStatus !== oldBot.presence.status) {
            this.emit('connection-status-change', 'open', botStatus);

            if (botStatus === 'online') {
                console.info(`Partner bot came online.`);
            } else {
                console.warn(`Partner bot went offline.`);
            }
        }
    }

    async _setPartnerBot() {
        let discordConfig = Config.soulLink.linking.discord;
        let match = /([^#]+)#(\d{4})/.exec(discordConfig.partnerBotTag);
        if (!match) {
            throw new Error(`ERROR: Invalid partnerBotTag in config: ${discordConfig.partnerBotTag}`);
        }

        let [_, botName, discriminator] = match,
            bot;

        this._partnerBot = this._channel.members.findAll('displayName', botName).filter(m => m.user.discriminator === discriminator);

        if (!this._partnerBot.length) {
            throw new Error(`ERROR: Your partner's bot '${discordConfig.partnerBotTag}' is not a member of the channel ${discordConfig.channel}`);
        } else {
            bot = this._partnerBot = this._partnerBot[0];
        }

        if (!bot.user.bot) {
            console.warn(`Partner bot is a Discord user rather than a Discord bot.`);
        }

        if (this._client) {
            // happens when we enable soullink in config without restarting server
            this._client.removeListener('presenceUpdate', this._updateBot);
            this._client.on('presenceUpdate', this._updateBot);
        }

        if (bot.presence.status === 'online') {
            console.info(`Partner bot is online.`);
            this.emit('connection-status-change', 'open', 'online');
        } else {
            console.warn(`Partner bot is not online.`);
            this.emit('connection-status-change', 'open', 'offline');
        }
    }
}

const dc = new DiscordClient();
export default dc;