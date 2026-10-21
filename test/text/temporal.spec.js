import { expect } from 'chai';
import * as temporal from '../../src/text/temporal.cjs';
import DXNDate from '../../src/values/date.js';
import DXNTime from '../../src/values/time.js';
import DXNDateTime from '../../src/values/date-time.js';
import DXNLocalDateTime from '../../src/values/local-date-time.js';
import DXNDuration from '../../src/values/duration.js';

describe('text/temporal', () => {
  describe('date', () => {
    it('round-trips YYYY-MM-DD', () => {
      const d = temporal.parseDate('2024-02-29');
      expect(d.equals(new DXNDate(2024, 2, 29))).to.equal(true);
      expect(temporal.formatDate(d)).to.equal('2024-02-29');
    });

    it('holds a year below 100 as itself', () => {
      expect(temporal.formatDate(temporal.parseDate('0050-03-01'))).to.equal('0050-03-01');
    });

    it('rejects a malformed or impossible date string', () => {
      expect(() => temporal.parseDate('2024-2-29')).to.throw(SyntaxError);
      expect(() => temporal.parseDate('not-a-date')).to.throw(SyntaxError);
      expect(() => temporal.parseDate('2023-02-29')).to.throw();
    });
  });

  describe('time', () => {
    it('round-trips HH:MM:SS with no fraction', () => {
      const t = temporal.parseTime('12:30:00');
      expect(t.equals(new DXNTime(12, 30, 0, 0))).to.equal(true);
      expect(temporal.formatTime(t)).to.equal('12:30:00');
    });

    it('writes the fraction without its trailing zeros (DXN.md §1.5)', () => {
      const t = temporal.parseTime('12:30:00.500');
      expect(t.nanosecond).to.equal(500_000_000);
      expect(temporal.formatTime(t)).to.equal('12:30:00.5');
    });

    it('keeps nine fraction digits, and refuses a tenth', () => {
      expect(temporal.formatTime(temporal.parseTime('12:30:00.000000001'))).to.equal('12:30:00.000000001');
      expect(() => temporal.parseTime('12:30:00.0000000001')).to.throw(SyntaxError);
    });

    it('refuses an hour, minute or second out of range', () => {
      expect(() => temporal.parseTime('24:00:00')).to.throw(SyntaxError);
      expect(() => temporal.parseTime('12:60:00')).to.throw(SyntaxError);
      expect(() => temporal.parseTime('12:00:60')).to.throw(SyntaxError);
    });
  });

  describe('datetime', () => {
    it('round-trips a UTC datetime, written Z', () => {
      const dt = temporal.parseDateTime('1990-01-01T00:00:00Z');
      expect(dt).to.be.instanceOf(DXNDateTime);
      expect(dt.offsetMinutes).to.equal(0);
      expect(temporal.formatDateTime(dt)).to.equal('1990-01-01T00:00:00Z');
    });

    it('round-trips a positive-offset datetime', () => {
      const dt = temporal.parseDateTime('2024-03-15T12:00:00+05:00');
      expect(dt.offsetMinutes).to.equal(300);
      expect(temporal.formatDateTime(dt)).to.equal('2024-03-15T12:00:00+05:00');
    });

    it('round-trips a negative-offset datetime', () => {
      const dt = temporal.parseDateTime('2024-03-15T12:00:00-05:30');
      expect(dt.offsetMinutes).to.equal(-330);
      expect(temporal.formatDateTime(dt)).to.equal('2024-03-15T12:00:00-05:30');
    });

    it('the offset changes the represented instant, not just its display', () => {
      const utc = temporal.parseDateTime('2024-03-15T12:00:00Z');
      const plusFive = temporal.parseDateTime('2024-03-15T12:00:00+05:00');
      expect(plusFive.epochNanoseconds).to.equal(utc.epochNanoseconds - 5n * 3_600_000_000_000n);
    });

    it('refuses -00:00, a missing offset, and an offset out of range', () => {
      expect(() => temporal.parseDateTime('2024-03-15T12:00:00-00:00')).to.throw(SyntaxError);
      expect(() => temporal.parseDateTime('2024-03-15T12:00:00')).to.throw(SyntaxError);
      expect(() => temporal.parseDateTime('2024-03-15T12:00:00+24:00')).to.throw(SyntaxError);
      expect(() => temporal.parseDateTime('2024-03-15 12:00:00Z')).to.throw(SyntaxError);
    });
  });

  describe('local-datetime', () => {
    it('round-trips a wall-clock date-time, before 1970 too', () => {
      const local = temporal.parseLocalDateTime('1969-12-31T23:59:59.999999999');
      expect(local).to.be.instanceOf(DXNLocalDateTime);
      expect(local.localNanoseconds).to.equal(-1n);
      expect(temporal.formatLocalDateTime(local)).to.equal('1969-12-31T23:59:59.999999999');
    });

    it('refuses an offset', () => {
      expect(() => temporal.parseLocalDateTime('2024-03-15T12:00:00Z')).to.throw(SyntaxError);
      expect(() => temporal.parseLocalDateTime('2024-03-15T12:00:00+02:00')).to.throw(SyntaxError);
    });
  });

  describe('duration', () => {
    it('round-trips a full-field duration', () => {
      const d = temporal.parseDuration('P1Y2M3DT4H5M6.5S');
      expect(d.equals(new DXNDuration({ years: 1, months: 2, days: 3, hours: 4, minutes: 5, nanoseconds: 6_500_000_000n }))).to.equal(true);
      expect(temporal.formatDuration(d)).to.equal('P1Y2M3DT4H5M6.5S');
    });

    it('round-trips a whole-seconds-only duration', () => {
      expect(temporal.formatDuration(temporal.parseDuration('PT30S'))).to.equal('PT30S');
    });

    it('keeps nine fraction digits of a second', () => {
      expect(temporal.parseDuration('PT0.000000001S').nanoseconds).to.equal(1n);
      expect(temporal.formatDuration(temporal.parseDuration('PT0.000000001S'))).to.equal('PT0.000000001S');
    });

    it("gives each field its own sign", () => {
      const d = temporal.parseDuration('P-1DT-1.5S');
      expect(d.days).to.equal(-1);
      expect(d.nanoseconds).to.equal(-1_500_000_000n);
      expect(temporal.formatDuration(d)).to.equal('P-1DT-1.5S');
    });

    it('unset fields stay null, not zero', () => {
      const d = temporal.parseDuration('P1Y');
      expect(d.months).to.equal(null);
      expect(d.years).to.equal(1);
    });

    it('writes PT0S when it has no fields', () => {
      expect(temporal.formatDuration(new DXNDuration())).to.equal('PT0S');
    });

    it('rejects a duration with no components at all, or a T with none after it', () => {
      expect(() => temporal.parseDuration('P')).to.throw(SyntaxError);
      expect(() => temporal.parseDuration('PT')).to.throw(SyntaxError);
      expect(() => temporal.parseDuration('P1DT')).to.throw(SyntaxError);
    });
  });
});
