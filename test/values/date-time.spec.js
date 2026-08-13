import { expect } from 'chai';
import DXNDateTime from '../../src/values/date-time.js';

describe('DXNDateTime', () => {
  it('wraps epochMicroseconds and offsetMinutes', () => {
    const dt = new DXNDateTime(1_000_000n, -300);
    expect(dt.epochMicroseconds).to.equal(1_000_000n);
    expect(dt.offsetMinutes).to.equal(-300);
  });

  it('fromDate() requires an explicit offsetMinutes (a plain Date cannot supply one)', () => {
    const jsDate = new Date('2024-03-15T12:00:00Z');
    expect(() => DXNDateTime.fromDate(jsDate, /** @type {any} */ (undefined))).to.throw(TypeError);
    expect(() => DXNDateTime.fromDate(jsDate, 1.5)).to.throw(TypeError);
  });

  it('toDate()/fromDate() are lossless for the instant itself; offset is informational only', () => {
    const jsDate = new Date('2024-03-15T12:00:00.000Z');
    const dt = DXNDateTime.fromDate(jsDate, -300); // e.g. UTC-05:00
    expect(dt.toDate().getTime()).to.equal(jsDate.getTime());

    const sameInstantDifferentOffset = new DXNDateTime(dt.epochMicroseconds, 60);
    expect(sameInstantDifferentOffset.toDate().getTime()).to.equal(jsDate.getTime());
    // but the two remain distinct DXN values (offset is part of the struct)
    expect(dt.equals(sameInstantDifferentOffset)).to.equal(false);
  });

  it('equals/compare structurally', () => {
    expect(new DXNDateTime(5n, 0).equals(new DXNDateTime(5n, 0))).to.equal(true);
  });
});
