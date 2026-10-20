'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `local-datetime` (`@local-datetime "YYYY-MM-DDTHH:MM:SS(.f{1,9})?"`)
 * — a date and a wall-clock time with no offset, so no instant (`DXN.md`
 * §1.3, Jan, 2026-10-20). Stored as `localNanoseconds`, the nanoseconds
 * since 1970-01-01T00:00:00 on the wall clock, `.dxnb`'s own shape
 * (`DXN.md` §2.2), as `DXNDateTime` keeps its epoch.
 *
 * `toDate()`/`fromDate()` read and write a `Date`'s UTC fields — a
 * documented convention, as `DXNDate`'s UTC midnight is, since a `Date`
 * is an instant and this is not one.
 */
class DXNLocalDateTime {
  /** @param {bigint} localNanoseconds since 1970-01-01T00:00:00, wall clock. */
  constructor(localNanoseconds) {
    if (typeof localNanoseconds !== 'bigint') {
      throw new TypeError('DXNLocalDateTime localNanoseconds must be a BigInt');
    }
    this.localNanoseconds = localNanoseconds;
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
   * @returns {Date} a `Date` whose UTC fields are this wall-clock date
   * and time (see class doc); lossy beyond millisecond precision.
   */
  toDate() {
    return new Date(Number(floorDiv(this.localNanoseconds, 1_000_000n)));
  }

  /**
   * @param {Date} date read via its UTC fields.
   * @returns {DXNLocalDateTime}
   */
  static fromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError('DXNLocalDateTime.fromDate expects a valid Date');
    }
    return new DXNLocalDateTime(BigInt(date.getTime()) * 1_000_000n);
  }
}

DXNLocalDateTime.prototype.dxnType = 'local-datetime';

/**
 * Floor (not truncating) BigInt division, for a wall clock before 1970.
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
function floorDiv(a, b) {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) !== (b < 0n) ? q - 1n : q;
}

module.exports = DXNLocalDateTime;
