import { expect } from 'chai';
import DXNURI from '../../src/values/uri.js';

describe('DXNURI', () => {
  it('wraps the raw string exactly, unparsed', () => {
    const raw = 'https://example.com/a b?q=1'; // deliberately unescaped space
    expect(new DXNURI(raw).value).to.equal(raw);
  });

  it('round-trips through toString/fromString byte-for-byte', () => {
    const raw = 'mailto:foo@example.com';
    expect(DXNURI.fromString(raw).toString()).to.equal(raw);
  });

  it('equals structurally by value', () => {
    expect(new DXNURI('a').equals(new DXNURI('a'))).to.equal(true);
    expect(new DXNURI('a').equals(new DXNURI('b'))).to.equal(false);
  });
});
