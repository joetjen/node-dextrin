'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * Opaque DXN custom tag (`@tag value`), produced when no decoder is
 * registered for its name — the open extension point `DXN.md` §1.2
 * reserves for any tag name that isn't one of the built-ins (`@uuid`,
 * `@duration`, ...). Prefer a schema-backed `struct` over a custom tag
 * for anything with real field structure; reserve custom tags for
 * simple scalar-wrapping. Mirrors `Dextrin.CustomTag` exactly. No
 * conversion helper: an open extension point has no fixed native
 * shape to convert to/from.
 */
class DXNCustomTag {
  /**
   * @param {string} name
   * @param {unknown} value
   */
  constructor(name, value) {
    if (typeof name !== 'string') throw new TypeError('DXNCustomTag name must be a string');
    this.name = name;
    this.value = value;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }
}

DXNCustomTag.prototype.dxnType = 'custom-tag';

module.exports = DXNCustomTag;
