'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

const DECIMAL_STRING = /^(-)?(\d+)(?:\.(\d+))?$/;
const EXPONENTIAL_STRING = /^(-)?(\d)(?:\.(\d+))?e([+-]\d+)$/i;

/**
 * DXN `decimal` (`[0-9]+(.[0-9]+)?M`) — exact fixed-point, stored as
 * `sign × unscaledValue × 10^exponent` (`unscaledValue` a non-negative
 * `BigInt`, `exponent` the scale). Hand-rolled rather than built on a
 * decimal-arithmetic package (`decimal.js` et al.) to keep this project
 * dependency-free, per its zero-runtime-dependency default — only
 * parse/format/compare/equals are needed for v1, not full arithmetic.
 *
 * Equality/ordering compare `sign`/`unscaledValue`/`exponent` directly
 * (the generic field-reflection default from `equality.cjs`), not
 * normalized numeric value — mirrors `DXNRational` never auto-reducing:
 * two representations of the same numeric value at different scales
 * (`1.10` vs `1.1`) are distinct DXN values, matching the "exact
 * fixed-point" precision `DXN.md` describes.
 */
class DXNDecimal {
  /**
   * @param {1 | -1} sign
   * @param {bigint} unscaledValue non-negative.
   * @param {number} exponent
   */
  constructor(sign, unscaledValue, exponent) {
    if (sign !== 1 && sign !== -1) throw new TypeError('DXNDecimal sign must be 1 or -1');
    if (typeof unscaledValue !== 'bigint' || unscaledValue < 0n) {
      throw new TypeError('DXNDecimal unscaledValue must be a non-negative BigInt');
    }
    if (!Number.isInteger(exponent)) throw new TypeError('DXNDecimal exponent must be an integer');
    this.sign = sign;
    this.unscaledValue = unscaledValue;
    this.exponent = exponent;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /** @returns {string} canonical `[-]digits(.digits)?` form. */
  toString() {
    const digits = this.unscaledValue.toString();
    const negative = this.sign < 0 && this.unscaledValue !== 0n;
    const prefix = negative ? '-' : '';

    if (this.exponent === 0) return prefix + digits;
    if (this.exponent > 0) return prefix + digits + '0'.repeat(this.exponent);

    const scale = -this.exponent;
    const padded = digits.padStart(scale + 1, '0');
    const intPart = padded.slice(0, padded.length - scale);
    const fracPart = padded.slice(padded.length - scale);
    return `${prefix}${intPart}.${fracPart}`;
  }

  /**
   * @returns {number} lossy for magnitude/precision beyond what
   * `Number` can hold exactly — documented, not hidden.
   */
  toNumber() {
    return Number(this.toString());
  }

  /**
   * @param {string} str `[-]digits(.digits)?`, no `M` suffix (that's
   * `.dxn` text syntax, applied/stripped by the text codec, not here).
   * @returns {DXNDecimal}
   */
  static fromString(str) {
    if (typeof str !== 'string') throw new TypeError('DXNDecimal.fromString expects a string');
    const match = DECIMAL_STRING.exec(str);
    if (!match) throw new TypeError(`DXNDecimal.fromString: invalid decimal literal ${JSON.stringify(str)}`);
    const [, negative, intPart, fracPart = ''] = match;
    const unscaledValue = BigInt(intPart + fracPart);
    const sign = negative && unscaledValue !== 0n ? -1 : 1;
    return new DXNDecimal(sign, unscaledValue, -fracPart.length);
  }

  /**
   * Best-effort, explicitly lossy: a JS `number` is binary
   * floating-point, so its exact decimal expansion is used, which may
   * carry more (or differently rounded) digits than the value's
   * "intended" decimal literal had — the same lossiness
   * `DXNDecimal#toNumber` has, just in the other direction.
   * @param {number} n
   * @returns {DXNDecimal}
   */
  static fromNumber(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new TypeError('DXNDecimal.fromNumber expects a finite number');
    }
    return DXNDecimal.fromString(numberToDecimalString(n));
  }
}

DXNDecimal.prototype.dxnType = 'decimal';

/**
 * Expands a JS number to a plain (non-exponential) decimal string.
 * @param {number} n
 * @returns {string}
 */
function numberToDecimalString(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) {
    return BigInt(n).toString();
  }

  const str = n.toString();
  if (!str.includes('e') && !str.includes('E')) return str;

  const match = EXPONENTIAL_STRING.exec(str);
  if (!match) throw new TypeError(`cannot convert ${n} to a decimal string`);
  const [, negative, leadDigit, fracDigits = '', expStr] = match;
  const exponent = parseInt(expStr, 10);
  const digits = leadDigit + fracDigits;
  const sign = negative ?? '';

  if (exponent >= 0) {
    const pointPos = 1 + exponent;
    const padded = digits.padEnd(pointPos, '0');
    const intPart = padded.slice(0, pointPos);
    const fracPart = padded.slice(pointPos);
    return sign + intPart + (fracPart ? `.${fracPart}` : '');
  }

  const leadingZeros = '0'.repeat(-exponent - 1);
  return `${sign}0.${leadingZeros}${digits}`;
}

module.exports = DXNDecimal;
