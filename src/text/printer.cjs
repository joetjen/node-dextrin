'use strict';

/**
 * @fileoverview `.dxn` printer — the reverse of `src/text/parser.cjs`.
 * Single-line, minimal-whitespace output: a printer, not a formatter
 * (no line-wrapping/indentation policy is specified anywhere in
 * `DXN.md`) — `src/text/formatter.cjs` owns multi-line, human-readable
 * rendering, built on top of this module. Mirrors
 * `Dextrin.Text.Printer` structurally.
 *
 * Throws on the one thing that can actually fail here: a value with
 * no DXN representation at all (a bare JS object, a function, ...) —
 * every built-in DXN-representable shape always succeeds.
 */

const { checkPairs } = require('../map-key.cjs');
const { encodeString, encodeChar } = require('./escapes.cjs');
const { unsupported } = require('../binary/errors.cjs');
const { tokenize } = require('./lexer.cjs');
const temporal = require('./temporal.cjs');

const DXNChar = require('../values/char.cjs');
const DXNSymbol = require('../values/symbol.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const DXNList = require('../values/list.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNOrderedMap = require('../values/ordered-map.cjs');
const DXNSortedSet = require('../values/sorted-set.cjs');
const DXNStruct = require('../values/struct.cjs');
const DXNDecimal = require('../values/decimal.cjs');
const DXNRational = require('../values/rational.cjs');
const DXNUUID = require('../values/uuid.cjs');
const DXNURI = require('../values/uri.cjs');
const DXNBytes = require('../values/bytes.cjs');
const DXNBits = require('../values/bits.cjs');
const DXNRegex = require('../values/regex.cjs');
const DXNCustomTag = require('../values/custom-tag.cjs');

const REGEX_FLAG_ORDER = /** @type {const} */ (['i', 'm', 's', 'u', 'x', 'f', 'r']);

/**
 * @param {unknown} value
 * @param {{registry?: import('../registry.cjs'), [k: string]: unknown}} [opts]
 * `registry:` lets a genuine application class instance (registered
 * via `schema.compile`/`Registry#putStructModule` or
 * `Registry#putTagEncoder`) be printed directly, see `printViaRegistry`.
 * @returns {string}
 */
function print(value, opts = {}) {
  if (value === null || value === undefined) return 'nil';
  if (value === true) return 'true';
  if (value === false) return 'false';

  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return printFloat(value);
  if (typeof value === 'string') return quoteString(value);
  if (typeof value === 'symbol') return ':' + keywordName(value.description ?? '');

  if (value instanceof DXNDecimal) return `${value.toString()}M`;
  if (value instanceof DXNRational) return `${value.numerator}/${value.denominator}`;
  if (value instanceof DXNChar) return '?' + printCharBody(value.codepoint);
  // A symbol is an identifier (DXN.md §1.1); a name that is not one has
  // no text form, and writing it verbatim would read back as something
  // else, or as nothing.
  if (value instanceof DXNSymbol) {
    if (isBareIdentifier(value.name)) return value.name;
    throw unsupported(`a symbol named ${JSON.stringify(value.name)}, which is not an identifier`);
  }
  if (value instanceof DXNKeyword) return ':' + keywordName(value.name);
  if (value instanceof DXNBytes) return tagForm('bytes', quoteString(Buffer.from(value.data).toString('base64')), opts);
  if (value instanceof DXNBits) return tagForm('bits', bitsBody(value), opts);

  if (value instanceof DXNList) return '[' + value.items.map((v) => print(v, opts)).join(' ') + ']';
  if (value instanceof DXNTuple) return '{' + value.items.map((v) => print(v, opts)).join(' ') + '}';
  // `@array[`, the bracket against the tag, is the preferred spelling
  // (Jan, 2026-10-20); `@array [` still reads.
  if (Array.isArray(value)) return '@array[' + value.map((v) => print(v, opts)).join(' ') + ']';

  if (value instanceof Set) return '@{' + Array.from(value).map((v) => print(v, opts)).join(' ') + '}';
  if (value instanceof DXNSortedSet) {
    return tagForm('sorted-set', '@{' + value.items.map((v) => print(v, opts)).join(' ') + '}', opts);
  }

  if (value instanceof DXNOrderedMap) {
    checkPairs(value.pairs);
    return tagForm('ordered', '%{' + printEntries(value.pairs, opts) + '}', opts);
  }
  if (value instanceof Map) {
    checkPairs(value.entries());
    return '%{' + printEntries(Array.from(value.entries()), opts) + '}';
  }

  if (value instanceof DXNStruct) return printStruct(value, opts);

  // Dates and times are ISO 8601 strings under their tag (DXN.md §1.2,
  // Jan, 2026-10-20), written by text/temporal.cjs. A native `Date` is an
  // instant: it always means a datetime in UTC, with or without a schema
  // (DXN.md §4.7).
  const temporalForm = temporal.tagged(value);
  if (temporalForm) return tagForm(temporalForm.tag, quoteString(temporalForm.text), opts);

  if (value instanceof DXNUUID) return tagForm('uuid', quoteString(value.toString()), opts);
  if (value instanceof DXNURI) return tagForm('uri', quoteString(value.value), opts);

  // `@regex "pattern"`, its flags in a header when it has any (DXN.md §1.2).
  if (value instanceof DXNRegex) return regexForm(printRegexFlags(value.flags), quoteString(value.pattern));

  if (value instanceof DXNCustomTag) return tagForm(value.name, print(value.value, opts), opts);

  return printViaRegistry(value, opts);
}

/**
 * Reached only for a value none of the clauses above recognized —
 * i.e. a genuine application class instance. Two independent
 * extension points, checked in order: a schema-registered class is
 * rebuilt as the equivalent keyed `DXNStruct` and re-printed through
 * that existing clause (reusing its recursive field printing rather
 * than duplicating it); only if no schema class matches does this
 * fall through to a registered tag encoder, the custom-tag-style
 * escape hatch for anything without real field structure.
 * @param {unknown} value
 * @param {{registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 * @returns {string}
 */
function printViaRegistry(value, opts) {
  const registry = opts.registry;
  if (registry && value !== null && typeof value === 'object') {
    const name = registry.fetchSchemaNameForModule(value.constructor);
    if (name) {
      const found = registry.fetchStructSchema(name);
      if (found) return printStruct(found.compiled.structOf(/** @type {object} */ (value)), opts);
    }

    const tagEncoder = registry.fetchTagEncoder(value.constructor);
    if (tagEncoder) {
      const [tagName, encoder] = tagEncoder;
      return tagForm(tagName, print(encoder(value), opts), opts);
    }
  }

  throw unsupported(describeForError(value));
}

/** @param {number} n */
function printFloat(n) {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  const s = String(n);
  // JS omits the decimal point for integer-valued floats (`String(1)`
  // === "1"), which `.dxn` needs to stay distinct from `integer` —
  // append ".0" whenever the native rendering has neither a fraction
  // nor an exponent to make that distinction implicit already.
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** @param {number} codepoint */
function printCharBody(codepoint) {
  if (codepoint === 0x20) return 's';
  if (codepoint === 0x0a) return '\\n';
  if (codepoint === 0x09) return '\\t';
  if (codepoint === 0x0d) return '\\r';
  if (codepoint === 0x22) return '\\"';
  if (codepoint === 0x5c) return '\\\\';
  if (codepoint < 0x20) return `\\x{${codepoint.toString(16)}}`;
  return String.fromCodePoint(codepoint);
}

/** @param {string} s */
function quoteString(s) {
  return `"${encodeString(s)}"`;
}

/**
 * @param {string} name
 * @param {string} printedValue
 * @param {{[k: string]: unknown}} opts
 */
function tagForm(name, printedValue, opts) {
  void opts;
  return `@${name} ${printedValue}`;
}

/**
 * The flags set, in `DXN.md` §2.3's bit order.
 * @param {{i: boolean, m: boolean, s: boolean, u: boolean, x: boolean, f: boolean, r: boolean}} flags
 */
function printRegexFlags(flags) {
  return REGEX_FLAG_ORDER.filter((f) => flags[f]).join('');
}

/**
 * `@regex "pattern"`, or `@regex(flags) "pattern"` (DXN.md §1.2) — what
 * the canonical form writes too.
 * @param {string} flags
 * @param {string} pattern already quoted.
 */
function regexForm(flags, pattern) {
  return flags === '' ? `@regex ${pattern}` : `@regex(${flags}) ${pattern}`;
}

/**
 * Whether `name` is a valid bare `identifier` (`DXN.md` §1.1) on its
 * own — the one thing that decides whether a keyword/field name can
 * use `map_entry`'s colon-shorthand at all, or must fall back to the
 * quoted arrow form. Reuses the real tokenizer rather than a
 * hand-rolled regex, mirroring `Dextrin.Text.Printer.bare_identifier?/1`
 * reusing `Dextrin.Text.Grammar.tokenize/1` for the same reason: one
 * source of truth for what an identifier is, not two that can drift.
 * @param {string} name
 * @returns {boolean}
 */
function isBareIdentifier(name) {
  if (name === '') return false;
  try {
    const tokens = tokenize(name);
    return tokens.length === 2 && tokens[0].type === 'IDENTIFIER' && tokens[0].value === name;
  } catch {
    return false;
  }
}

/** @param {string} name */
function keywordName(name) {
  return isBareIdentifier(name) ? name : quoteString(name);
}

/**
 * @param {Array<[unknown, unknown]>} pairs
 * @param {{[k: string]: unknown}} opts
 */
function printEntries(pairs, opts) {
  return pairs
    .map(([key, value]) => {
      const name = keywordEntryName(key);
      if (name !== null) return printKeywordEntry(name, value, opts);
      return `${print(key, opts)}=>${print(value, opts)}`;
    })
    .join(',');
}

/**
 * @param {unknown} key
 * @returns {string | null} the keyword's name if `key` is
 * keyword-shaped (a native `symbol` or `DXNKeyword`), else `null`.
 */
function keywordEntryName(key) {
  if (typeof key === 'symbol') return key.description ?? '';
  if (key instanceof DXNKeyword) return key.name;
  return null;
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {{[k: string]: unknown}} opts
 */
function printKeywordEntry(name, value, opts) {
  if (isBareIdentifier(name)) return `${name}:${print(value, opts)}`;
  return `:${quoteString(name)}=>${print(value, opts)}`;
}

/**
 * @param {DXNStruct} struct
 * @param {{[k: string]: unknown}} opts
 */
function printStruct(struct, opts) {
  const head = writtenHead(struct, opts);
  const extra = struct.extra.map(([key, value]) => printExtraEntry(key, value, opts));
  if (struct.fields.type === 'keyed') {
    const entries = struct.fields.pairs.map(([name, value]) => printKeywordEntry(name, value, opts));
    return `${head}{${[...entries, ...extra].join(',')}}`;
  }
  // A positional struct's items, then its extra fields as entries
  // (DXN.md §1.2).
  const items = struct.fields.values.map((v) => print(v, opts));
  return `${head}[${[...items, ...extra].join(',')}]`;
}

/**
 * One extra field as an entry: a name is written like a field name, any
 * other map key as itself (`DXN.md` §1.2).
 * @param {unknown} key
 * @param {unknown} value
 * @param {{[k: string]: unknown}} opts
 * @returns {string}
 */
function printExtraEntry(key, value, opts) {
  if (typeof key === 'string') return printKeywordEntry(key, value, opts);
  return `${print(key, opts)}=>${print(value, opts)}`;
}

/**
 * How `struct` opens when it is written: `%Name(3)` with the latest
 * loaded version of its schema, or with its own when there is no schema
 * (`DXN.md` §4.8). The formatter writes the same head.
 * @param {DXNStruct} struct
 * @param {{registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 * @returns {string}
 */
function writtenHead(struct, opts) {
  const written = opts.registry ? opts.registry.asWritten(struct) : struct;
  return DXNStruct.head(written.name, written.version);
}

/** @param {unknown} value */
function describeForError(value) {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * The body of `@bits {"..." n}` (DXN.md §1.5): the bytes in base64, the
 * unused bits zero (as DXNBits holds them), and the count.
 * @param {DXNBits} bits
 * @returns {string}
 */
function bitsBody(bits) {
  return `{${quoteString(Buffer.from(bits.data).toString('base64'))} ${bits.bitLength}}`;
}

module.exports = { print, isBareIdentifier, quoteString, keywordEntryName, writtenHead, printRegexFlags, regexForm };
