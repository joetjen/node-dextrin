import { expect } from 'chai';
import { decodeString, encodeString } from '../../src/text/escapes.cjs';

describe('text/escapes', () => {
  describe('decodeString', () => {
    it('decodes every named escape to its control character', () => {
      expect(decodeString('\\n')).to.equal('\n');
      expect(decodeString('\\t')).to.equal('\t');
      expect(decodeString('\\r')).to.equal('\r');
      expect(decodeString('\\"')).to.equal('"');
      expect(decodeString('\\\\')).to.equal('\\');
      expect([...decodeString('\\0')].map((c) => c.codePointAt(0))).to.deep.equal([0]);
      expect([...decodeString('\\a')].map((c) => c.codePointAt(0))).to.deep.equal([7]);
      expect([...decodeString('\\b')].map((c) => c.codePointAt(0))).to.deep.equal([8]);
      expect([...decodeString('\\f')].map((c) => c.codePointAt(0))).to.deep.equal([12]);
      expect([...decodeString('\\v')].map((c) => c.codePointAt(0))).to.deep.equal([11]);
    });

    it('decodes \\x{...} hex escapes to the corresponding codepoint', () => {
      expect(decodeString('\\x{41}')).to.equal('A');
      expect(decodeString('\\x{1f600}')).to.equal('😀');
    });

    it('passes through plain text untouched', () => {
      expect(decodeString('hello world')).to.equal('hello world');
      expect(decodeString('héllo 世界')).to.equal('héllo 世界');
    });

    it('throws on an unrecognized escape', () => {
      expect(() => decodeString('\\q')).to.throw(SyntaxError);
    });

    it('throws on a malformed \\x{...} escape', () => {
      expect(() => decodeString('\\x41}')).to.throw(SyntaxError);
      expect(() => decodeString('\\x{}')).to.throw(SyntaxError);
      expect(() => decodeString('\\x{41')).to.throw(SyntaxError);
    });

    it('throws on a dangling trailing backslash', () => {
      expect(() => decodeString('abc\\')).to.throw(SyntaxError);
    });
  });

  describe('encodeString', () => {
    it('escapes only the characters that round-tripping requires', () => {
      expect(encodeString('a"b\\c\nd\te\rf')).to.equal('a\\"b\\\\c\\nd\\te\\rf');
    });

    it('leaves non-ASCII text untouched', () => {
      expect(encodeString('héllo 世界 😀')).to.equal('héllo 世界 😀');
    });

    it('uses \\x{...} for other C0 control characters, never \\0/\\a/\\b/\\f/\\v', () => {
      expect(encodeString('\u0000')).to.equal('\\x{0}');
      expect(encodeString('\u0007')).to.equal('\\x{7}');
    });

    it('round-trips through decodeString for arbitrary text', () => {
      const s = 'mixed "quotes" \\ and \n newlines \t and 世界 😀';
      expect(decodeString(encodeString(s))).to.equal(s);
    });
  });
});
