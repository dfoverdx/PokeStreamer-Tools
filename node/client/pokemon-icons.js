import Pokedex from 'pokedex';

class PokemonIcons {
    constructor() {
        let req = require.context('../pokemon-icons/regular', false, /\.png$/);
        req.keys().forEach(fn => {
            let species = /([-a-zA-Z0-9]+)\.png$/.exec(fn)[1];
            this[species] = { regular: req(fn).default };
        });

        req = require.context('../pokemon-icons/shiny', false, /\.png$/);
        req.keys().forEach(fn => {
            let species = /([-a-zA-Z0-9]+)\.png$/.exec(fn)[1];
            this[species].shiny = req(fn).default;
        });

        let egg = require('../pokemon-icons/egg.png');
        this.egg = { regular: egg, shiny: egg };
    }

    getIcon(pokemon) {
        if (pokemon.isEgg) {
            return this.egg.regular;
        }

        if (pokemon.alteredForm) {
            let file = `${Pokedex.FileNames[pokemon.species]}-${pokemon.alteredForm}`;
            if (this[file]) {
                return this[file][pokemon.isShiny ? 'shiny' : 'regular'];
            }
        }

        return this[Pokedex.FileNames[pokemon.species]][pokemon.isShiny ? 'shiny' : 'regular'];
    }
}

const pi = new PokemonIcons();
export default pi;