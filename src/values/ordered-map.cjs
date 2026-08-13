'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `ordered-map` (`@ordered %{ ... }`) — order is part of the
 * value's identity, unlike plain `map` (native JS `Map`, which
 * preserves insertion order too but where that order isn't part of
 * DXN's own `map` equality — see `equality.cjs`'s `map` handling).
 * Wraps an ordered array of `[key, value]` pairs, mirroring
 * `Dextrin.OrderedMap` exactly.
 */
class DXNOrderedMap {
  /** @param {Array<[unknown, unknown]>} pairs */
  constructor(pairs) {
    if (!Array.isArray(pairs)) throw new TypeError('DXNOrderedMap pairs must be an array');
    this.pairs = pairs;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /**
   * @param {unknown} key compared structurally (`dxnEquals`), not by
   * JS reference.
   * @returns {boolean}
   */
  has(key) {
    return this.pairs.some(([k]) => dxnEquals(k, key));
  }

  /**
   * @param {unknown} key compared structurally (`dxnEquals`), not by
   * JS reference.
   * @returns {unknown} the associated value, or `undefined` if absent.
   */
  get(key) {
    const pair = this.pairs.find(([k]) => dxnEquals(k, key));
    return pair ? pair[1] : undefined;
  }

  /**
   * @returns {Map<unknown, unknown>} a close native-JS fit — `Map`
   * preserves insertion order too, so this conversion is lossless
   * (modulo the structural-key-equality caveat `map` itself already
   * has, see `equality.cjs`).
   */
  toMap() {
    return new Map(this.pairs);
  }

  /**
   * @param {Map<unknown, unknown>} map
   * @returns {DXNOrderedMap}
   */
  static fromMap(map) {
    if (!(map instanceof Map)) throw new TypeError('DXNOrderedMap.fromMap expects a Map');
    return new DXNOrderedMap(Array.from(map.entries()));
  }
}

DXNOrderedMap.prototype.dxnType = 'ordered-map';

module.exports = DXNOrderedMap;
