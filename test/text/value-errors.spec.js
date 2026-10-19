import { expect } from 'chai';
import { decode, DXNError } from '../../src/dextrin.js';

// A value that is written well but is not a value -- an impossible date,
// a uuid that is not one, an unknown escape -- is text that does not
// parse: `syntax` (DXN.md §5), placed at the value it is about, as the
// reference implementation answers. These came back with no category
// and no offset.
const refusal = (text) => {
  try {
    decode(text);
  } catch (err) {
    expect(err).to.be.instanceOf(DXNError);
    return { category: err.category, offset: err.offset };
  }
  throw new Error(`expected ${text} to be refused`);
};

describe('a value that is not one', () => {
  it('a uuid that is not one is a syntax error at its tag', () => {
    expect(refusal('[1 @uuid "nope"]')).to.deep.equal({ category: 'syntax', offset: 3 });
  });

  it('an impossible date is a syntax error at its sigil', () => {
    expect(refusal('[~D[2020-13-45]]')).to.deep.equal({ category: 'syntax', offset: 1 });
  });

  it('an impossible time is a syntax error at its sigil', () => {
    expect(refusal('%{a: ~T[25:00:00]}')).to.deep.equal({ category: 'syntax', offset: 5 });
  });

  it('a datetime that is not one is a syntax error at its tag', () => {
    expect(refusal('@datetime "x"')).to.deep.equal({ category: 'syntax', offset: 0 });
  });

  it('an unknown escape is a syntax error at its string', () => {
    expect(refusal('[1 "\\q"]')).to.deep.equal({ category: 'syntax', offset: 3 });
  });

  it('a zero denominator is a syntax error at its rational, not at the start', () => {
    expect(refusal('%{a: 1/0}')).to.deep.equal({ category: 'syntax', offset: 5 });
  });

  // An error that has a category of its own keeps it.
  it('a map key that is not allowed stays key/not-allowed', () => {
    expect(refusal('%{1.5 => 1}').category).to.equal('key/not-allowed');
  });
});
