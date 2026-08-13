import { expect } from 'chai';
import fc from 'fast-check';
import { dxnValue } from '../support/dxn-value.arbitrary.js';
import { dxnEquals, dxnCompare } from '../../src/values/equality.js';
import DXNList from '../../src/values/list.js';
import DXNTuple from '../../src/values/tuple.js';

describe('DXNValue property invariants', () => {
  it('dxnEquals is reflexive over arbitrary DXN value trees', () => {
    fc.assert(fc.property(dxnValue(3), (v) => dxnEquals(v, v) === true));
  });

  it('dxnCompare is reflexive (compare(v, v) === 0) over arbitrary DXN value trees', () => {
    fc.assert(fc.property(dxnValue(3), (v) => dxnCompare(v, v) === 0));
  });

  it('dxnCompare is antisymmetric: compare(a, b) === -compare(b, a)', () => {
    fc.assert(
      fc.property(dxnValue(2), dxnValue(2), (a, b) => {
        expect(dxnCompare(a, b)).to.equal(-dxnCompare(b, a));
      })
    );
  });

  it('DXNList.fromArray(arr).toArray() round-trips any array of DXN values', () => {
    fc.assert(
      fc.property(fc.array(dxnValue(1)), (arr) => {
        const roundTripped = DXNList.fromArray(arr).toArray();
        expect(roundTripped.every((v, i) => dxnEquals(v, arr[i]))).to.equal(true);
      })
    );
  });

  it('DXNTuple.fromArray(arr).toArray() round-trips any array of DXN values', () => {
    fc.assert(
      fc.property(fc.array(dxnValue(1)), (arr) => {
        const roundTripped = DXNTuple.fromArray(arr).toArray();
        expect(roundTripped.every((v, i) => dxnEquals(v, arr[i]))).to.equal(true);
      })
    );
  });
});
