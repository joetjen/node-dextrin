import { expect } from 'chai';
import DXNDuration from '../../src/values/duration.js';

describe('DXNDuration', () => {
  it('defaults every field to null', () => {
    const d = new DXNDuration();
    expect(d).to.include({
      years: null,
      months: null,
      weeks: null,
      days: null,
      hours: null,
      minutes: null,
      microseconds: null
    });
  });

  it('accepts a subset of fields, independently tracked (not folded into one scalar)', () => {
    const d = new DXNDuration({ years: 1, days: 3 });
    expect(d.years).to.equal(1);
    expect(d.days).to.equal(3);
    expect(d.months).to.equal(null);
  });

  it('rejects a non-integer field', () => {
    expect(() => new DXNDuration({ hours: 1.5 })).to.throw(TypeError);
  });

  it('equals structurally', () => {
    expect(new DXNDuration({ hours: 1 }).equals(new DXNDuration({ hours: 1 }))).to.equal(true);
    expect(new DXNDuration({ hours: 1 }).equals(new DXNDuration({ hours: 2 }))).to.equal(false);
    expect(new DXNDuration({ hours: 1 }).equals(new DXNDuration({ hours: 1, minutes: 0 }))).to.equal(false);
  });
});
