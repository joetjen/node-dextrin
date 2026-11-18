#!/usr/bin/env node

/**
 * @fileoverview `dextrin` CLI — one executable, eleven subcommands
 * (`decode`, `encode`, `format`, `validate`, `compat`, `check`, `docs`,
 * `from-json-schema`, `from-typespec`, `gen-js`, `conformance`), the JS analog of
 * `dextrin`'s `mix dextrin.*` tasks. One bin with subcommands rather
 * than a separate script per task, matching how Node CLIs are
 * conventionally shaped (`git <subcommand>`), not a mechanical
 * per-file port of the Mix task layout.
 *
 * Two Mix tasks have no analog here, deliberately:
 *   - `mix dextrin.gen.unicode` regenerates `dextrin`'s own generated
 *     grammar's Unicode identifier ranges from UCD data — this
 *     project's lexer uses JS's native `\p{ID_Start}`/`\p{ID_Continue}`
 *     regex properties directly instead (see `src/text/lexer.cjs`'s
 *     own doc), so there is no generated-ranges file to regenerate.
 *   - `mix dextrin.gen.schema` scaffolds a `.dxns` file from an
 *     existing Elixir struct via `Map.from_struct/1` reflection —
 *     JS classes have no equivalent field-reflection mechanism to
 *     scaffold from.
 *
 * `mix dextrin.encode`'s `--share` flag also has no analog: the
 * `.dxnb` encoder doesn't produce `DXN.md` §2.5 value-sharing output
 * yet (decode-only for now, see `src/binary/encoder.cjs`'s own note).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { decode, encode, decodeBinary, encodeBinary, answer, DXNError, Schema, Registry, Document, SchemaDocs, SchemaTree, JsonSchema } from '../src/dextrin.js';
import Codegen from '../src/codegen/javascript.cjs';

const USAGE = `usage: dextrin <command> [options]

Commands:
  decode PATH [--out PATH]                    Decode .dxnb binary to .dxn text (pretty-printed)
  encode PATH [--out PATH]                     Encode .dxn text to .dxnb binary
  format PATH [--mode pretty|condense] [--in-place]
                                                Reformat a .dxn file
  validate PATH [--format text|binary] [--schema PATH --as NAME]
                                                Validate a .dxn/.dxnb file, optionally against a schema
  compat OLD NEW                               Check that changed schemas have new versions (each a .dxns file or directory)
  check SCHEMAS... [--extern NAMESPACE]... [--warnings-as-errors]
                                                Check a tree of .dxns schemas: syntax, compiling, layout and names
  docs SCHEMAS [--out DIR] [--title TITLE]     Write HTML documentation for a directory of .dxns schemas
  from-json-schema SCHEMA... [--out FILE] [--name N] [--schemas DIR] [--draft D]
                   [--mongo] [--structs] [--assert-formats] [--strict]
                                                Convert JSON Schema (and MongoDB's $jsonSchema) to DXNS
  from-typespec MAIN.tsp [--out DIR]           Convert TypeSpec to DXNS with @joetjen/dextrin-typespec (Node 22)
  gen-js SCHEMAS... --out DIR [--check]        Generate JavaScript classes (with .d.ts) that read and check every version of the schemas
  conformance REQUEST ANSWER                   Answer a Dextrin Conformance Suite request

Run with no PATH, or an unrecognized command, to see this message.`;

/** @param {string[]} argv */
function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'decode':
      return run(() => cmdDecode(rest));
    case 'encode':
      return run(() => cmdEncode(rest));
    case 'format':
      return run(() => cmdFormat(rest));
    case 'validate':
      return run(() => cmdValidate(rest));
    case 'compat':
      return run(() => cmdCompat(rest));
    case 'docs':
      return run(() => cmdDocs(rest));
    case 'check':
      return run(() => cmdCheck(rest));
    case 'from-json-schema':
      return run(() => cmdFromJsonSchema(rest));
    case 'from-typespec':
      return run(() => cmdFromTypespec(rest));
    case 'gen-js':
      return run(() => cmdGenJs(rest));
    case 'conformance':
      return run(() => cmdConformance(rest));
    default:
      console.log(USAGE);
      process.exitCode = command === undefined ? 0 : 1;
  }
}

