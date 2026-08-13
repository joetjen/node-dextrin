'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `bytes` (`@bytes "..."`, base64 in text, raw binary in `.dxnb`).
 * Wraps a `Uint8Array` — needed because `string` is *also* representable
 * as raw bytes in JS (`Buffer`/`TextEncoder` round-trips), so a bare
 * `Uint8Array` on its own can't tell "UTF-8 text" and "raw bytes that
 * happen to be valid UTF-8" apart on re-encode any better than a bare
 * Elixir `binary()` can — mirrors `Dextrin.Bytes` exactly. No
 * conversion helper needed beyond direct field access: `Uint8Array` is
 * already the native binary type this class wraps.
 */
class DXNBytes {
  /** @param {Uint8Array} data */
  constructor(data) {
    if (!(data instanceof Uint8Array)) throw new TypeError('DXNBytes data must be a Uint8Array');
    this.data = data;
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

DXNBytes.prototype.dxnType = 'bytes';

module.exports = DXNBytes;
