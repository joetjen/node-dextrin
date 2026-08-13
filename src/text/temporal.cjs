'use strict';

/**
 * @fileoverview ISO 8601 parsing/formatting shared by the `.dxn` text
 * parser and printer for `date`/`time`/`timestamp`/`datetime`/
 * `duration` — one implementation so encode/decode never drift apart,
 * mirroring why `Dextrin.Text.Escapes` exists as its own module on the
 * Elixir side.
 */

const DXNDate = require('../values/date.cjs');
const DXNTime = require('../values/time.cjs');
const DXNTimestamp = require('../values/timestamp.cjs');
const DXNDateTime = require('../values/date-time.cjs');
const DXNDuration = require('../values/duration.cjs');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;
const DURATION_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * @param {string} text `YYYY-MM-DD`.
 * @returns {DXNDate}
 */
function parseDate(text) {
  const m = DATE_RE.exec(text);
  if (!m) throw new SyntaxError(`invalid date ${JSON.stringify(text)}`);
  return new DXNDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** @param {DXNDate} date @returns {string} */
function formatDate(date) {
  return `${String(date.year).padStart(4, '0')}-${pad2(date.month)}-${pad2(date.day)}`;
}

/**
 * @param {string} text `HH:MM:SS(.ffffff)?`.
 * @returns {DXNTime}
 */
function parseTime(text) {
  const m = TIME_RE.exec(text);
  if (!m) throw new SyntaxError(`invalid time ${JSON.stringify(text)}`);
  const microsecond = m[4] ? Number(m[4].padEnd(6, '0')) : 0;
  return new DXNTime(Number(m[1]), Number(m[2]), Number(m[3]), microsecond);
}

/** @param {DXNTime} time @returns {string} */
function formatTime(time) {
  const base = `${pad2(time.hour)}:${pad2(time.minute)}:${pad2(time.second)}`;
  if (time.microsecond === 0) return base;
  return `${base}.${String(time.microsecond).padStart(6, '0')}`;
}

/**
 * `~U[YYYY-MM-DD HH:MM:SSZ]` — date and time separated by one literal
 * space (not `T`, unlike `@datetime`/RFC 3339), `Z` mandatory.
 * @param {string} inner text between `~U[` and `]`.
 * @returns {DXNTimestamp}
 */
function parseInstant(inner) {
  const spaceAt = inner.indexOf(' ');
  if (spaceAt === -1) throw new SyntaxError(`invalid timestamp ${JSON.stringify(inner)}`);
  const datePart = inner.slice(0, spaceAt);
  let timePart = inner.slice(spaceAt + 1);
  if (!timePart.endsWith('Z')) throw new SyntaxError(`timestamp must end in 'Z': ${JSON.stringify(inner)}`);
  timePart = timePart.slice(0, -1);

  const date = parseDate(datePart);
  const time = parseTime(timePart);
  const epochMicroseconds = BigInt(Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second)) * 1000n + BigInt(time.microsecond);
  return new DXNTimestamp(epochMicroseconds);
}

/** @param {DXNTimestamp} ts @returns {string} inner text (no `~U[`/`]`). */
function formatInstant(ts) {
  const ms = floorDiv(ts.epochMicroseconds, 1000n);
  const microOfMs = ts.epochMicroseconds - ms * 1000n;
  const d = new Date(Number(ms));
  const date = new DXNDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const microsecond = d.getUTCMilliseconds() * 1000 + Number(microOfMs);
  const time = new DXNTime(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), microsecond);
  return `${formatDate(date)} ${formatTime(time)}Z`;
}

/**
 * `@datetime "YYYY-MM-DDTHH:MM:SS(.ffffff)?(Z|±HH:MM)"` — RFC 3339
 * separator (`T`), offset required (`Z` accepted defensively, even
 * though this type exists specifically for the non-UTC case — mirrors
 * `Dextrin.Text.Actions`'s own permissive acceptance).
 * @param {string} text
 * @returns {DXNDateTime}
 */