/**
 * Runs one subcommand, catching anything it throws (a bad `PATH`, a
 * `DXNError`, a schema violation, a plain usage error) and reporting
 * it uniformly — every command's own body can just `throw` and let
 * this be the one place that turns that into a clean message and a
 * non-zero exit code, rather than each command repeating the same
 * try/catch shape.
 * @param {() => void} fn
 */
function run(fn) {
  try {
    fn();
  } catch (err) {
    console.error(describeError(err));
    process.exitCode = 1;
  }
}

/** @param {unknown} err @returns {string} */
function describeError(err) {
  if (err instanceof DXNError) return err.offset !== undefined ? `${err.message} (at byte offset ${err.offset})` : err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Hand-rolled, dependency-free argv parsing — the CLI's own option
 * surface is small and fixed per subcommand, so a parser-generator
 * library would be an unneeded dependency for what a few `switch`
 * cases already do plainly.
 * @param {string[]} argv
 * @param {{flags?: string[], options?: string[]}} spec
 */
function parseArgs(argv, { flags = [], options = [] } = {}) {
  /** @type {string[]} */
  const positional = [];
  /** @type {{[k: string]: boolean}} */
  const flagValues = {};
  /** @type {{[k: string]: string}} */
  const optionValues = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const name = arg.startsWith('--') ? arg.slice(2) : null;
    if (name && flags.includes(name)) {
      flagValues[name] = true;
    } else if (name && options.includes(name)) {
      i += 1;
      optionValues[name] = argv[i];
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags: flagValues, options: optionValues };
}

/**
 * @param {string} text
 * @param {string | undefined} outPath
 */
function writeText(text, outPath) {
  if (outPath) writeFileSync(outPath, text);
  else console.log(text);
}

/**
 * @param {Buffer} bytes
 * @param {string | undefined} outPath
 */
function writeBinary(bytes, outPath) {
  if (outPath) writeFileSync(outPath, bytes);
  else process.stdout.write(bytes);
}

/** @param {string[]} argv */
function cmdDecode(argv) {
  const { positional, options } = parseArgs(argv, { options: ['out'] });
  if (positional.length !== 1) throw new Error('usage: dextrin decode PATH [--out PATH]');
  const bytes = readFileSync(positional[0]);
  const value = decodeBinary(bytes);
  writeText(encode(value, { pretty: true }), options.out);
}

/** @param {string[]} argv */
function cmdEncode(argv) {
  const { positional, options } = parseArgs(argv, { options: ['out'] });
  if (positional.length !== 1) throw new Error('usage: dextrin encode PATH [--out PATH]');
  const source = readFileSync(positional[0], 'utf8');
  const value = decode(source);
  writeBinary(encodeBinary(value), options.out);
}

/** @param {string[]} argv */
function cmdFormat(argv) {
  const { positional, flags, options } = parseArgs(argv, { flags: ['in-place'], options: ['mode'] });
  if (positional.length !== 1) throw new Error('usage: dextrin format PATH [--mode pretty|condense] [--in-place]');
  const [path] = positional;
  const mode = options.mode ?? 'pretty';
  if (mode !== 'pretty' && mode !== 'condense') {
    throw new Error(`unrecognized --mode ${JSON.stringify(mode)} — expected "pretty" or "condense"`);
  }
  // Pretty lays the document out and keeps its comments; condensed
  // output is one line, which no comment fits on, so it reprints the
  // value.
  const doc = Document.parse(readFileSync(path, 'utf8'));
  const text = mode === 'pretty' ? Document.format(doc) : encode(Document.toValue(doc));
  // A file written in place ends with one newline, and printed output with
  // none of its own, whether or not the formatted text kept the source's.
  const line = text.replace(/\n+$/, '');
  if (flags['in-place']) writeFileSync(path, `${line}\n`);
  else console.log(line);
}

/**
 * `dextrin docs SCHEMAS [--out DIR] [--title TITLE]`: every `.dxns` file
 * under `SCHEMAS` as HTML documentation in `DIR` (`doc/schemas` when not
 * given), as `mix dextrin.docs` writes it.
 * @param {string[]} argv
 */
function cmdDocs(argv) {
  const { positional, options } = parseArgs(argv, { options: ['out', 'title'] });
  if (positional.length !== 1) throw new Error('usage: dextrin docs SCHEMAS [--out DIR] [--title TITLE]');
  const out = options.out ?? 'doc/schemas';
  const written = SchemaDocs.write(positional[0], out, options.title ? { title: options.title } : {});
  console.log(`wrote ${written.length} files to ${out}`);
}

/**
 * `dextrin check SCHEMAS... [--extern NAMESPACE]... [--warnings-as-errors]`:
 * a tree of `.dxns` schemas checked as `mix dextrin.check` checks it --
 * every problem printed as `file:line: message`, and a non-zero exit. A
 * schema that uses something deprecated (DXNS.md §1b) is a warning,
 * printed as `warning: ...`; the check still passes, unless
 * `--warnings-as-errors` is given.
 * @param {string[]} argv
 */
function cmdCheck(argv) {
  /** @type {string[]} */
  const roots = [];
  /** @type {string[]} */
  const extern = [];
  let warningsAsErrors = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--extern') extern.push(/** @type {string} */ (argv[++i]));
    else if (argv[i] === '--warnings-as-errors') warningsAsErrors = true;
    else roots.push(/** @type {string} */ (argv[i]));
  }
  if (roots.length === 0) throw new Error('usage: dextrin check SCHEMAS... [--extern NAMESPACE]... [--warnings-as-errors]');
  const result = SchemaTree.load(roots, { extern });
  if (result.ok) {
    const warnings = result.registry.warnings;
    for (const warning of warnings) console.log(`warning: ${Schema.deprecationText(warning)}`);
    if (warningsAsErrors && warnings.length > 0) throw new Error(`${warnings.length} warning(s), and --warnings-as-errors`);
    console.log(`OK: ${result.summary.files} files, ${result.summary.definitions} definitions`);
    return;
  }
  for (const p of result.problems) console.error(`${p.file}:${p.line}: ${p.message}`);
  throw new Error(`${result.problems.length} problem(s)`);
}

