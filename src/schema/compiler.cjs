'use strict';

/**
 * @fileoverview Compiles a parsed `.dxns` document (an ordinary
 * decoded DXN value — a `.dxns` file is valid `.dxn`, no new grammar;
 * what makes it a *schema* document is purely the shape of the value
 * it parses to: a map from name to type expression) into
 * `Compiled` entries, mirroring `Dextrin.Schema.Compiler`.
 *
 * `%schema{}`/`%field{}` are recognized here directly, as
 * `DXNStruct` instances named `"schema"`/`"field"` straight out of
 * `decode` — never looked up in a registry, the same way built-in
 * tags are recognized by name in the text/binary codecs rather than
 * registered. This sidesteps an obvious bootstrapping question
 * (doesn't parsing a `.dxns` file need a schema for its own
 * `schema`/`field` structs?) the same way JSON Schema's own
 * vocabulary is fixed tooling knowledge rather than itself validated
 * against a schema.
 *
 * An entry whose value *isn't* a `%schema{}` is a **named type**
 * instead: a reusable name for some combination of the fixed
 * type_expr vocabulary, e.g. `PositiveInt: {:refine :integer
 * {min: 1}}` — purely data, no JS code, no registry callback, so any
 * conformant reader in any language resolves it the same way.
 */

const DXNKeyword = require('../values/keyword.cjs');
const DXNSymbol = require('../values/symbol.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNOrderedMap = require('../values/ordered-map.cjs');
const DXNList = require('../values/list.cjs');
const DXNStruct = require('../values/struct.cjs');
const DXNCustomTag = require('../values/custom-tag.cjs');
const Compiled = require('./compiled.cjs');
const Field = require('./field.cjs');

const PRIMITIVES = new Set([
  'nil', 'boolean', 'integer', 'float', 'decimal', 'rational', 'string', 'char', 'symbol', 'keyword',
  'list', 'tuple', 'map', 'ordered-map', 'set', 'sorted-set', 'array',
  'date', 'time', 'timestamp', 'datetime', 'duration', 'uuid', 'uri', 'bytes', 'regex'
]);

class SchemaCompileError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SchemaCompileError';
    /** The `DXN.md` §5 category every compile refusal carries. */
    this.category = 'schema/compile';
  }
}

/**
 * Compiles every entry of a decoded `.dxns` document into
 * `baseRegistry` — a struct schema for each `%schema(N){}` entry, a
 * named type_expr for every other entry. A refusal is a
 * `SchemaCompileError` (category `schema/compile`), or a `DXNError` of
 * category `schema/duplicate-version` for a version the registry has
 * loaded already (`DXN.md` §4.8).
 *
 * Named types defined in *this* document may reference any type
 * already known to `baseRegistry` (from an earlier `compile` call),
 * but not one declared alongside them in the same document — `.dxns`'s
 * own `map` type has no ordering guarantee to resolve forward
 * references against. A schema's *fields*, compiled afterwards, can
 * freely use any named type from either source.
 *
 * @param {unknown} schemaDoc a decoded `.dxns` document (see `decode`).
 * @param {import('../registry.cjs')} baseRegistry
 * @returns {import('../registry.cjs')}
 * @throws {SchemaCompileError}
 */
function compile(schemaDoc, baseRegistry) {
  if (!(schemaDoc instanceof Map)) {
    throw new SchemaCompileError(`expected a .dxns document (a map), got ${describe(schemaDoc)}`);
  }

  const normalized = /** @type {Map<unknown, unknown>} */ (normalizeKeywords(schemaDoc));
  const namedEntries = Array.from(normalized.entries()).map(([k, v]) => /** @type {[string, unknown]} */ ([entryName(k), v]));

  /** @type {Array<[string, DXNStruct]>} */
  const schemaEntries = [];
  /** @type {Array<[string, unknown]>} */
  const aliasEntries = [];
  for (const [name, value] of namedEntries) {
    if (value instanceof DXNStruct && value.name === 'schema') schemaEntries.push([name, value]);
    else aliasEntries.push([name, value]);
  }

  let registry = compileAliases(aliasEntries, baseRegistry);
  for (const [name, entry] of schemaEntries) {
    let compiled;
    try {
      compiled = compileEntry(entry, registry.typeAliases);
    } catch (err) {
      throw new SchemaCompileError(`schema ${JSON.stringify(name)}: ${errorMessage(err)}`);
    }
    compiled.name = name;
    registry = registry.addStructSchema(name, compiled);
  }
  return registry;
}

