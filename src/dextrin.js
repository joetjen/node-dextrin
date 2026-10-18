import { createRequire } from 'node:module';
import version from './version.js';
import * as values from './values/index.js';
import DXNError from './error.js';
import Registry from './registry.js';

const require = createRequire(import.meta.url);
const parser = require('./text/parser.cjs');
const printer = require('./text/printer.cjs');
const formatter = require('./text/formatter.cjs');
const binaryEncoder = require('./binary/encoder.cjs');
const binaryDecoder = require('./binary/decoder.cjs');
const Schema = require('./schema.cjs');
const Std = require('./schema/std.cjs');
const FileResolver = require('./schema/file-resolver.cjs');
const { canonical } = require('./canonical.cjs');
const { answer } = require('./conformance.cjs');

/** @param {string} text @param {{trusted?: boolean, registry?: Registry}} [opts] @returns {unknown} */
function decode(text, opts = {}) {
  try {
    return parser.parse(text, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'parse');
  }
}

/**
 * @param {unknown} value
 * @param {{pretty?: boolean, indent?: number, registry?: Registry, validate?: boolean, coerce?: boolean, schema?: string}} [opts]
 * @returns {string}
 */
function encode(value, opts = {}) {
  try {
    const validated = maybeValidateEncode(value, opts);
    return opts.pretty ? formatter.pretty(validated, opts) : printer.print(validated, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'encode');
  }
}

/** @param {Uint8Array} bytes @param {{trusted?: boolean, registry?: Registry}} [opts] @returns {unknown} */
function decodeBinary(bytes, opts = {}) {
  try {
    return binaryDecoder.decode(bytes, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'binary');
  }
}

/**
 * @param {unknown} value
 * @param {{registry?: Registry, validate?: boolean, coerce?: boolean, schema?: string, [k: string]: unknown}} [opts]
 * @returns {Buffer}
 */
function encodeBinary(value, opts = {}) {
  try {
    const validated = maybeValidateEncode(value, opts);
    return binaryEncoder.encode(validated, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'binary');
  }
}

/**
 * @param {unknown} value
 * @param {{registry?: Registry, validate?: boolean, coerce?: boolean, schema?: string}} opts
 * @returns {unknown}
 */
function maybeValidateEncode(value, opts) {
  const registry = opts.registry ?? new Registry();
  const coerceOpts = { coerce: opts.coerce ?? true };

  let result = value;
  if (opts.validate ?? true) {
    result = Schema.validateEncodeTree(result, registry, coerceOpts);
  }
  if (opts.schema !== undefined) {
    result = Schema.validateEncode(result, registry, opts.schema, coerceOpts);
  }
  return result;
}

export { version, decode, encode, decodeBinary, encodeBinary, canonical, answer, DXNError, Registry, Schema, Std, FileResolver };
export * from './values/index.js';

export default { version, decode, encode, decodeBinary, encodeBinary, canonical, answer, DXNError, Registry, Schema, Std, FileResolver, ...values };
