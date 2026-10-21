'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

const OBJECTID_STRING = /^[0-9a-f]{24}$/i;

/**
 * DXN `objectid` (`@objectid "..."`, Jan, 2026-10-20): BSON's 12-byte
 * ObjectId, built in like `uuid` -- readable in text, its raw bytes in
 * `.dxnb` (tag 221). The value holds the bytes; the 24 hex digits exist
 * only at the text boundary (`toString()`/`fromString()`), read in
 * either case and written lowercase, mirroring `Dextrin.ObjectId`.
 */
class DXNObjectId {
  /** @param {Uint8Array} bytes exactly 12 bytes. */
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 12) {
      throw new TypeError('DXNObjectId bytes must be a 12-byte Uint8Array');
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

  /** @returns {string} the 24 lowercase hex digits. */
  toString() {
    return Buffer.from(this.bytes).toString('hex');
  }

  /**
   * @param {string} str 24 hex digits, either case.
   * @returns {DXNObjectId}
   */
  static fromString(str) {
    if (typeof str !== 'string' || !OBJECTID_STRING.test(str)) {
      throw new TypeError(`DXNObjectId.fromString: invalid ObjectId string ${JSON.stringify(str)}`);
    }
    return new DXNObjectId(new Uint8Array(Buffer.from(str, 'hex')));
  }
}

DXNObjectId.prototype.dxnType = 'objectid';

module.exports = DXNObjectId;
