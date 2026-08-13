import { expect } from 'chai';
import DXNList from '../../src/values/list.js';

describe('DXNList', () => {
  it('wraps an items array', () => {
    expect(new DXNList([1, 2, 3]).items).to.deep.equal([1, 2, 3]);
  });

  it('equals structurally, order-sensitive', () => {
    expect(new DXNList([1, 2]).equals(new DXNList([1, 2]))).to.equal(true);
    expect(new DXNList([1, 2]).equals(new DXNList([2, 1]))).to.equal(false);
  });

  it('round-trips through toArray/fromArray', () => {
    const list = DXNList.fromArray([1, 2, 3]);
    expect(list.toArray()).to.deep.equal([1, 2, 3]);
  });

  it('toArray() returns a copy, not the live backing array', () => {
    const list = new DXNList([1, 2]);
    const copy = list.toArray();
    copy.push(3);
    expect(list.items).to.deep.equal([1, 2]);
  });

  it('stays distinct from DXNTuple even with identical items (different dxnType)', async () => {
    const { default: DXNTuple } = await import('../../src/values/tuple.js');
    expect(new DXNList([1, 2]).equals(new DXNTuple([1, 2]))).to.equal(false);
  });
});
