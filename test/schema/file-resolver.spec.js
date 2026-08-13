import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { forPaths } from '../../src/schema/file-resolver.cjs';
import Registry from '../../src/registry.js';

describe('schema/file-resolver', () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dextrin-file-resolver-'));
    writeFileSync(join(dir, 'Shapes.dxns'), '%{ Point: %schema{ fields: @ordered %{ x: :float, y: :float } } }');
    writeFileSync(join(dir, 'Solo.dxns'), '%{ Solo: %schema{ fields: @ordered %{ n: :integer } } }');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves Namespace/Name to <searchPath>/Namespace.dxns, entry Name', () => {
    const resolver = forPaths([dir]);
    const compiled = resolver('Shapes/Point');
    expect(compiled?.name).to.equal('Point');
    expect(compiled?.fieldNames()).to.deep.equal(['x', 'y']);
  });

  it('resolves a bare Name (no "/") to <searchPath>/Name.dxns, entry Name', () => {
    const resolver = forPaths([dir]);
    const compiled = resolver('Solo');
    expect(compiled?.name).to.equal('Solo');
  });

  it('returns undefined for a file that does not exist', () => {
    const resolver = forPaths([dir]);
    expect(resolver('NoSuchFile/Entry')).to.equal(undefined);
  });

  it('returns undefined for an entry name the file does not define', () => {
    const resolver = forPaths([dir]);
    expect(resolver('Shapes/NotDefined')).to.equal(undefined);
  });

  it('searches multiple paths in order, returning the first match', () => {
    const otherDir = mkdtempSync(join(tmpdir(), 'dextrin-file-resolver-2-'));
    try {
      writeFileSync(join(otherDir, 'Shapes.dxns'), '%{ Point: %schema{ fields: @ordered %{ z: :integer } } }');
      const resolver = forPaths([dir, otherDir]);
      // dir's Shapes.dxns (x/y) comes first, otherDir's (z) never reached
      expect(resolver('Shapes/Point')?.fieldNames()).to.deep.equal(['x', 'y']);
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('plugs into Registry#putResolver and Registry#fetchStructSchema', () => {
    const registry = new Registry().putResolver(forPaths([dir]));
    const found = registry.fetchStructSchema('Shapes/Point');
    expect(found?.compiled.name).to.equal('Point');
  });

  it('forwards predicates for refine-fn: in the loaded file', () => {
    writeFileSync(join(dir, 'Checked.dxns'), '%{ P: %schema{ refine-fn: check, fields: @ordered %{ x: :integer } } }');
    const predicate = (r) => (r.x > 0 ? true : 'must be positive');
    const resolver = forPaths([dir], { check: predicate });
    expect(resolver('Checked/P')?.refineFn).to.equal(predicate);
  });
});
