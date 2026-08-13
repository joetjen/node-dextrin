import { expect } from 'chai';
import * as temporal from '../../src/text/temporal.cjs';
import DXNDate from '../../src/values/date.js';
import DXNTime from '../../src/values/time.js';
import DXNTimestamp from '../../src/values/timestamp.js';
import DXNDateTime from '../../src/values/date-time.js';
import DXNDuration from '../../src/values/duration.js';

describe('text/temporal', () => {
  describe('date', () => {
    it('round-trips YYYY-MM-DD', () => {
      const d = temporal.parseDate('2024-02-29');
      expect(d.equals(new DXNDate(2024, 2, 29))).to.equal(true);
      expect(temporal.formatDate(d)).to.equal('2024-02-29');
    });

    it('rejects a malformed date string', () => {
      expect(() => temporal.parseDate('2024-2-29')).to.throw(SyntaxError);
      expect(() => temporal.parseDate('not-a-date')).to.throw(SyntaxError);
    });
  });

  describe('time', () => {
    it('round-trips HH:MM:SS with no fraction', () => {
      const t = temporal.parseTime('12:30:00');
      expect(t.equals(new DXNTime(12, 30, 0, 0))).to.equal(true);
      expect(temporal.formatTime(t)).to.equal('12:30:00');
    });

    it('round-trips fractional seconds at full microsecond precision', () => {
      const t = temporal.parseTime('12:30:00.5');
      expect(t.microsecond).to.equal(500000);
      expect(temporal.formatTime(t)).to.equal('12:30:00.500000');
    });
  });

  describe('instant (~U)', () => {
    it('round-trips a UTC timestamp', () => {
      const ts = temporal.parseInstant('1990-01-01 00:00:00Z');
      expect(ts).to.be.instanceOf(DXNTimestamp);
      expect(temporal.formatInstant(ts)).to.equal('1990-01-01 00:00:00Z');
    });

    it('requires a trailing Z', () => {
      expect(() => temporal.parseInstant('1990-01-01 00:00:00')).to.throw(SyntaxError);
    });
  });

  describe('offset datetime (@datetime)', () => {
    it('round-trips a positive-offset datetime', () => {
      const dt = temporal.parseOffsetDateTime('2024-03-15T12:00:00+05:00');
      expect(dt).to.be.instanceOf(DXNDateTime);
      expect(dt.offsetMinutes).to.equal(300);
      expect(temporal.formatOffsetDateTime(dt)).to.equal('2024-03-15T12:00:00+05:00');
    });

    it('round-trips a negative-offset datetime', () => {
      const dt = temporal.parseOffsetDateTime('2024-03-15T12:00:00-05:30');
      expect(dt.offsetMinutes).to.equal(-330);
      expect(temporal.formatOffsetDateTime(dt)).to.equal('2024-03-15T12:00:00-05:30');
    });

    it('the offset changes the represented instant, not just its display', () => {
      const utc = temporal.parseOffsetDateTime('2024-03-15T12:00:00Z');
      const plusFive = temporal.parseOffsetDateTime('2024-03-15T12:00:00+05:00');
      expect(plusFive.epochMicroseconds).to.be.lessThan(utc.epochMicroseconds);
    });
  });

  describe('duration', () => {
    it('round-trips a full-field duration', () => {
      const d = temporal.parseDuration('P1Y2M3DT4H5M6.5S');
      expect(d.equals(new DXNDuration({ years: 1, months: 2, days: 3, hours: 4, minutes: 5, microseconds: 6_500_000 }))).to.equal(true);
      expect(temporal.formatDuration(d)).to.equal('P1Y2M3DT4H5M6.5S');
    });

    it('round-trips a whole-seconds-only duration', () => {
      expect(temporal.formatDuration(temporal.parseDuration('PT30S'))).to.equal('PT30S');
    });

    it('unset fields stay null, not zero', () => {
      const d = temporal.parseDuration('P1Y');
      expect(d.months).to.equal(null);
      expect(d.years).to.equal(1);
    });

    it('rejects a duration with no components at all', () => {
      expect(() => temporal.parseDuration('P')).to.throw(SyntaxError);
    });
  });
});
