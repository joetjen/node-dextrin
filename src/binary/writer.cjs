'use strict';

/**
 * @fileoverview Low-level CBOR item builders shared by the encoder —
 * raw major-type/head construction, kept separate from the
 * DXN-type-dispatch logic in `encoder.cjs` the same way
 * `Dextrin.Binary.Encoder`'s own "raw CBOR item builders" section is
 * set apart from its `encode_item_dispatch` clauses.
 */

const BIGNUM_MAX = 0xffffffffffffffffn; // 2^64 - 1
const BIGNUM_MIN = -0x10000000000000000n; // -(2^63 ... ) i.e. -(2^64)

/**
 * CBOR item header: major type (0-7) + argument, shortest form.
 * @param {number} major
 * @param {bigint} n non-negative.
 * @returns {Buffer}
 */
function head(major, n) {
  if (n < 24n) return Buffer.from([(major << 5) | Number(n)]);
  if (n < 256n) return Buffer.from([(major << 5) | 24, Number(n)]);
  if (n < 65536n) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(Number(n), 1);
    return b;
  }
  if (n < 4294967296n) {
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(Number(n), 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = (major << 5) | 27;
  b.writeBigUInt64BE(n, 1);
  return b;
}

/**
 * Major 7's float marker (additional info 27, "double follows") —
 * deliberately not `head(7, 27n)`: for every other major type,
 * `head`'s job is "encode this integer using the fewest bytes CBOR
 * allows," but major 7's additional-info value of 27 has to mean
 * literally "float64 follows," not "the number 27, shortest form" —
 * `head(7, 27n)` would emit `<<7::3, 24::5, 27::8>>` (two bytes)
 * instead of the required `<<7::3, 27::5>>` (one byte), a genuinely
 * different, non-conformant encoding. Same bug `Dextrin.Binary.Encoder`
 * itself once had — see its own `float_head/0` comment.
 * @returns {Buffer}
 */
function floatHead() {
  return Buffer.from([0xfb]);
}

/**
 * @param {number} n a finite or non-finite IEEE-754 double.
 * @returns {Buffer}
 */
function floatItem(n) {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n);
  return Buffer.concat([floatHead(), b]);
}

/**
 * @param {number} tagNumber
 * @param {Buffer} itemBuffer
 * @returns {Buffer}
 */
function tag(tagNumber, itemBuffer) {
  return Buffer.concat([head(6, BigInt(tagNumber)), itemBuffer]);
}

/**
 * @param {Buffer[]} items already-encoded item buffers.
 * @returns {Buffer}
 */
function arrayOf(items) {
  return Buffer.concat([head(4, BigInt(items.length)), ...items]);
}

/**
 * @param {Array<[Buffer, Buffer]>} pairs already-encoded key/value buffer pairs.
 * @returns {Buffer}
 */
function mapOf(pairs) {
  const flat = pairs.flat();
  return Buffer.concat([head(5, BigInt(pairs.length)), ...flat]);
}

/**
 * @param {string} s
 * @returns {Buffer}
 */
function textItem(s) {
  const utf8 = Buffer.from(s, 'utf8');
  return Buffer.concat([head(3, BigInt(utf8.length)), utf8]);
}

/**
 * @param {Uint8Array} data
 * @returns {Buffer}
 */
function bytesItem(data) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.concat([head(2, BigInt(buf.length)), buf]);
}

/**
 * A DXN `integer` (arbitrary precision) as CBOR major 0/1, or tag 2/3
 * (two's-complement bignum bytes) once it overflows 64 bits — exactly
 * `DXN.md` §2.2's integrity requirement.
 * @param {bigint} i
 * @returns {Buffer}
 */
function integerItem(i) {
  if (i >= 0n && i <= BIGNUM_MAX) return head(0, i);
  if (i < 0n && i >= BIGNUM_MIN) return head(1, -1n - i);
  if (i >= 0n) return tag(2, bytesItem(bigIntToBytes(i)));
  return tag(3, bytesItem(bigIntToBytes(-1n - i)));
}

/**
 * @param {bigint} n non-negative.
 * @returns {Uint8Array}
 */
function bigIntToBytes(n) {
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

module.exports = { head, floatHead, floatItem, tag, arrayOf, mapOf, textItem, bytesItem, integerItem, bigIntToBytes };
