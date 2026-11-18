'use strict';

/**
 * @fileoverview JavaScript code from DXNS (T686, design/codegen-node.md),
 * the port of dextrin's `Dextrin.Codegen.Elixir` and php-dextrin's
 * `Codegen\Php`. For each `%schema` of a tree of `.dxns` files
 * (`schema/tree.cjs`) it writes, under the output directory, one directory
 * per namespace part (`acme.shop/Order` is `Acme/Shop/`):
 *
 *   - `Order.js`, **the user's**: `export class Order extends
 *     AbstractOrder { static { this.verify(); } }`, written once and never
 *     rewritten; it may be renamed `Order.ts`. Hand-written upgrades and
 *     anything else of the user's own go here.
 *   - `AbstractOrder.js`, **the generator's**: plain ES-module JavaScript,
 *     rewritten on every run. Its frozen properties are the latest
 *     version's fields; it holds a reader and a checker per version
 *     (`readV1()`, `conformV1()`), an upgrade step between each version
 *     and the next, `read()`, which dispatches on the version a struct was
 *     written with, `validate()` and `toDxn()`. Every check is code of its
 *     own: no schema is read when it runs (`codegen-runtime`).
 *   - `AbstractOrder.d.ts`, its declarations, so TypeScript reads the
 *     classes exactly, and a missing hand-written upgrade is a compile
 *     error.
 *
 * And one `Decoder.js` (with its `.d.ts`): `decode()` decodes DXN text and
 * reads every struct of a known schema into its class.
 *
 * What is written by hand survives regenerating, in two places: the
 * user's file, and the generated file's regions (`regions.cjs`). Both
 * files start with `// dextrin:schema NAME`, by which a schema's files are
 * found again: its class is named and placed as the user's file has it,
 * and the generated parent follows that name and directory (`Purchase`
 * makes `AbstractPurchase`).
 */

const fs = require('node:fs');
const path = require('node:path');
const Tree = require('../schema/tree.cjs');
const Regions = require('./regions.cjs');
const { JsClass, Unsupported, GENERATED, str, words, capital } = require('./class.cjs');

/** @typedef {import('./class.cjs').ClassInfo} ClassInfo */
/** @typedef {[string, string, 'generated' | 'user']} File */
/** @typedef {{user?: string, cls?: string, gen?: string}} Known */

/**
 * Code could not be generated: the schemas do not load, a schema uses a
 * form the generator does not write yet, or two schemas would be given one
 * class. Every problem is listed, each naming its schema (and its file,
 * version and field, where it has them); nothing is written while there
 * is one.
 */
class CodegenError extends Error {
  /** @param {string[]} problems every problem found, in words */
  constructor(problems) {
    super(problems.join('\n'));
    this.name = 'CodegenError';
    /** @type {string[]} */
    this.problems = problems;
  }
}

/** The extensions a user's file may have, `.js` as written and `.ts` once renamed. */
const SOURCE = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/;
const DECLARATION = /\.d\.[cm]?ts$/;

/**
 * Generates the classes for the schemas under `roots` into `out`: the
 * generated files rewritten, the user's files written once. A generated
 * parent whose class the user renamed or moved goes with it; the old files
 * are removed.
 * @param {string[]} roots `.dxns` files or directories
 * @param {string} out the directory written into
 * @returns {string[]} the paths written, sorted
 * @throws {CodegenError} when the schemas do not load, or a schema can't be generated; nothing is written then
 */
