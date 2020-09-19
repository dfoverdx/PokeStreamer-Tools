import webpack from 'webpack';
import path from 'path';
import json5 from 'json5';
import compileConfig from '../common/configCompiler';

/**
 * @this {webpack.loader.LoaderContext}
 * @param {string | Buffer} source
 **/
export default function ConfigCompilerLoader(source) {
    const baseConfig = json5.parse(source.toString());
    if (source === 'config.json') {
        this.addDependency(path.join(this.context, 'common/config.empty.json'));
        this.addDependency(path.join(this.context, baseConfig.advancedConfig));
    }

    if (baseConfig.configOverride) {
        switch (baseConfig.configOverride.constructor) {
            case String:
                this.addDependency(path.join(this.context, baseConfig.configOverride));
                break;

            case Array:
                baseConfig.configOverride.forEach(file => this.addDependency(path.join(this.context, file)));
                break;
        }
    } else {
        return JSON.stringify(baseConfig);
    }

    return JSON.stringify(compileConfig(baseConfig));
}