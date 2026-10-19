import { expect } from 'chai';
import { decode } from '../../src/binary/decoder.cjs';
import { BinaryError } from '../../src/binary/errors.cjs';
import { head, tag, arrayOf, bytesItem, integerItem } from '../../src/binary/writer.cjs';

/** @param {Buffer} item @returns {Buffer} */
function doc(item) {
  return Buffer.concat([Buffer.from([0x44, 0x58, 0x01]), item]);
}

describe('.dxnb malformed input', () => {
  it('rejects a missing envelope', () => {
    expect(() => decode(Buffer.from([]))).to.throw(BinaryError, /envelope/);
    expect(() => decode(Buffer.from('not dxnb', 'utf8'))).to.throw(BinaryError, /envelope/);
  });

  it('rejects a wrong magic or version byte', () => {
    expect(() => decode(Buffer.from([0x00, 0x00, 0x01, 0x00]))).to.throw(BinaryError, /envelope/);
    expect(() => decode(Buffer.from([0x44, 0x58, 0x02, 0x00]))).to.throw(BinaryError, /envelope/);
  });

  it('rejects trailing bytes after a complete top-level value', () => {
    const withExtra = Buffer.concat([doc(integerItem(1n)), Buffer.from([0xff])]);
    expect(() => decode(withExtra)).to.throw(BinaryError, /trailing bytes/);
  });

  it('rejects a truncated item (declared length longer than available bytes)', () => {
    const truncated = doc(head(3, 10n)); // text item claiming 10 bytes, none follow
    expect(() => decode(truncated)).to.throw(BinaryError, /truncated|end of input/);
  });

  it('rejects an unexpected end of input mid-header', () => {
    expect(() => decode(doc(Buffer.from([0x18])))).to.throw(BinaryError, /end of input/);
  });

  it('rejects invalid UTF-8 in a text item', () => {
    const invalidUtf8 = Buffer.concat([head(3, 1n), Buffer.from([0xff])]);
    expect(() => decode(doc(invalidUtf8))).to.throw(BinaryError, /UTF-8/);
  });

  it('rejects half-precision (16-bit) floats outright', () => {
    const halfFloat = Buffer.from([(7 << 5) | 25, 0x00, 0x00]);
    expect(() => decode(doc(halfFloat))).to.throw(BinaryError, /half-precision/);
  });

  it('rejects an unrecognized simple value / reserved major-7 additional info', () => {
    const reserved = Buffer.from([(7 << 5) | 28]);
    expect(() => decode(doc(reserved))).to.throw(BinaryError);
  });

  it('rejects an unrecognized CBOR tag', () => {
    const unknownTag = tag(999, integerItem(1n));
    expect(() => decode(doc(unknownTag))).to.throw(BinaryError, /unrecognized CBOR tag/);
  });

  it('rejects a malformed tuple payload (tag 203 around a non-list item)', () => {
    const badTuple = tag(203, integerItem(1n)); // payload must be a major-4 array
    expect(() => decode(doc(badTuple))).to.throw(BinaryError, /malformed tuple/);
  });

  it('rejects a malformed uuid payload (wrong byte length)', () => {
    const badUuid = tag(37, bytesItem(new Uint8Array(10)));
    expect(() => decode(doc(badUuid))).to.throw(BinaryError, /malformed uuid/);
  });

  it('rejects a malformed rational payload (zero denominator)', () => {
    const badRational = tag(30, arrayOf([integerItem(1n), integerItem(0n)]));
    expect(() => decode(doc(badRational))).to.throw(BinaryError, /malformed rational/);
  });

  it('rejects a malformed char payload (surrogate range)', () => {
    const badChar = tag(200, integerItem(0xd800n));
    expect(() => decode(doc(badChar))).to.throw(BinaryError, /malformed char/);
  });

  it('rejects a malformed struct payload (empty array, no name)', () => {
    const badStruct = tag(208, arrayOf([]));
    expect(() => decode(doc(badStruct))).to.throw(BinaryError, /malformed struct/);
  });

  it('rejects a duration whose bitmask does not match its field count', () => {
    // bitmask says only "years" (bit 0) is present, but two fields follow
    const badDuration = tag(212, arrayOf([integerItem(1n), integerItem(1n), integerItem(2n)]));
    expect(() => decode(doc(badDuration))).to.throw(BinaryError, /bitmask/);
  });

  it('never crashes with an uncaught non-BinaryError for fuzzed/random bytes', () => {
    // Mirrors dextrin's own binary/fuzz_test.exs: random bytes after a
    // valid envelope must always fail cleanly (a decoded value, or a
    // refusal with its DXN.md §5 category -- a BinaryError, or e.g. a
    // map key the format does not allow) — never an unrelated
    // TypeError/RangeError escaping from an unguarded buffer read or
    // shape assumption deep in the tag dispatch.
    const rng = () => Math.floor(Math.random() * 256);
    for (let trial = 0; trial < 500; trial += 1) {
      const length = 1 + Math.floor(Math.random() * 40);
      const bytes = Buffer.concat([Buffer.from([0x44, 0x58, 0x01]), Buffer.from(Array.from({ length }, rng))]);
      try {
        decode(bytes);
      } catch (err) {
        const categorised = err instanceof BinaryError || typeof (/** @type {any} */ (err).category) === 'string';
        expect(categorised, `unexpected error for fuzz input ${bytes.toString('hex')}: ${err}`).to.equal(true);
      }
    }
  });
});
