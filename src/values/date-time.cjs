'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `datetime` (`@datetime "..."`) — a fixed-offset, non-UTC instant.
 * Stored as `{ epochMicroseconds, offsetMinutes }`, mirroring
 * `.dxnb`'s own wire shape (`DXN.md` §2.2) directly. `offsetMinutes`
 * is informational only for `toDate()`: native JS `Date` has no offset
 * concept of its own (it always normalizes to the same UTC instant
 * either way), so the conversion is lossless for the instant itself
 * but drops which offset it was originally expressed in.
 */
class DXNDateTime {
  /**
   * @param {bigint} epochMicroseconds
   * @param {number} offsetMinutes
   */
  constructor(epochMicroseconds, offsetMinutes) {
    if (typeof epochMicroseconds !== 'bigint') {
      throw new TypeError('DXNDateTime epochMicroseconds must be a BigInt');
    }
    if (!Number.isInteger(offsetMinutes)) {
      throw new TypeError('DXNDateTime offsetMinutes must be an integer');
    }
    this.epochMicroseconds = epochMicroseconds;
    this.offsetMinutes = offsetMinutes;
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
   * @returns {Date} the same instant, offset dropped (see class doc);
   * lossy beyond millisecond precision like `DXNTimestamp#toDate`.
   */
  toDate() {
    return new Date(Number(floorDiv(this.epochMicroseconds, 1000n)));
  }

  /**
   * @param {Date} date
   * @param {number} offsetMinutes required — a plain `Date` has no
   * offset of its own to infer this from.
   * @returns {DXNDateTime}
   */
  static fromDate(date, offsetMinutes) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError('DXNDateTime.fromDate expects a valid Date');
    }
    if (!Number.isInteger(offsetMinutes)) {
      throw new TypeError('DXNDateTime.fromDate requires an explicit integer offsetMinutes');
    }
    return new DXNDateTime(BigInt(date.getTime()) * 1000n, offsetMinutes);
  }
}

DXNDateTime.prototype.dxnType = 'datetime';

/**
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
function floorDiv(a, b) {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) !== (b < 0n) ? q - 1n : q;
}

module.exports = DXNDateTime;
