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
  }
}

module.exports = { BinaryError };
