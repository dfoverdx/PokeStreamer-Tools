import path from 'path';
import { DepGraph } from 'dependency-graph';
import _ from 'lodash';
import { findSassVariableReferences } from './sass-helper';

const importRegex = /@import\s+'([^']+\.js)'\s*;/ig;

function validateExportType(data) {
    if (!_.isObject(data)) {
        throw new Error(`Export must be an object.`);
    }
}

/**
 * @param {Record<string, any>} data
 */
function transform(data) {
    validateExportType(data);
    const dg = new DepGraph();

    for (const [key, val] of Object.entries(data)) {
        if (key.startsWith('%')) {
            dg.addNode(key);
            for (const propVal of Object.values(val)) {
                findSassVariableReferences(propVal).forEach(v => {
                    v = v.slice(1);
                    if (!dg.hasNode(v)) {
                        dg.addNode(v);
                    }

                    dg.addDependency(key, v);
                });
            }

            const css = Object.keys(val).map(k => `    ${k}: ${val[k] || 'inherit'};`).join('\n');
            dg.setNodeData(key, `${key} {\n${css}\n}`);
        } else if (isValidKey(key)) {
            dg.addNode(key);
            const varVal = parseValue(data[key]);
            findSassVariableReferences(varVal).forEach(v => {
                v = v.slice(1);
                if (!dg.hasNode(v)) {
                    dg.addNode(v);
                }
                dg.addDependency(key, v);
            });

            dg.setNodeData(key, `$${key}: ${varVal};`);
        } else {
            console.warn(`Invalid key '${key}'.  Skipping.`);
        }
    }

    const scss = dg.overallOrder().map(k => dg.getNodeData(k)).join('\n');
    return scss;
}

/**
 * @param {string} key
 */
function isValidKey(key) {
    return /^[^$@%:].*/.test(key);
}

/**
 * @param {any} value
 */
function parseValue(value) {
    if (_.isArray(value)) {
        return parseList(value);
    } else if (_.isPlainObject(value)) {
        return parseMap(value);
    } else if (value === '') {
        return '""';
    } else if (_.isString(value) && shouldWrapInStrings(value)) {
        return `"${value}"`;
    } else {
        return value;
    }
}

/**
 * @param {any[]} list
 * @returns {string}
 */
function parseList(list) {
    return `(${list.map(v => parseValue(v)).join(',')})`;
}

/**
 * @param {Record<string, any>} map
 * @returns {string}
 */
function parseMap(map) {
    return `(${Object.keys(map)
        .filter(key => isValidKey(key))
        .map(key => `${key}: ${parseValue(map[key])}`)
        .join(',')})`;
}

/**
 * @param {string} input
 */
function shouldWrapInStrings(input) {
    const inputWithoutFunctions = input.replace(/[a-zA-Z]+\([^)]*\)/, ""); // Remove functions
    return inputWithoutFunctions.includes(',');
}

/**
 * @this {webpack.loader.LoaderContext}
 * @param {string | Buffer} content
 **/
export default function JsToSassLoader(content) {
    return content.toString().replace(importRegex, (match, relativePath) => {
        if (match) {
            let filePath = path.join(this.context, relativePath);
            this.addDependency(filePath);

            // prevent cacheing of the module
            delete require.cache[require.resolve(filePath)];
            let js = require(filePath);
            for (let dep of js.dependencies) {
                this.addDependency(dep);
            }

            return transform(js.default);
        }
    });
}