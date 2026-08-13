import { expect } from 'chai';
import DXNDate from '../../src/values/date.js';

describe('DXNDate', () => {
  it('constructs a valid calendar date', () => {
    const d = new DXNDate(2024, 2, 29); // leap year
    expect(d).to.include({ year: 2024, month: 2, day: 29 });
  });

  it('rejects an invalid calendar date (e.g. Feb 30, non-leap Feb 29)', () => {
    expect(() => new DXNDate(2023, 2, 30)).to.throw(RangeError);
    expect(() => new DXNDate(2023, 2, 29)).to.throw(RangeError); // 2023 is not a leap year
  });

  it('rejects an out-of-range month', () => {
    expect(() => new DXNDate(2024, 13, 1)).to.throw(RangeError);
    expect(() => new DXNDate(2024, 0, 1)).to.throw(RangeError);
  });

  it('round-trips through toDate/fromDate at UTC midnight', () => {
    const d = new DXNDate(2024, 3, 15);
    const jsDate = d.toDate();
    expect(jsDate.getUTCFullYear()).to.equal(2024);
    expect(jsDate.getUTCMonth()).to.equal(2);
    expect(jsDate.getUTCDate()).to.equal(15);
    expect(jsDate.getUTCHours()).to.equal(0);
    expect(DXNDate.fromDate(jsDate).equals(d)).to.equal(true);
  });

  it('equals/compare structurally', () => {
    expect(new DXNDate(2024, 1, 1).equals(new DXNDate(2024, 1, 1))).to.equal(true);
    expect(new DXNDate(2024, 1, 1).compare(new DXNDate(2024, 1, 2))).to.equal(-1);
  });
});
