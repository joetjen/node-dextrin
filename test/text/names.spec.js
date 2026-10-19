import { expect } from 'chai';
import { decode, encode, DXNError, DXNStruct, DXNSymbol } from '../../src/dextrin.js';

// Names (DXN.md §1.1): segments joined by `.`, with at most one `/`
// between a namespace and a name -- wherever a name stands: a struct, a
// symbol, a keyword, a map key. As the reference reads them (dextrin
// 0d1c7f5).
describe('names', () => {
  it("a struct's name may be dotted and namespaced", () => {
    expect(decode('%Foo.Bar/Baz{a: 1}').name).to.equal('Foo.Bar/Baz');
    const versioned = decode('%Foo.Bar.Baz(2){a: 1}');
    expect([versioned.name, versioned.version]).to.deep.equal(['Foo.Bar.Baz', 2]);
  });

  it('and so may a symbol, a keyword and a map key', () => {
    expect(decode('a.b.c')).to.deep.equal(new DXNSymbol('a.b.c'));
    expect(decode(':acme.billing/invoice')).to.equal(Symbol.for('acme.billing/invoice'));
    expect(decode('%{a.b: 1}').get(Symbol.for('a.b'))).to.equal(1n);
  });

  it('each is written back as it was', () => {
    for (const text of ['%Foo.Bar/Baz{a: 1}', 'a.b.c', ':acme.billing/invoice', '%{a.b: 1}']) {
      const value = decode(text);
      expect(encode(decode(encode(value)))).to.equal(encode(value), text);
    }
    expect(encode(new DXNSymbol('Foo.Bar/Baz'))).to.equal('Foo.Bar/Baz');
  });

  it('a name has at most one slash, and no empty segment', () => {
    for (const text of ['Foo/Bar/Baz', 'Foo.', '.Foo', 'Foo..Bar', 'Foo./Bar', 'Foo/.Bar']) {
      try {
        decode(text);
      } catch (err) {
        expect(err).to.be.instanceOf(DXNError);
        expect(err.category, text).to.equal('syntax');
        continue;
      }
      throw new Error(`expected ${text} to be refused`);
    }
  });
});
void DXNStruct;
