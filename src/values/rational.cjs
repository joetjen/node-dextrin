'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

// A finite double has at most 52 fractional mantissa bits (up to ~1074
// for denormals) — this bounds the doubling loop in fromNumber well
// above any real finite double, purely as a defensive circuit breaker.
const MAX_DOUBLING_STEPS = 1100;

/**
 * DXN `rational` (`int/uint`) — an exact ratio, stored exactly as
 * given and never silently reduced: `22/7` and `44/14` are distinct
 * DXN values (`DXN.md` calls it "exact ratio," not "exact reduced
 * ratio"), so reducing on parse/construction would be a silent,
 * opinionated transformation. `reduce()` is offered but never called
 * implicitly — mirrors `Dextrin.Rational` exactly.
 */
class DXNRational {
  /**
   * @param {bigint} numerator
   * @param {bigint} denominator must be positive.
   */
  constructor(numerator, denominator) {
    if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
      throw new TypeError('DXNRational numerator/denominator must be BigInt');
    }
    if (denominator <= 0n) {
      throw new RangeError('DXNRational denominator must be positive');
    }
    this.numerator = numerator;
    this.denominator = denominator;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /** @returns {DXNRational} numerator/denominator divided by their GCD. */
  reduce() {
    const g = gcd(absBigInt(this.numerator), this.denominator);
    return new DXNRational(this.numerator / g, this.denominator / g);
  }

  /**
   * @returns {number} lossy for numerator/denominator magnitudes
   * beyond `Number`'s safe range — documented, not hidden.
   */
  toNumber() {
    return Number(this.numerator) / Number(this.denominator);
  }

  /**
   * **Exact**, not approximate: every finite JS `number` is a binary
   * fraction (`mantissa × 2^exponent`), so this decomposes it into an
   * exact rational (a power-of-2 denominator) rather than
   * approximating a decimal value the way `DXNDecimal.fromNumber`
   * necessarily does.
   * @param {number} n
   * @returns {DXNRational}
   */
  static fromNumber(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new TypeError('DXNRational.fromNumber expects a finite number');
    }
    if (n === 0) return new DXNRational(0n, 1n);

    let value = n;
    let denominator = 1n;
    let steps = 0;
    while (!Number.isInteger(value) && steps < MAX_DOUBLING_STEPS) {
      value *= 2;
      denominator *= 2n;
      steps += 1;
    }
    if (!Number.isInteger(value)) {
      throw new RangeError(`DXNRational.fromNumber failed to exactly represent ${n}`);
    }
    return new DXNRational(BigInt(value), denominator);
  }
}

DXNRational.prototype.dxnType = 'rational';

/**
 * @param {bigint} n
 * @returns {bigint}
 */
function absBigInt(n) {
  return n < 0n ? -n : n;
}

/**
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
function gcd(a, b) {
  let x = a;
  let y = b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x === 0n ? 1n : x;
}

module.exports = DXNRational;
