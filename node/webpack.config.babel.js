import webpack from 'webpack';
import fs from 'fs';
import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import './common/extensions';
import compileConfig from './common/configCompiler';

function genConfig(env, options) {
    const config = compileConfig(),
        isDevServer = path.basename(require.main.filename) === 'webpack-dev-server.js',
        isHot = isDevServer && options.hot;

    const NODE_ENV = (options.mode || process.env.NODE_ENV || 'production').trim(),
        isProd = NODE_ENV === 'production',
        isDev = !isProd,
        host = `${config.server.host}:${config.server.port}`;

    function addDevServer(entry) {
        let entries = Array.makeArray(entry);

        if (isHot) {
            entries.push('webpack/hot/only-dev-server');
        }

        if (isDevServer) {
            entries.push(`webpack-dev-server/client?http://${host}`);
        }

        return entries;
    }

    /** @type {webpack.Configuration} */
    let webpackConfig = {
        entry: {
            index: addDevServer('./client/slot-display/index'),
            dashboard: addDevServer('./client/dashboard/index'),
            vendors: ['lodash'],
        },

        output: {
            // filename: opt => opt.chunk.name === 'index' ? 'index.js' : '[name]/[name].js',
            filename: '[name].js',
            chunkFilename: '[name].js',
            path: path.resolve(__dirname, 'public'),
            // publicPath: '/',
        },

        optimization: {
            minimize: isProd,
        },

        resolve: {
            alias: {
                'config.json': path.resolve(__dirname, 'config.json'),
                'pokedex': path.resolve(__dirname, 'common/pokedex'),
            }
        },

        resolveLoader: {
            alias: {
                'js-to-sass-loader': path.resolve(__dirname, 'webpack/js-to-sass-loader'),
                'config-compiler-loader': path.resolve(__dirname, 'webpack/config-compiler-loader')
            }
        },

        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude: /node_modules/,
                    loader: 'babel-loader',
                },
                {
                    test: /\.json$/,
                    exclude: /node_modules/,
                    loader: 'config-compiler-loader',
                },
                {
                    test: /\.s[ca]ss$/,
                    exclude: /node_modules/,
                    use: isHot
                        ? [
                            'style-loader',
                            'css-loader',
                            'sass-loader',
                            'js-to-sass-loader'
                        ]
                        : [
                            MiniCssExtractPlugin.loader,
                            'css-loader',
                            'sass-loader',
                            'js-to-sass-loader',
                        ],
                },
                {
                    test: /\.ejs$/,
                    loader: 'ejs-loader',
                    options: {
                        esModule: false,
                    }
                },
                {
                    test: /\.png$/,
                    use: [
                        'url-loader'
                    ]
                }
            ],
        },

        plugins: [],

        externals: [
            { jquery: '$' },
        ],

        devServer: {
            hot: isHot,
            overlay: true,
            contentBase: path.join(__dirname, 'public'),
            host: config.server.host,
            port: config.server.port,
            allowedHosts: [
                `api.${config.server.host}`,
            ],
            proxy: {
                '/api': {
                    target: `http://api.${config.server.host}:${config.server.devServerPort}/`,
                    secure: false,
                    ws: true
                }
            },
        }
    };

    function addPlugins(plugins) {
        for (let plugin of plugins) {
            webpackConfig.plugins.push(plugin);
        }
    }

    addPlugins([
        new webpack.DefinePlugin({
            NUM_SLOTS: 6,
            ENVIRONMENT: NODE_ENV,
            IS_HOT: isHot,

            ALL_IN_ONE: config.layout.allInOne,
            API_BASE_URL: `'api.${host}/api'`,

            NUZLOCKE_ENABLED: config.death.nuzlocke,

            SOULLINK_ENABLED: config.death.nuzlocke && config.soulLink.enabled,
            LINKING_METHOD: `'${config.soulLink.linking.method}'`,
            MANUAL_LINKING: config.soulLink.linking.method === 'manual',
        }),
        new webpack.ProvidePlugin({
            _: 'lodash',
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: './resources/*.png', flatten: true },
                { from: './resources/*.js', flatten: true },
            ],
        }),
        new MiniCssExtractPlugin({
            filename: '[name].css',
        }),
        new HtmlWebpackPlugin({
            template: '!!ejs-loader?esModule=false!./client/slot-display/index.ejs',
            filename: 'index.html',
            chunks: ['index'],
            inject: 'body',
            cache: true
        }),
        new HtmlWebpackPlugin({
            template: '!!ejs-loader?esModule=false!./client/dashboard/index.ejs',
            filename: 'dashboard/index.html',
            chunks: ['dashboard'],
            inject: 'body',
            cache: true
        }),
    ]);

    if (isDev || isHot) {
        addPlugins([
            new webpack.SourceMapDevToolPlugin({
                test: /\.js$|\.s?css$/,
                filename: '[file].map',
                exclude: ['vendors.js'],
                // publicPath: '/',
            }),
        ]);
    }

    let death = config.death,
        soulLink = config.soulLink;
    if (death.sound && death.sound.enabled) {
        const getSoundPath = function (soundFileName) {
            let p = path.resolve(__dirname, 'resources', soundFileName);
            if (fs.existsSync(p)) {
                return p;
            }

            console.warn(`Could not find specified sound file at '${p}'. Skipping.`);
            return null;
        };

        const copySounds = function (deathSounds) {
            if (deathSounds.constructor === String) {
                deathSounds = [deathSounds];
            }

            for (let soundPath of deathSounds) {
                soundPath = getSoundPath(soundPath);
                if (soundPath) {
                    webpackConfig.plugins.push(
                        new CopyWebpackPlugin({
                            patterns: [{
                                from: soundPath,
                                to: path.parse(soundPath).base
                            }]
                        })
                    );
                }
            }
        };

        copySounds(death.sound.filePath);

        if (soulLink.deathSound && soulLink.deathSound.enabled && soulLink.deathSound.filePath) {
            copySounds(soulLink.deathSound.filePath);
        }
    }

    return webpackConfig;
}

export default genConfig;