/**
 * `dextrin gen-js SCHEMAS... --out DIR [--check]`: JavaScript classes from
 * DXNS (design/codegen-node.md), as `mix dextrin.gen.elixir` and php-dextrin's
 * `gen-php` write Elixir and PHP. For each schema, `Order.js` -- the user's,
 * written once -- and `AbstractOrder.js` with its `AbstractOrder.d.ts`,
 * rewritten; and one `Decoder.js`. Each file written is printed, and each
 * orphaned region warned about. `--check` writes nothing and fails when a
 * generated file is missing, out of date, left from a renamed class, or
 * holds an orphaned region: for CI.
 * @param {string[]} argv
 */
function cmdGenJs(argv) {
  const { positional, flags, options } = parseArgs(argv, { flags: ['check'], options: ['out'] });
  if (positional.length === 0 || !options.out) throw new Error('usage: dextrin gen-js SCHEMAS... --out DIR [--check]');
  if (flags.check) {
    const problems = Codegen.check(positional, options.out);
    if (problems.length > 0) throw new Error(problems.join('\n'));
    console.log('OK: the generated classes are up to date');
    return;
  }
  const written = Codegen.write(positional, options.out);
  for (const file of written) console.log(`wrote ${file}`);
  for (const orphan of Codegen.orphansIn(written)) console.error(`warning: kept the orphaned region ${orphan}: move its code or delete it`);
}

/**
 * `dextrin from-typespec MAIN.tsp [--out DIR]`: TypeSpec to DXNS, by running
 * TypeSpec's own compiler with the `@joetjen/dextrin-typespec` emitter
 * through npx, as `mix dextrin.from_typespec` does (dextrin's
 * design/typespec-emitter.md). The files go straight into `--out`
 * (default `schemas/`), one per namespace and schema version. Needs Node 22
 * and the emitter installed where the TypeSpec project is.
 * @param {string[]} argv
 * @param {(cmd: string, args: string[]) => {status: number | null, error?: Error}} [runner]
 */
