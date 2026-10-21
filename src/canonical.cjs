'use strict';

/**
 * @fileoverview The canonical form of a value (`DXN.md` §1.5): one
 * `.dxn` rendering, fixed down to the byte, so values from different
 * implementations can be compared as text.
 *
 * **Not `encode`.** The printer chooses what reads best; this chooses
 * nothing. One space between items, maps and sets in canonical order (by
 * code point of each canonical form — UTF-8 byte order, which is *not*
 * JavaScript's UTF-16 string order), floats by one exact algorithm,
 * strings with one fixed set of escapes: the rules every DXN
 * implementation follows, which is what lets the Dextrin Conformance
 * Suite compare two strings instead of two values.
 *
 * **Nothing is normalised.** A decimal keeps its scale and its sign, a
 * rational is not reduced. Keyed structs and ordered maps keep the order
 * they hold: in a `%schema` body the order of entries is the order of
 * the fields.
 */

const temporal = require('./text/temporal.cjs');
const { isBareIdentifier, printRegexFlags, regexForm } = require('./text/printer.cjs');
const { unsupported } = require('./binary/errors.cjs');
const DXNError = require('./error.cjs');
const DXNChar = require('./values/char.cjs');
const DXNSymbol = require('./values/symbol.cjs');
const DXNKeyword = require('./values/keyword.cjs');
const DXNList = require('./values/list.cjs');
const DXNTuple = require('./values/tuple.cjs');
const DXNOrderedMap = require('./values/ordered-map.cjs');
const DXNSortedSet = require('./values/sorted-set.cjs');
const DXNStruct = require('./values/struct.cjs');
const DXNDecimal = require('./values/decimal.cjs');
const DXNRational = require('./values/rational.cjs');
const DXNUUID = require('./values/uuid.cjs');
const DXNObjectId = require('./values/object-id.cjs');
const DXNIp = require('./values/ip.cjs');
const DXNURI = require('./values/uri.cjs');
const DXNBytes = require('./values/bytes.cjs');
const DXNBits = require('./values/bits.cjs');
const DXNRegex = require('./values/regex.cjs');
const DXNCustomTag = require('./values/custom-tag.cjs');

/**
 * The canonical form of `value`.
 * @param {unknown} value
 * @returns {string}
 * @throws {DXNError} `encode/unsupported` for a value with no DXN meaning.
 */
function canonical(value) {
  try {
    return text(value);
  } catch (err) {
    throw DXNError.wrap(err, 'encode');
  }
}

/** @param {unknown} value @returns {string} */
function text(value) {
  if (value === null || value === undefined) return 'nil';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return float(value);
  if (typeof value === 'string') return quoted(value);
  if (typeof value === 'symbol') return keyword(value.description ?? '');
  if (value instanceof DXNDecimal) return decimal(value);
  if (value instanceof DXNRational) return `${value.numerator}/${value.denominator}`;
  if (value instanceof DXNChar) return '?' + charBody(value.codepoint);
  if (value instanceof DXNSymbol) {
    if (isBareIdentifier(value.name)) return value.name;
    throw unsupported(`a symbol named ${JSON.stringify(value.name)}, which is not an identifier`);
  }
  if (value instanceof DXNKeyword) return keyword(value.name);
  if (value instanceof DXNBytes) return '@bytes ' + quoted(Buffer.from(value.data).toString('base64'));
  if (value instanceof DXNBits) return '@bits {' + quoted(Buffer.from(value.data).toString('base64')) + ' ' + value.bitLength + '}';
  if (value instanceof DXNList) return '[' + value.items.map(text).join(' ') + ']';
  if (value instanceof DXNTuple) return '{' + value.items.map(text).join(' ') + '}';
  if (Array.isArray(value)) return '@array[' + value.map(text).join(' ') + ']';
  if (value instanceof Set) return '@{' + sorted(Array.from(value).map(text)).join(' ') + '}';
  if (value instanceof DXNSortedSet) return '@sorted-set @{' + sorted(value.items.map(text)).join(' ') + '}';
  if (value instanceof DXNOrderedMap) return '@ordered %{' + entries(value.pairs, false) + '}';
  if (value instanceof Map) return '%{' + entries(Array.from(value.entries()), true) + '}';
  if (value instanceof DXNStruct) return struct(value);
  // Dates and times are ISO 8601 strings under their tag (DXN.md §1.5,
  // Jan, 2026-10-20): the fraction without trailing zeros, Z for a zero
  // offset. A native `Date` is a datetime in UTC.
  const temporalForm = temporal.tagged(value);
  if (temporalForm) return `@${temporalForm.tag} ${quoted(temporalForm.text)}`;
  if (value instanceof DXNUUID) return '@uuid ' + quoted(value.toString().toLowerCase());
  if (value instanceof DXNObjectId) return '@objectid ' + quoted(value.toString());
  if (value instanceof DXNIp) return '@ip ' + quoted(value.toString());
  if (value instanceof DXNURI) return '@uri ' + quoted(value.value);
  // Its flags in §2.3's bit order.
  if (value instanceof DXNRegex) return regexForm(printRegexFlags(value.flags), quoted(value.pattern));
  if (value instanceof DXNCustomTag) return `@${value.name} ${text(value.value)}`;
  throw unsupported(describe(value));
}