/**
 * @param {Array<[string, unknown]>} aliasEntries
 * @param {import('../registry.cjs')} registry
 * @returns {import('../registry.cjs')}
 */
function compileAliases(aliasEntries, registry) {
  // `baseAliases` is a frozen snapshot, not the accumulating registry
  // — every alias in *this* document resolves references against
  // only what `registry` already knew coming in, never against a
  // sibling compiled earlier in this same loop (see this module's own
  // doc for why: a plain `map` has no ordering guarantee to resolve
  // same-document forward references against).
  const baseAliases = registry.typeAliases;
  let result = registry;
  for (const [name, rawValue] of aliasEntries) {
    let typeExpr;
    try {
      typeExpr = compileTypeExpr(rawValue, baseAliases);
    } catch (err) {
      throw new SchemaCompileError(`named type ${JSON.stringify(name)}: ${errorMessage(err)}`);
    }
    result = result.putTypeAlias(name, typeExpr);
  }
  return result;
}

/** @param {unknown} key @returns {string} */
function entryName(key) {
  if (key instanceof DXNKeyword) return key.name;
  if (key instanceof DXNSymbol) return key.name;
  if (typeof key === 'string') return key;
  throw new SchemaCompileError(`expected a schema/named-type entry name, got ${describe(key)}`);
}

/**
 * One `%schema(N){field: type, ...}` entry: the body is the fields, in
 * the order they are written; the header is the version, 1 when there
 * is none.
 * @param {unknown} entry
 * @param {Map<string, unknown>} aliases
 * @returns {Compiled}
 */
function compileEntry(entry, aliases) {
  if (!(entry instanceof DXNStruct) || entry.name !== 'schema') {
    throw new SchemaCompileError(`expected a %schema(N){...} entry, got ${describe(entry)}`);
  }
  if (entry.fields.type !== 'keyed') {
    throw new SchemaCompileError('a schema lists its fields by name: %schema(N){field: type, ...}');
  }
  const fields = entry.fields.pairs.map(([key, value]) => {
    try {
      return compileField(key, value, aliases);
    } catch (err) {
      throw new SchemaCompileError(`field ${JSON.stringify(key)}: ${errorMessage(err)}`);
    }
  });
  const seen = new Set();
  for (const field of fields) {
    if (seen.has(field.name)) throw new SchemaCompileError(`field ${JSON.stringify(field.name)} is named twice`);
    seen.add(field.name);
  }
  return new Compiled({ version: entry.version ?? 1, fields });
}

/**
 * @param {string} key a field name as a struct's keyed pairs hold it.
 * @param {unknown} value
 * @param {Map<string, unknown>} aliases
 * @returns {Field}
 */
function compileField(key, value, aliases) {
  const optional = key.endsWith('?');
  const name = optional ? key.slice(0, -1) : key;

  if (value instanceof DXNStruct && value.name === 'field' && value.fields.type === 'keyed') {
    const fieldPairs = value.fields.pairs;
    const type = compileTypeExpr(getField(fieldPairs, 'type', { form: 'any' }), aliases);
    return new Field({
      name,
      required: !optional,
      type,
      default: hasField(fieldPairs, 'default') ? getField(fieldPairs, 'default') : Field.NO_DEFAULT,
      description: /** @type {string | null} */ (getField(fieldPairs, 'description', null))
    });
  }

  return new Field({ name, required: !optional, type: compileTypeExpr(value, aliases) });
}

// ---- type expressions -------------------------------------------------------

/**
 * @param {unknown} value
 * @param {Map<string, unknown>} aliases
 * @returns {import('./type-expr.cjs').TypeExpr}
 */