function parseOffsetDateTime(text) {
  const tAt = text.indexOf('T');
  if (tAt === -1) throw new SyntaxError(`invalid datetime ${JSON.stringify(text)}`);
  const datePart = text.slice(0, tAt);
  const rest = text.slice(tAt + 1);

  let timePart;
  let offsetMinutes;
  if (rest.endsWith('Z')) {
    timePart = rest.slice(0, -1);
    offsetMinutes = 0;
  } else {
    const offsetMatch = OFFSET_RE.exec(rest.slice(-6));
    if (!offsetMatch) throw new SyntaxError(`invalid datetime offset in ${JSON.stringify(text)}`);
    timePart = rest.slice(0, -6);
    const sign = offsetMatch[1] === '-' ? -1 : 1;
    offsetMinutes = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
  }

  const date = parseDate(datePart);
  const time = parseTime(timePart);
  const wallClockMs = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second);
  const epochMicroseconds =
    BigInt(wallClockMs) * 1000n + BigInt(time.microsecond) - BigInt(offsetMinutes) * 60_000_000n;
  return new DXNDateTime(epochMicroseconds, offsetMinutes);
}

/** @param {DXNDateTime} dt @returns {string} the quoted string body (unquoted). */
function formatOffsetDateTime(dt) {
  const instantMicro = dt.epochMicroseconds + BigInt(dt.offsetMinutes) * 60_000_000n;
  const ms = floorDiv(instantMicro, 1000n);
  const microOfMs = instantMicro - ms * 1000n;
  const d = new Date(Number(ms));
  const date = new DXNDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const microsecond = d.getUTCMilliseconds() * 1000 + Number(microOfMs);
  const time = new DXNTime(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), microsecond);
  const offset = formatOffsetMinutes(dt.offsetMinutes);
  return `${formatDate(date)}T${formatTime(time)}${offset}`;
}

/** @param {number} offsetMinutes @returns {string} */
function formatOffsetMinutes(offsetMinutes) {
  if (offsetMinutes === 0) return 'Z';
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * @param {string} text an ISO 8601 duration, e.g. `P1Y2M3DT4H5M6.5S`.
 * @returns {DXNDuration}
 */
function parseDuration(text) {
  const m = DURATION_RE.exec(text);
  if (!m || text === 'P' || text === 'PT') throw new SyntaxError(`invalid duration ${JSON.stringify(text)}`);
  const [, years, months, weeks, days, hours, minutes, seconds] = m;

  let microseconds = null;
  if (seconds !== undefined) {
    const [wholeStr, fracStr = ''] = seconds.split('.');
    microseconds = Number(wholeStr) * 1_000_000 + Number(fracStr.padEnd(6, '0').slice(0, 6));
  }

  return new DXNDuration({
    years: intOrNull(years),
    months: intOrNull(months),
    weeks: intOrNull(weeks),
    days: intOrNull(days),
    hours: intOrNull(hours),
    minutes: intOrNull(minutes),
    microseconds
  });
}

/** @param {DXNDuration} d @returns {string} */
function formatDuration(d) {
  let out = 'P';
  if (d.years !== null) out += `${d.years}Y`;
  if (d.months !== null) out += `${d.months}M`;
  if (d.weeks !== null) out += `${d.weeks}W`;
  if (d.days !== null) out += `${d.days}D`;

  let time = '';
  if (d.hours !== null) time += `${d.hours}H`;
  if (d.minutes !== null) time += `${d.minutes}M`;
  if (d.microseconds !== null) time += `${formatSeconds(d.microseconds)}S`;
  if (time !== '') out += `T${time}`;

  return out === 'P' ? 'PT0S' : out;
}

/** @param {number} microseconds @returns {string} */
function formatSeconds(microseconds) {
  const whole = Math.trunc(microseconds / 1_000_000);
  const frac = Math.abs(microseconds % 1_000_000);
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(6, '0')}`.replace(/0+$/, '');
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
  parseDate,
  formatDate,
  parseTime,
  formatTime,
  parseInstant,
  formatInstant,
  parseOffsetDateTime,
  formatOffsetDateTime,
  parseDuration,
  formatDuration
};
