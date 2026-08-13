import { createRequire } from 'node:module';
import version from './version.js';
import * as values from './values/index.js';
import DXNError from './error.js';

const require = createRequire(import.meta.url);
const parser = require('./text/parser.cjs');
const printer = require('./text/printer.cjs');
const formatter = require('./text/formatter.cjs');
const binaryEncoder = require('./binary/encoder.cjs');
const binaryDecoder = require('./binary/decoder.cjs');

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

/** @param {Uint8Array} bytes @param {{trusted?: boolean}} [opts] @returns {unknown} */
function decodeBinary(bytes, opts = {}) {
  try {
    return binaryDecoder.decode(bytes, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'binary');
  }
}

/** @param {unknown} value @param {{[k: string]: unknown}} [opts] @returns {Buffer} */
function encodeBinary(value, opts = {}) {
  try {
    return binaryEncoder.encode(value, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'binary');
  }
}

export { version, decode, encode, decodeBinary, encodeBinary, DXNError };
export * from './values/index.js';

export default { version, decode, encode, decodeBinary, encodeBinary, DXNError, ...values };
