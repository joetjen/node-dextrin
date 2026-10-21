'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `datetime` (`@datetime "..."`) — an instant with the offset it was
 * written at, to the nanosecond (`DXN.md` §1.3). DXN 0.2's `timestamp`
 * is this type at offset 0, written `Z` (Jan, 2026-10-20: one type, not
 * two). Stored as `{ epochNanoseconds, offsetMinutes }`, mirroring
 * `.dxnb`'s own wire shape (`DXN.md` §2.2) directly.
 *
 * Close native fit: JS `Date` is a UTC epoch-ms instant, so
 * `toDate()`/`fromDate()` keep the instant to the millisecond — `Date`
 * holds nothing finer — and drop the offset, which `Date` has no
 * concept of; a native `Date` given to the encoder is a datetime in UTC.
 */
class DXNDateTime {
  /**
   * @param {bigint} epochNanoseconds since 1970-01-01T00:00:00Z.
   * @param {number} [offsetMinutes] the offset it is written at,
   * -1439 to 1439; 0, UTC, when not given.
   */
  constructor(epochNanoseconds, offsetMinutes = 0) {
    if (typeof epochNanoseconds !== 'bigint') {
      throw new TypeError('DXNDateTime epochNanoseconds must be a BigInt');
    }
    if (!Number.isInteger(offsetMinutes)) {
      throw new TypeError('DXNDateTime offsetMinutes must be an integer');
    }
    if (Math.abs(offsetMinutes) >= 1440) {
      throw new RangeError(`DXNDateTime offsetMinutes out of range: ${offsetMinutes}`);
    }
    this.epochNanoseconds = epochNanoseconds;
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
   * lossy beyond millisecond precision.
   */
  toDate() {
    return new Date(Number(floorDiv(this.epochNanoseconds, 1_000_000n)));
  }

  /**
   * @param {Date} date
   * @param {number} [offsetMinutes] the offset to write it at; UTC when
   * not given — a plain `Date` has no offset of its own.
   * @returns {DXNDateTime}
   */
  static fromDate(date, offsetMinutes = 0) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError('DXNDateTime.fromDate expects a valid Date');
    }
    return new DXNDateTime(BigInt(date.getTime()) * 1_000_000n, offsetMinutes);
  }
}

DXNDateTime.prototype.dxnType = 'datetime';

/**
 * Floor (not truncating) BigInt division — matters for negative
 * `epochNanoseconds` (pre-1970 instants), where `BigInt`'s native `/`
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

module.exports = DXNDateTime;
