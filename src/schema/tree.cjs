'use strict';

/**
 * @fileoverview A tree of `.dxns` files read as one (Jan, 2026-10-20),
 * the port of `Dextrin.Schema.Tree`: every entry named from where its
 * file lies (DXN.md §4.6, `layout.cjs`), the files compiled in the order
 * their references need -- so a reference to another file's named type
 * resolves whatever order the files sort in -- and every problem
 * reported with its file and line:
 *
 * - a file that is not DXN, or not a map of names to definitions;
 * - a definition that does not compile;
 * - a versioned file holding another version, and one version of a name
 *   held by two files;
 * - files that need each other (a cycle across files is not resolved yet);
 * - **a name that resolves to nothing** -- a typo such as
 *   `acme.comon/Money` -- unless its namespace is declared `extern`.
 *
 * `dextrin check` is this, for CI.
 */

const fs = require('node:fs');
const path = require('node:path');
const parser = require('../text/parser.cjs');
const Registry = require('../registry.cjs');
const Compiler = require('./compiler.cjs');
const Layout = require('./layout.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const DXNSymbol = require('../values/symbol.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNList = require('../values/list.cjs');
const DXNStruct = require('../values/struct.cjs');

/** @typedef {{file: string, line: number, message: string}} Problem */
/** @typedef {{file: string, source: string, doc: Map<unknown, unknown>, keys: string[], layout: import('./layout.cjs').Layout}} TreeFile */

/**
 * Every `.dxns` file under `roots` (files or directories, searched
 * recursively), compiled into one registry: `{ok: true, registry,
 * summary}`, or `{ok: false, problems}` with every problem found, in file
 * and line order. `extern` lists namespaces whose names are known to be
 * supplied elsewhere.
 * @param {string[]} roots
 * @param {{registry?: Registry, extern?: string[]}} [opts]
 * @returns {{ok: true, registry: Registry, summary: {files: number, definitions: number}} | {ok: false, problems: Problem[]}}
 */
function load(roots, opts = {}) {
  const base = opts.registry ?? new Registry();
  const extern = opts.extern ?? [];
  /** @type {Problem[]} */
  const problems = [];
  const files = read(roots, problems);
  for (const file of files) {
    const p = versionProblem(file);
    if (p) problems.push(p);
  }
  const index = indexOf(files);
  problems.push(...twice(index));
  const ordered = order(files, index, problems);
  const registry = compiled(ordered, base, problems);
  problems.push(...unknown(ordered, registry, index, extern));

  if (problems.length === 0) {
    return { ok: true, registry, summary: { files: files.length, definitions: files.reduce((n, f) => n + f.keys.length, 0) } };
  }
  problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return { ok: false, problems };
}

/**
 * The named types `roots` define, compiled as `load` compiles them but
 * past any problem -- what a file of the tree needs from the others when
 * it is compiled on its own (`file-resolver.cjs`).
 * @param {string[]} roots
 * @returns {Map<string, unknown>}
 */
function namedTypes(roots) {
  const files = read(roots, []);
  const ordered = order(files, indexOf(files), []);
  return compiled(ordered, new Registry(), []).typeAliases;
}

// ---- reading -------------------------------------------------------------------

/** @param {string[]} roots @param {Problem[]} problems @returns {TreeFile[]} */
function read(roots, problems) {
  /** @type {TreeFile[]} */
  const files = [];
  for (const [root, relative] of roots.flatMap(filesUnder)) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    let doc;
    try {
      doc = parser.parse(source);
    } catch (err) {
      const e = /** @type {any} */ (err);
      problems.push(problem(relative, lineAt(source, e.offset), e.message));
      continue;
    }
    if (!(doc instanceof Map)) {
      problems.push(problem(relative, 1, 'a .dxns document is a map of names to definitions'));
      continue;
    }
    const keys = Array.from(doc.keys(), keyName);
    files.push({ file: relative, source, doc, keys, layout: Layout.of(relative, keys) });
  }
  return files;
}

/** @param {string} root @returns {Array<[string, string]>} */
function filesUnder(root) {
  if (fs.statSync(root).isDirectory()) {
    return walk(root, '').sort().map((rel) => [root, rel]);
  }
  return [[path.dirname(root), path.basename(root)]];
}

/** @param {string} root @param {string} rel @returns {string[]} */
function walk(root, rel) {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((d) => {
    const next = rel === '' ? d.name : `${rel}/${d.name}`;
    if (d.isDirectory()) return walk(root, next);
    return d.name.endsWith('.dxns') ? [next] : [];
  });
}

