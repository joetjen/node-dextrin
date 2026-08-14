'use strict';

/**
 * @fileoverview Public entry point. Exports the DXN value model
 * (`src/values/`), the `.dxn` text codec (`decode`/`encode`), the
 * `.dxnb` binary codec (`decodeBinary`/`encodeBinary`), the schema
 * system (`schema.cjs`, `Registry`), and `DXNError`.
 *
 * This is a port of `dextrin` (Elixir, on Hex.pm), the reference
 * implementation. A sibling of `php-dextrin` (PHP, on Packagist) reads
 * and writes the exact same `.dxn`/`.dxnb`/`.dxns` documents — see the
 * README's own "Other language implementations" section.
 */

const version = require('./version.cjs');
const values = require('./values/index.cjs');
const DXNError = require('./error.cjs');
const Registry = require('./registry.cjs');
const Schema = require('./schema.cjs');
const Std = require('./schema/std.cjs');
const FileResolver = require('./schema/file-resolver.cjs');
const parser = require('./text/parser.cjs');
const printer = require('./text/printer.cjs');
const formatter = require('./text/formatter.cjs');
const binaryEncoder = require('./binary/encoder.cjs');
const binaryDecoder = require('./binary/decoder.cjs');

/**
 * Decodes `.dxn` text into a value — every DXN type maps to a native
 * JS value or a `DXN*` wrapper class, see `src/values/index.cjs`'s
 * `DXNValue` typedef for the full mapping. Throws `DXNError` on
 * malformed input, including a schema violation for any registered
 * `struct` name the text uses.
 *
 * `keyword` decodes as a real, global `Symbol.for(name)` by default
 * (`trusted: true`) — the closest native analog to a BEAM atom, and
 * like an atom, never garbage collected, so pass `trusted: false` for
 * any source you don't fully control (the default assumes you do —
 * your own config, your own application's data — not arbitrary
 * untrusted/network input). `trusted: false` decodes `keyword` as
 * `DXNKeyword` instead. `symbol` is unaffected either way.
 *
 * `registry:` (a `Registry` built via `schema.compile`) enables
 * schema-backed `struct` decoding and custom-tag decoding for any
 * name it knows — a `struct`/tag with no matching registry entry
 * falls back to an opaque `DXNStruct`/`DXNCustomTag`, never a hard
 * failure.
 *
 * @param {string} text
 * @param {{trusted?: boolean, registry?: import('./registry.cjs')}} [opts]
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
 * Throws `DXNError` for a value with no DXN representation, or that
 * fails schema validation.
 *
 * Automatically validates every `DXNStruct` or registered application
 * class instance found anywhere in `value` against its own schema
 * (`registry:`'s compiled schemas) — set `validate: false` to skip.
 * A `schema:` opt additionally validates `value` itself against that
 * specific schema — the one case the automatic walk can't cover on
 * its own, a nameless top-level plain object or unregistered struct.
 *
 * `coerce:` (default `true`) lets a field whose value doesn't already
 * match its declared type be coerced toward it first (a plain
 * `number` becoming a `DXNRational` for a `:rational` field, say) —
 * see `src/schema/coercion.cjs`'s own doc; this has no Elixir
 * `dextrin` equivalent, see that module for why it exists here.
 * Pass `coerce: false` for strict validation with no silent
 * conversion.
 *
 * @param {unknown} value
 * @param {{pretty?: boolean, indent?: number, registry?: import('./registry.cjs'), validate?: boolean, coerce?: boolean, schema?: string}} [opts]
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

/**
 * Decodes a `.dxnb` binary into a value. Same `trusted:`/`registry:`
 * opts as `decode`, same effect. Throws `DXNError` on malformed
 * input, including a missing/invalid envelope (`DX` magic + version
 * byte) or a schema violation.
 *
 * @param {Uint8Array} bytes
 * @param {{trusted?: boolean, registry?: import('./registry.cjs')}} [opts]
 * @returns {unknown}
 */
function decodeBinary(bytes, opts = {}) {
  try {
    return binaryDecoder.decode(bytes, opts);
  } catch (err) {
    throw DXNError.wrap(err, 'binary');
  }
}

/**
 * Encodes a value to `.dxnb` binary, returning a `Buffer`. Same
 * `registry:`/`validate:`/`coerce:`/`schema:` opts as `encode`. Throws
 * `DXNError` for a value with no DXN representation, or that fails
 * schema validation.
 *
 * @param {unknown} value
 * @param {{registry?: import('./registry.cjs'), validate?: boolean, coerce?: boolean, schema?: string, [k: string]: unknown}} [opts]
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
 * Two independent checks, both applied when requested: the automatic
 * whole-tree walk (every named struct anywhere in `value`, driven by
 * whether a schema is registered for its name) and, only if
 * `schema:` was given, a check of the (possibly already-coerced)
 * result against that one named schema. Both may return a
 * *transformed* value when `coerce:` (default `true`) lets a
 * mismatched field be coerced toward its declared type — see
 * `encode`'s own doc.
 * @param {unknown} value
 * @param {{registry?: import('./registry.cjs'), validate?: boolean, coerce?: boolean, schema?: string}} opts
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

module.exports = { version, decode, encode, decodeBinary, encodeBinary, DXNError, Registry, Schema, Std, FileResolver, ...values };
