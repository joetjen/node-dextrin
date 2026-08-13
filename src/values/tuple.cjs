'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `tuple` (`{ ... }`) — ordered, heterogeneous, arbitrary length,
 * wire-distinct from `list`. Wraps a plain `Array`, the same as
 * `DXNList` — `DXNArray` is the one collection type that claims native
 * `Array` directly, since JS has no fixed-arity type for it to compete
 * with the way Elixir's own tuple does.
 */
class DXNTuple {
  /** @param {unknown[]} items */
  constructor(items) {
    if (!Array.isArray(items)) throw new TypeError('DXNTuple items must be an array');
    this.items = items;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /** @returns {unknown[]} a shallow copy of `items`. */
  toArray() {
    return this.items.slice();
  }

  /**
   * @param {Iterable<unknown>} arr
   * @returns {DXNTuple}
   */
  static fromArray(arr) {
    return new DXNTuple(Array.from(arr));
  }
}

DXNTuple.prototype.dxnType = 'tuple';

module.exports = DXNTuple;
