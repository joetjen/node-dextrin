import { expect } from 'chai';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { SchemaDocs } from '../../src/dextrin.js';

// `SchemaDocs` and `dextrin docs`, as dextrin's `Dextrin.Schema.Docs`
// (Jan, 2026-10-20). The example is the reference's, and so is its
// generated `doc/`: every implementation must write it byte for byte.

/** Every file under `dir`, by its path relative to `dir`. @param {string} dir */
function filesUnder(dir) {
  /** @type {Map<string, string>} */
  const found = new Map();
  const walk = (/** @type {string} */ at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.set(relative(dir, path), readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return found;
}

/** The site for `files`, by page path. @param {{[path: string]: string}} files */
function site(files) {
  const root = mkdtempSync(join(tmpdir(), 'dextrin-docs-'));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return new Map(SchemaDocs.site(root, { title: 'T' }));
}

describe('SchemaDocs', () => {
  it('writes the example exactly as the reference does', () => {
    const expected = filesUnder('example/doc');
    const made = new Map(SchemaDocs.site('example/schemas', { title: 'Acme schemas' }));
    expect([...made.keys()].sort()).to.deep.equal([...expected.keys()].sort());
    for (const [path, content] of expected) expect(made.get(path), path).to.equal(content);
  });

  it('gives every directory of the site its own index.html', () => {
    const pages = site({ 'a.b.c.dxns': '%{T: :string}', 'x/y/Z-v1.dxns': '%{Z: %schema{v: :integer}}' });
    for (const path of pages.keys()) {
      const dir = dirname(path);
      expect(pages.has(dir === '.' ? 'index.html' : `${dir}/index.html`), dir).to.equal(true);
    }
  });

  it('refuses a document that is not a map, naming its file', () => {
    const root = mkdtempSync(join(tmpdir(), 'dextrin-docs-bad-'));
    writeFileSync(join(root, 'bad.dxns'), '[1 2]');
    expect(() => SchemaDocs.site(root)).to.throw(/bad\.dxns/);
  });
});
