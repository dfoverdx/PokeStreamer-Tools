import 'colors';
import '../common/extensions/array';
import compileConfig from '../common/configCompiler';

try {
    let config = compileConfig();
    console.log(`All referenced config files have valid syntax.\n`.green);
    console.log(`Config files validated:`);
    console.log([
        './config.json',
        ...Array.makeArray(config.configOverride),
        config.advancedConfig,
        './common/config.empty.json'
    ].map(f => `• ${f.white}`.gray).join('\n'));
    process.exit(0);
} catch (err) {
    console.error(err.message);
    process.exit(1);
}