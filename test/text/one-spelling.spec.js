import { expect } from 'chai';
import fc from 'fast-check';
import { canonical, decode, decodeBinary, encode, encodeBinary, DXNError, Registry, Schema } from '../../src/dextrin.js';
import DXNTime from '../../src/values/time.js';
import DXNDateTime from '../../src/values/date-time.js';
import DXNLocalDateTime from '../../src/values/local-date-time.js';
import DXNStruct from '../../src/values/struct.js';

// One way to write a value (Jan, 2026-10-20; DXN.md §1.2): dates, times
// and regexes are tags with a string, sigils are gone, timestamp and
// datetime are one type, and times carry nanoseconds -- in text and in
// `.dxnb`, where 0.2's microsecond tags are still read as they were meant.

/** The category `text` is refused with, or `null` when it decodes. */
const category = (text) => {
  try {
    decode(text);
    return null;
  } catch (err) {
    expect(err).to.be.instanceOf(DXNError);
    return err.category;
  }
};

/** `text` decoded, through `.dxnb` and back, in canonical form. */
const roundTrip = (text) => canonical(decodeBinary(encodeBinary(decode(text))));

/** `.dxnb` bytes: the envelope, then `item`. */
const dxnb = (...item) => new Uint8Array([0x44, 0x58, 1, ...item]);

