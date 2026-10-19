'use strict';

/**
 * @fileoverview Which values may be map keys (`DXN.md` §1.6): a string,
 * keyword, integer, uuid, date, bytes, symbol or char. Anything else is
 * refused as `key/not-allowed` -- in text, in binary and when encoding.
 *
 * The allowed types are those whose identity is exact and obvious in
 * every language: two keys are the same exactly when their canonical
 * forms are. Floats (a JS `number`, `NaN` included), decimals and
 * rationals are not; neither are times, URIs or collections; `null` and
 * the booleans collide with other keys in some languages and are rare as
 * keys anyway.
 */

const DXNKeyword = require('./values/keyword.cjs');
const DXNUUID = require('./values/uuid.cjs');
const DXNDate = require('./values/date.cjs');
const DXNBytes = require('./values/bytes.cjs');
const DXNSymbol = require('./values/symbol.cjs');
const DXNChar = require('./values/char.cjs');

/**
 * Whether `key` is one of the eight types.
 * @param {unknown} key
 * @returns {boolean}
 */
function allowed(key) {
  return (
    typeof key === 'string' ||
    typeof key === 'bigint' ||
    typeof key === 'symbol' ||
    key instanceof DXNKeyword ||
    key instanceof DXNUUID ||
    key instanceof DXNDate ||
    key instanceof DXNBytes ||
    key instanceof DXNSymbol ||
    key instanceof DXNChar
  );
}

/**
 * Throws a `key/not-allowed` error unless `key` may be a map key.
 * @param {unknown} key
 */
function check(key) {
  if (allowed(key)) return;
  const err = new TypeError(
    `${describe(key)} cannot be a map key: a key is a string, keyword, integer, uuid, date, bytes, symbol or char`
  );
  /** @type {any} */ (err).category = 'key/not-allowed';
  throw err;
}

/**
 * Throws for the first key of `pairs` that may not be a map key.
 * @param {Iterable<[unknown, unknown]>} pairs
 */
function checkPairs(pairs) {
  for (const [key] of pairs) check(key);
}

/** @param {unknown} key @returns {string} */
function describe(key) {
  if (typeof key === 'symbol') return key.toString();
  try {
    return String(key);
  } catch {
    return Object.prototype.toString.call(key);
  }
}

module.exports = { allowed, check, checkPairs };