function write(roots, out) {
  const { files, stale } = plan(roots, out);
  /** @type {string[]} */
  const written = [];
  for (const [file, content, kind] of files) {
    if (kind === 'user' && fs.existsSync(file)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    written.push(file);
  }
  for (const file of stale) fs.rmSync(file, { force: true });
  return written.sort();
}

/**
 * Whether the generated files under `out` are what `write` would write
 * now, with no orphaned region in them: every problem, each naming a file;
 * `[]` when there is none. For CI.
 * @param {string[]} roots `.dxns` files or directories
 * @param {string} out the directory generated into
 * @returns {string[]} the problems
 * @throws {CodegenError} when the schemas do not load, or a schema can't be generated
 */
function check(roots, out) {
  const { files, stale } = plan(roots, out);
  /** @type {string[]} */
  const problems = [];
  for (const [file, content, kind] of files) {
    if (kind !== 'generated') continue;
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (now === null) problems.push(`${file} is missing`);
    else if (now !== content) problems.push(`${file} is out of date with its schema`);
    for (const name of Regions.orphans(content)) problems.push(`${file} holds the orphaned region ${name}: move its code or delete it`);
  }
  for (const file of stale) problems.push(`${file} belongs to a class that has been renamed or moved: regenerate to remove it`);
  return problems;
}

/**
 * The orphaned regions of the files `write` wrote, `file: name` each: what
 * the command warns about.
 * @param {string[]} written @returns {string[]}
 */
function orphansIn(written) {
  return written
    .filter((file) => file.endsWith('.js') && fs.existsSync(file))
    .flatMap((file) => Regions.orphans(fs.readFileSync(file, 'utf8')).map((name) => `${file}: ${name}`));
}

/**
 * Every file, `[path, content, kind]`, and the generated files left from a
 * class since renamed or moved.
 * @param {string[]} roots @param {string} out
 * @returns {{files: File[], stale: string[]}}
 * @throws {CodegenError}
 */
function plan(roots, out) {
  const loaded = Tree.load(roots);
  if (!loaded.ok) throw new CodegenError(loaded.problems.map((p) => `${p.file}:${p.line}: ${p.message}`));
  const registry = loaded.registry;
  const names = Array.from(registry.structs.keys()).sort();

  const known = knownFiles(out);
  /** @type {Map<string, ClassInfo>} */
  const classes = new Map(names.map((name) => [name, classFor(name, out, known)]));
  refuseClashes(classes, out);

  /** @type {File[]} */
  const files = [];
  /** @type {string[]} */
  const stale = [];
  /** @type {string[]} */
  const problems = [];
  for (const name of names) {
    const versions = Array.from(/** @type {Map<number, import('../schema/compiled.cjs')>} */ (registry.structs.get(name)).values()).sort((a, b) => a.version - b.version);
    const info = /** @type {ClassInfo} */ (classes.get(name));
    let source;
    try {
      source = new JsClass(name, versions, info, classes, registry, importPath).source();
    } catch (err) {
      if (!(err instanceof Unsupported)) throw err;
      problems.push(`${name}(${err.version ?? versions[0].version}): ${err.message}`);
      continue;
    }
    const oldGen = known.get(name)?.gen ?? info.gen;
    const old = fs.existsSync(oldGen) ? fs.readFileSync(oldGen, 'utf8') : null;
    files.push([info.gen, Regions.merge(source.js, old), 'generated']);
    files.push([info.dts, source.dts, 'generated']);
    files.push([info.user, userFile(name, info), 'user']);
    if (oldGen !== info.gen) {
      for (const file of [oldGen, declarationOf(oldGen)]) if (fs.existsSync(file)) stale.push(file);
    }
  }
  if (problems.length > 0) throw new CodegenError(problems);
  const decoder = path.join(out, 'Decoder.js');
  files.unshift([decoder, decoderFile(classes, decoder), 'generated'], [declarationOf(decoder), decoderTypes(classes, decoder), 'generated']);
  return { files, stale };
}

// ---- names and paths, kept ---------------------------------------------------

/**
 * The files under `out` that say which schema they are: by schema, the
 * user's file with its class, and the generated file.
 * @param {string} out @returns {Map<string, Known>}
 * @throws {CodegenError} two files of one kind for one schema, or a user's file with no class
 */
function knownFiles(out) {
  /** @type {Map<string, Known>} */
  const known = new Map();
  /** @type {string[]} */
  const problems = [];
  for (const file of sourcesUnder(out)) {
    const text = fs.readFileSync(file, 'utf8');
    const id = /^\/\/ dextrin:schema (\S+)$/m.exec(text);
    if (!id) continue;
    const schema = id[1];
    const entry = known.get(schema) ?? {};
    known.set(schema, entry);
    const kind = text.startsWith(GENERATED) ? 'gen' : 'user';
    const already = kind === 'gen' ? entry.gen : entry.user;
    if (already) {
      problems.push(`${already} and ${file} are both the schema ${schema}`);
      continue;
    }
    if (kind === 'gen') {
      entry.gen = file;
      continue;
    }
    const cls = /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/m.exec(text);
    if (!cls) {
      problems.push(`${file} is the schema ${schema}, but exports no class`);
      continue;
    }
    entry.user = file;
    entry.cls = cls[1];
  }
  if (problems.length > 0) throw new CodegenError(problems);
  return known;
}

/** Every source file under `dir`, declarations and `node_modules` left out, sorted. @param {string} dir @returns {string[]} */
function sourcesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') found.push(...sourcesUnder(full));
    } else if (SOURCE.test(entry.name) && !DECLARATION.test(entry.name)) {
      found.push(full);
    }
  }
  return found.sort();
}

