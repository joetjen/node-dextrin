'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `uri` (`@uri "..."`, RFC 3986). Wraps the raw string exactly as
 * given, not parsed into a `URL`/`URL`-like structure — the WHATWG
 * `URL` parser is lenient in ways RFC 3986 isn't, and doesn't always
 * reproduce the original text byte-for-byte on `.toString()` (e.g.
 * component re-escaping), which would risk breaking round-trip.
 * Parsing is left to the caller, who can always call `new URL(value)`
 * themselves — mirrors `Dextrin.Uri` exactly.
 */
class DXNURI {
  /** @param {string} value */
  constructor(value) {
    if (typeof value !== 'string') throw new TypeError('DXNURI value must be a string');
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

  /** @returns {string} */
  toString() {
    return this.value;
  }

  /**
   * @param {string} str
   * @returns {DXNURI}
   */
  static fromString(str) {
    return new DXNURI(str);
  }
}

DXNURI.prototype.dxnType = 'uri';

module.exports = DXNURI;
