import { expect } from 'chai';
import DXNKeyword from '../../src/values/keyword.js';

describe('DXNKeyword', () => {
  it('wraps a name string', () => {
    expect(new DXNKeyword('ok').name).to.equal('ok');
  });

  it('equals structurally by name', () => {
    expect(new DXNKeyword('ok').equals(new DXNKeyword('ok'))).to.equal(true);
    expect(new DXNKeyword('ok').equals(new DXNKeyword('error'))).to.equal(false);
  });

  it('toSymbol() interns via the global Symbol.for registry', () => {
    const sym = new DXNKeyword('ok').toSymbol();
    expect(Symbol.keyFor(sym)).to.equal('ok');
    expect(sym).to.equal(Symbol.for('ok')); // interning: same call, same symbol
  });

  it('fromSymbol() round-trips a global symbol via its registry key', () => {
    const back = DXNKeyword.fromSymbol(Symbol.for('ok'));
    expect(back.equals(new DXNKeyword('ok'))).to.equal(true);
  });

  it('fromSymbol() falls back to description for a non-global symbol', () => {
    const back = DXNKeyword.fromSymbol(Symbol('ok'));
    expect(back.equals(new DXNKeyword('ok'))).to.equal(true);
  });
});
