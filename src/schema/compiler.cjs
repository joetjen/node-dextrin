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
  'date', 'time', 'datetime', 'local-datetime', 'duration', 'uuid', 'objectid', 'ip', 'uri', 'bytes', 'bits', 'regex'
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
 * Every named type in a document sees every other, in any order, and may
 * reach itself through a guard -- a field, or a collection's elements
 * (DXN.md §4.5, Jan, 2026-10-20). `names` maps an entry's key to the
 * name it is registered under -- a tree's full names (DXN.md §4.6,
 * `layout.cjs`); a bare symbol naming a sibling resolves to it.
 *
 * @param {unknown} schemaDoc a decoded `.dxns` document (see `decode`).
 * @param {import('../registry.cjs')} baseRegistry
 * @param {Map<string, string>} [names]
 * @returns {import('../registry.cjs')}
 * @throws {SchemaCompileError}
 */
function compile(schemaDoc, baseRegistry, names = new Map()) {
  if (!(schemaDoc instanceof Map)) {
    throw new SchemaCompileError(`expected a .dxns document (a map), got ${describe(schemaDoc)}`);
  }

  const normalized = /** @type {Map<unknown, unknown>} */ (normalizeKeywords(schemaDoc));
  const namedEntries = Array.from(normalized.entries()).map(([k, v]) => {
    const name = entryName(k);
    return /** @type {[string, unknown]} */ ([names.get(name) ?? name, v]);
  });

  /** @type {Array<[string, DXNStruct]>} */
  const schemaEntries = [];
  /** @type {Array<[string, unknown]>} */
  const aliasEntries = [];
  for (const [name, value] of namedEntries) {
    if (value instanceof DXNStruct && value.name === 'schema') schemaEntries.push([name, value]);
    else aliasEntries.push([name, value]);
  }

  let registry = compileAliases(aliasEntries, baseRegistry, names);
  for (const [name, entry] of schemaEntries) {
    let compiled;
    try {
      compiled = compileEntry(entry, scopeOf(registry.typeAliases, names));
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
 * @param {Map<string, string>} names
 * @returns {import('../registry.cjs')}
 */
function compileAliases(aliasEntries, registry, names) {
  // Every named type in a document sees every other (design/
  // shapes-and-case.md): each is compiled with its siblings standing as
  // `{form: 'named'}`, and those are put in place once all are read -- so
  // the order of a map's entries, which DXN does not give, never matters.
  /** @type {Array<[string, unknown]>} */
  const siblings = aliasEntries.map(([n]) => [n, { form: 'named', name: n }]);
  const scope = scopeOf(new Map([...registry.typeAliases, ...siblings]), names);
  /** @type {Map<string, any>} */
  const compiled = new Map();
  for (const [name, rawValue] of aliasEntries) {
    try {
      compiled.set(name, compileNamed(name, rawValue, scope));
    } catch (err) {
      throw new SchemaCompileError(`named type ${JSON.stringify(name)}: ${errorMessage(err)}`);
    }
  }
  guarded(compiled);
  const known = new Map([...registry.typeAliases, ...compiled]);
  let result = registry;
  for (const [name] of aliasEntries) {
    let typeExpr;
    try {
      const own = compiled.get(name);
      typeExpr = own.form === 'generic' ? { ...own, body: resolved(own.body, known, [name]) } : resolved(own, known, [name]);
    } catch (err) {
      throw new SchemaCompileError(`named type ${JSON.stringify(name)}: ${errorMessage(err)}`);
    }
    result = result.putTypeAlias(name, typeExpr);
  }
  return result;
}

/** The scope names compile in: the named types, and the document's `names`. @param {Map<string, unknown>} aliases @param {Map<string, string>} names */
function scopeOf(aliases, names) {
  const scope = new Map(aliases);
  /** @type {any} */ (scope).names = names;
  return scope;
}

/**
 * The name a written symbol stands for: itself where it is in scope
 * already (a generic's parameter, a name known so), otherwise the full
 * name this document's `names` give it.
 * @param {string} written @param {Map<string, unknown>} aliases
 */
function fullName(written, aliases) {
  if (aliases.has(written)) return written;
  const names = /** @type {any} */ (aliases).names;
  return (names && names.get(written)) ?? written;
}

/**
 * A named type's definition: a generic's parameters and body, a shape
 * carrying its own name, or a type.
 * @param {string} name @param {unknown} raw @param {Map<string, unknown>} scope
 * @returns {any}
 */
function compileNamed(name, raw, scope) {
  if (raw instanceof DXNTuple && raw.items[0] instanceof DXNKeyword && raw.items[0].name === 'generic') {
    const [, params, body] = raw.items;
    const list = params instanceof DXNList ? params.items : Array.isArray(params) ? params : null;
    if (raw.items.length !== 3 || !list || list.length === 0 || !list.every((p) => p instanceof DXNSymbol)) {
      throw new SchemaCompileError("a generic's parameters are symbols: {:generic [t ...] body}");
    }
    const names = list.map((p) => /** @type {DXNSymbol} */ (p).name);
    if (new Set(names).size !== names.length) throw new SchemaCompileError('a generic names a parameter twice');
    if (body instanceof DXNStruct && body.name === 'schema') {
      throw new SchemaCompileError(
        'a struct schema cannot be generic: a struct goes on the wire under its one name; make the generic a %shape, or give each use a schema of its own'
      );
    }
    /** @type {Array<[string, unknown]>} */
    const bound = names.map((n) => [n, { form: 'param', name: n }]);
    const inner = scopeOf(new Map([...scope, ...bound]), /** @type {any} */ (scope).names);
    return { form: 'generic', params: names, body: compileNamed(name, body, inner) };
  }
  const type = compileTypeExpr(raw, scope);
  return type.form === 'shape' && type.name === null ? { ...type, name } : type;
}

/**
 * `type` with every `{form: 'named'}` replaced by that named type; a
 * reference back to a type being resolved closes a cycle, which `guarded`
 * has passed, and stays a reference by name.
 * @param {any} type @param {Map<string, any>} known @param {string[]} path @returns {any}
 */
function resolved(type, known, path) {
  switch (type.form) {
    case 'named': {
      if (path.includes(type.name)) return type;
      const target = known.get(type.name);
      if (target.form === 'generic') throw new SchemaCompileError(takesArguments(type.name, target));
      return resolved(target, known, [type.name, ...path]);
    }
    case 'apply':
      applies(type.name, type.args.length, known);
      return { ...type, args: type.args.map((/** @type {any} */ a) => resolved(a, known, path)) };
    case 'generic':
      throw new SchemaCompileError("a generic is a named type's whole definition, {:generic [t ...] body}");
    case 'shape':
      return { ...type, fields: type.fields.map((/** @type {Field} */ f) => new Field({ ...f, default: f.default, type: resolved(f.type, known, path) })) };
    case 'case':
      return {
        ...type,
        branches: type.branches.map((/** @type {[unknown, any]} */ [l, t]) => [l, resolved(t, known, path)]),
        otherwise: type.otherwise === null ? null : resolved(type.otherwise, known, path)
      };
    case 'refine':
      return { ...type, base: resolved(type.base, known, path) };
    case 'tuple-of':
      return { ...type, elems: type.elems.map((/** @type {any} */ t) => resolved(t, known, path)) };
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return { ...type, variants: type.variants.map((/** @type {any} */ t) => resolved(t, known, path)) };
    case 'list-of':
    case 'set-of':
    case 'array-of':
    case 'sorted-set-of':
    case 'not':
    case 'nilable':
      return { ...type, elem: resolved(type.elem, known, path) };
    case 'map-of':
    case 'ordered-map-of':
      return { ...type, key: resolved(type.key, known, path), value: resolved(type.value, known, path) };
    default:
      return type;
  }
}

/**
 * Every cycle among `compiled`'s named types passes a guard: a field of
 * a shape, or a collection's elements, so that each step of a check reads
 * a smaller part of the value. A cycle with none -- `A: {:nilable A}` --
 * describes no value and would never finish.
 * @param {Map<string, any>} compiled
 */
function guarded(compiled) {
  const edges = new Map(Array.from(compiled, ([name, type]) => [name, unguardedNames(type)]));
  for (const start of Array.from(edges.keys()).sort()) {
    const cycle = unguardedCycle(start, edges, []);
    if (cycle) {
      throw new SchemaCompileError(
        `named type ${JSON.stringify(cycle[0])}: reaches itself with no field or collection between (${cycle.join(' -> ')}); it describes no value`
      );
    }
  }
}

/** @param {string} name @param {Map<string, string[]>} edges @param {string[]} path @returns {string[] | null} */
function unguardedCycle(name, edges, path) {
  if (path.length > 0 && name === path[0]) return [...path, name];
  if (path.includes(name)) return null;
  for (const next of edges.get(name) ?? []) {
    const found = unguardedCycle(next, edges, [...path, name]);
    if (found) return found;
  }
  return null;
}

/** The named types `type` refers to without a guard on the way. @param {any} type @returns {string[]} */
function unguardedNames(type) {
  switch (type.form) {
    case 'named':
      return [type.name];
    case 'apply':
      return [type.name, ...type.args.flatMap(unguardedNames)];
    case 'generic':
      return unguardedNames(type.body);
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return type.variants.flatMap(unguardedNames);
    case 'not':
    case 'nilable':
      return unguardedNames(type.elem);
    case 'refine':
      return unguardedNames(type.base);
    case 'case':
      return [...(type.otherwise ? [type.otherwise] : []), ...type.branches.map((/** @type {[unknown, any]} */ [, t]) => t)].flatMap(unguardedNames);
    default:
      return [];
  }
}

/** Whether `name` is a generic taking `count` arguments. @param {string} name @param {number} count @param {Map<string, any>} known */
function applies(name, count, known) {
  const target = known.get(name);
  if (target && target.form === 'named') return;
  if (!target || target.form !== 'generic') throw new SchemaCompileError(`{:of ${name} ...} names no generic`);
  if (target.params.length !== count) {
    throw new SchemaCompileError(`${name} takes ${target.params.length} type argument(s), {:of ${name} ...} gives ${count}`);
  }
}

/** @param {string} name @param {any} generic */
function takesArguments(name, generic) {
  return `${name} is generic: write {:of ${name} ${generic.params.join(' ')}}, with a type for each`;
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
  notFormat10(entry.fields.pairs);
  const fields = entry.fields.pairs.map(([key, value]) => {
    try {
      return compileField(key, value, aliases);
    } catch (err) {
      throw new SchemaCompileError(`field ${JSON.stringify(key)}: ${errorMessage(err)}`);
    }
  });
  distinctNames(fields);
  casesNameFields(entry.fields.pairs, fields);
  return new Compiled({ version: entry.version ?? 1, fields });
}

/** @param {Field[]} fields */
function distinctNames(fields) {
  const seen = new Set();
  for (const field of fields) {
    if (seen.has(field.name)) throw new SchemaCompileError(`field ${JSON.stringify(field.name)} is named twice`);
    seen.add(field.name);
  }
}

/**
 * Every `{:case field ...}` written in `pairs`' field types names one of
 * `fields` -- told from the source, so a named type the case reaches
 * through is not looked into.
 * @param {Array<[string, unknown]>} pairs @param {Field[]} fields
 */
function casesNameFields(pairs, fields) {
  const names = new Set(fields.map((f) => f.name));
  for (const [, value] of pairs) {
    for (const field of caseFields(value)) {
      if (!names.has(field)) throw new SchemaCompileError(`{:case ${field} ...} names no field of its schema or shape`);
    }
  }
}

/** @param {unknown} value @returns {string[]} */
function caseFields(value) {
  if (value instanceof DXNTuple) {
    const [head, second, ...rest] = value.items;
    if (head instanceof DXNKeyword && head.name === 'case' && second instanceof DXNSymbol) {
      return [second.name, ...rest.flatMap(caseFields)];
    }
    return value.items.flatMap(caseFields);
  }
  if (value instanceof DXNStruct && value.name === 'shape') return [];
  if (value instanceof DXNStruct && value.name === 'field' && value.fields.type === 'keyed') {
    return caseFields(getField(value.fields.pairs, 'type'));
  }
  if (value instanceof Map) return Array.from(value.values()).flatMap(caseFields);
  return [];
}

/**
 * Refuses a schema written in Dextrin 0.1's syntax -- `fields: @ordered
 * %{...}`, `closed: true`, `forbidden: [...]` -- saying so, and what a
 * schema is written as now (DXN.md §4.4), rather than that a field has no
 * known type. Only those shapes: now `fields`, `closed` and `forbidden`
 * are ordinary field names, whose values are type expressions. The format
 * stays 1.0 until 1.0.0 (Jan, 2026-10-20), so the old syntax is named by
 * the release that had it.
 * @param {Array<[string, unknown]>} pairs
 */
function notFormat10(pairs) {
  const old = pairs.some(
    ([key, value]) =>
      (key === 'fields' && value instanceof DXNOrderedMap) ||
      (key === 'closed' && typeof value === 'boolean') ||
      (key === 'forbidden' && value instanceof DXNList)
  );
  if (old) {
    throw new SchemaCompileError(
      "this is Dextrin 0.1's schema syntax (fields:, closed:, forbidden:); a schema lists its fields directly, " +
        '%schema(N){field: type, ...}, and refuses undeclared fields with strict: true (DXN.md §4.4)'
    );
  }
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
    if (value.name === 'never') return { form: 'never' };
    if (PRIMITIVES.has(value.name)) return { form: 'primitive', name: value.name };
    // DXN 0.2's timestamp type, now a datetime in UTC (DXN.md §4.2, Jan,
    // 2026-10-20): a schema naming it keeps its meaning.
    if (value.name === 'timestamp') {
      return { form: 'refine', base: { form: 'primitive', name: 'datetime' }, constraints: { offsets: new DXNList(['Z']) } };
    }
    throw new SchemaCompileError(`unrecognized primitive type name ${JSON.stringify(value.name)}`);
  }

  if (value instanceof DXNSymbol) {
    const name = fullName(value.name, aliases);
    const known = /** @type {any} */ (aliases.get(name));
    if (known && known.form === 'generic') throw new SchemaCompileError(takesArguments(name, known));
    if (known) return known;
    return { form: 'reference', name };
  }

  // `%shape{field: type, ...}` (design/shapes-and-case.md): a plain map's
  // fields, as a schema's are written; no version, never positional.
  if (value instanceof DXNStruct && value.name === 'shape') {
    if (value.fields.type !== 'keyed') throw new SchemaCompileError('a shape lists its fields by name: %shape{field: type, ...}');
    if (value.version !== null && value.version !== undefined) throw new SchemaCompileError('a shape has no version: %shape{field: type, ...}');
    const pairs = value.fields.pairs;
    const fields = pairs.map(([key, v]) => {
      try {
        return compileField(key, v, aliases);
      } catch (err) {
        throw new SchemaCompileError(`field ${JSON.stringify(key)}: ${errorMessage(err)}`);
      }
    });
    distinctNames(fields);
    casesNameFields(pairs, fields);
    return { form: 'shape', name: null, fields };
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
    if (tag === 'array-of' && rest.length === 1) return { form: 'array-of', elem: compileTypeExpr(rest[0], aliases) };
    if (tag === 'sorted-set-of' && rest.length === 1) return { form: 'sorted-set-of', elem: compileTypeExpr(rest[0], aliases) };
    if (tag === 'ordered-map-of' && rest.length === 2) {
      return { form: 'ordered-map-of', key: compileTypeExpr(rest[0], aliases), value: compileTypeExpr(rest[1], aliases) };
    }
    if (tag === 'enum') return { form: 'enum', literals: rest };
    if (tag === 'one-of') return { form: 'one-of', variants: rest.map((v) => compileTypeExpr(v, aliases)) };
    if (tag === 'any-of') return { form: 'any-of', variants: rest.map((v) => compileTypeExpr(v, aliases)) };
    if (tag === 'not' && rest.length === 1) return { form: 'not', elem: compileTypeExpr(rest[0], aliases) };
    if (tag === 'all-of') return { form: 'all-of', variants: rest.map((v) => compileTypeExpr(v, aliases)) };
    if (tag === 'nilable' && rest.length === 1) return { form: 'nilable', elem: compileTypeExpr(rest[0], aliases) };
    // `{:case field %{value => type, ..., :else => type}}`: the type the
    // sibling `field`'s value chooses.
    if (tag === 'case') {
      if (rest.length !== 2 || !(rest[0] instanceof DXNSymbol) || !(rest[1] instanceof Map)) {
        throw new SchemaCompileError('a case is {:case field %{value => type, ..., :else => type}}');
      }
      /** @type {import('./type-expr.cjs').TypeExpr | null} */
      let otherwise = null;
      /** @type {Array<[unknown, import('./type-expr.cjs').TypeExpr]>} */
      const branches = [];
      for (const [k, v] of rest[1].entries()) {
        if (k instanceof DXNKeyword && k.name === 'else') otherwise = compileTypeExpr(v, aliases);
        else branches.push([k, compileTypeExpr(v, aliases)]);
      }
      return { form: 'case', field: rest[0].name, branches, otherwise };
    }
    // `{:of Name type ...}`: one use of the generic `Name`.
    if (tag === 'of') {
      if (!(rest[0] instanceof DXNSymbol) || rest.length < 2) throw new SchemaCompileError('a use of a generic is {:of Name type ...}');
      const name = fullName(rest[0].name, aliases);
      applies(name, rest.length - 1, /** @type {any} */ (aliases));
      return { form: 'apply', name, args: rest.slice(1).map((v) => compileTypeExpr(v, aliases)) };
    }
    if (tag === 'generic') throw new SchemaCompileError("a generic is a named type's whole definition, {:generic [t ...] body}");
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
