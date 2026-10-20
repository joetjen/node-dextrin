import { expect } from 'chai';
import { decode, decodeBinary, encodeBinary, Registry, Schema, DXNBytes, DXNList } from '../../src/dextrin.js';

// Encoded content, the superset's group 5, as dextrin 6918cf8
// (design/schema-superset.md, Jan, 2026-10-20): `encoding:`,
// `media-type:` and `content:` on strings (JSON Schema's contentEncoding,
// contentMediaType and contentSchema), `encodes:` and `encodes-seq:` on
// bytes (CDDL's `.cbor` and `.cborseq`).
describe('schema encoded content', () => {
  /** @param {string} type */
  const compiled = (type) => Schema.compile(decode(`%{T: ${type}}`), new Registry());

  /**
   * Whether `value` is a `type`. Only a refusal, an error with a schema
   * category, answers false: any other error is thrown on.
   * @param {string} type @param {unknown} value
   */
  const takes = (type, value) => {
    const registry = compiled(type);
    try {
      return Schema.check(value, registry, 'T');
    } catch (err) {
      if (String(/** @type {any} */ (err).category ?? '').startsWith('schema/')) return false;
      throw err;
    }
  };

  /** The message a compile refuses `type` with. @param {string} type @returns {string} */
  const compileError = (type) => {
    try {
      compiled(type);
    } catch (err) {
      expect(/** @type {any} */ (err).category).to.equal('schema/compile');
      return /** @type {any} */ (err).message;
    }
    throw new Error(`${type} compiled`);
  };

  /** The `.dxnb` of the value written `text`. @param {string} text @returns {Buffer} */
  const dxnb = (text) => encodeBinary(decode(text));

  /** @param {Uint8Array | string} data */
  const bytes = (data) => new DXNBytes(typeof data === 'string' ? new Uint8Array(Buffer.from(data, 'latin1')) : new Uint8Array(data));

  describe('encoding', () => {
    it('the string is valid in that RFC 4648 encoding', () => {
      expect(takes('{:refine :string %{encoding: :base64}}', 'aGk=')).to.equal(true);
      expect(takes('{:refine :string %{encoding: :base64}}', 'aGk')).to.equal(false);
      expect(takes('{:refine :string %{encoding: :base64}}', 'a-k=')).to.equal(false);
      expect(takes('{:refine :string %{encoding: :base64url}}', 'a-_9')).to.equal(true);
      expect(takes('{:refine :string %{encoding: :base64url}}', 'aGk')).to.equal(true);
      expect(takes('{:refine :string %{encoding: :base32}}', 'NBUQ====')).to.equal(true);
      expect(takes('{:refine :string %{encoding: :base32}}', 'nbuq====')).to.equal(false);
      expect(takes('{:refine :string %{encoding: :base16}}', '6869')).to.equal(true);
      expect(takes('{:refine :string %{encoding: :base16}}', '6A6b')).to.equal(true);
      expect(takes('{:refine :string %{encoding: :base16}}', '686')).to.equal(false);
    });

    it('an unknown encoding is a compile error', () => {
      expect(compileError('{:refine :string %{encoding: :rot13}}')).to.include('encoding');
    });
  });

  describe('media-type', () => {
    it('says what the string holds, and checks nothing else', () => {
      expect(takes('{:refine :string %{media-type: "image/png"}}', 'anything')).to.equal(true);
      expect(takes('{:refine :string %{media-type: "image/png"}}', 5n)).to.equal(false);
    });

    it('is a type/subtype name', () => {
      expect(compileError('{:refine :string %{media-type: "png"}}')).to.include('media-type');
    });
  });

  describe('content', () => {
    it('the string is a DXN document whose value is a T', () => {
      const type = '{:refine :string %{content: {:list-of :integer}}}';
      expect(takes(type, '[1 2 3]')).to.equal(true);
      expect(takes(type, '["a"]')).to.equal(false);
      expect(takes(type, '[1 2')).to.equal(false);
    });

    it('with an encoding, the decoded bytes are the document: .dxnb under application/dxnb', () => {
      const type = '{:refine :string %{encoding: :base64, media-type: "application/dxnb", content: :integer}}';
      expect(takes(type, dxnb('42').toString('base64'))).to.equal(true);
      expect(takes(type, dxnb('"x"').toString('base64'))).to.equal(false);

      const text = '{:refine :string %{encoding: :base16, content: :integer}}';
      expect(takes(text, Buffer.from('42').toString('hex').toUpperCase())).to.equal(true);
    });

    it('any other media type has no reader, and is a compile error', () => {
      expect(compileError('{:refine :string %{media-type: "application/json", content: :any}}')).to.include('content');
    });
  });

  describe('encodes', () => {
    it('the bytes are a .dxnb document whose value is a T', () => {
      expect(takes('{:refine :bytes %{encodes: {:list-of :integer}}}', bytes(dxnb('[1 2]')))).to.equal(true);
      expect(takes('{:refine :bytes %{encodes: :string}}', bytes(dxnb('[1 2]')))).to.equal(false);
      expect(takes('{:refine :bytes %{encodes: :any}}', bytes('not dxnb'))).to.equal(false);
    });

    it('encodes-seq: documents back to back, each a T, none at all too', () => {
      const seq = bytes(Buffer.concat([dxnb('1'), dxnb('2'), dxnb('3')]));
      expect(takes('{:refine :bytes %{encodes-seq: :integer}}', seq)).to.equal(true);
      expect(takes('{:refine :bytes %{encodes-seq: :string}}', seq)).to.equal(false);
      expect(takes('{:refine :bytes %{encodes-seq: :integer}}', bytes(''))).to.equal(true);
      expect(takes('{:refine :bytes %{encodes-seq: :integer}}', bytes(Buffer.concat([dxnb('1'), Buffer.from('DX')])))).to.equal(false);
    });

    it("a check inside a decode leaves the decode's own state alone", () => {
      const registry = Schema.compile(decode('%{Box: %schema{payload: {:refine :bytes %{encodes: :string}}, again: :string}}'), new Registry());
      const inner = dxnb('"shared"').toString('base64');

      const text = `[%Box{payload: @bytes "${inner}", again: "shared"} "shared"]`;
      const value = /** @type {DXNList} */ (decode(text, { registry }));
      expect(value.items[1]).to.equal('shared');

      const binary = encodeBinary(value, { registry });
      const back = /** @type {DXNList} */ (decodeBinary(binary, { registry }));
      expect(back.items[1]).to.equal('shared');
    });
  });
});