/** @param {unknown} key @returns {string} */
function keyName(key) {
  if (key instanceof DXNKeyword || key instanceof DXNSymbol) return key.name;
  if (typeof key === 'symbol') return Symbol.keyFor(key) ?? key.description ?? '';
  return String(key);
}

/** @param {TreeFile} file @param {string} key */
function held(file, key) {
  for (const [k, v] of file.doc) if (keyName(k) === key) return v;
  return undefined;
}

// ---- layout ------------------------------------------------------------------

/** A versioned file holds its entry as the version its name says. @param {TreeFile} file */
function versionProblem(file) {
  const { holder, version } = file.layout;
  if (holder === null || version === null) return null;
  const value = held(file, holder);
  if (value instanceof DXNStruct && value.name === 'schema') {
    const v = value.version ?? 1;
    return v === version
      ? null
      : problem(file.file, entryLine(file, holder), `holds ${holder} as version ${v}, but its name says version ${version} (DXN.md §4.6)`);
  }
  return problem(file.file, entryLine(file, holder), `a versioned file holds a %schema(N), not ${holder}'s kind`);
}

// ---- names across files ------------------------------------------------------

/** @param {unknown} value @returns {number | 'type'} */
function versionOf(value) {
  return value instanceof DXNStruct && value.name === 'schema' ? value.version ?? 1 : 'type';
}

/** Every full name the tree defines, with the files and versions defining it. @param {TreeFile[]} files */
function indexOf(files) {
  /** @type {Map<string, Array<[string, number | 'type']>>} */
  const index = new Map();
  for (const file of files) {
    for (const [key, name] of file.layout.names) {
      const holders = index.get(name) ?? [];
      holders.push([file.file, versionOf(held(file, key))]);
      index.set(name, holders);
    }
  }
  return index;
}

/** One version of a name in two files (§4.6): found once, or refused naming both. @param {Map<string, Array<[string, number | 'type']>>} index */
function twice(index) {
  /** @type {Problem[]} */
  const found = [];
  for (const [name, holders] of index) {
    /** @type {Map<number | 'type', string[]>} */
    const byVersion = new Map();
    for (const [file, version] of holders) byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    for (const [version, files] of byVersion) {
      if (files.length < 2) continue;
      files.sort();
      const what = version === 'type' ? name : `${name} version ${version}`;
      found.push(problem(/** @type {string} */ (files[0]), 1, `${what} is in two files, ${files.join(' and ')}; it is found once (DXN.md §4.6)`));
    }
  }
  return found;
}

/**
 * The files in an order that compiles each after every file it refers
 * to; files that need each other are a problem, and are left out.
 * @param {TreeFile[]} files @param {Map<string, Array<[string, number | 'type']>>} index @param {Problem[]} problems
 */
function order(files, index, problems) {
  const needs = new Map(files.map((f) => [f.file, needsOf(f, index)]));
  /** @type {string[]} */
  const done = [];
  let pending = files.map((f) => f.file);
  while (pending.length > 0) {
    const ready = pending.filter((f) => (needs.get(f) ?? []).every((n) => done.includes(n)));
    if (ready.length === 0) {
      const cycle = [...pending].sort();
      problems.push(problem(/** @type {string} */ (cycle[0]), 1, `these files need each other, which is not resolved yet: ${cycle.join(', ')}`));
      break;
    }
    done.push(...ready);
    pending = pending.filter((f) => !ready.includes(f));
  }
  const byFile = new Map(files.map((f) => [f.file, f]));
  return done.map((f) => /** @type {TreeFile} */ (byFile.get(f)));
}

/** The other files `file` refers to. @param {TreeFile} file @param {Map<string, Array<[string, number | 'type']>>} index */
function needsOf(file, index) {
  const out = new Set();
  for (const value of file.doc.values()) {
    for (const written of symbols(value)) {
      const name = file.layout.names.get(written) ?? written;
      for (const [holder] of index.get(name) ?? []) if (holder !== file.file) out.add(holder);
    }
  }
  return /** @type {string[]} */ ([...out]);
}

/** @param {unknown} value @returns {string[]} */
function symbols(value) {
  if (value instanceof DXNSymbol) return [value.name];
  if (value instanceof DXNTuple || value instanceof DXNList) return value.items.flatMap(symbols);
  if (Array.isArray(value)) return value.flatMap(symbols);
  if (value instanceof DXNStruct) {
    return value.fields.type === 'keyed' ? value.fields.pairs.flatMap(([, v]) => symbols(v)) : value.fields.values.flatMap(symbols);
  }
  if (value instanceof Map) return Array.from(value.values()).flatMap(symbols);
  return [];
}

// ---- compiling -----------------------------------------------------------------

