import { expect } from 'chai';
import DXNDateTime from '../../src/values/date-time.js';

// One datetime type, an instant with its offset; `Z` is offset 0 (Jan,
// 2026-10-20). DXN 0.2's DXNTimestamp is a DXNDateTime at offset 0.
describe('DXNDateTime', () => {
  it('wraps epochNanoseconds and offsetMinutes', () => {
    const dt = new DXNDateTime(1_000_000_000n, -300);
    expect(dt.epochNanoseconds).to.equal(1_000_000_000n);
    expect(dt.offsetMinutes).to.equal(-300);
  });

  it('is UTC when no offset is given', () => {
    expect(new DXNDateTime(5n).offsetMinutes).to.equal(0);
  });

  it('refuses an offset of a day or more, or a fractional one', () => {
    expect(() => new DXNDateTime(0n, 1440)).to.throw(RangeError);
    expect(() => new DXNDateTime(0n, -1440)).to.throw(RangeError);
    expect(() => new DXNDateTime(0n, 1.5)).to.throw(TypeError);
  });

  it('round-trips through toDate/fromDate at millisecond precision, in UTC by default', () => {
    const jsDate = new Date('2024-03-15T12:30:00.500Z');
    const dt = DXNDateTime.fromDate(jsDate);
    expect(dt.epochNanoseconds).to.equal(BigInt(jsDate.getTime()) * 1_000_000n);
    expect(dt.offsetMinutes).to.equal(0);
    expect(dt.toDate().getTime()).to.equal(jsDate.getTime());
  });

  it('floors toward negative infinity for pre-1970 instants with a sub-millisecond remainder', () => {
    // -1,500,000 ns = -1.5ms; flooring (not truncating toward zero)
    // must land on -2ms, not -1ms.
    expect(new DXNDateTime(-1_500_000n).toDate().getTime()).to.equal(-2);
  });

  it('toDate()/fromDate() keep the instant; the offset is part of the value, not of the instant', () => {
    const jsDate = new Date('2024-03-15T12:00:00.000Z');
    const dt = DXNDateTime.fromDate(jsDate, -300); // e.g. UTC-05:00
    expect(dt.toDate().getTime()).to.equal(jsDate.getTime());

    const sameInstantDifferentOffset = new DXNDateTime(dt.epochNanoseconds, 60);
    expect(sameInstantDifferentOffset.toDate().getTime()).to.equal(jsDate.getTime());
    // but the two remain distinct DXN values (offset is part of the struct)
    expect(dt.equals(sameInstantDifferentOffset)).to.equal(false);
  });

  it('equals/compare structurally', () => {
    expect(new DXNDateTime(5n, 0).equals(new DXNDateTime(5n, 0))).to.equal(true);
    expect(new DXNDateTime(5n).compare(new DXNDateTime(6n))).to.equal(-1);
  });
});
