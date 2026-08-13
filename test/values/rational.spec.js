import { expect } from 'chai';
import DXNRational from '../../src/values/rational.js';

describe('DXNRational', () => {
  it('wraps numerator/denominator as BigInt', () => {
    const r = new DXNRational(22n, 7n);
    expect(r.numerator).to.equal(22n);
    expect(r.denominator).to.equal(7n);
  });

  it('rejects a non-positive denominator', () => {
    expect(() => new DXNRational(1n, 0n)).to.throw(RangeError);
    expect(() => new DXNRational(1n, -1n)).to.throw(RangeError);
  });

  it('never auto-reduces: 22/7 and 44/14 are distinct DXN values', () => {
    const a = new DXNRational(22n, 7n);
    const b = new DXNRational(44n, 14n);
    expect(a.equals(b)).to.equal(false);
  });

  it('reduce() is explicit, never implicit', () => {
    const reduced = new DXNRational(44n, 14n).reduce();
    expect(reduced.numerator).to.equal(22n);
    expect(reduced.denominator).to.equal(7n);
  });

  it('toNumber() divides numerator by denominator', () => {
    expect(new DXNRational(1n, 2n).toNumber()).to.equal(0.5);
  });

  it('fromNumber() is exact: reconstructing via toNumber() recovers the original double bit-for-bit', () => {
    for (const n of [0.5, 0.1, 1 / 3, 123.456, -7.25, 0, 2 ** 60]) {
      const r = DXNRational.fromNumber(n);
      expect(r.toNumber()).to.equal(n);
    }
  });

  it('fromNumber() denominator is always a power of two (binary fraction, not decimal)', () => {
    const r = DXNRational.fromNumber(0.1);
    // denominator is a power of 2 iff repeatedly halving reaches 1
    let d = r.denominator;
    while (d > 1n) {
      expect(d % 2n).to.equal(0n);
      d /= 2n;
    }
  });

  it('fromNumber() rejects non-finite numbers', () => {
    expect(() => DXNRational.fromNumber(NaN)).to.throw(TypeError);
    expect(() => DXNRational.fromNumber(Infinity)).to.throw(TypeError);
  });
});