function compileTypeExpr(value, aliases) {
  if (value === null) return { form: 'primitive', name: 'nil' };

  if (value instanceof DXNKeyword) {
    if (value.name === 'any') return { form: 'any' };
    if (PRIMITIVES.has(value.name)) return { form: 'primitive', name: value.name };
    throw new SchemaCompileError(`unrecognized primitive type name ${JSON.stringify(value.name)}`);
  }

  if (value instanceof DXNSymbol) {
    if (aliases.has(value.name)) return /** @type {import('./type-expr.cjs').TypeExpr} */ (aliases.get(value.name));
    return { form: 'reference', name: value.name };
  }

  if (value instanceof DXNTuple) {
    const [head, ...rest] = value.items;
    const tag = head instanceof DXNKeyword ? head.name : null;

    if (tag === 'list-of' && rest.length === 1) return { form: 'list-of', elem: compileTypeExpr(rest[0], aliases) };
    if (tag === 'set-of' && rest.length === 1) return { form: 'set-of', elem: compileTypeExpr(rest[0], aliases) };
    if (tag === 'tuple-of') return { form: 'tuple-of', elems: rest.map((v) => compileTypeExpr(v, aliases)) };
    if (tag === 'map-of' && rest.length === 2) {
      return { form: 'map-of', key: compileTypeExpr(rest[0], aliases), value: compileTypeExpr(rest[1], aliases) };
    }
    if (tag === 'enum') return { form: 'enum', literals: rest };
    if (tag === 'one-of') return { form: 'one-of', variants: rest.map((v) => compileTypeExpr(v, aliases)) };
    if (tag === 'all-of') return { form: 'all-of', variants: rest.map((v) => compileTypeExpr(v, aliases)) };
    if (tag === 'nilable' && rest.length === 1) return { form: 'nilable', elem: compileTypeExpr(rest[0], aliases) };
    if (tag === 'refine' && rest.length === 2 && rest[1] instanceof Map) {
      const constraints = Object.fromEntries(Array.from(rest[1].entries(), ([k, v]) => [literalName(k), v]));
      return { form: 'refine', base: compileTypeExpr(rest[0], aliases), constraints };
    }
  }

  throw new SchemaCompileError(`unrecognized type expression: ${describe(value)}`);
}

// ---- helpers -------------------------------------------------------------

/**
 * @param {Array<[string, unknown]>} pairs
 * @param {string} key
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
function getField(pairs, key, fallback = null) {
  const found = pairs.find(([k]) => k === key);
  return found ? found[1] : fallback;
}

/**
 * @param {Array<[string, unknown]>} pairs
 * @param {string} key
 * @returns {boolean}
 */
function hasField(pairs, key) {
  return pairs.some(([k]) => k === key);
}

/** @param {unknown} value @returns {string} */
function literalName(value) {
  if (value instanceof DXNKeyword) return value.name;
  if (value instanceof DXNSymbol) return value.name;
  if (typeof value === 'string') return value;
  throw new SchemaCompileError(`expected an identifier or string, got ${describe(value)}`);
}

/**
 * Normalizes a decoded `.dxns` document to one canonical internal
 * shape: every keyword becomes `DXNKeyword`, regardless of whether
 * the caller decoded the document `trusted: true` (global `Symbol.for`)
 * or `false` — this module's whole vocabulary is written against
 * `DXNKeyword` specifically, mirroring `Dextrin.Schema.Compiler`'s own
 * `atomize_back/1`. A `.dxns` document is schema *definition* syntax,
 * not the untrusted end-user data it describes, so this has nothing
 * to do with trust — the compiler just needs one shape either way.
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizeKeywords(value) {
  if (typeof value === 'symbol') {
    const name = Symbol.keyFor(value) ?? value.description ?? '';
    return new DXNKeyword(name);
  }
  if (Array.isArray(value)) return value.map(normalizeKeywords);
  if (value instanceof DXNList) return new DXNList(value.items.map(normalizeKeywords));
  if (value instanceof DXNTuple) return new DXNTuple(value.items.map(normalizeKeywords));
  if (value instanceof DXNOrderedMap) return new DXNOrderedMap(value.pairs.map(([k, v]) => [normalizeKeywords(k), normalizeKeywords(v)]));
  if (value instanceof Map) return new Map(Array.from(value.entries(), ([k, v]) => [normalizeKeywords(k), normalizeKeywords(v)]));
  if (value instanceof Set) return new Set(Array.from(value, normalizeKeywords));
  if (value instanceof DXNStruct) {
    return value.fields.type === 'keyed'
      ? value.withFields({ type: 'keyed', pairs: value.fields.pairs.map(([k, v]) => [k, normalizeKeywords(v)]) })
      : value.withFields({ type: 'positional', values: value.fields.values.map(normalizeKeywords) });
  }
  if (value instanceof DXNCustomTag) return new DXNCustomTag(value.name, normalizeKeywords(value.value));
  return value;
}

/** @param {unknown} err @returns {string} */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {unknown} value */
function describe(value) {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

module.exports = { compile, SchemaCompileError, normalizeKeywords };
