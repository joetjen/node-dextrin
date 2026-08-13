import { expect } from 'chai';
import DXNTuple from '../../src/values/tuple.js';

describe('DXNTuple', () => {
  it('wraps an items array', () => {
    expect(new DXNTuple(['a', 'b']).items).to.deep.equal(['a', 'b']);
  });

  it('equals structurally, order-sensitive', () => {
    expect(new DXNTuple([1, 2]).equals(new DXNTuple([1, 2]))).to.equal(true);
    expect(new DXNTuple([1, 2]).equals(new DXNTuple([2, 1]))).to.equal(false);
  });

  it('round-trips through toArray/fromArray', () => {
    const tuple = DXNTuple.fromArray(['ok', 200]);
    expect(tuple.toArray()).to.deep.equal(['ok', 200]);
  });
});
