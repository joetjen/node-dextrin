'use strict';

/**
 * @fileoverview Public entry point for `.dxns` schema compilation and
 * validation, mirroring `Dextrin.Schema`.
 *
 *   - `compile` — the one-time walk from a decoded `.dxns` document to
 *     a populated `Registry`.
 *   - `validate` — checks an already-decoded value against a named
 *     schema (decode-side, but not decode itself — see its own doc).
 *   - `validateEncode`/`validateEncodeTree` — the encode-side mirror,
 *     one named schema vs. an automatic whole-tree walk. Unlike the
 *     Elixir original, both may *transform* the value they check (see
 *     `schema/validator.cjs`'s own doc on schema-driven coercion).
 *
 * Enforcement during actual decoding is fail-fast and automatic:
 * every registered struct name is checked unconditionally as part of
 * `decode`/`decodeBinary`. The functions here are for the cases that
 * aren't "check while decoding" (see `validate`'s own doc).
 */

const DXNStruct = require('./values/struct.cjs');
const Registry = require('./registry.cjs');
const Compiler = require('./schema/compiler.cjs');
const TypeExpr = require('./schema/type-expr.cjs');
const Validator = require('./schema/validator.cjs');
const Reader = require('./schema/reader.cjs');
const Validated = require('./schema/validated.cjs');
const Provider = require('./schema/provider.cjs');
const Compat = require('./schema/compat.cjs');

/**
 * Compiles a decoded `.dxns` document into `baseRegistry` — a struct
 * schema for each `%schema(N){}` entry, and a reusable named type for
 * every other entry. `names`, when given, maps each entry's key to the
 * full name a tree gives it (DXN.md §4.6) -- how `tree.cjs` compiles a
 * file -- a bare symbol naming a sibling resolving to it.
 * @param {unknown} schemaDoc
 * @param {import('./registry.cjs')} baseRegistry
 * @param {Map<string, string>} [names]
 * @returns {import('./registry.cjs')}
 */
function compile(schemaDoc, baseRegistry, names) {
  return Compiler.compile(schemaDoc, baseRegistry, names);
}

/**
 * Compiles several decoded `.dxns` documents into one registry, in order,
 * over `baseRegistry` (a new one by default) -- each seeing the schemas
 * and named types of those before it, as `compile` called on each in
 * turn. The first that does not compile throws, naming which it was
 * (`schema/compile`). As the reference's `Dextrin.Schema.compile_all/2`.
 * @param {unknown[]} schemaDocs
 * @param {import('./registry.cjs')} [baseRegistry]
 * @returns {import('./registry.cjs')}
 */
