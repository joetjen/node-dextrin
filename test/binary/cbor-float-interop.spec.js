import { expect } from 'chai';
import fc from 'fast-check';
import { decode, decodeBinary, encodeBinary } from '../../src/dextrin.js';

// CBOR floats from any conformant producer, and the widths `.dxnb`
// writes: the shortest that holds a float exactly (DXN.md §2.2, Jan,
// 2026-10-20). Ported from dextrin's test/binary/cbor_float_interop_test.exs.

const ENVELOPE = Buffer.from([0x44, 0x58, 1]);

/** @param {number[] | Buffer} item @returns {Buffer} */
const doc = (item) => Buffer.concat([ENVELOPE, Buffer.from(item)]);

/** A double-precision item, 0xFB and its 8 bytes. @param {number} f */
const double = (f) => {
  const b = Buffer.alloc(9);
  b[0] = 0xfb;
  b.writeDoubleBE(f, 1);
  return b;
};

describe('.dxnb CBOR floats', () => {
  it('decodes a canonical (standards-conformant) double-precision float header', () => {
    expect(decodeBinary(doc(double(19.99)))).to.equal(19.99);
  });

  it('writes a double behind the single-byte header 0xFB', () => {
    const bytes = encodeBinary(19.99);
    expect(bytes[3]).to.equal(0xfb);
    expect(bytes.length).to.equal(12);
  });

  it('decodes a single-precision (32-bit) float', () => {
    const b = Buffer.alloc(5);
    b[0] = 0xfa;
    b.writeFloatBE(1.5, 1);
    expect(decodeBinary(doc(b))).to.equal(1.5);
  });

  it('reads half-precision floats, specials and subnormals included', () => {
    /** @param {number} bits */
    const half = (bits) => decodeBinary(doc([0xf9, bits >> 8, bits & 0xff]));
    expect(Object.is(half(0x0000), 0)).to.equal(true);
    expect(Object.is(half(0x8000), -0)).to.equal(true);
    expect(half(0xc000)).to.equal(-2.0);
    expect(half(0x7bff)).to.equal(65504.0);
    expect(half(0x0001)).to.equal(5.960464477539063e-8);
    expect(half(0x7c00)).to.equal(Infinity);
    expect(half(0xfc00)).to.equal(-Infinity);
    expect(Number.isNaN(half(0x7e00))).to.equal(true);
  });

  it('reads single-precision specials and subnormals', () => {
    /** @param {number} bits */
    const single = (bits) => {
      const b = Buffer.alloc(5);
      b[0] = 0xfa;
      b.writeUInt32BE(bits, 1);
      return decodeBinary(doc(b));
    };
    expect(single(0x7f800000)).to.equal(Infinity);
    expect(single(0xff800000)).to.equal(-Infinity);
    expect(Number.isNaN(single(0x7fc00000))).to.equal(true);
    expect(single(0x00000001)).to.equal(2 ** -149);
  });

  it('writes a float in the shortest width that holds it exactly', () => {
    /** @param {number} f */
    const width = (f) => ({ 25: 'half', 26: 'single', 27: 'double' })[encodeBinary(f)[3] & 0x1f];
    expect(width(1.5)).to.equal('half');
    expect(width(-0.0)).to.equal('half');
    expect(width(65504.0)).to.equal('half');
    expect(width(65520.0)).to.equal('single');
    expect(width(0.1)).to.equal('double');
    expect(width(3.141592653589793)).to.equal('double');
    expect(width(NaN)).to.equal('half');
    expect(width(Infinity)).to.equal('half');
    expect(width(-Infinity)).to.equal('half');
    expect(width(5.960464477539063e-8)).to.equal('half');
    expect(width(2 ** -149)).to.equal('single');
    expect(width(1.0e300)).to.equal('double');

    for (const f of [1.5, -0.0, 0.0, 65520.0, 0.1, 1.0e-40, 1.0e300, 2 ** -24, 2 ** -25, -65504.0, NaN, Infinity, -Infinity]) {
      expect(Object.is(decodeBinary(encodeBinary(f)), f), String(f)).to.equal(true);
    }
  });

  it('writes every half-precision value back as the half it was read from', () => {
    for (let bits = 0; bits < 0x10000; bits += 1) {
      const isNaN = (bits & 0x7c00) === 0x7c00 && (bits & 0x3ff) !== 0;
      if (isNaN) continue;
      const item = Buffer.from([0xf9, bits >> 8, bits & 0xff]);
      const written = encodeBinary(decodeBinary(doc(item))).subarray(3);
      expect(written.equals(item), bits.toString(16)).to.equal(true);
    }
  });

  it('keeps every double exactly, whatever width it is written in', () => {
    fc.assert(
      fc.property(fc.double(), (f) => Object.is(decodeBinary(encodeBinary(f)), f) || Number.isNaN(f)),
      { numRuns: 2000 }
    );
    fc.assert(
      // A single never needs a double.
      fc.property(fc.float(), (f) => encodeBinary(f).length <= 8 && (Object.is(decodeBinary(encodeBinary(f)), f) || Number.isNaN(f))),
      { numRuns: 2000 }
    );
  });

  it('writes NaN and the infinities as half: 0x7E00, 0x7C00, 0xFC00', () => {
    expect(Array.from(encodeBinary(NaN).subarray(3))).to.deep.equal([0xf9, 0x7e, 0x00]);
    expect(Array.from(encodeBinary(Infinity).subarray(3))).to.deep.equal([0xf9, 0x7c, 0x00]);
    expect(Array.from(encodeBinary(-Infinity).subarray(3))).to.deep.equal([0xf9, 0xfc, 0x00]);
  });

  it('writes a UTC datetime as its bare nanoseconds, a regex without flags as its bare pattern', () => {
    // tag 219, then the integer 1_000_000_000: no array, no offset.
    expect(Array.from(encodeBinary(decode('@datetime "1970-01-01T00:00:01Z"')))).to.deep.equal([
      0x44, 0x58, 1, 0xd8, 219, 0x1a, 0x3b, 0x9a, 0xca, 0x00
    ]);
    // tag 213, then the string "a".
    expect(Array.from(encodeBinary(decode('@regex "a"')))).to.deep.equal([0x44, 0x58, 1, 0xd8, 213, 0x61, 0x61]);
  });

  it('keeps the array for a datetime with an offset, and for a regex with flags', () => {
    // tag 219, [1_000_000_000, 60].
    expect(Array.from(encodeBinary(decode('@datetime "1970-01-01T01:00:01+01:00"')))).to.deep.equal([
      0x44, 0x58, 1, 0xd8, 219, 0x82, 0x1a, 0x3b, 0x9a, 0xca, 0x00, 0x18, 60
    ]);
    // tag 213, ["a", 1]: the i flag.
    expect(Array.from(encodeBinary(decode('@regex(i) "a"')))).to.deep.equal([0x44, 0x58, 1, 0xd8, 213, 0x82, 0x61, 0x61, 0x01]);
  });

  it('reads both forms of a UTC datetime and of a regex without flags', () => {
    const bare = decodeBinary(doc([0xd8, 219, 0x1a, 0x3b, 0x9a, 0xca, 0x00]));
    const old = decodeBinary(doc([0xd8, 219, 0x82, 0x1a, 0x3b, 0x9a, 0xca, 0x00, 0x00]));
    expect(bare).to.deep.equal(old);
    expect(bare).to.deep.equal(decode('@datetime "1970-01-01T00:00:01Z"'));

    const bareRegex = decodeBinary(doc([0xd8, 213, 0x61, 0x61]));
    const oldRegex = decodeBinary(doc([0xd8, 213, 0x82, 0x61, 0x61, 0x00]));
    expect(bareRegex).to.deep.equal(oldRegex);
    expect(bareRegex).to.deep.equal(decode('@regex "a"'));
  });

  it('round-trips the special float values', () => {
    for (const value of [NaN, Infinity, -Infinity, -0.0, 1.0e10]) {
      expect(Object.is(decodeBinary(encodeBinary(value)), value), String(value)).to.equal(true);
    }
  });
});
