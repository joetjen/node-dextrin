import { expect } from 'chai';
import DXNBytes from '../../src/values/bytes.js';

describe('DXNBytes', () => {
  it('wraps a Uint8Array', () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(new DXNBytes(data).data).to.equal(data);
  });

  it('rejects a non-Uint8Array', () => {
    expect(() => new DXNBytes(/** @type {any} */ ([1, 2, 3]))).to.throw(TypeError);
  });

  it('equals structurally by byte content, not array reference', () => {
    const a = new DXNBytes(new Uint8Array([1, 2, 3]));
    const b = new DXNBytes(new Uint8Array([1, 2, 3]));
    const c = new DXNBytes(new Uint8Array([1, 2, 4]));
    expect(a.equals(b)).to.equal(true);
    expect(a.equals(c)).to.equal(false);
  });

  it('stays distinct from a same-content DXN string (the ambiguity this class exists to avoid)', () => {
    const a = new DXNBytes(new Uint8Array([104, 105])); // "hi"
    expect(a.equals('hi')).to.equal(false);
  });
});