function compileAll(schemaDocs, baseRegistry = new Registry()) {
  let registry = baseRegistry;
  for (const [index, doc] of schemaDocs.entries()) {
    try {
      registry = Compiler.compile(doc, registry);
    } catch (err) {
      throw new Compiler.SchemaCompileError(`document ${index + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return registry;
}

/**
 * Validates an already-decoded value against a named, compiled
 * schema — for the cases that aren't "check while decoding": a value
 * built directly in JS before encoding, an opaque `DXNStruct` decoded
 * before a schema became available, or checking against a different
 * schema than the one originally used. Returns `true` on success,
 * throws on failure.
 * @param {unknown} value
 * @param {import('./registry.cjs')} registry
 * @param {string} schemaName
 * @returns {true}
 */
function validate(value, registry, schemaName) {
  if (!(value instanceof DXNStruct) || value.name !== schemaName) {
    throw new Validator.SchemaValidationError(`expected a DXNStruct named ${JSON.stringify(schemaName)}, got ${describe(value)}`, 'schema/type-mismatch');
  }
  // Read exactly as a decode would read it, version and materializer
  // included (schema/reader.cjs).
  const read = Reader.read(registry, schemaName, value.version, value.fields);
  if (!read) throw new Validator.SchemaValidationError(`no compiled schema registered for ${JSON.stringify(schemaName)}`);
  return true;
}

/**
 * Whether `value` -- data a program already holds -- matches the
 * definition `name` in `registry`: a struct schema, a `%shape` or a
 * named type (design/shapes-and-case.md). Only a check: `value` is never
 * changed. Returns `true`, or throws the error saying why.
 * @param {unknown} value
 * @param {import('./registry.cjs')} registry
 * @param {string} name
 * @returns {true}
 */
function check(value, registry, name) {
  conform(value, registry, name);
  return true;
}

/**
 * `value` checked as `check` checks it, returned with every shape's
 * missing defaults filled in, as a decode fills them; throws the error
 * saying why it does not match.
 * @param {unknown} value
 * @param {import('./registry.cjs')} registry
 * @param {string} name
 * @returns {unknown}
 */
function conform(value, registry, name) {
  const type = registry.typeAliases.get(name);
  if (type === undefined) {
    validate(value, registry, name);
    return value;
  }
  const conformed = TypeExpr.conform(/** @type {any} */ (type), value, TypeExpr.context(registry));
  if (conformed === TypeExpr.NO) {
    throw new Validator.SchemaValidationError(`value does not match ${JSON.stringify(name)}`, 'schema/type-mismatch');
  }
  return conformed;
}

/**
 * What the `{:doc ... %{...}}` around the schema or named type `name` says
 * about it (DXN.md §4.1b): its annotations by name, `{}` when it has none,
 * `undefined` when there is no such name -- as the registry's `fetch*`
 * answer a name it does not know. A schema answers for its latest
 * version. As the reference's `Dextrin.Schema.annotations/2`.
 *
 * An enum's `values` is a `Map` from each value to its own annotations.
 *
 * @example
 * const registry = Schema.compile(decode('%{Port: {:doc :integer %{description: "A TCP port"}}}'), new Registry());
 * Schema.annotations(registry, 'Port'); // => {description: 'A TCP port'}
 * @param {import('./registry.cjs')} registry
 * @param {string} name
 * @returns {{[k: string]: unknown} | undefined}
 */
function annotations(registry, name) {
  const type = /** @type {any} */ (registry.typeAliases.get(name));
  if (type !== undefined) {
    if (type.form === 'doc') return type.notes;
    if (type.form === 'generic' && type.body.form === 'doc') return type.body.notes;
    return {};
  }
  const found = registry.fetchStructSchema(name);
  return found ? found.compiled.annotations : undefined;
}

/**
 * Encode-time schema validation: checks `value` — ordinary JS data
 * you're about to encode — against a named, compiled schema *before*
 * encoding produces any output. The mirror image of `validate`, for
 * data on its way out rather than in. Returns the checked value,
 * stripped of internal bookkeeping; nothing is converted (`DXN.md`
 * §4.7).
 * @param {unknown} value
 * @param {import('./registry.cjs')} registry
 * @param {string} schemaName
 * @param {{[k: string]: unknown}} [opts]
 * @returns {unknown}
 */
function validateEncode(value, registry, schemaName, opts = {}) {
  const found = registry.fetchStructSchema(schemaName);
  if (!found) throw new Validator.SchemaValidationError(`no compiled schema registered for ${JSON.stringify(schemaName)}`);
  return Validated.strip(Validator.validateForEncode(found.compiled, value, registry, opts));
}

/**
 * Automatic, name-driven encode-time validation: walks `value` and
 * checks *every* `DXNStruct` or registered application class instance
 * anywhere in it against its own schema, wherever it turns out to be.
 * Symmetric to how decode checks every named struct unconditionally.
 * `encode`/`encodeBinary` call this automatically by default (opt out
 * with `validate: false`). Returns the checked tree.
 * @param {unknown} value
 * @param {import('./registry.cjs')} registry
 * @param {{[k: string]: unknown}} [opts]
 * @returns {unknown}
 */
function validateEncodeTree(value, registry, opts = {}) {
  return Validated.strip(Validator.validateTreeForEncode(value, registry, opts));
}

/**
 * Compiles and registers one schema provider (`schema/provider.cjs`)
 * into `registry` — lets a class's own library ship its DXN schema
 * without that library depending on `dextrin` itself.
 * @param {import('./registry.cjs')} registry
 * @param {import('./schema/provider.cjs').DXNSchemaProvider} provider
 * @returns {import('./registry.cjs')}
 */
function registerProvider(registry, provider) {
  return Provider.registerProvider(registry, provider, compile);
}

/** @param {unknown} value */
function describe(value) {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * The version discipline check (`schema/compat.cjs`, DXN.md §4.8):
 * `oldRegistry`'s schemas against `newRegistry`'s, as the problems -- a
 * version whose content changed without a new version, a version that
 * went down -- and what the latest versions' materializers have to
 * upgrade.
 * @param {import('./registry.cjs')} oldRegistry
 * @param {import('./registry.cjs')} newRegistry
 */
function compat(oldRegistry, newRegistry) {
  return Compat.check(oldRegistry, newRegistry);
}

// The names `compat`'s declaration uses, in scope here: `tsc` writes its
// result type by them (`npm run types`).
/**
 * @typedef {import('./schema/compat.cjs').Problem} Problem
 * @typedef {import('./schema/compat.cjs').Upgrade} Upgrade
 */

module.exports = { compile, compileAll, validate, check, conform, annotations, validateEncode, validateEncodeTree, registerProvider, compat };
