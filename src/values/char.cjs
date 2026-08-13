'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

const MAX_CODEPOINT = 0x10ffff;

/**
 * DXN `char` (`?c`) — a single Unicode codepoint. Kept distinct from a
 * 1-codepoint `string` so `char` and `string` (`?a` vs `"a"`, two
 * distinct DXN types) never collapse to the same JS value and silently
 * fail to round-trip.
 */
class DXNChar {
  /** @param {number} codepoint */
  constructor(codepoint) {
    if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > MAX_CODEPOINT) {
      throw new TypeError(`DXNChar codepoint must be an integer in [0, 0x10FFFF], got ${codepoint}`);
    }
    this.codepoint = codepoint;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /** @returns {string} the single-codepoint string form. */
  toString() {
    return String.fromCodePoint(this.codepoint);
  }

  /**
   * @param {string} str a string holding exactly one Unicode codepoint.
   * @returns {DXNChar}
   */
  static fromString(str) {
    if (typeof str !== 'string') throw new TypeError('DXNChar.fromString expects a string');
    const codepoints = Array.from(str);
    if (codepoints.length !== 1) {
      throw new TypeError(`DXNChar.fromString expects exactly one codepoint, got ${codepoints.length}`);
    }
    // codepoints.length === 1 was just checked, so codePointAt(0) always hits.
    return new DXNChar(/** @type {number} */ (/** @type {string} */ (codepoints[0]).codePointAt(0)));
  }
}

DXNChar.prototype.dxnType = 'char';

module.exports = DXNChar;
