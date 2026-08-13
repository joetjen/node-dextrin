import { expect } from 'chai';
import DXNSortedSet from '../../src/values/sorted-set.js';
import DXNChar from '../../src/values/char.js';

describe('DXNSortedSet', () => {
  it('sorts items at construction', () => {
    expect(new DXNSortedSet([3, 1, 2]).items).to.deep.equal([1, 2, 3]);
  });

  it('deduplicates primitive items', () => {
    expect(new DXNSortedSet([1, 2, 2, 1, 3]).items).to.deep.equal([1, 2, 3]);
  });

  it('deduplicates structurally-equal compound items, even across distinct instances', () => {
    const set = new DXNSortedSet([new DXNChar(97), new DXNChar(98), new DXNChar(97)]);
    expect(set.items).to.have.lengthOf(2);
  });

  it('equals regardless of construction-time item order (it is always normalized)', () => {
    expect(new DXNSortedSet([3, 1, 2]).equals(new DXNSortedSet([1, 2, 3]))).to.equal(true);
    expect(new DXNSortedSet([1, 2, 2]).equals(new DXNSortedSet([1, 2]))).to.equal(true);
  });

  it('round-trips through toArray/fromArray and toSet/fromSet', () => {
    const set = new DXNSortedSet([3, 1, 2]);
    expect(set.toArray()).to.deep.equal([1, 2, 3]);
    expect(set.toSet()).to.deep.equal(new Set([1, 2, 3]));
    expect(DXNSortedSet.fromArray([2, 1, 3]).equals(set)).to.equal(true);
    expect(DXNSortedSet.fromSet(new Set([2, 1, 3])).equals(set)).to.equal(true);
  });
});
