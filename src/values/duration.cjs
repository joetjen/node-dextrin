'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `duration` (`@duration "P..."`). Each field is `number | null` —
 * only fields actually present in the source set a bit in `.dxnb`'s
 * bitmask (`DXN.md` §2.3). `years`/`months` are calendar-relative
 * (variable length) and not reducible to a single elapsed-time scalar,
 * so all seven fields are tracked independently rather than folded
 * into one — mirrors `Dextrin.Duration` exactly. No conversion helper
 * to a native JS type: nothing in JS represents a calendar-relative
 * duration this way either.
 */
class DXNDuration {
  /**
   * @param {{years?: number|null, months?: number|null, weeks?: number|null, days?: number|null, hours?: number|null, minutes?: number|null, microseconds?: number|null}} [fields]
   */
  constructor(fields = {}) {
    /** @type {number | null} */
    this.years = validateField('years', fields.years);
    /** @type {number | null} */
    this.months = validateField('months', fields.months);
    /** @type {number | null} */
    this.weeks = validateField('weeks', fields.weeks);
    /** @type {number | null} */
    this.days = validateField('days', fields.days);
    /** @type {number | null} */
    this.hours = validateField('hours', fields.hours);
    /** @type {number | null} */
    this.minutes = validateField('minutes', fields.minutes);
    /** @type {number | null} */
    this.microseconds = validateField('microseconds', fields.microseconds);
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

DXNDuration.prototype.dxnType = 'duration';

/**
 * @param {string} name
 * @param {number | null | undefined} value
 * @returns {number | null}
 */
function validateField(name, value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value)) throw new TypeError(`DXNDuration ${name} must be an integer or null`);
  return value;
}

module.exports = DXNDuration;
