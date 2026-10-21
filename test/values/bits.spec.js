import { expect } from 'chai';
import { canonical, decode, decodeBinary, encode, encodeBinary, DXNBits, DXNBytes, DXNError, Registry, Schema } from '../../src/dextrin.js';

// `bits` (DXN.md §1.3, §1.4, §2.3): a run of bits that is not whole bytes
// -- `@bits {"oA==" 3}` in text, `T_BITS` (216) around `[bytes, count]` in
// `.dxnb`. Bits and bytes are one value space: a whole number of bytes is
// bytes. JavaScript has no bitstring, so `DXNBits` holds the bytes and the
// count.
const category = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).to.be.instanceOf(DXNError);
    return err.category;
  }
  throw new Error('expected a refusal');
};
const bits = (bytes, n) => DXNBits.from(new Uint8Array(bytes), n);
const hex = (b) => Buffer.from(b).toString('hex');

describe('bits', () => {
  describe('text', () => {
    it('reads a run of bits, from the high bit of the first byte', () => {
      const value = decode('@bits {"oA==" 3}');
      expect(value).to.be.instanceOf(DXNBits);
      expect(value.bitLength).to.equal(3);
      expect(hex(value.data)).to.equal('a0');
    });

    it('a whole number of bytes is bytes', () => {
      const value = decode('@bits {"AQID" 24}');
      expect(value).to.be.instanceOf(DXNBytes);
      expect(hex(value.data)).to.equal('010203');
    });

    it('the unused low bits of the last byte are ignored', () => {
      expect(decode('@bits {"pw==" 3}').equals(decode('@bits {"oA==" 3}'))).to.equal(true);
    });

    it('a count the data does not match is refused', () => {
      expect(category(() => decode('@bits {"oA==" 9}'))).to.equal('syntax');
      expect(category(() => decode('@bits {"AAA=" 3}'))).to.equal('syntax');
      expect(category(() => decode('@bits {"oA==" -1}'))).to.equal('syntax');
      expect(category(() => decode('@bits "oA=="'))).to.equal('syntax');
    });

    it('is written with the count, the unused bits zero', () => {
      expect(encode(bits([0xa7], 3))).to.equal('@bits {"oA==" 3}');
      expect(encode(bits([0xa7], 3), { pretty: true })).to.equal('@bits {"oA==" 3}');
    });

    it('the canonical form is the same', () => {
      expect(canonical(bits([0xa0], 3))).to.equal('@bits {"oA==" 3}');
    });
  });

  describe('.dxnb', () => {
    it('is T_BITS around the bytes and the count', () => {
      expect(hex(encodeBinary(bits([0xa0], 3)))).to.equal('445801d8d88241a003');
    });

    it('and reads back', () => {
      const value = decodeBinary(encodeBinary(bits([0x01, 0xa0], 11)));
      expect(value.equals(bits([0x01, 0xa0], 11))).to.equal(true);
    });

    it('a count its bytes do not match is malformed', () => {
      expect(category(() => decodeBinary(Buffer.from('445801d8d88241a009', 'hex')))).to.equal('binary');
      expect(category(() => decodeBinary(Buffer.from('445801d8d86161', 'hex')))).to.equal('binary');
    });
  });

  it('bits are no map key', () => {
    expect(category(() => decode('%{@bits {"oA==" 3} => 1}'))).to.equal('key/not-allowed');
  });

  describe('a schema', () => {
    const registry = (type) => Schema.compile(decode(`%{S: %schema{b: ${type}}}`), new Registry());

    it(':bits takes bits and bytes alike', () => {
      expect(() => decode('%S{b: @bits {"oA==" 3}}', { registry: registry(':bits') })).not.to.throw();
      expect(() => decode('%S{b: @bytes "AQ=="}', { registry: registry(':bits') })).not.to.throw();
    });

    it(':bytes takes only whole bytes', () => {
      expect(category(() => decode('%S{b: @bits {"oA==" 3}}', { registry: registry(':bytes') }))).to.equal('schema/type-mismatch');
    });
  });
});
