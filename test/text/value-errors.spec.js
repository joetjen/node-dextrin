import { expect } from 'chai';
import { decode, DXNError, Registry, Schema } from '../../src/dextrin.js';

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

describe('a map key that is not allowed', () => {
  // As the reference places it: at the key, line 2, column 2.
  it('is placed at the key', () => {
    expect(refusal('%{a: 1\n 1.5 => 2}')).to.deep.equal({ category: 'key/not-allowed', offset: 8 });
  });

  it('in an ordered map too', () => {
    expect(refusal('@ordered %{a: 1, [1] => 2}')).to.deep.equal({ category: 'key/not-allowed', offset: 17 });
  });

  it("and a struct's extra field", () => {
    expect(refusal('%P{a: 1, 1.5 => 2}')).to.deep.equal({ category: 'key/not-allowed', offset: 9 });
  });

  // Written as DXN, as the reference writes it: it said `[object Object]`.
  it('is named as written', () => {
    try {
      decode('%{[1] => 2}');
    } catch (err) {
      expect(err.message).to.match(/^\[1\] cannot be a map key/);
      return;
    }
    throw new Error('expected a refusal');
  });
});

describe('a schema violation found while decoding', () => {
  // As the reference places it: at the struct, line 2, column 2.
  it('is placed at its struct', () => {
    const registry = Schema.compile(decode('%{U: %schema{a: :string}}'), new Registry());
    try {
      decode('[1\n %U{a: 2}]', { registry });
    } catch (err) {
      expect(err).to.be.instanceOf(DXNError);
      expect({ category: err.category, offset: err.offset }).to.deep.equal({ category: 'schema/type-mismatch', offset: 4 });
      return;
    }
    throw new Error('expected a refusal');
  });
});
