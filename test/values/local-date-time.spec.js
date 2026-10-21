import { expect } from 'chai';
import DXNLocalDateTime from '../../src/values/local-date-time.js';

// A wall-clock date and time with no offset, so no instant (Jan,
// 2026-10-20): nanoseconds since 1970-01-01T00:00:00 on the wall clock.
describe('DXNLocalDateTime', () => {
  it('wraps localNanoseconds as BigInt', () => {
    expect(new DXNLocalDateTime(1n).localNanoseconds).to.equal(1n);
    expect(() => new DXNLocalDateTime(/** @type {any} */ (1))).to.throw(TypeError);
  });

  it('reads and writes a Date by its UTC fields, a documented convention', () => {
    const jsDate = new Date('2024-03-15T12:30:00.500Z');
    const local = DXNLocalDateTime.fromDate(jsDate);
    expect(local.localNanoseconds).to.equal(BigInt(jsDate.getTime()) * 1_000_000n);
    expect(local.toDate().getTime()).to.equal(jsDate.getTime());
  });

  it('equals/compare structurally', () => {
    expect(new DXNLocalDateTime(5n).equals(new DXNLocalDateTime(5n))).to.equal(true);
    expect(new DXNLocalDateTime(5n).compare(new DXNLocalDateTime(6n))).to.equal(-1);
  });
});
