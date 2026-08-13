import { expect } from 'chai';
import { head, floatHead, floatItem, tag, arrayOf, mapOf, textItem, bytesItem, integerItem } from '../../src/binary/writer.cjs';

describe('binary/writer', () => {
  describe('head', () => {
    it('uses the direct form for n < 24', () => {
      expect(head(0, 5n)).to.deep.equal(Buffer.from([0x05]));
    });

    it('uses the 1-byte-extra form for 24 <= n < 256', () => {
      expect(head(0, 200n)).to.deep.equal(Buffer.from([0x18, 200]));
    });

    it('uses the 2-byte-extra form for 256 <= n < 65536', () => {
      expect(head(0, 1000n)).to.deep.equal(Buffer.from([0x19, 0x03, 0xe8]));
    });

    it('uses the 4-byte-extra form for 65536 <= n < 2^32', () => {
      expect(head(0, 4294967295n)).to.deep.equal(Buffer.from([0x1a, 0xff, 0xff, 0xff, 0xff]));
    });

    it('uses the 8-byte-extra form for n >= 2^32, with the header byte intact', () => {
      const b = head(0, 45_000_000_000n);
      expect(b[0]).to.equal(0x1b);
      expect(b.length).to.equal(9);
      expect(b.readBigUInt64BE(1)).to.equal(45_000_000_000n);
    });

    it('encodes the major type into the top 3 bits', () => {
      expect(head(4, 3n)[0]).to.equal((4 << 5) | 3);
      expect(head(6, 200n)).to.deep.equal(Buffer.from([(6 << 5) | 24, 200]));
    });
  });

  it('floatHead is the single-byte major-7/info-27 marker, not head(7, 27n)', () => {
    expect(floatHead()).to.deep.equal(Buffer.from([0xfb]));
    expect(floatHead()).to.not.deep.equal(head(7, 27n));
  });

  it('floatItem writes an 8-byte big-endian double after the float header', () => {
    const b = floatItem(1.5);
    expect(b[0]).to.equal(0xfb);
    expect(b.readDoubleBE(1)).to.equal(1.5);
  });

  it('floatItem round-trips NaN/Infinity/-Infinity via native IEEE-754 bits', () => {
    expect(Number.isNaN(floatItem(NaN).readDoubleBE(1))).to.equal(true);
    expect(floatItem(Infinity).readDoubleBE(1)).to.equal(Infinity);
    expect(floatItem(-Infinity).readDoubleBE(1)).to.equal(-Infinity);
  });

  it('tag prefixes an item with a major-6 head of the tag number', () => {
    const item = Buffer.from([0x01]);
    expect(tag(37, item)).to.deep.equal(Buffer.concat([head(6, 37n), item]));
  });

  it('arrayOf prefixes concatenated items with a major-4 count head', () => {
    const items = [Buffer.from([1]), Buffer.from([2])];
    expect(arrayOf(items)).to.deep.equal(Buffer.concat([head(4, 2n), ...items]));
  });

  it('mapOf flattens pairs and prefixes with a major-5 pair-count head', () => {
    const pairs = /** @type {[Buffer, Buffer][]} */ ([
      [Buffer.from([1]), Buffer.from([2])],
      [Buffer.from([3]), Buffer.from([4])]
    ]);
    expect(mapOf(pairs)).to.deep.equal(Buffer.concat([head(5, 2n), Buffer.from([1]), Buffer.from([2]), Buffer.from([3]), Buffer.from([4])]));
  });

  it('textItem encodes UTF-8 bytes with a major-3 length head', () => {
    const b = textItem('hi');
    expect(b).to.deep.equal(Buffer.concat([head(3, 2n), Buffer.from('hi', 'utf8')]));
  });

  it('bytesItem encodes raw bytes with a major-2 length head', () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(bytesItem(data)).to.deep.equal(Buffer.concat([head(2, 3n), Buffer.from(data)]));
  });

  describe('integerItem', () => {
    it('uses major 0 directly for non-negative values up to 2^64-1', () => {
      expect(integerItem(0n)).to.deep.equal(head(0, 0n));
      expect(integerItem(18_446_744_073_709_551_615n)).to.deep.equal(head(0, 18_446_744_073_709_551_615n));
    });

    it('uses major 1 (-1-n) for negative values down to -2^64', () => {
      expect(integerItem(-1n)).to.deep.equal(head(1, 0n));
      expect(integerItem(-18_446_744_073_709_551_616n)).to.deep.equal(head(1, 18_446_744_073_709_551_615n));
    });

    it('falls back to a tag-2 bignum for values beyond 2^64-1', () => {
      const n = 18_446_744_073_709_551_616n; // 2^64
      const b = integerItem(n);
      expect(b[0]).to.equal((6 << 5) | 2); // major 6 (tag), tag number 2 (fits directly, < 24)
    });

    it('falls back to a tag-3 bignum for values beyond -2^64', () => {
      const n = -18_446_744_073_709_551_617n;
      const b = integerItem(n);
      expect(b[0]).to.equal((6 << 5) | 3); // major 6 (tag), tag number 3
    });

    it('bignum payload round-trips through manual big-endian byte decoding', () => {
      const n = 123_456_789_012_345_678_901_234_567_890n;
      const b = integerItem(n);
      // tag(2, bytesItem(...)) — skip the tag(2) head (2 bytes: 0xc2) and the bytes-item head
      expect(b[0]).to.equal((6 << 5) | 2); // tag 2 fits in the direct 5-bit form
      let offset = 1;
      const byteHead = b[offset];
      expect(byteHead >> 5).to.equal(2); // major 2 (bytes)
      offset += 1;
      const len = byteHead & 0x1f;
      let reconstructed = 0n;
      for (let i = 0; i < len; i += 1) reconstructed = (reconstructed << 8n) | BigInt(b[offset + i]);
      expect(reconstructed).to.equal(n);
    });
  });
});
