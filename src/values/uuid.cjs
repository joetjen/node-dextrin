'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

const UUID_STRING = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DXN `uuid` (`@uuid "..."`, RFC 4122). Wraps 16 raw bytes, not the
 * 36-char text form — the text form exists only at the codec boundary
 * (`toString()`/`fromString()` below convert between them); the
 * in-memory value stays the compact, comparison-cheap byte form,
 * mirroring `Dextrin.Uuid` exactly.
 */
class DXNUUID {
  /** @param {Uint8Array} bytes exactly 16 bytes. */
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
      throw new TypeError('DXNUUID bytes must be a 16-byte Uint8Array');
    }
    this.bytes = bytes;
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /** @returns {string} the canonical 36-char hyphenated hex form. */
  toString() {
    const hex = Buffer.from(this.bytes).toString('hex');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
  }

  /**
   * @param {string} str the canonical 36-char hyphenated hex form.
   * @returns {DXNUUID}
   */
  static fromString(str) {
    if (typeof str !== 'string' || !UUID_STRING.test(str)) {
      throw new TypeError(`DXNUUID.fromString: invalid UUID string ${JSON.stringify(str)}`);
    }
    const hex = str.replace(/-/g, '');
    return new DXNUUID(new Uint8Array(Buffer.from(hex, 'hex')));
  }
}

DXNUUID.prototype.dxnType = 'uuid';

module.exports = DXNUUID;
