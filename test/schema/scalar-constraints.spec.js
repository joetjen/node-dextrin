import { expect } from 'chai';
import { decode, Registry, Schema } from '../../src/dextrin.js';

// Scalar refine keys, the superset's group 5, as dextrin 2f20707
// (design/schema-superset.md, Jan, 2026-10-20): lengths and patterns on
// more types, a decimal's precision and exponent, single precision,
// allowed bits, and ranges on dates, times and durations. A constraint on
// a value it does not apply to refuses it, never throws.
describe('schema scalar constraints', () => {
  /** @param {string} type */
  const compiled = (type) => Schema.compile(decode(`%{T: ${type}}`), new Registry());

  /**
   * Whether the value written `text` is a `type`. Only a refusal, an
   * error with a schema category, answers false: any other error is
   * thrown on, so a constraint that throws fails the test.
   * @param {string} type @param {string} text
   */
  const takes = (type, text) => {
    const registry = compiled(type);
    const value = decode(text);
    try {
      return Schema.check(value, registry, 'T');
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  describe('a constraint on a value it does not apply to', () => {
    it('refuses the value', () => {
      expect(takes('{:refine :any %{min-length: 1}}', '5')).to.equal(false);
      expect(takes('{:refine :any %{min: 1}}', '"x"')).to.equal(false);
      expect(takes('{:refine :any %{pattern: @regex "a"}}', '5')).to.equal(false);
      expect(takes('{:refine :any %{min-count: 1}}', '5')).to.equal(false);
      expect(takes('{:refine :any %{min-precision: 1}}', '1.5')).to.equal(false);
    });
  });

  describe('compiling', () => {
    /** The message a compile refuses `type` with. @param {string} type @returns {string} */
    const compileError = (type) => {
      try {
        compiled(type);
      } catch (err) {
        expect(/** @type {any} */ (err).category).to.equal('schema/compile');
        return /** @type {any} */ (err).message;
      }
      throw new Error(`${type} compiled`);
    };

    it('a key, a unique-by or a resolution that is no name is refused, never thrown', () => {
      expect(compileError('{:refine :string %{1 => 2}}')).to.include('key is a name');
      expect(compileError('{:refine {:list-of :any} %{unique-by: 5}}')).to.include('unique-by');
      expect(compileError('{:refine :time %{resolution: :fortnight}}')).to.include(':millisecond');
    });
  });

  describe('lengths', () => {
    it("a keyword's or a symbol's is its name's, in codepoints", () => {
      expect(takes('{:refine :keyword %{max-length: 3}}', ':abc')).to.equal(true);
      expect(takes('{:refine :keyword %{max-length: 3}}', ':abcd')).to.equal(false);
      expect(takes('{:refine :symbol %{min-length: 2}}', 'ab')).to.equal(true);
    });

    it("a byte string's is in bytes, a bit run's under :bits in bits", () => {
      expect(takes('{:refine :bytes %{min-length: 2, max-length: 2}}', '@bytes "AQI="')).to.equal(true);
      expect(takes('{:refine :bytes %{max-length: 1}}', '@bytes "AQI="')).to.equal(false);
      expect(takes('{:refine :bits %{min-length: 12}}', '@bytes "AQI="')).to.equal(true);
      expect(takes('{:refine :bits %{min-length: 17}}', '@bytes "AQI="')).to.equal(false);
    });

    it('min-bytes and max-bytes count a string in UTF-8', () => {
      expect(takes('{:refine :string %{max-length: 1, max-bytes: 2}}', '"é"')).to.equal(true);
      expect(takes('{:refine :string %{max-bytes: 1}}', '"é"')).to.equal(false);
      expect(takes('{:refine :string %{min-bytes: 2}}', '"é"')).to.equal(true);
    });
  });

  describe('pattern', () => {
    it("matches a keyword's or a symbol's name", () => {
      expect(takes('{:refine :keyword %{pattern: @regex "^[a-z]+$"}}', ':abc')).to.equal(true);
      expect(takes('{:refine :symbol %{pattern: @regex "^[a-z]+$"}}', 'Abc')).to.equal(false);
    });

    it('matches bytes one character per byte', () => {
      expect(takes('{:refine :bytes %{pattern: @regex "^\\\\x01\\\\xff$"}}', '@bytes "Af8="')).to.equal(true);
      expect(takes('{:refine :bytes %{pattern: @regex "^\\\\x01$"}}', '@bytes "Af8="')).to.equal(false);
    });
  });

  describe("a decimal's precision and exponent", () => {
    it("precision counts the coefficient's digits, as written", () => {
      expect(takes('{:refine :decimal %{max-precision: 3}}', '1.50M')).to.equal(true);
      expect(takes('{:refine :decimal %{max-precision: 2}}', '1.50M')).to.equal(false);
      expect(takes('{:refine :decimal %{min-precision: 3}}', '1.50M')).to.equal(true);
      expect(takes('{:refine :decimal %{min-precision: 1, max-precision: 1}}', '0M')).to.equal(true);
    });

    it('the exponent is the power of ten the coefficient is scaled by', () => {
      expect(takes('{:refine :decimal %{min-exponent: -2, max-exponent: -2}}', '1.50M')).to.equal(true);
      expect(takes('{:refine :decimal %{min-exponent: -1}}', '1.50M')).to.equal(false);
    });
  });

  describe('float32', () => {
    it('the float holds in single precision exactly', () => {
      expect(takes('{:refine :float %{float32: true}}', '1.5')).to.equal(true);
      expect(takes('{:refine :float %{float32: true}}', '0.1')).to.equal(false);
      expect(takes('{:refine :float %{float32: true}}', '1.0e300')).to.equal(false);
      expect(takes('{:refine :float %{float32: true}}', 'Infinity')).to.equal(true);
      expect(takes('{:refine :float %{float32: false}}', '0.1')).to.equal(true);
    });
  });

  describe('bits', () => {
    it('an unsigned integer sets only the bits given', () => {
      const rwx = '{:refine :integer %{bits: [0 1 2]}}';
      expect(takes(rwx, '5')).to.equal(true);
      expect(takes(rwx, '0')).to.equal(true);
      expect(takes(rwx, '8')).to.equal(false);
      expect(takes(rwx, '-1')).to.equal(false);
    });

    it("a byte string numbers its bits from the first byte's lowest", () => {
      const flags = '{:refine :bytes %{bits: [0 9]}}';
      expect(takes(flags, '@bytes "AQI="')).to.equal(true);
      expect(takes(flags, '@bytes "Ag=="')).to.equal(false);
      expect(takes(flags, '@bytes ""')).to.equal(true);
    });
  });

  describe('ranges on dates, times and durations', () => {
    it('min and max compare values of the same kind', () => {
      const type = '{:refine :date %{min: @date "2026-01-01", exclusive-max: @date "2027-01-01"}}';
      expect(takes(type, '@date "2026-10-20"')).to.equal(true);
      expect(takes(type, '@date "2027-01-01"')).to.equal(false);
      expect(takes(type, '@date "2025-12-31"')).to.equal(false);
    });

    it('datetimes compare as instants, whatever their offsets', () => {
      const type = '{:refine :datetime %{max: @datetime "2026-10-20T12:00:00Z"}}';
      expect(takes(type, '@datetime "2026-10-20T13:00:00+01:00"')).to.equal(true);
      expect(takes(type, '@datetime "2026-10-20T12:00:01Z"')).to.equal(false);
    });

    it('a time, a local date-time and a duration compare too', () => {
      expect(takes('{:refine :time %{min: @time "09:00:00"}}', '@time "09:30:00"')).to.equal(true);
      expect(
        takes('{:refine :local-datetime %{max: @local-datetime "2026-10-20T00:00:00"}}', '@local-datetime "2026-10-19T23:59:59.999999999"')
      ).to.equal(true);
      expect(takes('{:refine :duration %{max: @duration "PT1H"}}', '@duration "PT59M"')).to.equal(true);
      expect(takes('{:refine :duration %{max: @duration "PT1H"}}', '@duration "P1D"')).to.equal(false);
    });

    it('a duration with years or months, or values of two kinds, compare with nothing', () => {
      expect(takes('{:refine :duration %{max: @duration "P400D"}}', '@duration "P1Y"')).to.equal(false);
      expect(takes('{:refine :any %{min: @date "2026-01-01"}}', '@time "12:00:00"')).to.equal(false);
      expect(takes('{:refine :any %{min: @date "2026-01-01"}}', '5')).to.equal(false);
    });

    it('before-now, after-now and within compare a datetime with the time of the check', () => {
      expect(takes('{:refine :datetime %{before-now: true}}', '@datetime "2000-01-01T00:00:00Z"')).to.equal(true);
      expect(takes('{:refine :datetime %{after-now: true}}', '@datetime "2000-01-01T00:00:00Z"')).to.equal(false);
      expect(takes('{:refine :datetime %{after-now: true}}', '@datetime "2999-01-01T00:00:00Z"')).to.equal(true);
      expect(takes('{:refine :datetime %{within: @duration "PT1H"}}', '@datetime "2000-01-01T00:00:00Z"')).to.equal(false);

      const registry = compiled('{:refine :datetime %{within: @duration "PT1H"}}');
      expect(Schema.check(new Date(), registry, 'T')).to.equal(true);
    });

    it('resolution: no part of the value is finer than the unit given', () => {
      expect(takes('{:refine :time %{resolution: :second}}', '@time "12:00:00"')).to.equal(true);
      expect(takes('{:refine :time %{resolution: :second}}', '@time "12:00:00.5"')).to.equal(false);
      expect(takes('{:refine :datetime %{resolution: :millisecond}}', '@datetime "2026-10-20T12:00:00.123Z"')).to.equal(true);
      expect(takes('{:refine :datetime %{resolution: :millisecond}}', '@datetime "2026-10-20T12:00:00.1234Z"')).to.equal(false);
      expect(takes('{:refine :duration %{resolution: :second}}', '@duration "PT2S"')).to.equal(true);
      expect(takes('{:refine :duration %{resolution: :second}}', '@duration "PT2.5S"')).to.equal(false);
    });
  });
});