function cmdFromTypespec(argv, runner = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' })) {
  const { positional, options } = parseArgs(argv, { options: ['out'] });
  if (positional.length !== 1) throw new Error('usage: dextrin from-typespec MAIN.tsp [--out DIR]');
  const out = resolvePath(options.out ?? 'schemas');
  const emitter = '@joetjen/dextrin-typespec';
  const result = runner('npx', ['--no-install', 'tsp', 'compile', positional[0], '--emit', emitter, '--option', `${emitter}.emitter-output-dir=${out}`]);
  if (result.error) throw new Error('npx was not found: TypeSpec needs Node 22 or later, with npx on the PATH');
  if (result.status !== 0) throw new Error(`tsp compile failed (exit ${result.status})`);
  process.stdout.write(`wrote ${out}\n`);
}

/**
 * `dextrin from-json-schema SCHEMA... [options]`: JSON Schema to DXNS, as
 * `mix dextrin.from_json_schema` converts it (dextrin's
 * design/json-schema.md). The first file is the root. A `$ref` to another
 * document is resolved among the files given and those under `--schemas
 * DIR`, by `$id` or by relative path; nothing is fetched. Whatever is not
 * exact is printed to standard error as `inexact: PATH: why`, and kept in
 * the type's `meta` where it applies; `--strict` fails on it.
 * @param {string[]} argv
 */
function cmdFromJsonSchema(argv) {
  const { positional, flags, options } = parseArgs(argv, {
    flags: ['mongo', 'structs', 'assert-formats', 'strict'],
    options: ['out', 'name', 'draft', 'schemas']
  });
  if (positional.length === 0) throw new Error('usage: dextrin from-json-schema SCHEMA... [--out FILE] [options]');
  const files = [...positional, ...jsonUnder(options.schemas, positional)];
  /** @type {Array<[string, string]>} */
  const sources = files.map((file) => [file, readFileSync(file, 'utf8')]);
  /** @type {{name?: string, draft?: string, mongo?: boolean, structs?: boolean, assertFormats?: boolean}} */
  const convertOpts = {};
  if (options.name !== undefined) convertOpts.name = options.name;
  if (options.draft !== undefined) convertOpts.draft = options.draft;
  if (flags.mongo) convertOpts.mongo = true;
  if (flags.structs) convertOpts.structs = true;
  if (flags['assert-formats']) convertOpts.assertFormats = true;
  const { document, inexact } = JsonSchema.toDxns(sources, convertOpts);
  for (const { path, why } of inexact) console.error(`inexact: ${path}: ${why}`);
  if (flags.strict && inexact.length > 0) throw new Error(`${inexact.length} place(s) not exact, and --strict`);
  const text = encode(document, { pretty: true }) + '\n';
  if (options.out) {
    writeFileSync(options.out, text);
    console.log(`wrote ${options.out}`);
  } else {
    process.stdout.write(text);
  }
}

/**
 * Every `.json` file under `dir`, sorted, but those given already.
 * @param {string | undefined} dir @param {string[]} given @returns {string[]}
 */
function jsonUnder(dir, given) {
  if (dir === undefined) return [];
  return /** @type {string[]} */ (readdirSync(dir, { recursive: true }))
    .filter((file) => file.endsWith('.json'))
    .map((file) => join(dir, file))
    .sort()
    .filter((file) => !given.includes(file));
}

