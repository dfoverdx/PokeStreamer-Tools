import Config from './config';
import args from './args';

const ERROR = 'error',
    ERROR_IGNORE = 'error-ignore',
    WARNING = 'warning';

class AssertionResult {
    constructor(isValid, message, severity) {
        this.isValid = isValid;
        this.message = message;
        this.severity = severity || WARNING;
    }
}

class Assertion {
    constructor(test, message, severity) {
        this.test = test;
        this.message = message;
        this.severity = severity || WARNING;
    }

    get result() {
        if (!this.test.call(Config.Current)) {
            return new AssertionResult(false, this.message, this.severity);
        } else {
            return new AssertionResult(true);
        }
    }
}

const Validations = {
    soulLink: {
        genSupported: new Assertion(c => !c.nuzlocke.enabled || !c.nuzlocke.soulLink.enabled || c.generation === 4,
            `Currently only gen IV games are supported with Soul Link.  Found ${c.generation}.`, ERROR),
        nuzlockeDisabled: new Assertion(c => !c.soulLink.enabled || c.nuzlocke.enabled,
            `Soul Link was enabled but Nuzlocke was disabled.  Ignoring Soul Link.`),
    },
    style: {
        nonTransparentBackground: new Assertion(c => 
                args.isDebug || !c.style['%body'].background || c.style['%body'].background === 'transparent',
            `%body background is not 'transparent'`),
    }
};

function validateConfig(validationSet, validationSetName) {
    if (!validationSet) {
        console.log('Validating config...');
    }

    validationSet = validationSet || Validations;
    validationSetName = validationSetName ? validationSetName + '-' : '';
    
    for (let [name, validation] of Object.entries()) {
        name = validationSetName + name;
        if (validation instanceof Assertion) {
            let result = validation.result;
            if (!result.isValid) {
                let msg = `${result.severity}: Config failed ${name} validation: ${result.message}`;
                switch (result.severity) {
                    case ERROR:
                        throw new Error(msg);
                    case ERROR_IGNORE:
                        console.error(msg);
                        break;
                    case WARN:
                        console.warn(msg);
                        break;
                }
            }
        } else {
            validateConfig(validation, validationSetName);
        }
    }
}

validateConfig();
Config.on('update', validateConfig);