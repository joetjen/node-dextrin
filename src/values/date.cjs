'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `date` (`~D[YYYY-MM-DD]`) — a bare calendar date, no time-of-day
 * or timezone component. Not backed by native JS `Date` internally:
 * `Date` conflates date+time+instant into one epoch-ms value and can't
 * represent a bare calendar date distinctly from midnight-somewhere —
 * exactly the ambiguity `DXN.md` §1.3 avoids by keeping `date`/`time`/
 * `datetime` as separate types. `toDate()`/`fromDate()` below offer a
 * documented, UTC-midnight convention as a convenience, not as this
 * class's actual storage.
 */
class DXNDate {
  /**
   * @param {number} year
   * @param {number} month 1-12.
   * @param {number} day 1-31, validated against `month`/`year`.
   */
  constructor(year, month, day) {
    if (![year, month, day].every(Number.isInteger)) {
      throw new TypeError('DXNDate year/month/day must be integers');
    }
    if (month < 1 || month > 12) throw new RangeError(`DXNDate month out of range: ${month}`);
    const utc = Date.UTC(year, month - 1, day);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      throw new RangeError(`DXNDate: ${year}-${month}-${day} is not a valid calendar date`);
    }
    this.year = year;
    this.month = month;
    this.day = day;
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
   * @returns {Date} a JS `Date` at UTC midnight of this calendar date
   * — a documented convention, since `Date` can't hold a bare date on
   * its own.
   */
  toDate() {
    return new Date(Date.UTC(this.year, this.month - 1, this.day));
  }

  /**
   * @param {Date} date read via its UTC year/month/day fields.
   * @returns {DXNDate}
   */
  static fromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError('DXNDate.fromDate expects a valid Date');
    }
    return new DXNDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
}

DXNDate.prototype.dxnType = 'date';

module.exports = DXNDate;
