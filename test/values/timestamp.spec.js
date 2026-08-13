import { expect } from 'chai';
import DXNTimestamp from '../../src/values/timestamp.js';

describe('DXNTimestamp', () => {
  it('wraps epochMicroseconds as BigInt', () => {
    expect(new DXNTimestamp(1_000_000n).epochMicroseconds).to.equal(1_000_000n);
  });

  it('round-trips through toDate/fromDate at millisecond precision', () => {
    const jsDate = new Date('2024-03-15T12:30:00.500Z');
    const ts = DXNTimestamp.fromDate(jsDate);
    expect(ts.epochMicroseconds).to.equal(BigInt(jsDate.getTime()) * 1000n);
    expect(ts.toDate().getTime()).to.equal(jsDate.getTime());
  });

  it('floors toward negative infinity for pre-1970 instants with a sub-millisecond remainder', () => {
    // -1500 microseconds = -1.5ms; flooring (not truncating toward zero)
    // must land on -2ms, not -1ms.
    const ts = new DXNTimestamp(-1500n);
    expect(ts.toDate().getTime()).to.equal(-2);
  });

  it('equals/compare structurally', () => {
    expect(new DXNTimestamp(5n).equals(new DXNTimestamp(5n))).to.equal(true);
    expect(new DXNTimestamp(5n).compare(new DXNTimestamp(6n))).to.equal(-1);
  });
});
