'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `time` (`~T[HH:MM:SS(.ffffff)?]`) — a bare wall-clock
 * time-of-day, no date or timezone component. No conversion helpers to
 * a native JS type: nothing in JS represents "time of day" on its own
 * without a synthetic, misleading date component the way `DXNDate`'s
 * UTC-midnight convention at least stays honest about being a
 * convention — see that class's own doc for the same underlying
 * `Date`-conflation problem.
 */
class DXNTime {
  /**
   * @param {number} hour 0-23.
   * @param {number} minute 0-59.
   * @param {number} second 0-59.
   * @param {number} microsecond 0-999999.
   */
  constructor(hour, minute, second, microsecond) {
    if (![hour, minute, second, microsecond].every(Number.isInteger)) {
      throw new TypeError('DXNTime fields must be integers');
    }
    if (hour < 0 || hour > 23) throw new RangeError(`DXNTime hour out of range: ${hour}`);
    if (minute < 0 || minute > 59) throw new RangeError(`DXNTime minute out of range: ${minute}`);
    if (second < 0 || second > 59) throw new RangeError(`DXNTime second out of range: ${second}`);
    if (microsecond < 0 || microsecond > 999999) {
      throw new RangeError(`DXNTime microsecond out of range: ${microsecond}`);
    }
    this.hour = hour;
    this.minute = minute;
    this.second = second;
    this.microsecond = microsecond;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }
}

DXNTime.prototype.dxnType = 'time';

module.exports = DXNTime;
