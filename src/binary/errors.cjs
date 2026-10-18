'use strict';

/** @fileoverview Error type for malformed `.dxnb` input, the binary-side analog of `text/parser.cjs`'s `ParseError`. */
class BinaryError extends Error {
  /**
   * @param {string} message
   * @param {number} [offset]
   */
  constructor(message, offset) {
    super(message);
    this.name = 'BinaryError';
    this.offset = offset;
    /** `DXN.md` §5's category for a malformed `.dxnb` document. */
    this.category = 'binary';
  }
}

/**
 * The error for a value with no DXN meaning — a function, a symbol
 * nothing registered — thrown by the printer and the binary encoder
 * alike, with `DXN.md` §5's `encode/unsupported` category.
 * @param {string} described
 * @returns {TypeError}
 */
function unsupported(described) {
  const err = new TypeError(`cannot encode value with no DXN representation: ${described}`);
  /** @type {any} */ (err).category = 'encode/unsupported';
  return err;
}

module.exports = { BinaryError, unsupported };
