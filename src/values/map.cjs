'use strict';

/**
 * @fileoverview A DXN map: a `Map` whose keys are compared by value.
 *
 * `DXN.md` §1.6: two keys are the same key exactly when their canonical
 * forms are. A JavaScript `Map` compares objects by identity, so two
 * equal `DXNChar`s, `DXNUUID`s or `DXNDate`s were two keys -- a repeated
 * key was not merged, and looking one up with an equal value found
 * nothing. This keys every object by its canonical form instead, and
 * keeps the first such object as the entry's key; primitives (strings,
 * bigints, keyword symbols) are their own identity already.
 *
 * **Still a `Map`**, so everything that takes one takes this.
 */

/**
 * @template V
 * @extends {Map<unknown, V>}
 */
class DXNMap extends Map {
  /** @param {Iterable<[unknown, V]>} [entries] */
  constructor(entries) {
    super();
    /**
     * Identity → the key this map holds for it. Not enumerable: it is how
     * the map tells keys apart, not part of the value, so printing a map
     * shows its entries alone.
     * @type {Map<unknown, unknown>}
     */
    this.byIdentity;
    Object.defineProperty(this, 'byIdentity', { value: new Map(), enumerable: false });
    if (entries) for (const [key, value] of entries) this.set(key, value);
  }

  /** @param {unknown} key @param {V} value @returns {this} */
  set(key, value) {
    const identity = identityOf(key);
    if (this.byIdentity.has(identity)) return super.set(this.byIdentity.get(identity), value);
    this.byIdentity.set(identity, key);
    return super.set(key, value);
  }

  /** @param {unknown} key @returns {V | undefined} */
  get(key) {
    return super.get(this.held(key));
  }

  /** @param {unknown} key @returns {boolean} */
  has(key) {
    return this.byIdentity.has(identityOf(key));
  }

  /** @param {unknown} key @returns {boolean} */
  delete(key) {
    const identity = identityOf(key);
    if (!this.byIdentity.has(identity)) return false;
    const held = this.byIdentity.get(identity);
    this.byIdentity.delete(identity);
    return super.delete(held);
  }

  clear() {
    this.byIdentity.clear();
    super.clear();
  }

  /**
   * The key this map holds for `key`'s identity, or `key` itself.
   * @param {unknown} key
   * @returns {unknown}
   */
  held(key) {
    const identity = identityOf(key);
    return this.byIdentity.has(identity) ? this.byIdentity.get(identity) : key;
  }
}

/**
 * What a key is compared by: a primitive by itself, an object by its
 * canonical form.
 * @param {unknown} key
 * @returns {unknown}
 */
function identityOf(key) {
  if (key === null || (typeof key !== 'object' && typeof key !== 'function')) return key;
  // Required here rather than at the top: the canonical printer reaches
  // the value classes, and this is one of them.
  const { canonical } = require('../canonical.cjs');
  return `\u0000${key.constructor.name}\u0000${canonical(key)}`;
}

module.exports = DXNMap;
