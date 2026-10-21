'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `duration` (`@duration "P..."`). Each field is `number | null` —
 * only fields actually present in the source set a bit in `.dxnb`'s
 * bitmask (`DXN.md` §2.3). `years`/`months` are calendar-relative
 * (variable length) and not reducible to a single elapsed-time scalar,
 * so all seven fields are tracked independently rather than folded
 * into one — mirrors `Dextrin.Duration` exactly. Seconds and their
 * fraction are one field, `nanoseconds` (Jan, 2026-10-20), a `BigInt`
 * where the others are numbers: a `number` holds only some 104 days of
 * nanoseconds exactly. No conversion helper
 * to a native JS type: nothing in JS represents a calendar-relative
 * duration this way either.
 */
class DXNDuration {
  /**
   * @param {{years?: number|null, months?: number|null, weeks?: number|null, days?: number|null, hours?: number|null, minutes?: number|null, nanoseconds?: bigint|number|null}} [fields]
   *   `nanoseconds` may be given as an integer `number`; it is held as a `BigInt`.
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
    /** @type {bigint | null} */
    this.nanoseconds = validateNanoseconds(fields.nanoseconds);
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

/**
 * @param {bigint | number | null | undefined} value
 * @returns {bigint | null}
 */
function validateNanoseconds(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) throw new TypeError('DXNDuration nanoseconds must be a BigInt, an integer, or null');
  return BigInt(value);
}

module.exports = DXNDuration;
