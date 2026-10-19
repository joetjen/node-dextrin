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
const Compiler = require('./schema/compiler.cjs');
const Validator = require('./schema/validator.cjs');
const Reader = require('./schema/reader.cjs');
const Validated = require('./schema/validated.cjs');
const Provider = require('./schema/provider.cjs');
const Compat = require('./schema/compat.cjs');

/**
 * Compiles a decoded `.dxns` document into `baseRegistry` — a struct
 * schema for each `%schema(N){}` entry, and a reusable named type for
 * every other entry.
 * @param {unknown} schemaDoc
 * @param {import('./registry.cjs')} baseRegistry
 * @returns {import('./registry.cjs')}
 */
function compile(schemaDoc, baseRegistry) {
  return Compiler.compile(schemaDoc, baseRegistry);
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

module.exports = { compile, validate, validateEncode, validateEncodeTree, registerProvider, compat };
