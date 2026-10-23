'use strict';

/**
 * @fileoverview DXN's dates and times as text and as numbers (`DXN.md`
 * §1.2, §1.5, §2.2; Jan, 2026-10-20): one place that reads and writes the
 * ISO 8601 strings under `@date`, `@time`, `@datetime`, `@local-datetime`
 * and `@duration`, and turns a value into the nanoseconds `.dxnb` holds
 * and back — shared by the parser, the printer, the canonical form and
 * the binary codec so they never drift apart, mirroring
 * `Dextrin.Temporal`.
 *
 * A time takes up to nine fraction digits. A datetime keeps its offset:
 * `Z` is UTC, `-00:00` (an unknown offset) is refused, and a value with
 * no offset is a local date-time. Written text drops a fraction's
 * trailing zeros and writes `Z` for a zero offset (`DXN.md` §1.5).
 * Nanoseconds are `BigInt` throughout: an epoch in nanoseconds is far
 * past what a `number` holds exactly.
 */

const DXNDate = require('../values/date.cjs');
const DXNTime = require('../values/time.cjs');
const DXNDateTime = require('../values/date-time.cjs');
const DXNLocalDateTime = require('../values/local-date-time.cjs');
const DXNDuration = require('../values/duration.cjs');
const { daysFromCivil, civilFromDays } = require('../values/calendar.cjs');