describe('one spelling', () => {
  describe('sigils are gone', () => {
    it('every one is refused', () => {
      for (const old of ['~D[2026-10-20]', '~T[12:00:00]', '~U[2026-10-20 12:00:00Z]', '~r/a/i']) {
        expect(category(old), old).to.equal('syntax');
      }
    });
  });

  describe('dates and times', () => {
    it('read and write as ISO 8601 strings under their tag', () => {
      for (const text of [
        '@date "2026-10-20"',
        '@time "14:30:00.5"',
        '@datetime "2026-10-20T14:30:00Z"',
        '@datetime "2026-10-20T16:30:00+02:00"',
        '@local-datetime "2026-10-20T14:30:00"',
        '@duration "P1DT2.5S"'
      ]) {
        expect(canonical(decode(text))).to.equal(text);
        expect(encode(decode(text))).to.equal(text);
      }
    });

    it('a UTC datetime is written Z, whichever way it was given', () => {
      expect(canonical(decode('@datetime "2026-10-20T14:30:00+00:00"'))).to.equal('@datetime "2026-10-20T14:30:00Z"');
    });

    it('an unknown offset, -00:00, is refused; a local date-time has none', () => {
      expect(category('@datetime "2026-10-20T14:30:00-00:00"')).to.equal('syntax');
      expect(category('@datetime "2026-10-20T14:30:00"')).to.equal('syntax');
      expect(category('@local-datetime "2026-10-20T14:30:00Z"')).to.equal('syntax');
    });

    it('nine fraction digits survive text and binary', () => {
      for (const text of [
        '@time "14:30:00.123456789"',
        '@datetime "2026-10-20T14:30:00.000000001+05:30"',
        '@local-datetime "1969-12-31T23:59:59.999999999"',
        '@duration "PT0.000000001S"'
      ]) {
        expect(roundTrip(text), text).to.equal(text);
      }
    });

    // Any instant from year 0 to 9999, at any offset, to the nanosecond:
    // printed, read back, written to `.dxnb` and read again, it is itself.
    it('every datetime and local date-time survives text and binary', () => {
      const nanos = fc.bigInt(-62_167_219_200_000_000_000n + 86_400_000_000_000n, 253_402_300_799_999_999_999n - 86_400_000_000_000n);
      fc.assert(
        fc.property(nanos, fc.integer({ min: -1439, max: 1439 }), (ns, offset) => {
          for (const value of [new DXNDateTime(ns, offset), new DXNLocalDateTime(ns)]) {
            const text = encode(value);
            expect(decode(text)).to.deep.equal(value);
            expect(roundTrip(text)).to.equal(text);
          }
        })
      );
    });

    it('a tenth fraction digit is refused', () => {
      expect(category('@time "14:30:00.1234567891"')).to.equal('syntax');
    });

    it('a time holds its nanoseconds, a local date-time is a DXNLocalDateTime', () => {
      const time = decode('@time "14:30:00.123456789"');
      expect(time).to.be.instanceOf(DXNTime);
      expect(time.nanosecond).to.equal(123456789);
      const local = decode('@local-datetime "2026-10-20T14:30:00"');
      expect(local).to.be.instanceOf(DXNLocalDateTime);
    });

    it('a native Date is a datetime in UTC', () => {
      const at = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));
      expect(encode(at)).to.equal('@datetime "2024-01-02T03:04:05Z"');
      expect(decodeBinary(encodeBinary(at))).to.deep.equal(DXNDateTime.fromDate(at));
    });
  });

  describe('regex', () => {
    it('flags in a header, or inline in the pattern; two different values', () => {
      expect(roundTrip('@regex(im) "^\\\\d+$"')).to.equal('@regex(im) "^\\\\d+$"');
      expect(roundTrip('@regex "(?im)^\\\\d+$"')).to.equal('@regex "(?im)^\\\\d+$"');
      const header = decode('@regex(i) "a"');
      const inline = decode('@regex "(?i)a"');
      expect(header.toRegExp().test('A')).to.equal(true);
      expect(header.equals(inline)).to.equal(false);
    });

    it('the flags are written in their canonical order', () => {
      expect(canonical(decode('@regex(mi) "a"'))).to.equal('@regex(im) "a"');
      expect(encode(decode('@regex(mi) "a"'))).to.equal('@regex(im) "a"');
    });

    it('a header on any other tag, a flag given twice, or an unknown flag is refused', () => {
      expect(category('@uuid(i) "x"')).to.equal('syntax');
      expect(category('@regex(ii) "a"')).to.equal('syntax');
      expect(category('@regex(q) "a"')).to.equal('syntax');
    });

    it('a pattern is a string', () => {
      expect(category('@regex 1')).to.equal('syntax');
    });
  });

  describe("0.2's binary", () => {
    // A tag never changes its meaning (DXN.md §2.3): 0.2 wrote a time as
    // microseconds under 210, a UTC timestamp under 1.
    it('a microsecond time and a tag-1 timestamp read as what they meant', () => {
      // 210(43_200_000_000): 12:00:00 in microseconds.
      const time = dxnb(0xd8, 210, 0x1b, 0, 0, 0, 0x0a, 0x0e, 0xeb, 0xb0, 0x00);
      expect(decodeBinary(time)).to.deep.equal(new DXNTime(12, 0, 0, 0));

      // 1(1_000_000): one second past the epoch, in microseconds.
      const utc = dxnb(0xc1, 0x1a, 0x00, 0x0f, 0x42, 0x40);
      expect(decodeBinary(utc)).to.deep.equal(new DXNDateTime(1_000_000_000n, 0));
    });

    it('a microsecond datetime and duration read as what they meant', () => {
      // 211([1, 60]): a microsecond past the epoch, at +01:00.
      const datetime = dxnb(0xd8, 211, 0x82, 0x01, 0x18, 60);
      expect(canonical(decodeBinary(datetime))).to.equal('@datetime "1970-01-01T01:00:00.000001+01:00"');
      // 212([0b1000000, 1_500_000]): 1.5 seconds, in microseconds.
      const duration = dxnb(0xd8, 212, 0x82, 0x18, 0x40, 0x1a, 0x00, 0x16, 0xe3, 0x60);
      expect(canonical(decodeBinary(duration))).to.equal('@duration "PT1.5S"');
    });

    it('the nanosecond forms take the new tags', () => {
      const tagOf = (text) => Buffer.from(encodeBinary(decode(text))).subarray(3, 5).toString('hex');
      expect(tagOf('@local-datetime "1970-01-01T00:00:01"')).to.equal('d8d9');
      expect(tagOf('@time "00:00:01"')).to.equal('d8da');
      expect(tagOf('@datetime "1970-01-01T00:00:01Z"')).to.equal('d8db');
      expect(tagOf('@duration "PT1S"')).to.equal('d8dc');
    });
  });

  describe('schemas', () => {
    const registryFor = (type) => Schema.compile(decode(`%{T: %schema{v: ${type}}}`), new Registry());
    const field = (registry, text) => decode(`%T{v: ${text}}`, { registry });

    // One datetime type whatever its offset; :timestamp is a datetime in
    // UTC (Jan, 2026-10-20).
    it('timestamp takes a UTC datetime only; datetime takes any offset', () => {
      let r = registryFor(':timestamp');
      expect(() => field(r, '@datetime "2024-01-01T00:00:00Z"')).not.to.throw();
      expect(() => field(r, '@datetime "2024-01-01T00:00:00+02:00"')).to.throw(DXNError);
      expect(() => encode(DXNStruct.keyed('T', [['v', new Date(0)]]), { registry: r })).not.to.throw();

      r = registryFor(':datetime');
      expect(() => field(r, '@datetime "2024-01-01T00:00:00Z"')).not.to.throw();
      expect(() => field(r, '@datetime "2024-01-01T00:00:00+02:00"')).not.to.throw();
    });

    it('local-datetime is a type of its own', () => {
      const r = registryFor(':local-datetime');
      expect(() => field(r, '@local-datetime "2024-01-01T00:00:00"')).not.to.throw();
      expect(() => field(r, '@datetime "2024-01-01T00:00:00Z"')).to.throw(DXNError);
    });

    it('offsets checks a datetime against the offsets it lists', () => {
      const r = registryFor('{:refine :datetime %{offsets: ["Z" "+02:00"]}}');
      expect(() => field(r, '@datetime "2024-01-01T00:00:00+02:00"')).not.to.throw();
      expect(() => field(r, '@datetime "2024-01-01T00:00:00Z"')).not.to.throw();
      expect(() => field(r, '@datetime "2024-01-01T00:00:00+01:00"')).to.throw(DXNError);
    });

    it('finite refuses NaN and the infinities; a range refuses NaN', () => {
      let r = registryFor('{:refine :float %{finite: true}}');
      expect(() => field(r, '1.5')).not.to.throw();
      for (const bad of ['NaN', 'Infinity', '-Infinity']) expect(() => field(r, bad), bad).to.throw(DXNError);

      r = registryFor('{:refine :float %{min: 0}}');
      expect(() => field(r, 'Infinity')).not.to.throw();
      expect(() => field(r, 'NaN')).to.throw(DXNError);
      expect(() => field(r, '-Infinity')).to.throw(DXNError);

      for (const bound of ['max: 0', 'exclusive-min: 0', 'exclusive-max: 0']) {
        r = registryFor(`{:refine :float %{${bound}}}`);
        expect(() => field(r, 'NaN'), bound).to.throw(DXNError);
      }
    });
  });
});
