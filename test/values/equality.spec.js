import { expect } from 'chai';
import { dxnEquals, dxnCompare, canonicalKey, kindOf, KIND_RANK } from '../../src/values/equality.js';
import DXNBytes from '../../src/values/bytes.js';
import DXNChar from '../../src/values/char.js';

describe('equality kernel', () => {
  describe('kindOf', () => {
    it('classifies native shapes', () => {
      expect(kindOf(null)).to.equal('nil');
      expect(kindOf(undefined)).to.equal('nil');
      expect(kindOf(true)).to.equal('boolean');
      expect(kindOf(5n)).to.equal('integer');
      expect(kindOf(5.5)).to.equal('float');
      expect(kindOf('x')).to.equal('string');
      expect(kindOf([1, 2])).to.equal('array');
      expect(kindOf(new Map())).to.equal('map');
      expect(kindOf(new Set())).to.equal('set');
    });

    it('distinguishes an interned (keyword-like) symbol from a plain one', () => {
      expect(kindOf(Symbol.for('ok'))).to.equal('keyword');
      expect(kindOf(Symbol('ok'))).to.equal('symbol');
    });

    it('classifies both a bare Uint8Array and a DXNBytes wrapper as "bytes"', () => {
      expect(kindOf(new Uint8Array([1]))).to.equal('bytes');
      expect(kindOf(new DXNBytes(new Uint8Array([1])))).to.equal('bytes');
    });

    it('recognizes DXN* wrapper instances via their dxnType tag', () => {
      expect(kindOf(new DXNChar(97))).to.equal('char');
    });
  });

  describe('dxnEquals', () => {
    it('treats two NaN floats as equal (DXN treats NaN as one specific scalar value)', () => {
      expect(dxnEquals(NaN, NaN)).to.equal(true);
    });

    it('compares arrays elementwise, structurally', () => {
      expect(dxnEquals([1, [2, 3]], [1, [2, 3]])).to.equal(true);
      expect(dxnEquals([1, 2], [1, 2, 3])).to.equal(false);
    });

    it('compares bare Uint8Arrays byte-wise', () => {
      expect(dxnEquals(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).to.equal(true);
      expect(dxnEquals(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).to.equal(false);
    });

    it('compares Maps structurally, matching compound (non-reference-equal) keys', () => {
      const a = new Map([[[1, 2], 'x']]);
      const b = new Map([[[1, 2], 'x']]); // distinct array reference, same structure
      expect(dxnEquals(a, b)).to.equal(true);
      expect(a.has([1, 2])).to.equal(false); // native Map itself uses reference equality
    });

    it('compares Sets structurally', () => {
      const a = new Set([[1, 2]]);
      const b = new Set([[1, 2]]);
      expect(dxnEquals(a, b)).to.equal(true);
    });

    it('never equals across different kinds', () => {
      expect(dxnEquals(1n, 1)).to.equal(false); // integer (BigInt) vs float (number)
      expect(dxnEquals('a', new DXNChar(97))).to.equal(false);
    });
  });

  describe('dxnCompare', () => {
    it('ranks different kinds by the fixed KIND_RANK order', () => {
      expect(dxnCompare(null, true)).to.equal(-1);
      expect(KIND_RANK.nil).to.be.lessThan(KIND_RANK.boolean);
    });

    it('sorts NaN after every other float', () => {
      expect(dxnCompare(NaN, Infinity)).to.equal(1);
      expect(dxnCompare(1.0, NaN)).to.equal(-1);
      expect(dxnCompare(NaN, NaN)).to.equal(0);
    });

    it('compares arrays lexicographically, then by length', () => {
      expect(dxnCompare([1, 2], [1, 3])).to.equal(-1);
      expect(dxnCompare([1], [1, 2])).to.equal(-1);
      expect(dxnCompare([1, 2], [1, 2])).to.equal(0);
    });
  });

  describe('canonicalKey', () => {
    it('is equal for dxnEquals-equal values and stable across calls', () => {
      expect(canonicalKey([1, { x: 1 }])).to.equal(canonicalKey([1, { x: 1 }]));
    });

    it('differs for structurally different values', () => {
      expect(canonicalKey([1, 2])).to.not.equal(canonicalKey([2, 1]));
    });
  });
});
