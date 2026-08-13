import { expect } from 'chai';
import DXNUUID from '../../src/values/uuid.js';

const CANONICAL = '550e8400-e29b-41d4-a716-446655440000';

describe('DXNUUID', () => {
  it('requires exactly 16 bytes', () => {
    expect(() => new DXNUUID(new Uint8Array(15))).to.throw(TypeError);
    expect(() => new DXNUUID(new Uint8Array(16))).to.not.throw();
  });

  it('round-trips through toString/fromString', () => {
    const uuid = DXNUUID.fromString(CANONICAL);
    expect(uuid.bytes).to.have.lengthOf(16);
    expect(uuid.toString()).to.equal(CANONICAL);
  });

  it('is case-insensitive on parse but lowercases on format', () => {
    const uuid = DXNUUID.fromString(CANONICAL.toUpperCase());
    expect(uuid.toString()).to.equal(CANONICAL);
  });

  it('rejects a malformed UUID string', () => {
    expect(() => DXNUUID.fromString('not-a-uuid')).to.throw(TypeError);
  });

  it('equals structurally by bytes', () => {
    expect(DXNUUID.fromString(CANONICAL).equals(DXNUUID.fromString(CANONICAL))).to.equal(true);
  });
});
