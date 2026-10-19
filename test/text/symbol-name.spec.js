import { expect } from 'chai';
import { encode, decodeBinary, encodeBinary, canonical, DXNError } from '../../src/dextrin.js';
import DXNSymbol from '../../src/values/symbol.js';

// A symbol is an identifier (DXN.md §1.1), so text can only write one
// whose name is an identifier. Any other name has no text form, and
// writing it verbatim answered text that read back as something else, or
// as nothing; it is refused, as encode/unsupported. Binary keeps any name.
describe('a symbol name', () => {
  it('that is an identifier is written as it is', () => {
    expect(encode(new DXNSymbol('ok'))).to.equal('ok');
    expect(encode(new DXNSymbol('my-app/money'))).to.equal('my-app/money');
  });

  it('that is not has no text form, and is refused', () => {
    for (const name of ['', '{', 'a b', '1x', 'nil', 'x:']) {
      expect(() => encode(new DXNSymbol(name)), name).to.throw(DXNError).with.property('category', 'encode/unsupported');
      expect(() => encode(new DXNSymbol(name), { pretty: true }), name).to.throw(DXNError).with.property('category', 'encode/unsupported');
      expect(() => canonical(new DXNSymbol(name)), name).to.throw().with.property('category', 'encode/unsupported');
    }
  });

  it('binary keeps any name', () => {
    expect(decodeBinary(encodeBinary(new DXNSymbol('a b')))).to.deep.equal(new DXNSymbol('a b'));
  });
});
