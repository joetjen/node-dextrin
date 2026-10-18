'use strict';

/**
 * @fileoverview Pure constants — CBOR tag numbers and bit-layout
 * tables, mirroring `DXN.md` §2.3 verbatim and `Dextrin.Binary.Tags`
 * structurally. No behavior beyond the flag<->byte conversions, which
 * exist here (not in the encoder/decoder) for the same reason
 * `Dextrin.Binary.Tags.regex_flags_to_byte/1` etc. do: one shared
 * source of truth for the bit layout, used by both directions.
 */

// ---- registered CBOR tags used (RFC 8949 + the extensions DXN.md §2 cites) --
const T_TIMESTAMP = 1;
const T_BIGNUM_POS = 2;
const T_BIGNUM_NEG = 3;
const T_DECIMAL = 4;
const T_RATIONAL = 30;
const T_URI = 32;
const T_UUID = 37;
const T_STRINGREF_NAMESPACE = 256;
const T_STRINGREF = 25;
const T_SHAREABLE = 28;
const T_SHARED_REF = 29;

// ---- private tag block, DXN.md §2.3 (200-214) --------------------------
const T_CHAR = 200;
const T_SYMBOL = 201;
const T_KEYWORD = 202;
const T_TUPLE = 203;
const T_ARRAY = 204;
const T_ORDERED = 205;
const T_SET = 206;
const T_SORTED_SET = 207;
const T_STRUCT = 208;
const T_DATE = 209;
const T_TIME = 210;
const T_DATETIME_OFFSET = 211;
const T_DURATION = 212;
const T_REGEX = 213;
const T_CUSTOM = 214;
/** A struct's extra fields: only ever its last item (`DXN.md` §2.3). */
const T_EXTRA = 215;

/** Duration bitmask field order, low bit first (`DXN.md` §2.3). */
const DURATION_FIELDS = /** @type {const} */ (['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'microseconds']);

/** Regex flags byte bit order, low bit first (`DXN.md` §2.3). */
const REGEX_FLAG_BITS = /** @type {const} */ (['i', 'm', 's', 'u', 'x', 'f', 'r']);

/**
 * @param {{i: boolean, m: boolean, s: boolean, u: boolean, x: boolean, f: boolean, r: boolean}} flags
 * @returns {number}
 */
function regexFlagsToByte(flags) {
  let byte = 0;
  REGEX_FLAG_BITS.forEach((flag, bit) => {
    if (flags[flag]) byte |= 1 << bit;
  });
  return byte;
}

/**
 * @param {number} byte
 * @returns {{i: boolean, m: boolean, s: boolean, u: boolean, x: boolean, f: boolean, r: boolean}}
 */
function regexByteToFlags(byte) {
  const flags = /** @type {any} */ ({});
  REGEX_FLAG_BITS.forEach((flag, bit) => {
    flags[flag] = (byte & (1 << bit)) !== 0;
  });
  return flags;
}

/**
 * @param {{years: number|null, months: number|null, weeks: number|null, days: number|null, hours: number|null, minutes: number|null, microseconds: number|null}} d
 * @returns {number}
 */
function durationBitmask(d) {
  let mask = 0;
  DURATION_FIELDS.forEach((field, bit) => {
    if (d[field] !== null) mask |= 1 << bit;
  });
  return mask;
}

/**
 * @param {number} bitmask
 * @returns {Array<(typeof DURATION_FIELDS)[number]>}
 */
function durationFieldsPresent(bitmask) {
  return DURATION_FIELDS.filter((_field, bit) => (bitmask & (1 << bit)) !== 0);
}

module.exports = {
  T_TIMESTAMP,
  T_BIGNUM_POS,
  T_BIGNUM_NEG,
  T_DECIMAL,
  T_RATIONAL,
  T_URI,
  T_UUID,
  T_STRINGREF_NAMESPACE,
  T_STRINGREF,
  T_SHAREABLE,
  T_SHARED_REF,
  T_CHAR,
  T_SYMBOL,
  T_KEYWORD,
  T_TUPLE,
  T_ARRAY,
  T_ORDERED,
  T_SET,
  T_SORTED_SET,
  T_STRUCT,
  T_DATE,
  T_TIME,
  T_DATETIME_OFFSET,
  T_DURATION,
  T_REGEX,
  T_CUSTOM,
  T_EXTRA,
  DURATION_FIELDS,
  REGEX_FLAG_BITS,
  regexFlagsToByte,
  regexByteToFlags,
  durationBitmask,
  durationFieldsPresent
};
