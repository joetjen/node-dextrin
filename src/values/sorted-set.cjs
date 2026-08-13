'use strict';

const { dxnEquals, dxnCompare, canonicalKey } = require('./equality.cjs');

/**
 * DXN `sorted-set` (`@sorted-set` applied to a set literal). Wraps an array kept
 * sorted and deduplicated as a hard invariant at every construction
 * site — the constructor is the *only* way to build one, precisely so
 * that structural equality between two `DXNSortedSet`s is valid
 * set-equality rather than something that happens to work only when
 * both were built the same way, mirroring `Dextrin.SortedSet` exactly.
 *
 * Cross-type ordering (e.g. a set mixing numbers and strings) is
 * implementation-defined per `DXN.md` (no normative cross-type order
 * given) — this class uses `dxnCompare`'s own fixed rank order (see
 * `equality.cjs`), not a claim of matching Erlang term order.
 */
class DXNSortedSet {
  /** @param {unknown[]} items */
  constructor(items) {
    if (!Array.isArray(items)) throw new TypeError('DXNSortedSet items must be an array');
    /** @type {unknown[]} */
    const deduped = [];
    const seen = new Set();
    for (const item of items) {
      const key = canonicalKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }
    deduped.sort(dxnCompare);
    this.items = deduped;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /** @returns {unknown[]} a shallow copy of the sorted, deduped items. */
  toArray() {
    return this.items.slice();
  }

  /** @returns {Set<unknown>} */
  toSet() {
    return new Set(this.items);
  }

  /**
   * @param {Iterable<unknown>} arr
   * @returns {DXNSortedSet}
   */
  static fromArray(arr) {
    return new DXNSortedSet(Array.from(arr));
  }

  /**
   * @param {Set<unknown>} set
   * @returns {DXNSortedSet}
   */
  static fromSet(set) {
    if (!(set instanceof Set)) throw new TypeError('DXNSortedSet.fromSet expects a Set');
    return new DXNSortedSet(Array.from(set.values()));
  }
}

DXNSortedSet.prototype.dxnType = 'sorted-set';

module.exports = DXNSortedSet;
