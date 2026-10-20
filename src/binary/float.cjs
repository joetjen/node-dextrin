'use strict';

/**
 * @fileoverview CBOR's half- and single-precision floats (RFC 8949
 * §3.3, Appendix D), which `.dxnb` writes when they hold a value
 * exactly -- the smallest representation (`DXN.md` §2.2, Jan,
 * 2026-10-20). Mirrors `Dextrin.Binary.Float`. A JS `number` holds NaN
 * and the infinities itself, so they need no atoms here; a single's
 * bits are read by `Buffer#readFloatBE`, which knows every one of them.
 */

const { floatItem } = require('./writer.cjs');

// The smallest normal half, 2^-14, and the largest finite one.
const HALF_MIN_NORMAL = 2 ** -14;
const HALF_MAX = 65504;

/**
 * A half-precision float's bits as the number they mean, the specials
 * and subnormals included.
 * @param {number} bits
 * @returns {number}
 */
function fromHalf(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 31) return fraction !== 0 ? NaN : sign * Infinity;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  return sign * (1024 + fraction) * 2 ** (exponent - 25);
}

/**
 * `f`'s half-precision bits, when half precision holds it exactly --
 * the sign of a zero included -- else `null`. NaN is the quiet NaN,
 * 0x7E00.
 * @param {number} f
 * @returns {number | null}
 */
function half(f) {
  if (Number.isNaN(f)) return 0x7e00;
  const sign = f < 0 || Object.is(f, -0) ? 0x8000 : 0;
  const a = Math.abs(f);
  let bits = null;
  if (a === Infinity) bits = sign | 0x7c00;
  else if (a === 0) bits = sign;
  else if (a < HALF_MIN_NORMAL) bits = subnormal(a, sign);
  else if (a <= HALF_MAX) bits = normal(a, sign);
  return bits !== null && Object.is(fromHalf(bits), f) ? bits : null;
}

/** @param {number} a @param {number} sign @returns {number | null} */
function subnormal(a, sign) {
  const fraction = a * 2 ** 24;
  return Number.isInteger(fraction) ? sign | fraction : null;
}

/** @param {number} a @param {number} sign @returns {number | null} */
function normal(a, sign) {
  // `Math.log2` may be off by one next to a power of two; put it right.
  let exponent = Math.floor(Math.log2(a));
  if (2 ** exponent > a) exponent -= 1;
  if (2 ** (exponent + 1) <= a) exponent += 1;
  const fraction = (a / 2 ** exponent - 1) * 1024;
  if (exponent < -14 || exponent > 15 || !Number.isInteger(fraction)) return null;
  return sign | ((exponent + 15) << 10) | fraction;
}

/**
 * Whether single precision holds `f` exactly. NaN and the infinities
 * are always half, so they are not asked about.
 * @param {number} f
 * @returns {boolean}
 */
function single(f) {
  return Number.isFinite(f) && Object.is(Math.fround(f), f);
}

/**
 * `f` as a CBOR float item, in the shortest of half, single and double
 * that holds it exactly: NaN and the infinities in half.
 * @param {number} f
 * @returns {Buffer}
 */
function shortestFloatItem(f) {
  const halfBits = half(f);
  if (halfBits !== null) return Buffer.from([0xf9, halfBits >> 8, halfBits & 0xff]);
  if (single(f)) {
    const b = Buffer.alloc(5);
    b[0] = 0xfa;
    b.writeFloatBE(f, 1);
    return b;
  }
  return floatItem(f);
}

module.exports = { fromHalf, half, single, shortestFloatItem };
