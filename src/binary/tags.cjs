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
// DXN 0.2's UTC timestamp, epoch microseconds: read, never written
// (DXN.md §2.3, Jan, 2026-10-20).
const T_TIMESTAMP_US = 1;
const T_BIGNUM_POS = 2;
const T_BIGNUM_NEG = 3;
const T_DECIMAL = 4;
const T_RATIONAL = 30;
const T_URI = 32;
const T_UUID = 37;
// RFC 9164: an IPv4 or IPv6 address, or a prefix.
const T_IPV4 = 52;
const T_IPV6 = 54;
const T_STRINGREF_NAMESPACE = 256;
const T_STRINGREF = 25;
const T_SHAREABLE = 28;
const T_SHARED_REF = 29;

// ---- private tag block, DXN.md §2.3 (200-221) --------------------------
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
// DXN 0.2's microsecond encodings: read, never written. A tag never
// changes its meaning, so a document 0.2 wrote reads as it was meant.
const T_TIME_US = 210;
const T_DATETIME_US = 211;
const T_DURATION_US = 212;
const T_REGEX = 213;
const T_CUSTOM = 214;
/** A struct's extra fields: only ever its last item (`DXN.md` §2.3). */
const T_EXTRA = 215;
// A run of bits that is not whole bytes: [bytes, count] (DXN.md §2.3).
const T_BITS = 216;
// A local date-time: nanoseconds since 1970-01-01T00:00:00 on the wall
// clock (DXN.md §2.3, Jan, 2026-10-20).
const T_LOCAL_DATETIME = 217;
// Nanoseconds since midnight.
const T_TIME = 218;
// Epoch nanoseconds in UTC; else [epoch-nanoseconds, offset-minutes].
const T_DATETIME = 219;
// The duration bitmask, its seventh field nanoseconds.
const T_DURATION = 220;
// BSON's ObjectId: 12 raw bytes (Jan, 2026-10-20).
const T_OBJECTID = 221;

/** Duration bitmask field order, low bit first (`DXN.md` §2.3). */
const DURATION_FIELDS = /** @type {const} */ (['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'nanoseconds']);

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
 * @param {{years: number|null, months: number|null, weeks: number|null, days: number|null, hours: number|null, minutes: number|null, nanoseconds: bigint|number|null}} d
 * @returns {number}
 */
function durationBitmask(d) {
  let mask = 0;
  DURATION_FIELDS.forEach((field, bit) => {
    // A zero field is left out, as in text (DXN.md §1.5).
    if (d[field] !== null && d[field] !== 0 && d[field] !== 0n) mask |= 1 << bit;
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
  T_TIMESTAMP_US,
  T_BIGNUM_POS,
  T_BIGNUM_NEG,
  T_DECIMAL,
  T_RATIONAL,
  T_URI,
  T_UUID,
  T_IPV4,
  T_IPV6,
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
  T_TIME_US,
  T_DATETIME_US,
  T_DURATION_US,
  T_REGEX,
  T_CUSTOM,
  T_EXTRA,
  T_BITS,
  T_LOCAL_DATETIME,
  T_TIME,
  T_DATETIME,
  T_DURATION,
  T_OBJECTID,
  DURATION_FIELDS,
  REGEX_FLAG_BITS,
  regexFlagsToByte,
  regexByteToFlags,
  durationBitmask,
  durationFieldsPresent
};
