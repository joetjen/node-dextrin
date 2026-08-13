import { expect } from 'chai';
import DXNTime from '../../src/values/time.js';

describe('DXNTime', () => {
  it('constructs a valid time-of-day', () => {
    const t = new DXNTime(23, 59, 59, 999999);
    expect(t).to.include({ hour: 23, minute: 59, second: 59, microsecond: 999999 });
  });

  it('rejects out-of-range fields', () => {
    expect(() => new DXNTime(24, 0, 0, 0)).to.throw(RangeError);
    expect(() => new DXNTime(0, 60, 0, 0)).to.throw(RangeError);
    expect(() => new DXNTime(0, 0, 60, 0)).to.throw(RangeError);
    expect(() => new DXNTime(0, 0, 0, 1000000)).to.throw(RangeError);
  });

  it('equals/compare structurally', () => {
    expect(new DXNTime(10, 0, 0, 0).equals(new DXNTime(10, 0, 0, 0))).to.equal(true);
    expect(new DXNTime(10, 0, 0, 0).compare(new DXNTime(11, 0, 0, 0))).to.equal(-1);
  });
});
