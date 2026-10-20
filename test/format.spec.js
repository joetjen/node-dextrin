import { expect } from 'chai';
import { Format, encodeBinary, DXNMap } from '../src/dextrin.js';

// `Format` (DXN.md §6), as `Dextrin.Format`: the media types and
// extensions of the three forms, which form a media type names, and a
// cheap test of whether a body is worth decoding as a form -- the text
// rule as Jan set it on 2026-10-20.
describe('Format', () => {
  describe('names', () => {
    it('gives each form a media type and an extension', () => {
      expect(Format.mediaType('text')).to.equal('application/vnd.dxn');
      expect(Format.mediaType('binary')).to.equal('application/vnd.dxnb');
      expect(Format.mediaType('schema')).to.equal('application/vnd.dxns');
      expect(Format.extension('text')).to.equal('.dxn');
      expect(Format.extension('binary')).to.equal('.dxnb');
      expect(Format.extension('schema')).to.equal('.dxns');
    });

    it('reads the form a media type names, a +dxn suffix as text, in any case', () => {
      expect(Format.form('application/vnd.dxn')).to.equal('text');
      expect(Format.form('application/vnd.dxnb')).to.equal('binary');
      expect(Format.form('application/vnd.dxns')).to.equal('schema');
      expect(Format.form('application/vnd.acme.event+dxn')).to.equal('text');
      expect(Format.form('Application/VND.DXN')).to.equal('text');
    });

    it('reads nothing else: no +dxnb suffix, no parameters', () => {
      expect(Format.form('application/json')).to.equal(null);
      expect(Format.form('application/vnd.acme.event+dxnb')).to.equal(null);
      expect(Format.form('application/vnd.dxn; charset=utf-8')).to.equal(null);
      expect(Format.form('')).to.equal(null);
    });
  });

  describe('identifies, for text and schemas: the first significant character is %', () => {
    it('takes a map, a struct, a schema, a tuple-ish %(', () => {
      for (const body of ['%{a: 1}', '%Point{x: 1}', '%ns/Name{x: 1}', '%{P: %schema{x: :integer}}', '%(1)']) {
        expect(Format.identifies(body, 'text'), body).to.equal(true);
        expect(Format.identifies(body, 'schema'), body).to.equal(true);
      }
    });

    it('after whitespace, commas, comments and a header', () => {
      expect(Format.identifies('\n  , # a comment\n# another\n@dxn "1.0"  # the version\n\n%{a: 1}', 'text')).to.equal(true);
    });

    it('leaves a list or a scalar unrecognised on purpose: they overlap with JSON', () => {
      for (const body of ['[1 2]', '"a"', '1', ':a', '{1 2}', '@array[1]', 'true', '', '# only a comment']) {
        expect(Format.identifies(body, 'text'), body).to.equal(false);
      }
    });

    it('and JSON', () => {
      expect(Format.identifies('{"a": 1}', 'text')).to.equal(false);
    });
  });

  describe('identifies, for binary: the envelope\'s magic and a version byte', () => {
    it('takes DX and a version byte', () => {
      expect(Format.identifies(encodeBinary(new DXNMap([['a', 1n]])), 'binary')).to.equal(true);
      expect(Format.identifies(Uint8Array.of(0x44, 0x58, 1), 'binary')).to.equal(true);
    });

    it('takes nothing shorter, nothing else', () => {
      expect(Format.identifies(Uint8Array.of(0x44, 0x58), 'binary')).to.equal(false);
      expect(Format.identifies('%{a: 1}', 'binary')).to.equal(false);
      expect(Format.identifies(new Uint8Array(0), 'binary')).to.equal(false);
    });
  });
});
