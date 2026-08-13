import { createRequire } from 'node:module';
import { expect } from 'chai';
import * as esm from '../src/dextrin.js';

const require = createRequire(import.meta.url);
const cjs = require('../src/dextrin.cjs');

describe('dextrin (top-level API)', () => {
  describe('decode/encode', () => {
    it('decode parses .dxn text', () => {
      expect(esm.decode('%{x: 1, y: 2}')).to.be.instanceOf(Map);
    });

    it('encode prints a value back to single-line .dxn text', () => {
      const value = esm.decode('%{x: 1, y: 2}');
      expect(esm.encode(value)).to.equal('%{x:1,y:2}');
    });

    it('encode with pretty: true produces multi-line indented output', () => {
      const value = esm.decode('%{x: 1, y: 2}');
      expect(esm.encode(value, { pretty: true })).to.equal('%{\n  x: 1\n  y: 2\n}');
    });

    it('both directions round-trip the README example exactly', () => {
      const value = esm.decode('%{x: 1, y: 2}');
      expect(esm.encode(value)).to.equal('%{x:1,y:2}');
    });

    it('decode throws DXNError, not a bare parser error, on malformed input', () => {
      expect(() => esm.decode('%{x: }')).to.throw(esm.DXNError);
    });

    it('encode throws DXNError for a value with no DXN representation', () => {
      expect(() => esm.encode(() => {})).to.throw(esm.DXNError);
    });

    it('trusted: false decodes keyword as DXNKeyword instead of a global Symbol', () => {
      const value = esm.decode(':ok', { trusted: false });
      expect(value).to.be.instanceOf(esm.DXNKeyword);
    });
  });

  describe('dual entry-point parity', () => {
    it('exports the same set of names from both the CJS and ESM entry points', () => {
      const esmKeys = Object.keys(esm).filter((k) => k !== 'default').sort();
      const cjsKeys = Object.keys(cjs).sort();
      expect(esmKeys).to.deep.equal(cjsKeys);
    });

    it('decode/encode behave identically through both entry points', () => {
      const text = '%{a: 1, b: [1 2 3], c: :ok}';
      expect(esm.encode(esm.decode(text))).to.equal(cjs.encode(cjs.decode(text)));
    });
  });
});
