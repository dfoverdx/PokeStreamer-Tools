import webpack from 'webpack';
import fs from 'fs';
import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import ExtractTextPlugin from 'extract-text-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import config from './server/parsed-config';

const NODE_ENV = (process.env.NODE_ENV || 'production').trim();

let webpackConfig = {
    entry: {
        app: './client/script.js',
    },
    
    output: {
        filename: 'script.js',
        path: path.resolve(__dirname, 'public')
    },

    optimization: {
        minimize: false,
    },
    
    resolveLoader: {
        alias: {
            'js-to-sass-loader': path.resolve(__dirname, 'webpack/js-to-sass-loader'),
            'remove-json-comments-loader': path.resolve(__dirname, 'webpack/remove-json-comments-loader')
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
                loader: 'remove-json-comments-loader',
            },
            {
                test: /\.s[ca]ss$/,
                exclude: /node_modules/,
                use: ExtractTextPlugin.extract({
                    fallback: 'style-loader',
                    use: [
                        { loader: 'css-loader' },
                        { loader: 'sass-loader' },
                        { loader: 'js-to-sass-loader' },
                    ]
                }),
            },
            {
                test: /\.ejs$/,
                loader: 'ejs-loader',
            }
        ],
    },
    
    plugins: [
        new webpack.DefinePlugin({
            NUM_SLOTS: 6,
            ALL_IN_ONE: config.layout.allInOne,
            ENVIRONMENT: NODE_ENV,
            config: JSON.stringify(config),
        }),
        new webpack.ProvidePlugin({
            _: 'lodash',
        }),
        new ExtractTextPlugin({ filename: 'style.css' }),
        new HtmlWebpackPlugin({
            template: '!!ejs-loader!./client/index.ejs',
            filename: 'index.html',
            inject: 'body',
            cache: true,
        }),
        new webpack.SourceMapDevToolPlugin({
            test: /\.js$/,
            filename: '[file].map',
            publicPath: '/',
            
        })
    ],
    
    externals: [
        { jquery: '$' },
    ]
};

if (config.nuzlocke.deathSound && config.nuzlocke.deathSound.enabled) {
    let soundFileName = config.nuzlocke.deathSound.filePath,
    possiblePaths = [
        path.resolve(__dirname, 'resources', soundFileName),
        path.resolve(__dirname, soundFileName),
        path.resolve(soundFileName)
    ],
    soundPath = null;
    
    for (let p of possiblePaths) {
        if (fs.existsSync(p)) {
            soundPath = p;
            break;
        }
    }
    
    if (soundPath) {
        webpackConfig.plugins.push(
            new CopyWebpackPlugin([{ 
                from: soundPath,
                to: `${config.nuzlocke.deathSound.filePath}`
            }])
        );
    }
}

module.exports = webpackConfig;