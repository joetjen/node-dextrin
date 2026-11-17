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

  /**
   * The name and version a tuple `{:at Name N}` pins (`DXNS.md` §5c),
   * which text writes `Name(N)`; `null` for any other value. `:at` may be
   * a keyword or, decoded trusted, a global symbol; `N` is a positive
   * integer. Shared by every writer, so the printer, the formatter and
   * the canonical form agree.
   *
   * @example
   * DXNTuple.pinned(decode('Pet(2)')) // => {name: 'Pet', version: 2}
   * DXNTuple.pinned(new DXNTuple([1n, 2n])) // => null
   * @param {unknown} value
   * @returns {{name: string, version: number} | null}
   */
  static pinned(value) {
    if (!(value instanceof DXNTuple) || value.items.length !== 3) return null;
    const [at, name, version] = value.items;
    const isAt =
      (typeof at === 'symbol' && Symbol.keyFor(at) === 'at') ||
      (at !== null && typeof at === 'object' && /** @type {any} */ (at).dxnType === 'keyword' && /** @type {any} */ (at).name === 'at');
    const isName = name !== null && typeof name === 'object' && /** @type {any} */ (name).dxnType === 'symbol';
    if (!isAt || !isName || typeof version !== 'bigint' || version <= 0n || version > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { name: /** @type {any} */ (name).name, version: Number(version) };
  }

  /**
   * How `pinned`'s name and version are written: `Name(N)`.
   * @param {string} name
   * @param {number} version
   * @returns {string}
   */
  static pinnedText(name, version) {
    return `${name}(${version})`;
  }
}

DXNTuple.prototype.dxnType = 'tuple';

module.exports = DXNTuple;