const NANOS_PER_SECOND = 1_000_000_000n;
const NANOS_PER_MINUTE = 60n * NANOS_PER_SECOND;
const NANOS_PER_DAY = 86_400n * NANOS_PER_SECOND;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_RE = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T([^Z+-]+)(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(.+)$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;
// ISO 8601, each field's sign its own, seconds with up to nine fraction digits.
const DURATION_RE =
  /^P(?:(-?\d+)Y)?(?:(-?\d+)M)?(?:(-?\d+)W)?(?:(-?\d+)D)?(?:T(?:(-?\d+)H)?(?:(-?\d+)M)?(?:(-?)(\d+)(?:\.(\d{1,9}))?S)?)?$/;

// ---- reading text -----------------------------------------------------------

/**
 * @param {string} text `YYYY-MM-DD`.
 * @returns {DXNDate}
 */
function parseDate(text) {
  const m = DATE_RE.exec(text);
  if (!m) throw new SyntaxError(`invalid date ${JSON.stringify(text)}`);
  return new DXNDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * @param {string} text `HH:MM:SS` and up to nine fraction digits.
 * @returns {DXNTime}
 */
function parseTime(text) {
  return timeFromNanos(clock(text, 'time'));
}

/**
 * @param {string} text a date, `T`, a time, and an offset, `Z` or `±HH:MM`.
 * @returns {DXNDateTime}
 */
function parseDateTime(text) {
  const m = DATETIME_RE.exec(text);
  if (!m) throw new SyntaxError(`invalid datetime ${JSON.stringify(text)}`);
  const offset = offsetMinutes(m[3], text);
  return new DXNDateTime(wallClock(m[1], m[2], 'datetime') - BigInt(offset) * NANOS_PER_MINUTE, offset);
}

/**
 * @param {string} text a date, `T` and a time, no offset.
 * @returns {DXNLocalDateTime}
 */
function parseLocalDateTime(text) {
  const m = LOCAL_RE.exec(text);
  if (!m) throw new SyntaxError(`invalid local-datetime ${JSON.stringify(text)}`);
  return new DXNLocalDateTime(wallClock(m[1], m[2], 'local-datetime'));
}

/**
 * The nanoseconds since 1970-01-01T00:00:00 of a date and a time, as a
 * wall clock reads them.
 * @param {string} dateText
 * @param {string} timeText
 * @param {string} tag what is being read, for the error.
 * @returns {bigint}
 */
function wallClock(dateText, timeText, tag) {
  const date = parseDate(dateText);
  return BigInt(daysFromCivil(date.year, date.month, date.day)) * NANOS_PER_DAY + clock(timeText, tag);
}

/**
 * Nanoseconds since midnight, from `HH:MM:SS(.f{1,9})`.
 * @param {string} text
 * @param {string} tag what is being read, for the error.
 * @returns {bigint}
 */
function clock(text, tag) {
  const m = CLOCK_RE.exec(text);
  if (!m) throw new SyntaxError(`invalid ${tag} ${JSON.stringify(text)}`);
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (h > 23 || mi > 59 || s > 59) throw new SyntaxError(`invalid ${tag} ${JSON.stringify(text)}`);
  const fraction = BigInt((m[4] ?? '').padEnd(9, '0'));
  return BigInt((h * 60 + mi) * 60 + s) * NANOS_PER_SECOND + fraction;
}

/**
 * `Z`, or `±HH:MM`, in minutes; `-00:00` says the offset is unknown,
 * which a datetime cannot be.
 * @param {string} offset
 * @param {string} text the whole datetime, for the error.
 * @returns {number}
 */
function offsetMinutes(offset, text) {
  if (offset === 'Z') return 0;
  const m = OFFSET_RE.exec(offset);
  if (!m || offset === '-00:00' || Number(m[2]) > 23 || Number(m[3]) > 59) {
    throw new SyntaxError(`invalid datetime ${JSON.stringify(text)}`);
  }
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * @param {string} text an ISO 8601 duration, e.g. `P1Y2M3DT4H5M6.5S`.
 * @returns {DXNDuration}
 */
function parseDuration(text) {
  const m = DURATION_RE.exec(text);
  if (!m || text === 'P' || text.endsWith('T')) throw new SyntaxError(`invalid duration ${JSON.stringify(text)}`);
  const [, years, months, weeks, days, hours, minutes, sign, seconds, fraction] = m;

  /** @type {bigint | null} */
  let nanoseconds = null;
  if (seconds !== undefined) {
    nanoseconds = BigInt(seconds) * NANOS_PER_SECOND + BigInt((fraction ?? '').padEnd(9, '0'));
    if (sign === '-') nanoseconds = -nanoseconds;
  }

  return new DXNDuration({
    years: intOrNull(years),
    months: intOrNull(months),
    weeks: intOrNull(weeks),
    days: intOrNull(days),
    hours: intOrNull(hours),
    minutes: intOrNull(minutes),
    nanoseconds
  });
}

// ---- writing text -----------------------------------------------------------

/** @param {DXNDate} date @returns {string} `YYYY-MM-DD`; a year before 0 signed. */
function formatDate(date) {
  return `${yearText(date.year)}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** @param {DXNTime} time @returns {string} `HH:MM:SS`, then the fraction without its trailing zeros. */
function formatTime(time) {
  return clockText(timeNanos(time));
}

/** @param {DXNDateTime} dt @returns {string} the wall clock at its offset, then `Z` or `±HH:MM`. */
function formatDateTime(dt) {
  return localText(dt.epochNanoseconds + BigInt(dt.offsetMinutes) * NANOS_PER_MINUTE) + offsetName(dt.offsetMinutes);
}

/** @param {DXNLocalDateTime} local @returns {string} `YYYY-MM-DDTHH:MM:SS` and the fraction. */
function formatLocalDateTime(local) {
  return localText(local.localNanoseconds);
}

/**
 * An offset in minutes as a datetime writes it: `Z`, or `±HH:MM`.
 * @param {number} minutes
 * @returns {string}
 */
function offsetName(minutes) {
  if (minutes === 0) return 'Z';
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * `P...`: the fields in `DXN.md` §2.3's order, absent and zero ones left
 * out, `PT0S` when none is left (§1.5).
 * @param {DXNDuration} d
 * @returns {string}
 */
function formatDuration(d) {
  let date = '';
  if (d.years !== null && d.years !== 0) date += `${d.years}Y`;
  if (d.months !== null && d.months !== 0) date += `${d.months}M`;
  if (d.weeks !== null && d.weeks !== 0) date += `${d.weeks}W`;
  if (d.days !== null && d.days !== 0) date += `${d.days}D`;

  let time = '';
  if (d.hours !== null && d.hours !== 0) time += `${d.hours}H`;
  if (d.minutes !== null && d.minutes !== 0) time += `${d.minutes}M`;
  if (d.nanoseconds !== null && d.nanoseconds !== 0n) time += `${secondsText(d.nanoseconds)}S`;

  if (date === '' && time === '') return 'PT0S';
  return time === '' ? `P${date}` : `P${date}T${time}`;
}

/**
 * The text of a wall clock `nanos` after 1970-01-01T00:00:00.
 * @param {bigint} nanos
 * @returns {string}
 */
function localText(nanos) {
  const day = floorDiv(nanos, NANOS_PER_DAY);
  const [year, month, dayOfMonth] = civilFromDays(Number(day));
  return `${yearText(year)}-${pad2(month)}-${pad2(dayOfMonth)}T${clockText(nanos - day * NANOS_PER_DAY)}`;
}

/**
 * `HH:MM:SS` of `nanos` since midnight, then the fraction with its
 * trailing zeros removed, or nothing when it is zero (`DXN.md` §1.5).
 * @param {bigint} nanos
 * @returns {string}
 */
function clockText(nanos) {
  const seconds = Number(nanos / NANOS_PER_SECOND);
  const base = `${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor(seconds / 60) % 60)}:${pad2(seconds % 60)}`;
  return base + fractionText(nanos % NANOS_PER_SECOND);
}

/** @param {bigint} nanos a duration's seconds, signed. @returns {string} */
function secondsText(nanos) {
  const abs = nanos < 0n ? -nanos : nanos;
  return `${nanos < 0n ? '-' : ''}${abs / NANOS_PER_SECOND}${fractionText(abs % NANOS_PER_SECOND)}`;
}

/** @param {bigint} fraction 0 to 999999999. @returns {string} `.f` without trailing zeros, or nothing. */
function fractionText(fraction) {
  return fraction === 0n ? '' : `.${String(fraction).padStart(9, '0').replace(/0+$/, '')}`;
}

/**
 * The tag and ISO 8601 text of a date, time, datetime, local date-time
 * or duration — what the printer and the canonical form both write — or
 * `null` for any other value. A native `Date` is a datetime in UTC.
 * @param {unknown} value
 * @returns {{tag: string, text: string} | null}
 */
function tagged(value) {
  if (value instanceof DXNDate) return { tag: 'date', text: formatDate(value) };
  if (value instanceof DXNTime) return { tag: 'time', text: formatTime(value) };
  if (value instanceof DXNDateTime) return { tag: 'datetime', text: formatDateTime(value) };
  if (value instanceof Date) return { tag: 'datetime', text: formatDateTime(DXNDateTime.fromDate(value)) };
  if (value instanceof DXNLocalDateTime) return { tag: 'local-datetime', text: formatLocalDateTime(value) };
  if (value instanceof DXNDuration) return { tag: 'duration', text: formatDuration(value) };
  return null;
}

// ---- values and nanoseconds -------------------------------------------------

/** @param {DXNTime} time @returns {bigint} its nanoseconds since midnight. */
function timeNanos(time) {
  return BigInt((time.hour * 60 + time.minute) * 60 + time.second) * NANOS_PER_SECOND + BigInt(time.nanosecond);
}

/** @param {bigint} nanos since midnight, below a day. @returns {DXNTime} */
function timeFromNanos(nanos) {
  const seconds = Number(nanos / NANOS_PER_SECOND);
  return new DXNTime(Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, Number(nanos % NANOS_PER_SECOND));
}

/**
 * The year a wall clock `nanos` after 1970-01-01T00:00:00 falls in —
 * what the binary decoder checks a datetime's range by.
 * @param {bigint} nanos
 * @returns {number}
 */
function yearOf(nanos) {
  return civilFromDays(Number(floorDiv(nanos, NANOS_PER_DAY)))[0];
}

// ---- helpers ----------------------------------------------------------------

/** @param {number} year @returns {string} four digits at least, signed before year 0. */
function yearText(year) {
  return year < 0 ? `-${String(-year).padStart(4, '0')}` : String(year).padStart(4, '0');
}

/** @param {string | undefined} s @returns {number | null} */
function intOrNull(s) {
  return s === undefined ? null : Number(s);
}

/** @param {number} n @returns {string} */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Floor (not truncating) BigInt division, for a moment before 1970.
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
function floorDiv(a, b) {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) !== (b < 0n) ? q - 1n : q;
}

module.exports = {
  NANOS_PER_DAY,
  parseDate,
  parseTime,
  parseDateTime,
  parseLocalDateTime,
  parseDuration,
  formatDate,
  formatTime,
  formatDateTime,
  formatLocalDateTime,
  formatDuration,
  offsetName,
  tagged,
  timeNanos,
  timeFromNanos,
  yearOf
};
