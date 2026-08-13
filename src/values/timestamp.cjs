'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `timestamp` (`~U[YYYY-MM-DD HH:MM:SSZ]`) — a UTC instant, stored
 * as integer microseconds since the Unix epoch (matching `.dxnb`'s own
 * integrity requirement, `DXN.md` §2.2: "MUST use integer, not float
 * tag-1 form — float loses microsecond precision at scale").
 *
 * Genuinely close native fit: JS `Date` *is* fundamentally a UTC
 * epoch-ms instant already, so `toDate()`/`fromDate()` are lossless
 * down to millisecond precision — the conversion is explicitly
 * documented as ms-only since `Date` cannot hold microseconds at all.
 */
class DXNTimestamp {
  /** @param {bigint} epochMicroseconds */
  constructor(epochMicroseconds) {
    if (typeof epochMicroseconds !== 'bigint') {
      throw new TypeError('DXNTimestamp epochMicroseconds must be a BigInt');
    }
    this.epochMicroseconds = epochMicroseconds;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /**
   * @returns {Date} lossy beyond millisecond precision — `Date`
   * cannot hold microseconds.
   */
  toDate() {
    return new Date(Number(floorDiv(this.epochMicroseconds, 1000n)));
  }

  /**
   * @param {Date} date
   * @returns {DXNTimestamp}
   */
  static fromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError('DXNTimestamp.fromDate expects a valid Date');
    }
    return new DXNTimestamp(BigInt(date.getTime()) * 1000n);
  }
}

DXNTimestamp.prototype.dxnType = 'timestamp';

/**
 * Floor (not truncating) BigInt division — matters for negative
 * `epochMicroseconds` (pre-1970 instants), where `BigInt`'s native `/`
 * truncates toward zero rather than flooring.
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
function floorDiv(a, b) {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) !== (b < 0n) ? q - 1n : q;
}

module.exports = DXNTimestamp;