/** @param {TreeFile[]} files @param {Registry} base @param {Problem[]} problems */
function compiled(files, base, problems) {
  let registry = base;
  for (const file of files) {
    try {
      registry = Compiler.compile(file.doc, registry, file.layout.names);
    } catch (err) {
      const e = /** @type {any} */ (err);
      // Reported up front, naming both files (`twice`).
      if (e.category === 'schema/duplicate-version') continue;
      problems.push(problem(file.file, errorLine(file, e.message), e.message));
    }
  }
  return registry;
}

/** The line of the entry a compile error names. @param {TreeFile} file @param {string} message */
function errorLine(file, message) {
  const m = /^(?:schema|named type) "([^"]+)"/.exec(message);
  if (!m) return 1;
  for (const [key, full] of file.layout.names) if (full === m[1]) return entryLine(file, key);
  return 1;
}

// ---- names that resolve to nothing --------------------------------------------

/** @param {TreeFile[]} files @param {Registry} registry @param {Map<string, unknown>} index @param {string[]} extern */
function unknown(files, registry, index, extern) {
  /** @type {Problem[]} */
  const found = [];
  const seen = new Set();
  for (const file of files) {
    for (const [, name] of file.layout.names) {
      for (const reference of new Set(referencesOf(registry, name))) {
        if (registry.structs.has(reference) || index.has(reference) || isExtern(reference, extern)) continue;
        const p = problem(file.file, mentionLine(file, reference), `${reference} names nothing in this tree (declare its namespace extern if it is defined elsewhere)`);
        const key = `${p.file}:${p.line}:${p.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push(p);
        }
      }
    }
  }
  return found;
}

/** @param {Registry} registry @param {string} name @returns {string[]} */
function referencesOf(registry, name) {
  const alias = registry.typeAliases.get(name);
  if (alias) return typeReferences(alias);
  const versions = registry.structs.get(name);
  if (!versions) return [];
  return Array.from(versions.values()).flatMap((c) => /** @type {any} */ (c).fields.flatMap((/** @type {any} */ f) => typeReferences(f.type)));
}

/** @param {any} type @returns {string[]} */
function typeReferences(type) {
  if (!type || typeof type !== 'object') return [];
  switch (type.form) {
    case 'reference':
      return [type.name];
    case 'shape':
      return type.fields.flatMap((/** @type {any} */ f) => typeReferences(f.type));
    case 'case':
      return [type.otherwise, ...type.branches.map((/** @type {[unknown, any]} */ [, t]) => t)].flatMap(typeReferences);
    case 'generic':
      return typeReferences(type.body);
    case 'apply':
      return type.args.flatMap(typeReferences);
    case 'refine':
      return typeReferences(type.base);
    case 'tuple-of':
      return type.elems.flatMap(typeReferences);
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return type.variants.flatMap(typeReferences);
    case 'map-of':
    case 'ordered-map-of':
      return [...typeReferences(type.key), ...typeReferences(type.value)];
    default:
      return type.elem ? typeReferences(type.elem) : [];
  }
}

/** @param {string} name @param {string[]} extern */
function isExtern(name, extern) {
  const slash = name.indexOf('/');
  if (slash === -1) return false;
  const namespace = name.slice(0, slash);
  return extern.some((e) => namespace === e || namespace.startsWith(`${e}.`));
}

// ---- lines ---------------------------------------------------------------------

/** @param {string} file @param {number} line @param {string} message @returns {Problem} */
function problem(file, line, message) {
  return { file, line, message };
}

/** @param {string} source @param {unknown} offset */
function lineAt(source, offset) {
  if (typeof offset !== 'number' || offset < 0) return 1;
  return source.slice(0, offset).split('\n').length;
}

/** @param {string} text */
function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The line an entry's key stands on. @param {TreeFile} file @param {string} key */
function entryLine(file, key) {
  return firstLine(file.source, new RegExp(`^\\s*(?:"${escape(key)}"\\s*=>|:?${escape(key)}\\??\\s*:)`, 'm')) ?? 1;
}

/** The first line that mentions `name`, as a written reference. @param {TreeFile} file @param {string} name */
function mentionLine(file, name) {
  const short = /** @type {string} */ (name.split('/').pop());
  for (const candidate of [name, short]) {
    const line = firstLine(file.source, new RegExp(`(?<![\\w./])${escape(candidate)}(?![\\w.])`));
    if (line !== null) return line;
  }
  return 1;
}

/** @param {string} source @param {RegExp} pattern @returns {number | null} */
function firstLine(source, pattern) {
  const m = pattern.exec(source);
  return m ? source.slice(0, m.index).split('\n').length : null;
}

module.exports = { load, namedTypes };
