import { expect } from 'chai';
import DXNOrderedMap from '../../src/values/ordered-map.js';
import DXNList from '../../src/values/list.js';

describe('DXNOrderedMap', () => {
  it('wraps an ordered pairs array', () => {
    const om = new DXNOrderedMap([
      ['a', 1],
      ['b', 2]
    ]);
    expect(om.pairs).to.deep.equal([
      ['a', 1],
      ['b', 2]
    ]);
  });

  it('get/has compare keys structurally, not by reference', () => {
    const om = new DXNOrderedMap([[new DXNList([1, 2]), 'found']]);
    expect(om.has(new DXNList([1, 2]))).to.equal(true);
    expect(om.get(new DXNList([1, 2]))).to.equal('found');
    expect(om.get(new DXNList([9, 9]))).to.equal(undefined);
  });

  it('equals is order-sensitive (order is part of identity, unlike map)', () => {
    const a = new DXNOrderedMap([
      ['a', 1],
      ['b', 2]
    ]);
    const b = new DXNOrderedMap([
      ['b', 2],
      ['a', 1]
    ]);
    expect(a.equals(b)).to.equal(false);
  });

  it('round-trips through toMap/fromMap, preserving order', () => {
    const om = new DXNOrderedMap([
      ['a', 1],
      ['b', 2]
    ]);
    const map = om.toMap();
    expect(Array.from(map.entries())).to.deep.equal([
      ['a', 1],
      ['b', 2]
    ]);
    expect(DXNOrderedMap.fromMap(map).equals(om)).to.equal(true);
  });
});
