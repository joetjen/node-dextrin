import { createRequire } from 'node:module';
import { expect } from 'chai';
import * as esm from '../../src/values/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../../src/values/index.cjs');

describe('values barrel dual entry-point parity', () => {
  it('exports the same set of names from both the CJS and ESM entry points', () => {
    const esmKeys = Object.keys(esm).sort();
    const cjsKeys = Object.keys(cjs).sort();
    expect(esmKeys).to.deep.equal(cjsKeys);
  });

  it('exports the same classes (by reference) from both entry points', () => {
    for (const key of Object.keys(cjs)) {
      expect(/** @type {any} */ (esm)[key]).to.equal(cjs[key]);
    }
  });
});
