import { expect } from 'chai';
import DXNDecimal from '../../src/values/decimal.js';

describe('DXNDecimal', () => {
  it('parses a plain decimal string', () => {
    const d = DXNDecimal.fromString('19.99');
    expect(d.sign).to.equal(1);
    expect(d.unscaledValue).to.equal(1999n);
    expect(d.exponent).to.equal(-2);
  });

  it('parses a negative decimal string', () => {
    const d = DXNDecimal.fromString('-3.5');
    expect(d.sign).to.equal(-1);
    expect(d.unscaledValue).to.equal(35n);
  });

  it('parses an integer-only decimal string (exponent 0)', () => {
    const d = DXNDecimal.fromString('42');
    expect(d.unscaledValue).to.equal(42n);
    expect(d.exponent).to.equal(0);
  });

  it('rejects a malformed decimal string', () => {
    expect(() => DXNDecimal.fromString('1.2.3')).to.throw(TypeError);
    expect(() => DXNDecimal.fromString('abc')).to.throw(TypeError);
  });

  it('round-trips through toString', () => {
    expect(DXNDecimal.fromString('19.99').toString()).to.equal('19.99');
    expect(DXNDecimal.fromString('-3.50').toString()).to.equal('-3.50');
    expect(DXNDecimal.fromString('42').toString()).to.equal('42');
  });

  it('treats different scales of the same numeric value as distinct DXN values (never auto-reduced, like DXNRational)', () => {
    const a = DXNDecimal.fromString('1.10');
    const b = DXNDecimal.fromString('1.1');
    expect(a.equals(b)).to.equal(false);
    expect(a.unscaledValue).to.not.equal(b.unscaledValue);
  });

  it('toNumber()/fromNumber() are lossy bridges to native number, documented as such', () => {
    expect(DXNDecimal.fromString('19.99').toNumber()).to.be.closeTo(19.99, 1e-9);
    expect(DXNDecimal.fromNumber(19.99).toString()).to.equal('19.99');
    expect(DXNDecimal.fromNumber(-3).toString()).to.equal('-3');
  });

  it('fromNumber() handles values that stringify in exponential notation', () => {
    expect(DXNDecimal.fromNumber(5e-7).toString()).to.equal('0.0000005');
    expect(DXNDecimal.fromNumber(1.5e21).toString()).to.equal('1500000000000000000000');
  });
});