/** @param {string[]} argv */
function cmdValidate(argv) {
  const { positional, options } = parseArgs(argv, { options: ['format', 'schema', 'as'] });
  if (positional.length !== 1) throw new Error('usage: dextrin validate PATH [--format text|binary] [--schema PATH --as NAME]');
  const [path] = positional;
  const format = detectFormat(path, options.format);

  let registry = new Registry();
  if (options.schema) {
    let schemaDoc;
    try {
      schemaDoc = decode(readFileSync(options.schema, 'utf8'));
    } catch (err) {
      throw new Error(`failed to compile schema ${options.schema}: ${describeError(err)}`);
    }
    registry = Schema.compile(schemaDoc, registry);
  }

  let value;
  try {
    value = format === 'binary' ? decodeBinary(readFileSync(path), { registry }) : decode(readFileSync(path, 'utf8'), { registry });
  } catch (err) {
    throw new Error(`${path}: ${describeError(err)}`);
  }

  const suffix = format === 'binary' ? 'b' : '';
  if (!options.as) {
    console.log(`OK: ${path} is valid .dxn${suffix}`);
    return;
  }

  // Deliberately Schema.validateEncode, not Schema.validate: `value`
  // has already gone through decode's own automatic, registry-driven
  // materialization — validateEncode accepts any shape (struct,
  // materialized object, or a real registered class instance), which
  // is what "does this decoded value satisfy schema NAME" needs here.
  try {
    Schema.validateEncode(value, registry, options.as);
  } catch (err) {
    throw new Error(`${path} does not satisfy schema ${options.as}: ${describeError(err)}`);
  }
  console.log(`OK: ${path} is valid .dxn${suffix} and satisfies schema ${options.as}`);
}

/**
 * @param {string} path
 * @param {string | undefined} forced
 * @returns {'text' | 'binary'}
 */
function detectFormat(path, forced) {
  if (forced === 'text' || forced === 'binary') return forced;
  return path.endsWith('.dxnb') ? 'binary' : 'text';
}

main(process.argv.slice(2));

/**
 * `dextrin compat OLD NEW` — the version discipline check
 * (`Schema.compat`, DXNS.md §8), for CI against the previous release's
 * schema files. Lists what the latest versions' materializers have to
 * upgrade; a version whose content changed without a new version, or a
 * version that went down, is reported and exits non-zero.
 * @param {string[]} args
 */
function cmdCompat(args) {
  if (args.length !== 2) throw new Error('usage: dextrin compat OLD NEW (each a .dxns file or a directory)');
  const { problems, upgrades } = Schema.compat(loadedSchemas(args[0]), loadedSchemas(args[1]));
  for (const { schema, from, to, added, removed, changed } of upgrades) {
    const changes = Object.entries({ added, removed, changed })
      .filter(([, fields]) => fields.length > 0)
      .map(([what, fields]) => `${what} ${fields.join(', ')}`)
      .join('; ');
    console.log(`${schema} ${from} -> ${to}: ${changes || 'no field changes'}`);
  }
  if (problems.length > 0) {
    throw new Error(
      problems
        .map((/** @type {any} */ p) => problemLine(p))
        .join('\n'),
    );
  }
  console.log('OK: no version discipline problems');
}

/**
 * One version discipline problem in words: a schema's, or a named type's
 * (`DXNS.md` §5c).
 * @param {any} p
 * @returns {string}
 */
function problemLine(p) {
  const what = p.type !== undefined ? `named type ${p.type}` : p.schema;
  return p.problem === 'version-went-down' ? `${what} went down from version ${p.from} to ${p.to}` : `${what} version ${p.version} changed without a new version`;
}

/**
 * Every `.dxns` document under `path` (or `path` itself, a file),
 * compiled into one registry -- so several versions of a schema, each
 * in its own document, sit side by side.
 * @param {string} path
 */
function loadedSchemas(path) {
  const files = statSync(path).isDirectory()
    ? /** @type {string[]} */ (readdirSync(path, { recursive: true }))
        .filter((file) => file.endsWith('.dxns'))
        .sort()
        .map((file) => join(path, file))
    : [path];
  return files.reduce((registry, file) => {
    try {
      return Schema.compile(decode(readFileSync(file, 'utf8')), registry);
    } catch (err) {
      throw new Error(`${file}: ${describeError(err)}`);
    }
  }, new Registry());
}

/**
 * `dextrin conformance REQUEST ANSWER` — this implementation's adapter
 * for the Dextrin Conformance Suite: reads the JSON request, answers every
 * case, writes the JSON answer. It fails only when the adapter itself
 * cannot work, never because a case did: a failed case is an answer, and
 * the suite judges it.
 * @param {string[]} args
 */
function cmdConformance(args) {
  if (args.length !== 2) throw new Error('usage: dextrin conformance REQUEST ANSWER');
  const [request, response] = args;
  writeFileSync(response, JSON.stringify(answer(JSON.parse(readFileSync(request, 'utf8')))));
}
