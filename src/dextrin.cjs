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
const {
  DXNChar,
  DXNSymbol,
  DXNKeyword,
  DXNList,
  DXNTuple,
  DXNOrderedMap,
  DXNMap,
  DXNSortedSet,
  DXNStruct,
  DXNDecimal,
  DXNRational,
  DXNDate,
  DXNTime,
  DXNTimestamp,
  DXNDateTime,
  DXNDuration,
  DXNUUID,
  DXNURI,
  DXNBytes,
  DXNBits,
  DXNRegex,
  DXNCustomTag,
  dxnEquals,
  dxnCompare,
  canonicalKey,
  kindOf,
  KIND_RANK,
} = require('./values/index.cjs');
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
 * **Safe by default**: `keyword` decodes as `DXNKeyword`, so no input
 * can fill the global symbol registry. Pass `trusted: true` (or a
 * registry with `putTrusted(true)`) for a source you control -- your own
 * config, your own application's data -- and it decodes as a real, global
 * `Symbol.for(name)`, the closest native analog to a BEAM atom and, like
 * one, never garbage collected. `symbol` is unaffected either way.
 *
 * `registry:` (a `Registry` built via `schema.compile`) enables
 * schema-backed `struct` decoding and custom-tag decoding for any
 * name it knows — a `struct`/tag with no matching registry entry
 * falls back to an opaque `DXNStruct`/`DXNCustomTag`, never a hard
 * failure.
 *
 * @param {string} text
 * @param {{trusted?: boolean, strict?: boolean, registry?: import('./registry.cjs')}} [opts]
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
 * instead: the top-level collection one entry per line, a nested one on
 * one line when it fits (`indent:` then sets spaces per nesting level,
 * default 2, and `width:` the columns that line must fit in, default
 * 80). Both produce the exact same value on the way back through
 * `decode` — `pretty`/`indent`/`width` are a rendering choice, never a
 * semantic one.
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
 * Nothing is converted to make a value match its declared type
 * (`DXN.md` §4.7): a host value always means the same DXN type, schema
 * or not, so a `number` for a `:rational` field is refused rather than
 * turned into a `DXNRational`. Use the `DXN*` classes to say which type
 * a value is.
 *
 * @param {unknown} value
 * @param {{pretty?: boolean, indent?: number, width?: number, registry?: import('./registry.cjs'), validate?: boolean, schema?: string}} [opts]
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
 * @param {{trusted?: boolean, strict?: boolean, registry?: import('./registry.cjs')}} [opts]
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
 * `registry:`/`validate:`/`schema:` opts as `encode`. Throws
 * `DXNError` for a value with no DXN representation, or that fails
 * schema validation.
 *
 * @param {unknown} value
 * @param {{registry?: import('./registry.cjs'), validate?: boolean, schema?: string, [k: string]: unknown}} [opts]
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
 * `schema:` was given, a check of the result against that one named
 * schema.
 * @param {unknown} value
 * @param {{registry?: import('./registry.cjs'), validate?: boolean, schema?: string}} opts
 * @returns {unknown}
 */
function maybeValidateEncode(value, opts) {
  const registry = opts.registry ?? new Registry();

  let result = value;
  if (opts.validate ?? true) {
    result = Schema.validateEncodeTree(result, registry);
  }
  if (opts.schema !== undefined) {
    result = Schema.validateEncode(result, registry, opts.schema);
  }
  return result;
}

const { canonical } = require('./canonical.cjs');
const { answer } = require('./conformance.cjs');
const Document = require('./document.cjs');
const Format = require('./format.cjs');

// One name at a time, not one object: `tsc` declares a class exported
// this way as a type as well as a value -- `err: DXNError`, `r: Registry`
// -- and a module as itself (`npm run types`); an object's members are
// values only.
module.exports.version = version;
module.exports.decode = decode;
module.exports.encode = encode;
module.exports.decodeBinary = decodeBinary;
module.exports.encodeBinary = encodeBinary;
module.exports.canonical = canonical;
module.exports.answer = answer;
module.exports.DXNError = DXNError;
module.exports.Registry = Registry;
module.exports.Schema = Schema;
module.exports.Std = Std;
module.exports.FileResolver = FileResolver;
module.exports.Document = Document;
module.exports.Format = Format;
module.exports.DXNChar = DXNChar;
module.exports.DXNSymbol = DXNSymbol;
module.exports.DXNKeyword = DXNKeyword;
module.exports.DXNList = DXNList;
module.exports.DXNTuple = DXNTuple;
module.exports.DXNOrderedMap = DXNOrderedMap;
module.exports.DXNMap = DXNMap;
module.exports.DXNSortedSet = DXNSortedSet;
module.exports.DXNStruct = DXNStruct;
module.exports.DXNDecimal = DXNDecimal;
module.exports.DXNRational = DXNRational;
module.exports.DXNDate = DXNDate;
module.exports.DXNTime = DXNTime;
module.exports.DXNTimestamp = DXNTimestamp;
module.exports.DXNDateTime = DXNDateTime;
module.exports.DXNDuration = DXNDuration;
module.exports.DXNUUID = DXNUUID;
module.exports.DXNURI = DXNURI;
module.exports.DXNBytes = DXNBytes;
module.exports.DXNBits = DXNBits;
module.exports.DXNRegex = DXNRegex;
module.exports.DXNCustomTag = DXNCustomTag;
module.exports.dxnEquals = dxnEquals;
module.exports.dxnCompare = dxnCompare;
module.exports.canonicalKey = canonicalKey;
module.exports.kindOf = kindOf;
module.exports.KIND_RANK = KIND_RANK;