/**
 * A schema's class and files: as the user's file has them when there is
 * one, otherwise derived -- `acme.shop/Order` is `Order` in
 * `Acme/Shop/Order.js`, each namespace part a StudlyCase directory,
 * whatever case the DXNS namespace was written in.
 * @param {string} name @param {string} out @param {Map<string, Known>} known @returns {ClassInfo}
 */
function classFor(name, out, known) {
  const entry = known.get(name);
  let cls;
  let user;
  if (entry?.user && entry.cls) {
    cls = entry.cls;
    user = entry.user;
  } else {
    const slash = name.lastIndexOf('/');
    const parts = slash < 0 ? [] : name.slice(0, slash).split('.').map(identifier);
    cls = identifier(slash < 0 ? name : name.slice(slash + 1));
    user = path.join(out, ...parts, `${cls}.js`);
  }
  const gen = path.join(path.dirname(user), `Abstract${cls}.js`);
  return { name, cls, user, gen, dts: declarationOf(gen) };
}

/** A DXNS name part as a class or directory name: `order-line` is `OrderLine`, `shop` is `Shop`. @param {string} part @returns {string} */
function identifier(part) {
  const name = words(part).map(capital).join('');
  if (name === '') return '_';
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

/** The `.d.ts` beside a generated `.js`. @param {string} file @returns {string} */
function declarationOf(file) {
  return file.replace(/\.js$/, '.d.ts');
}

/**
 * The specifier `from` imports `to` by: relative, with `/`, and ending in
 * `.js` -- as TypeScript writes an import of a `.ts` file too.
 * @param {string} from @param {string} to @returns {string}
 */
function importPath(from, to) {
  let rel = path.relative(path.dirname(from), to).split(path.sep).join('/');
  rel = rel.replace(/\.[cm]?[jt]sx?$/, '.js');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Two schemas given one file, or one named like another's generated
 * parent, or like the decoder, are refused, naming both. Paths compare
 * without regard to case, as a case-insensitive file system does.
 * @param {Map<string, ClassInfo>} classes @param {string} out
 * @throws {CodegenError}
 */
function refuseClashes(classes, out) {
  /** @param {string} file */
  const shown = (file) => path.relative(out, file).split(path.sep).join('/').replace(/\.[cm]?[jt]sx?$/, '');
  /** @type {Map<string, string>} */
  const taken = new Map([['decoder', 'the generated decoder']]);
  /** @type {string[]} */
  const problems = [];
  for (const [name, info] of classes) {
    for (const [file, what] of [
      [info.user, `the schema ${name}`],
      [info.gen, `the generated parent of the schema ${name}`]
    ]) {
      const k = shown(file).toLowerCase();
      const before = taken.get(k);
      if (before !== undefined) problems.push(`${shown(file)} would be both ${before} and ${what}: rename one`);
      else taken.set(k, what);
    }
  }
  if (problems.length > 0) throw new CodegenError(problems);
}

// ---- the user's file and the decoder ---------------------------------------------

/** @param {string} name @param {ClassInfo} info @returns {string} */
function userFile(name, info) {
  return `// dextrin:schema ${name}

import { Abstract${info.cls} } from ${str(importPath(info.user, info.gen))};

/**
 * The schema ${name}. Its properties and methods come from
 * Abstract${info.cls}, which \`dextrin gen-js\` rewrites; this file is yours
 * and is never rewritten. A hand-written upgrade the schema needs is a
 * static method here, and the static block below fails when one is
 * missing.
 */
export class ${info.cls} extends Abstract${info.cls} {
  static {
    this.verify();
  }
}
`;
}

/**
 * Each schema's class as the decoder imports it: its local name and the
 * import line.
 * @param {Map<string, ClassInfo>} classes @param {string} decoder @param {boolean} types
 * @returns {{locals: Map<string, string>, imports: string[]}}
 */
function decoderImports(classes, decoder, types) {
  /** @type {Map<string, string>} */
  const locals = new Map();
  const taken = new Set();
  /** @type {string[]} */
  const imports = [];
  for (const [name, info] of classes) {
    let local = `$${info.cls}`;
    for (let n = 2; taken.has(local); n += 1) local = `$${info.cls}${n}`;
    taken.add(local);
    locals.set(name, local);
    imports.push(`import ${types ? 'type ' : ''}{ ${info.cls} as ${local} } from ${str(importPath(decoder, info.user))};`);
  }
  return { locals, imports };
}

/**
 * `Decoder.js`: DXN text decoded, every struct of a known schema read with
 * its class's generated `read()` -- no registry, so no schema at run time.
 * @param {Map<string, ClassInfo>} classes @param {string} decoder @returns {string}
 */
function decoderFile(classes, decoder) {
  const { locals, imports } = decoderImports(classes, decoder, false);
  const entries = Array.from(locals, ([name, local]) => `  ${str(name)}: ${local}`).join(',\n');
  const arms = Array.from(locals, ([name, local]) => `    case ${str(name)}:\n      return ${local}.read(value);`).join('\n');
  return `${GENERATED}.
// Regenerating rewrites it: do not edit it.

import { decode as decodeText, DXNStruct } from '@joetjen/dextrin';
import { Runtime } from '@joetjen/dextrin/codegen-runtime';
${imports.join('\n')}

/** @typedef {import('@joetjen/dextrin/codegen-runtime').ReadOptions} ReadOptions */
/** @typedef {ReadOptions & {registry?: InstanceType<typeof import('@joetjen/dextrin').Registry>, strict?: boolean, trusted?: boolean}} DecoderOptions */

/** The class generated for each schema, by schema name. */
export const CLASSES = Object.freeze({${entries === '' ? '' : `\n${entries}\n`}});

// Every class is checked as it is loaded: a class whose hand-written
// upgrade is missing fails here, whether or not its own file checks it.
for (const cls of /** @type {any[]} */ (Object.values(CLASSES))) cls.verify();

/**
 * \`text\` decoded, its structs read into the generated classes, wherever
 * they stand -- inside lists and maps too; any other value is left as it is
 * decoded. \`registry\`, \`strict\` and \`trusted\` are as \`decode\` of
 * \`@joetjen/dextrin\` takes them; \`deprecations\` and \`onDeprecated\` say how
 * what is deprecated warns, as each class's \`read()\` takes them.
 * @param {string} text the DXN text
 * @param {DecoderOptions} [options]
 * @returns {unknown} the value
 * @throws {import('@joetjen/dextrin').DXNError} when the text does not decode
 * @throws {InstanceType<typeof import('@joetjen/dextrin/codegen-runtime').InvalidData>} when a struct is refused
 */
export function decode(text, options = {}) {
  const { deprecations, onDeprecated, ...rest } = options;
  return read(decodeText(text, rest), { deprecations, onDeprecated });
}

/**
 * A decoded value with its structs read into the generated classes; the
 * options as each class's \`read()\` takes them.
 * @param {unknown} value the decoded value
 * @param {ReadOptions} [options]
 * @returns {unknown} the value, its structs read
 */
export function read(value, options) {
  return Runtime.reading(options, () => walk(value));
}

/** One value read, and every value inside it. @param {unknown} value @returns {unknown} */
function walk(value) {
  if (!(value instanceof DXNStruct)) return Runtime.walk(value, walk);
  switch (value.name) {
${arms}${arms === '' ? '' : '\n'}    default:
      return value;
  }
}
`;
}

/** `Decoder.d.ts`. @param {Map<string, ClassInfo>} classes @param {string} decoder @returns {string} */
function decoderTypes(classes, decoder) {
  const { locals, imports } = decoderImports(classes, decoder.replace(/\.js$/, '.d.ts'), true);
  const entries = Array.from(locals, ([name, local]) => `  readonly ${str(name)}: typeof ${local};`).join('\n');
  return `${GENERATED}.
// Regenerating rewrites it: do not edit it.

import type { Registry } from '@joetjen/dextrin';
import type { ReadOptions } from '@joetjen/dextrin/codegen-runtime';
${imports.join('\n')}

/** What \`decode()\` takes: \`decode\`'s options of @joetjen/dextrin, and how what is deprecated warns. */
export type DecoderOptions = ReadOptions & { registry?: InstanceType<typeof Registry>; strict?: boolean; trusted?: boolean };

/** The class generated for each schema, by schema name. */
export declare const CLASSES: {${entries === '' ? '' : `\n${entries}\n`}};

/** \`text\` decoded, its structs read into the generated classes, wherever they stand. */
export declare function decode(text: string, options?: DecoderOptions): unknown;

/** A decoded value with its structs read into the generated classes. */
export declare function read(value: unknown, options?: ReadOptions): unknown;
`;
}

module.exports = { write, check, orphansIn, CodegenError, GENERATED };
