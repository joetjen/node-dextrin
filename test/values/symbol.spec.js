import { expect } from 'chai';
import DXNSymbol from '../../src/values/symbol.js';

describe('DXNSymbol', () => {
  it('wraps a name string', () => {
    expect(new DXNSymbol('Foo').name).to.equal('Foo');
  });

  it('rejects a non-string name', () => {
    expect(() => new DXNSymbol(/** @type {any} */ (42))).to.throw(TypeError);
  });

  it('equals structurally by name', () => {
    expect(new DXNSymbol('Foo').equals(new DXNSymbol('Foo'))).to.equal(true);
    expect(new DXNSymbol('Foo').equals(new DXNSymbol('Bar'))).to.equal(false);
  });

  it('toSymbol() produces a non-global Symbol carrying the name as description', () => {
    const sym = new DXNSymbol('Foo').toSymbol();
    expect(typeof sym).to.equal('symbol');
    expect(sym.description).to.equal('Foo');
    expect(Symbol.keyFor(sym)).to.equal(undefined); // non-global, unlike DXNKeyword#toSymbol
  });

  it('fromSymbol() round-trips the description', () => {
    const back = DXNSymbol.fromSymbol(Symbol('Foo'));
    expect(back.equals(new DXNSymbol('Foo'))).to.equal(true);
  });
});
