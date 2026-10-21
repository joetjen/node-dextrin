'use strict';

/**
 * @fileoverview A resolver (`Registry#putResolver`) finding a struct's
 * schema in `.dxns` files on disk, by the convention DXN.md §4.6 states
 * for every implementation -- so one set of schema files serves them all.
 * Mirrors `Dextrin.Schema.FileResolver`. Swappable like any resolver:
 * anyone with another convention writes their own.
 *
 * **The convention.** A name is segments joined by `.`, with at most one
 * `/` between a namespace and a name (`Foo.Bar/Baz`); every segment is a
 * directory but the last, which names the file. A schema of version `N`
 * named `Foo.Bar/Baz` is looked for, on each search path in order, in
 *
 * - `Foo/Bar/Baz-vN.dxns` (version 1 also `Foo/Bar/Baz.dxns`),
 * - `Foo/Bar/Baz/vN.dxns`,
 * - `Foo.Bar.Baz-vN.dxns` (version 1 also `Foo.Bar.Baz.dxns`),
 * - and the entry `Baz` in `Foo.Bar.dxns`, by its `%schema(N)`;
 *
 * a name with no `/` is its own namespace: `Money` in `Money.dxns`.
 *
 * - **The first search path that has the name at all decides.**
 * - **A file's version is its schema's**, or the file is refused.
 * - **One version is found once**: two files holding the same version
 *   are refused, naming both.
 * - **Every version found is loaded**, so an older struct reaches the
 *   materializer.
 *
 * A refusal is a thrown `SchemaCompileError` (`schema/compile`).
 */

const fs = require('node:fs');
const path = require('node:path');
const parser = require('../text/parser.cjs');
const Compiler = require('./compiler.cjs');
const Tree = require('./tree.cjs');
const Layout = require('./layout.cjs');
const Compiled = require('./compiled.cjs');
const Registry = require('../registry.cjs');

const { SchemaCompileError } = Compiler;

/**
 * A resolver searching `searchPaths` in order.
 * @param {string[]} searchPaths
 * @returns {(name: string) => Compiled[] | undefined}
 */
function forPaths(searchPaths) {
  return (name) => {
    for (const dir of searchPaths) {
      const found = inPath(dir, name);
      if (found) return found;
    }
    return undefined;
  };
}

/**
 * Every version of `name` `dir` holds, each under the name asked for, or
 * undefined when it holds none, so the next search path is asked.
 * @param {string} dir
 * @param {string} name
 * @returns {Compiled[] | undefined}
 */
function inPath(dir, name) {
  const { entry, candidates } = candidatesFor(dir, name);
  const found = candidates.flatMap(({ file, expected }) => load(file, entry, expected, dir, name));
  if (found.length === 0) return undefined;
  /** @type {Map<number, string[]>} */
  const holders = new Map();
  for (const { version, file } of found) holders.set(version, [...(holders.get(version) ?? []), file]);
  for (const [version, files] of holders) {
    if (files.length > 1) {
      throw new SchemaCompileError(
        `${name} version ${version} is in two files, ${[...files].sort().join(' and ')}; it is found once (DXN.md §4.6)`
      );
    }
  }
  return found.map(({ compiled }) => new Compiled({ name, version: compiled.version, fields: compiled.fields }));
}

/**
 * The entry a file holds the schema under -- the name after its `/`, or
 * the whole name when it has none -- and every file that may hold it,
 * with the version its name says (`'any'` for the namespace file).
 * @param {string} dir
 * @param {string} name
 * @returns {{entry: string, candidates: Array<{file: string, expected: number | 'any'}>}}
 */
function candidatesFor(dir, name) {
  const slash = name.indexOf('/');
  const namespace = slash === -1 ? null : name.slice(0, slash);
  const entry = slash === -1 ? name : name.slice(slash + 1);
  const segments = name.split(/[/.]/);
  const stem = /** @type {string} */ (segments[segments.length - 1]);
  const nested = path.join(dir, ...segments.slice(0, -1));
  const flat = path.join(dir, segments.join('.'));

  /** @type {Array<{file: string, expected: number | 'any'}>} */
  const all = [
    // One file, one candidate: a name without a namespace is both its own
    // version-1 file and its namespace file, and is read as the latter.
    { file: path.join(dir, `${namespace ?? entry}.dxns`), expected: 'any' },
    { file: path.join(nested, `${stem}.dxns`), expected: 1 },
    { file: `${flat}.dxns`, expected: 1 },
    ...numbered(nested, `${stem}-v`),
    ...numbered(path.join(nested, stem), 'v'),
    ...numbered(path.dirname(flat), `${path.basename(flat)}-v`),
  ];
  const seen = new Set();
  const candidates = all.filter(({ file }) => {
    const key = path.resolve(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { entry, candidates };
}

/**
 * The files in `dir` named `<prefix>N.dxns`, each with its version `N`.
 * @param {string} dir
 * @param {string} prefix
 * @returns {Array<{file: string, expected: number}>}
 */
function numbered(dir, prefix) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const shape = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\.dxns$`);
  return names.flatMap((file) => {
    const m = shape.exec(file);
    const version = m ? Number(m[1]) : 0;
    return version > 0 ? [{ file: path.join(dir, file), expected: version }] : [];
  });
}

/**
 * The versions of `entry` in the file `file`: none when the file is not
 * there or holds no such entry. A file that does not compile, or holds
 * another version than its name says, is refused.
 *
 * The file is compiled as a tree compiles it (`tree.cjs`): its entries
 * under their full names (DXN.md §4.6), over the named types the rest of
 * its search path `dir` defines -- so a field naming another file's
 * shape or named type resolves.
 * @param {string} file
 * @param {string} entry
 * @param {number | 'any'} expected
 * @param {string} dir
 * @param {string} name
 * @returns {Array<{version: number, compiled: Compiled, file: string}>}
 */
function load(file, entry, expected, dir, name) {
  let source;
  try {
    if (!fs.statSync(file).isFile()) return [];
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let registry;
  try {
    const doc = parser.parse(source);
    let base = new Registry();
    for (const [n, t] of Tree.namedTypes([dir])) base = base.putTypeAlias(n, t);
    const relative = path.relative(dir, file).split(path.sep).join('/');
    const keys = doc instanceof Map ? Array.from(doc.keys(), (k) => (k && typeof k === 'object' && 'name' in k ? String(k.name) : String(k))) : [];
    registry = Compiler.compile(doc, base, Layout.of(relative, keys).names);
  } catch (err) {
    throw new SchemaCompileError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const versions = registry.structs.get(name) ?? registry.structs.get(entry);
  if (!versions || versions.size === 0) return [];
  if (expected !== 'any' && !(versions.size === 1 && versions.has(expected))) {
    throw new SchemaCompileError(
      `${file} holds ${entry} as version ${[...versions.keys()].join(', ')}, but its name says version ${expected} (DXN.md §4.6)`
    );
  }
  return [...versions].map(([version, compiled]) => ({ version, compiled, file }));
}

module.exports = { forPaths };
