import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect } from 'chai';
import { forPaths } from '../../src/schema/file-resolver.cjs';
import Registry from '../../src/registry.js';
import { decode, DXNError } from '../../src/dextrin.js';

// The file convention of DXN.md §4.6, as the reference follows it
// (dextrin fd34537): versioned files in three layouts and the namespace
// file, the first search path deciding, a file's version its schema's,
// one version found once, every version loaded.
describe('schema/file-resolver', () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dextrin-file-resolver-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (relative, source) => {
    const file = join(dir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  };
  const resolved = (text) => decode(text, { registry: new Registry().putResolver(forPaths([dir])) });
  const category = (fn) => {
    try {
      fn();
    } catch (err) {
      expect(err).to.be.instanceOf(DXNError);
      return err.category;
    }
    throw new Error('expected a refusal');
  };

  describe('the namespace file, as before', () => {
    it('resolves Namespace/Name to Namespace.dxns, entry Name, under the name asked for', () => {
      write('Shapes.dxns', '%{ Point: %schema{ x: :float, y: :float } }');
      const [compiled] = forPaths([dir])('Shapes/Point');
      expect([compiled.name, compiled.fieldNames()]).to.deep.equal(['Shapes/Point', ['x', 'y']]);
    });

    it('a bare Name resolves to Name.dxns', () => {
      write('Solo.dxns', '%{ Solo: %schema{ n: :integer } }');
      expect(forPaths([dir])('Solo')?.[0].name).to.equal('Solo');
    });

    it('answers undefined for a file that is not there, or an entry it lacks', () => {
      write('Shapes.dxns', '%{ Point: %schema{ x: :float } }');
      expect(forPaths([dir])('NoSuchFile/Entry')).to.equal(undefined);
      expect(forPaths([dir])('Shapes/NotDefined')).to.equal(undefined);
    });

    it('searches multiple paths in order, the first that has the name deciding', () => {
      const other = mkdtempSync(join(tmpdir(), 'dextrin-file-resolver-2-'));
      try {
        write('Shapes.dxns', '%{ Point: %schema{ x: :integer, y: :integer } }');
        writeFileSync(join(other, 'Shapes.dxns'), '%{ Point: %schema{ z: :integer } }');
        expect(forPaths([dir, other])('Shapes/Point')?.[0].fieldNames()).to.deep.equal(['x', 'y']);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });
  });

  describe('versions, and dotted names', () => {
    it('a dotted, namespaced name is a directory of versioned files', () => {
      write('Foo/Bar/Baz-v1.dxns', '%{Baz: %schema{a: :integer}}');
      write('Foo/Bar/Baz-v2.dxns', '%{Baz: %schema(2){a: :integer, b?: :string}}');
      const value = resolved('%Foo.Bar/Baz(2){a: 1}');
      expect([value.name, value.version]).to.deep.equal(['Foo.Bar/Baz', 2]);
    });

    it("version 1's -v1 is optional", () => {
      write('Foo/Bar/Baz.dxns', '%{Baz: %schema{a: :integer}}');
      expect(resolved('%Foo.Bar/Baz{a: 1}').version).to.equal(1);
    });

    it('a directory per name holds its versions', () => {
      write('Foo/Bar/Baz/v1.dxns', '%{Baz: %schema{a: :integer}}');
      write('Foo/Bar/Baz/v3.dxns', '%{Baz: %schema(3){a: :integer}}');
      expect(resolved('%Foo.Bar/Baz{a: 1}').version).to.equal(3);
    });

    it('and a flat directory names them with dots', () => {
      write('Foo.Bar.Baz-v2.dxns', '%{Baz: %schema(2){a: :integer}}');
      expect(resolved('%Foo.Bar/Baz{a: 1}').version).to.equal(2);
    });

    it('every version is loaded, so an older struct reaches the materializer', () => {
      write('Foo/Bar/Baz-v1.dxns', '%{Baz: %schema{a: :integer}}');
      write('Foo/Bar/Baz-v2.dxns', '%{Baz: %schema(2){a: :integer, b?: :string}}');
      expect(category(() => resolved('%Foo.Bar/Baz(1){a: 1}'))).to.equal('schema/no-materializer');
    });

    it('a file whose schema is not the version its name says is refused', () => {
      write('Foo/Bar/Baz-v2.dxns', '%{Baz: %schema(3){a: :integer}}');
      expect(category(() => resolved('%Foo.Bar/Baz{a: 1}'))).to.equal('schema/compile');
    });

    it('one version found in two files is refused, naming both', () => {
      write('Foo/Bar/Baz-v2.dxns', '%{Baz: %schema(2){a: :integer}}');
      write('Foo/Bar/Baz/v2.dxns', '%{Baz: %schema(2){a: :integer}}');
      try {
        resolved('%Foo.Bar/Baz{a: 1}');
      } catch (err) {
        expect(err.category).to.equal('schema/compile');
        expect(err.message).to.include('Baz-v2.dxns').and.to.include('v2.dxns');
        return;
      }
      throw new Error('expected a refusal');
    });

    it('and so is a versioned file beside the namespace file holding the same version', () => {
      write('Foo.Bar.dxns', '%{Baz: %schema(2){a: :integer}}');
      write('Foo/Bar/Baz-v2.dxns', '%{Baz: %schema(2){a: :integer}}');
      expect(category(() => resolved('%Foo.Bar/Baz{a: 1}'))).to.equal('schema/compile');
    });

    it('the namespace file keeps working with dotted namespaces', () => {
      write('Foo.Bar.dxns', '%{Baz: %schema(2){a: :integer}}');
      expect(resolved('%Foo.Bar/Baz{a: 1}').version).to.equal(2);
    });
  });
});