// ---- collections ------------------------------------------------------------

/**
 * Canonical order: by code point, first difference wins. UTF-8 byte
 * order is that order; JavaScript's own `<` on strings compares UTF-16
 * code units, which differs above U+FFFF, so it is not used.
 * @param {string[]} texts
 * @returns {string[]}
 */
function sorted(texts) {
  return texts
    .map((t) => [Buffer.from(t, 'utf8'), t])
    .sort((a, b) => Buffer.compare(/** @type {Buffer} */ (a[0]), /** @type {Buffer} */ (b[0])))
    .map((pair) => /** @type {string} */ (pair[1]));
}

/**
 * Entries as written, in canonical order of their keys when `sort`, in
 * the order held otherwise: shorthand for a keyword whose name is an
 * identifier, the arrow for every other key.
 * @param {Array<[unknown, unknown]>} pairs
 * @param {boolean} sort
 * @returns {string}
 */
function entries(pairs, sort) {
  const rows = pairs.map(([key, value]) => {
    const keyText = text(key);
    const name = keywordName(key);
    const written = name !== null && isBareIdentifier(name) ? `${name}: ${text(value)}` : `${keyText} => ${text(value)}`;
    return /** @type {[string, string]} */ ([keyText, written]);
  });
  if (!sort) return rows.map((row) => row[1]).join(' ');
  const byKey = new Map(rows.map((row) => [row[0], row[1]]));
  return sorted(rows.map((row) => row[0]))
    .map((key) => byKey.get(key))
    .join(' ');
}

/** @param {unknown} key @returns {string | null} */
function keywordName(key) {
  if (typeof key === 'symbol') return key.description ?? '';
  if (key instanceof DXNKeyword) return key.name;
  return null;
}

/** @param {DXNStruct} value @returns {string} */
function struct(value) {
  const fields = /** @type {any} */ (value.fields);
  /** @param {unknown} key @param {unknown} field @returns {string} */
  const entry = (key, field) => {
    if (typeof key !== 'string') return `${text(key)} => ${text(field)}`;
    return isBareIdentifier(key) ? `${key}: ${text(field)}` : `${quoted(key)} => ${text(field)}`;
  };
  // A keyed struct's extra fields follow its declared ones in the order
  // they were written; a positional struct's follow its items in
  // canonical order of their keys (DXN.md §1.5).
  if (fields.type === 'keyed') {
    const written = [...fields.pairs, ...value.extra].map(([key, field]) => entry(key, field));
    return `${DXNStruct.head(value.name, value.version)}{${written.join(' ')}}`;
  }
  const byKey = new Map(value.extra.map(([key, field]) => [text(key), entry(key, field)]));
  const extras = sorted([...byKey.keys()]).map((key) => /** @type {string} */ (byKey.get(key)));
  return `${DXNStruct.head(value.name, value.version)}[${[...fields.values.map(text), ...extras].join(' ')}]`;
}

