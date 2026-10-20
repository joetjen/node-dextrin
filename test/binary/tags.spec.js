import { expect } from 'chai';
import * as Tags from '../../src/binary/tags.cjs';

describe('binary/tags', () => {
  describe('regex flags <-> byte', () => {
    it('round-trips an empty flag set', () => {
      const flags = { i: false, m: false, s: false, u: false, x: false, f: false, r: false };
      expect(Tags.regexFlagsToByte(flags)).to.equal(0);
      expect(Tags.regexByteToFlags(0)).to.deep.equal(flags);
    });

    it('sets bit 0 for "i", matching DXN.md §2.3\'s bit order', () => {
      const flags = { i: true, m: false, s: false, u: false, x: false, f: false, r: false };
      expect(Tags.regexFlagsToByte(flags)).to.equal(0b0000001);
    });

    it('round-trips an arbitrary combination', () => {
      const flags = { i: true, m: false, s: true, u: false, x: true, f: false, r: true };
      const byte = Tags.regexFlagsToByte(flags);
      expect(Tags.regexByteToFlags(byte)).to.deep.equal(flags);
    });

    it('sets bit 6 for "r" (the last flag)', () => {
      const flags = { i: false, m: false, s: false, u: false, x: false, f: false, r: true };
      expect(Tags.regexFlagsToByte(flags)).to.equal(0b1000000);
    });
  });

  describe('duration bitmask', () => {
    it('is 0 when every field is null', () => {
      const empty = { years: null, months: null, weeks: null, days: null, hours: null, minutes: null, nanoseconds: null };
      expect(Tags.durationBitmask(empty)).to.equal(0);
      expect(Tags.durationFieldsPresent(0)).to.deep.equal([]);
    });

    it('sets bit 0 for years, matching DXN.md §2.3\'s field order', () => {
      const d = { years: 1, months: null, weeks: null, days: null, hours: null, minutes: null, nanoseconds: null };
      expect(Tags.durationBitmask(d)).to.equal(0b0000001);
      expect(Tags.durationFieldsPresent(0b0000001)).to.deep.equal(['years']);
    });

    it('sets bit 6 for nanoseconds (the last field)', () => {
      const d = { years: null, months: null, weeks: null, days: null, hours: null, minutes: null, nanoseconds: 5n };
      expect(Tags.durationBitmask(d)).to.equal(0b1000000);
    });

    it('lists present fields in bit order regardless of object key order', () => {
      const d = { nanoseconds: 1n, years: 1, months: null, weeks: null, days: null, hours: null, minutes: null };
      const bitmask = Tags.durationBitmask(d);
      expect(Tags.durationFieldsPresent(bitmask)).to.deep.equal(['years', 'nanoseconds']);
    });
  });
});
