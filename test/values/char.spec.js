import { expect } from 'chai';
import DXNChar from '../../src/values/char.js';

describe('DXNChar', () => {
  it('constructs from a codepoint', () => {
    const c = new DXNChar(97);
    expect(c.codepoint).to.equal(97);
  });

  it('rejects non-integer, negative, or out-of-range codepoints', () => {
    expect(() => new DXNChar(1.5)).to.throw(TypeError);
    expect(() => new DXNChar(-1)).to.throw(TypeError);
    expect(() => new DXNChar(0x110000)).to.throw(TypeError);
  });

  it('round-trips through toString/fromString', () => {
    const c = DXNChar.fromString('a');
    expect(c.codepoint).to.equal(97);
    expect(c.toString()).to.equal('a');
  });

  it('handles astral (surrogate-pair) codepoints as one char', () => {
    const c = DXNChar.fromString('😀');
    expect(c.codepoint).to.equal(0x1f600);
    expect(c.toString()).to.equal('😀');
  });

  it('rejects strings that are not exactly one codepoint', () => {
    expect(() => DXNChar.fromString('ab')).to.throw(TypeError);
    expect(() => DXNChar.fromString('')).to.throw(TypeError);
  });

  it('equals/compare structurally', () => {
    expect(new DXNChar(97).equals(new DXNChar(97))).to.equal(true);
    expect(new DXNChar(97).equals(new DXNChar(98))).to.equal(false);
    expect(new DXNChar(97).compare(new DXNChar(98))).to.equal(-1);
  });

  it('never equals a same-content plain string (char vs string stay distinct types)', () => {
    expect(new DXNChar(97).equals('a')).to.equal(false);
  });
});
