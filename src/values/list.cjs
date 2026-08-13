'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `list` (`[ ... ]`) — ordered, heterogeneous, arbitrary length.
 * Wraps a plain JS `Array` rather than *being* one, even though a JS
 * `Array` is the closer semantic fit (dynamic length, same as this
 * type) — native `Array` is reserved for DXN `array` instead (see
 * `DXNArray`'s own module doc for why), so `list` gets this thin
 * wrapper purely to stay distinct from it.
 */
class DXNList {
  /** @param {unknown[]} items */
  constructor(items) {
    if (!Array.isArray(items)) throw new TypeError('DXNList items must be an array');
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
   * @returns {DXNList}
   */
  static fromArray(arr) {
    return new DXNList(Array.from(arr));
  }
}

DXNList.prototype.dxnType = 'list';

module.exports = DXNList;
