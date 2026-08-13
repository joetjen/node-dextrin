#!/usr/bin/env node

/**
 * @fileoverview `dextrin` CLI — one executable, four subcommands
 * (`decode`, `encode`, `format`, `validate`), the JS analog of
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

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { decode, encode, decodeBinary, encodeBinary, DXNError, Schema, Registry } from '../src/dextrin.js';

const USAGE = `usage: dextrin <command> [options]

Commands:
  decode PATH [--out PATH]                    Decode .dxnb binary to .dxn text (pretty-printed)
  encode PATH [--out PATH]                     Encode .dxn text to .dxnb binary
  format PATH [--mode pretty|condense] [--in-place]
                                                Reformat a .dxn file
  validate PATH [--format text|binary] [--schema PATH --as NAME]
                                                Validate a .dxn/.dxnb file, optionally against a schema

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
  const source = readFileSync(path, 'utf8');
  const value = decode(source);
  const text = encode(value, { pretty: mode === 'pretty' });
  if (flags['in-place']) writeFileSync(path, `${text}\n`);
  else console.log(text);
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
