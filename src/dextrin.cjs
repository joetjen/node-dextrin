'use strict';

/**
 * @fileoverview Public entry point. Exports the DXN value model
 * (`src/values/`), the `.dxn` text codec (`decode`/`encode`), and
 * `DXNError`. `decodeBinary`/`encodeBinary` (`.dxnb`) land in a later
 * phase.
 */

const version = require('./version.cjs');
const values = require('./values/index.cjs');
const DXNError = require('./error.cjs');
const parser = require('./text/parser.cjs');
const printer = require('./text/printer.cjs');
const formatter = require('./text/formatter.cjs');

/**
 * Decodes `.dxn` text into a value — every DXN type maps to a native
 * JS value or a `DXN*` wrapper class, see `src/values/index.cjs`'s
 * `DXNValue` typedef for the full mapping. Throws `DXNError` on
 * malformed input.
 *
 * `keyword` decodes as a real, global `Symbol.for(name)` by default
 * (`trusted: true`) — the closest native analog to a BEAM atom, and
 * like an atom, never garbage collected, so pass `trusted: false` for
 * any source you don't fully control (the default assumes you do —
 * your own config, your own application's data — not arbitrary
 * untrusted/network input). `trusted: false` decodes `keyword` as
 * `DXNKeyword` instead. `symbol` is unaffected either way, mirroring
 * `Dextrin.Registry.put_trusted/2`'s own `keyword`-only scope exactly.
 *
 * @param {string} text
 * @param {{trusted?: boolean}} [opts]
 * @returns {unknown}
 */
function decode(text, opts = {}) {
  try {
    return parser.parse(text, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'parse');
  }
}

/**
 * Encodes a value back to `.dxn` text. Single-line, minimal-whitespace
 * by default; pass `pretty: true` for multi-line, indented output
 * instead (`indent:` then sets spaces per nesting level, default 2).
 * Both produce the exact same value on the way back through `decode`
 * — `pretty`/`indent` are a rendering choice, never a semantic one.
 * Throws `DXNError` for a value with no DXN representation at all.
 *
 * No schema validation yet (`Dextrin.Schema` lands in a later phase)
 * — `validate:`/`schema:` options are not implemented.
 *
 * @param {unknown} value
 * @param {{pretty?: boolean, indent?: number}} [opts]
 * @returns {string}
 */
function encode(value, opts = {}) {
  try {
    return opts.pretty ? formatter.pretty(value, opts) : printer.print(value, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'encode');
  }
}

module.exports = { version, decode, encode, DXNError, ...values };
