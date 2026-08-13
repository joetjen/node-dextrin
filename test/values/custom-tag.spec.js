import { expect } from 'chai';
import DXNCustomTag from '../../src/values/custom-tag.js';

describe('DXNCustomTag', () => {
  it('wraps a name and an arbitrary value', () => {
    const tag = new DXNCustomTag('my-app/money', 100);
    expect(tag.name).to.equal('my-app/money');
    expect(tag.value).to.equal(100);
  });

  it('equals structurally by name and value', () => {
    expect(new DXNCustomTag('t', 1).equals(new DXNCustomTag('t', 1))).to.equal(true);
    expect(new DXNCustomTag('t', 1).equals(new DXNCustomTag('t', 2))).to.equal(false);
    expect(new DXNCustomTag('t', 1).equals(new DXNCustomTag('other', 1))).to.equal(false);
  });
});