/** @param {string} name @returns {string} */
function keyword(name) {
  return isBareIdentifier(name) ? ':' + name : ':' + quoted(name);
}

// ---- numbers --------------------------------------------------------------------

/**
 * A float by `DXN.md` §1.5: the shortest digits that read back exactly,
 * ECMAScript's thresholds, `.0` on a whole number, no `+` in an exponent,
 * and the sign of negative zero kept.
 * @param {number} n
 * @returns {string}
 */
function float(n) {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  const negative = n < 0 || Object.is(n, -0);
  const [mantissa, exponent] = Math.abs(n).toExponential().split('e');
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0';
  const point = Number(exponent) + 1;
  return (negative ? '-' : '') + laidOut(digits, digits === '0' ? 1 : point);
}

/**
 * The digits `digits` with value 0.d1..dk × 10^`n`, laid out by
 * `DXN.md` §1.5.
 * @param {string} digits
 * @param {number} n
 * @returns {string}
 */
function laidOut(digits, n) {
  const k = digits.length;
  if (k <= n && n <= 21) return digits + '0'.repeat(n - k) + '.0';
  if (0 < n && n < k) return digits.slice(0, n) + '.' + digits.slice(n);
  if (-6 < n && n <= 0) return '0.' + '0'.repeat(-n) + digits;
  return digits[0] + '.' + (k === 1 ? '0' : digits.slice(1)) + 'e' + (n - 1);
}

/**
 * A decimal as it was given: its digits with exactly its scale and its
 * sign, negative zero included; a positive exponent written out.
 * @param {DXNDecimal} d
 * @returns {string}
 */
function decimal(d) {
  const digits = d.unscaledValue.toString();
  let body;
  if (d.exponent >= 0) {
    body = digits + '0'.repeat(d.exponent);
  } else {
    const scale = -d.exponent;
    const padded = digits.padStart(scale + 1, '0');
    body = padded.slice(0, padded.length - scale) + '.' + padded.slice(padded.length - scale);
  }
  return (d.sign < 0 ? '-' : '') + body + 'M';
}

// ---- text -------------------------------------------------------------------------

/** @param {string} s @returns {string} */
function quoted(s) {
  let out = '"';
  for (const ch of s) out += escaped(/** @type {number} */ (ch.codePointAt(0)));
  return out + '"';
}

/** @param {number} cp @returns {string} */
function escaped(cp) {
  if (cp === 0x22) return '\\"';
  if (cp === 0x5c) return '\\\\';
  if (cp === 0x0a) return '\\n';
  if (cp === 0x09) return '\\t';
  if (cp === 0x0d) return '\\r';
  if (cp < 0x20 || cp === 0x7f) return hexEscape(cp);
  return String.fromCodePoint(cp);
}

/** @param {number} cp @returns {string} */
function hexEscape(cp) {
  return `\\x{${cp.toString(16)}}`;
}

/** @param {number} cp @returns {string} */
function charBody(cp) {
  if (cp === 0x20) return 's';
  if (cp === 0x5c) return '\\\\';
  if (cp === 0x0a) return '\\n';
  if (cp === 0x09) return '\\t';
  if (cp === 0x0d) return '\\r';
  if (cp < 0x20 || cp === 0x7f || /^\s$/u.test(String.fromCodePoint(cp))) return hexEscape(cp);
  return String.fromCodePoint(cp);
}

// ---- the rest -----------------------------------------------------------------

/** @param {unknown} value @returns {string} */
function describe(value) {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

module.exports = { canonical };
