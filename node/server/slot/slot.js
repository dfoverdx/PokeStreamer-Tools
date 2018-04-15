import VA from '../validate-argument';
import Pokemon from '../pokemon/pokemon';

class Slot {
    constructor(slot, pokemon, box) {
        this.isBox = Number.isInteger(box);
        if (this.isBox) {
            this.box = VA.boundedInt(box, 'box', 0, 17) + 1;
            this.slot = VA.boundedInt(slot, 'slot', 0, 29) + 1;
        } else {
            this.slot = VA.boundedInt(slot, 'slot', 0, 5) + 1;
        }

        // this.changeId = VA.int(changeId, 'changeId');
        this.pokemon = VA.hasValue(pokemon, 'pokemon');
    }

    get soulLinkPokemon() {
        if (this._soulLinkPokemon) {
            return this._soulLinkPokemon;
        }
    }

    toJSON() {
        return {
            // box: this.box,
            slot: this.slot,
            // changeId: this.changeId,
            pokemon: this.pokemon,
            slPokemon: this.soulLinkPokemon,
        };
    }

    static empty(slot) {
        slot = VA.boundedInt(slot, 'slot', 0, 5, 
            `Argument 'slot' must be between 0 and 5 (0-indexed value between 1 and 6).  Found '${slot}'.`);

        // let cid = changeId === undefined ? -1 : changeId;
        // changeId = VA.int(cid, 'changeId', `Argument 'changeId' must be a valid integer or undefined.  Found ${changeId}.`);

        return new Slot(slot, Pokemon.empty);
    }

    // static emptyBox(box, slot) {
    //     box = VA.boundedInt(box, 'box', 0, 17);
    //     slot = VA.boundedInt(slot, 'slot', 0, 29);

    //     // let cid = changeId === undefined ? -1 : changeId;
    //     // changeId = VA.int(cid, 'changeId', `Argument 'changeId' must be a valid integer or undefined.  Found ${changeId}.`);

    //     return new Slot(slot, Pokemon.empty, box);
    // };
}

export default Slot;