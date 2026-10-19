'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');
const DXNBytes = require('./bytes.cjs');

/**
 * DXN `bits` (DXN.md §1.4): a run of bits that is not whole bytes --
 * `@bits {"oA==" 3}` in text, `T_BITS` around `[bytes, count]` in
 * `.dxnb`. JavaScript has no bitstring, so this holds the bytes, the
 * unused low bits of the last one zero, and how many bits are the value.
 *
 * **Bits and bytes are one value space**: a run of whole bytes is bytes,
 * so `DXNBits.from` answers a `DXNBytes` for one, and the constructor
 * refuses it. Mirrors the Elixir reference's bitstring in a
 * `Dextrin.Bytes`.
 */
class DXNBits {
  /**
   * @param {Uint8Array} data the bits, from the high bit of the first byte
   * @param {number} bitLength how many of them are the value; not a multiple of 8
   */
  constructor(data, bitLength) {
    const made = DXNBits.parts(data, bitLength);
    if (!made || bitLength % 8 === 0) {
      throw new TypeError('DXNBits holds a run of bits that is not whole bytes: data of exactly ceil(bitLength / 8) bytes');
    }
    this.data = made;
    this.bitLength = bitLength;
  }

  /**
   * The value `data` and `bitLength` write: bits, or bytes when the
   * count is a whole number of them. Throws a TypeError when they write
   * none (a count the data does not match).
   *
   * @param {Uint8Array} data
   * @param {number | bigint} bitLength
   * @returns {DXNBits | DXNBytes}
   */
  static from(data, bitLength) {
    const n = Number(bitLength);
    const made = DXNBits.parts(data, n);
    if (!made) throw new TypeError(`bits wants ceil(${n} / 8) bytes and a non-negative count, got ${data.length} bytes`);
    return n % 8 === 0 ? new DXNBytes(made) : new DXNBits(made, n);
  }

  /**
   * `data` with the unused low bits of its last byte cleared, or null when
   * it is not exactly the bytes `bitLength` needs.
   *
   * @param {Uint8Array} data
   * @param {number} bitLength
   * @returns {Uint8Array | null}
   */
  static parts(data, bitLength) {
    if (!(data instanceof Uint8Array) || !Number.isInteger(bitLength) || bitLength < 0) return null;
    if (data.length !== Math.ceil(bitLength / 8)) return null;
    const out = Uint8Array.from(data);
    const used = bitLength % 8;
    if (used !== 0) out[out.length - 1] &= (0xff << (8 - used)) & 0xff;
    return out;
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

DXNBits.prototype.dxnType = 'bits';

module.exports = DXNBits;
