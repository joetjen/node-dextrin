import { createRequire } from 'node:module';
import version from './version.js';
import * as values from './values/index.js';
import DXNError from './error.js';

const require = createRequire(import.meta.url);
const parser = require('./text/parser.cjs');
const printer = require('./text/printer.cjs');
const formatter = require('./text/formatter.cjs');

/** @param {string} text @param {{trusted?: boolean}} [opts] @returns {unknown} */
function decode(text, opts = {}) {
  try {
    return parser.parse(text, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'parse');
  }
}

/** @param {unknown} value @param {{pretty?: boolean, indent?: number}} [opts] @returns {string} */
function encode(value, opts = {}) {
  try {
    return opts.pretty ? formatter.pretty(value, opts) : printer.print(value, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'encode');
  }
}

export { version, decode, encode, DXNError };
export * from './values/index.js';

export default { version, decode, encode, DXNError, ...values };
