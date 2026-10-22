import { expect } from 'chai';
import { decode, decodeBinary, encode, encodeBinary, Registry, Schema } from '../../src/dextrin.js';
import DXNDuration from '../../src/values/duration.js';

// A duration's zero fields are left out when it is written, in text and
// in `.dxnb`, and one that is zero throughout is `PT0S` (DXN.md §1.5), as
// dextrin 80c4e88. Reading keeps what was written: only the writer drops
// a zero field.
describe('a duration written', () => {
  /** @param {string} text */
  const rewritten = (text) => encode(decode(text));

  it('leaves a zero field out', () => {
    expect(rewritten('@duration "P1DT0H"')).to.equal('@duration "P1D"');
    expect(rewritten('@duration "P0Y2M0DT3H0M0S"')).to.equal('@duration "P2MT3H"');
    expect(rewritten('@duration "PT0H30M"')).to.equal('@duration "PT30M"');
  });

  it('is PT0S when it is zero throughout', () => {
    for (const text of ['P0D', 'P0Y0M', 'PT0H', 'PT0M0S', 'PT0.000S']) {
      expect(rewritten(`@duration "${text}"`), text).to.equal('@duration "PT0S"');
    }
  });

  it('keeps a negative field', () => {
    expect(rewritten('@duration "P-1DT0H"')).to.equal('@duration "P-1D"');
    expect(rewritten('@duration "PT-0.5S"')).to.equal('@duration "PT-0.5S"');
  });

  it('keeps a zero field when read', () => {
    const d = decode('@duration "P0D"');
    expect(d.days).to.equal(0);
    expect(d.hours).to.equal(null);
  });

  it('in .dxnb holds only the fields that are not zero', () => {
    const withZero = encodeBinary(decode('@duration "P1DT0H"'));
    expect(withZero).to.deep.equal(encodeBinary(decode('@duration "P1D"')));
    const back = decodeBinary(withZero);
    expect(back.days).to.equal(1);
    expect(back.hours).to.equal(null);
  });

  it('in .dxnb has no field when it is zero throughout, and reads back as PT0S', () => {
    const back = decodeBinary(encodeBinary(decode('@duration "P0D"')));
    expect(back).to.deep.equal(new DXNDuration());
    expect(encode(back)).to.equal('@duration "PT0S"');
  });

  it('is one value to a uniqueness check, as P0D and as PT0S', () => {
    const registry = Schema.compile(decode('%{T: {:refine {:list-of :duration} %{unique: true}}}'), new Registry());
    expect(() => Schema.check(decode('[@duration "P0D" @duration "PT0S"]'), registry, 'T')).to.throw();
  });
});
