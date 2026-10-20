'use strict';

/**
 * @fileoverview Days since 1970-01-01 and back, in the proleptic
 * Gregorian calendar — what `date`, `datetime` and `local-datetime` are
 * counted in (`DXN.md` §2.2). Plain arithmetic (Howard Hinnant's
 * `days_from_civil`/`civil_from_days`) rather than `Date.UTC`, which
 * reads a year below 100 as 19xx and stops at ±275,760 years.
 */

/**
 * The days from 1970-01-01 to `year`-`month`-`day`.
 * @param {number} year
 * @param {number} month 1-12.
 * @param {number} day
 * @returns {number}
 */
function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * The date `days` after 1970-01-01.
 * @param {number} days
 * @returns {[number, number, number]} year, month (1-12), day.
 */
function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shifted = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
  const month = shifted < 10 ? shifted + 3 : shifted - 9;
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

module.exports = { daysFromCivil, civilFromDays };
