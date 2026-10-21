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
const { canonical } = require('../canonical.cjs');
const DXNRegex = require('../values/regex.cjs');
const { resolutions, comparable, nonzeroNumber, span, TYPE_KEYS } = require('./type-expr.cjs');
const Format = require('./format.cjs');
const { dxnEquals, dxnCompare } = require('../values/equality.cjs');

const PRIMITIVES = new Set([
  'nil', 'boolean', 'integer', 'float', 'decimal', 'rational', 'string', 'char', 'symbol', 'keyword',
  'list', 'tuple', 'map', 'ordered-map', 'set', 'sorted-set', 'array',
  'date', 'time', 'datetime', 'local-datetime', 'duration', 'uuid', 'objectid', 'ip', 'uri', 'bytes', 'bits', 'regex'
]);

/** The sized integers' ranges (DXNS.md §1's sugar). */
const SIZED = new Map([
  ['int32', [-2_147_483_648n, 2_147_483_647n]],
  ['int64', [-9_223_372_036_854_775_808n, 9_223_372_036_854_775_807n]],
  ['uint32', [0n, 4_294_967_295n]],
  ['uint64', [0n, 18_446_744_073_709_551_615n]]
]);

/** What a doc may say about a type (DXNS.md §1b), in the order its refusal names them. */
const ANNOTATION_KEYS = ['title', 'description', 'examples', 'read-only', 'write-only', 'deprecated', 'meta', 'values'];

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
 * (DXNS.md §5, Jan, 2026-10-20). `names` maps an entry's key to the
 * name it is registered under -- a tree's full names (DXNS.md §6,
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

  /** @type {Array<[string, unknown]>} */
  const schemaEntries = [];
  /** @type {Array<[string, unknown]>} */
  const aliasEntries = [];
  for (const [name, value] of namedEntries) {
    const inner = undoc(value);
    if (inner instanceof DXNStruct && inner.name === 'schema') schemaEntries.push([name, /** @type {any} */ (value)]);
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
  // A named type's annotations wrap it whole: a generic keeps them on its
  // body, a shape takes the name as it would bare.
  if (isDoc(raw) && /** @type {DXNTuple} */ (raw).items.length === 3) {
    const [, inner, notes] = /** @type {DXNTuple} */ (raw).items;
    const compiled = compileNamed(name, inner, scope);
    if (compiled.form === 'generic') return { ...compiled, body: { form: 'doc', elem: compiled.body, notes: annotations(notes, compiled.body) } };
    return { form: 'doc', elem: compiled, notes: annotations(notes, compiled) };
  }
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
      return { ...type, base: resolved(type.base, known, path), constraints: resolvedTypes(type.constraints, known, path) };
    case 'if':
      return {
        ...type,
        test: resolved(type.test, known, path),
        consequent: resolved(type.consequent, known, path),
        alternative: resolved(type.alternative, known, path)
      };
    case 'list-items':
      return { ...type, particles: resolvedParticles(type.particles, known, path) };
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
    case 'tuple-of-all':
    case 'not':
    case 'nilable':
    case 'tagged':
    case 'doc':
      return { ...type, elem: resolved(type.elem, known, path) };
    case 'map-of':
    case 'ordered-map-of':
      return { ...type, key: resolved(type.key, known, path), value: resolved(type.value, known, path) };
    default:
      return type;
  }
}

/**
 * A refine's types -- `contains`, `content`, `encodes`, `encodes-seq` --
 * resolved as its base is.
 * @param {{[k: string]: any}} constraints @param {Map<string, any>} known @param {string[]} path
 */
function resolvedTypes(constraints, known, path) {
  const out = { ...constraints };
  for (const key of TYPE_KEYS) {
    if (key in out) out[key] = resolved(out[key], known, path);
  }
  return out;
}

/**
 * A `{:list-items}`'s or a group's items, each type in them resolved.
 * @param {any[]} particles @param {Map<string, any>} known @param {string[]} path @returns {any[]}
 */
function resolvedParticles(particles, known, path) {
  return particles.map((p) =>
    p.kind === 'one' ? { kind: 'one', type: resolved(p.type, known, path) } : { ...p, group: resolvedParticles(p.group, known, path) }
  );
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
    case 'doc':
      return unguardedNames(type.elem);
    case 'refine':
      return unguardedNames(type.base);
    case 'if':
      return [type.test, type.consequent, type.alternative].flatMap(unguardedNames);
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
  // A schema's annotations, `{:doc %schema{...} %{...}}`, kept on its
  // `Compiled`.
  if (isDoc(entry) && /** @type {DXNTuple} */ (entry).items.length === 3) {
    const [, inner, notes] = /** @type {DXNTuple} */ (entry).items;
    const compiled = compileEntry(inner, aliases);
    compiled.annotations = annotations(notes, 'schema');
    return compiled;
  }
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
 * schema is written as now (DXNS.md §4), rather than that a field has no
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
        '%schema(N){field: type, ...}, and refuses undeclared fields with strict: true (DXNS.md §4)'
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
    // Sugar (DXNS.md §1, Jan, 2026-10-20): protobuf's and MongoDB's sized
    // numbers as their ranges, `:float32` as single precision, `:number` as
    // every kind of number.
    const sized = SIZED.get(value.name);
    if (sized) return { form: 'refine', base: { form: 'primitive', name: 'integer' }, constraints: { min: sized[0], max: sized[1] } };
    if (value.name === 'float32') return { form: 'refine', base: { form: 'primitive', name: 'float' }, constraints: { float32: true } };
    if (value.name === 'number') {
      return { form: 'any-of', variants: ['integer', 'float', 'decimal', 'rational'].map((name) => ({ form: 'primitive', name })) };
    }
    // DXN 0.2's timestamp type, now a datetime in UTC (DXNS.md §2, Jan,
    // 2026-10-20): a schema naming it keeps its meaning.
    if (value.name === 'timestamp') {
      return { form: 'refine', base: { form: 'primitive', name: 'datetime' }, constraints: { offsets: new DXNList(['Z']) } };
    }
    throw new SchemaCompileError(`unrecognized type expression: ${shown(value)}`);
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
      const base = compileTypeExpr(rest[0], aliases);
      return { form: 'refine', base, constraints: refineConstraints(rest[1], aliases) };
    }
    // `{:list-items p ...}`: a list's items in order, each `p` a type for
    // one item or a `{:repeat ...}` (DXNS.md §1a).
    if (tag === 'list-items') return { form: 'list-items', particles: particles(rest, aliases) };
    if (tag === 'tuple-of-all' && rest.length === 1) return { form: 'tuple-of-all', elem: compileTypeExpr(rest[0], aliases) };
    // `{:const v}`: the one value `v`, `{:enum v}`.
    if (tag === 'const') {
      if (rest.length !== 1) throw new SchemaCompileError('a const is {:const value}');
      return { form: 'enum', literals: rest };
    }
    // `{:if I T E}`: JSON Schema's if, then and else; `E` is `:any` when
    // not given.
    if (tag === 'if') {
      if (rest.length !== 2 && rest.length !== 3) throw new SchemaCompileError('an if is {:if test then else}, else :any when left out');
      return {
        form: 'if',
        test: compileTypeExpr(rest[0], aliases),
        consequent: compileTypeExpr(rest[1], aliases),
        alternative: compileTypeExpr(rest.length === 3 ? rest[2] : new DXNKeyword('any'), aliases)
      };
    }
    // `{:doc type %{...}}`: the type, annotated (DXNS.md §1b).
    if (tag === 'doc') {
      if (rest.length !== 2) throw new SchemaCompileError('a doc is {:doc type %{description: ..., ...}}');
      const type = compileTypeExpr(rest[0], aliases);
      return { form: 'doc', elem: type, notes: annotations(rest[1], type) };
    }
    // `{:tagged name type}`: a custom tag of that name, its value a type
    // (DXNS.md §1).
    if (tag === 'tagged') {
      if (rest.length !== 2) throw new SchemaCompileError('a tagged is {:tagged name type}');
      const name = nameOf(rest[0]);
      if (name === null) throw new SchemaCompileError('a tagged is {:tagged name type}, the name a symbol, keyword or string');
      // Required here, not at the top: the parser reads schemas with this module.
      if (require('../text/parser.cjs').BUILT_IN_TAGS.has(name)) throw new SchemaCompileError(`${name} is a built-in tag (DXN.md §1.3), no custom one: its type is :${name}`);
      return { form: 'tagged', name, elem: compileTypeExpr(rest[1], aliases) };
    }
    if (tag === 'repeat' || tag === 'group') throw new SchemaCompileError(`a ${tag} stands only among {:list-items ...}'s items`);
  }

  throw new SchemaCompileError(`unrecognized type expression: ${shown(value)}`);
}

/**
 * A `{:list-items}`'s or a group's items: `{kind: 'one', type}` for a
 * type, `{kind: 'repeat', group, min, max}` for a repeat, `max` null when
 * there is no upper bound.
 * @param {unknown[]} values @param {Map<string, unknown>} aliases
 * @returns {import('./type-expr.cjs').Particle[]}
 */
function particles(values, aliases) {
  return values.map((value) => particle(value, aliases));
}

/** @param {unknown} value @param {Map<string, unknown>} aliases @returns {import('./type-expr.cjs').Particle} */
function particle(value, aliases) {
  const head = value instanceof DXNTuple && value.items[0] instanceof DXNKeyword ? value.items[0].name : null;
  if (head === 'repeat') {
    const [, inner, least, most] = /** @type {DXNTuple} */ (value).items;
    const fits =
      /** @type {DXNTuple} */ (value).items.length === 4 &&
      typeof least === 'bigint' &&
      least >= 0n &&
      (most === null || (typeof most === 'bigint' && most >= least));
    if (!fits) throw new SchemaCompileError('a repeat is {:repeat type min max}: 0 <= min <= max, max nil for no bound');
    const group = inner instanceof DXNTuple && inner.items[0] instanceof DXNKeyword && inner.items[0].name === 'group' ? inner.items.slice(1) : [inner];
    return { kind: 'repeat', group: particles(group, aliases), min: Number(least), max: most === null ? null : Number(most) };
  }
  if (head === 'group') throw new SchemaCompileError('a group stands only in a repeat, {:repeat {:group a b ...} min max}');
  return { kind: 'one', type: compileTypeExpr(value, aliases) };
}

const REFINE_KEYS = new Set([
  'min', 'max', 'exclusive-min', 'exclusive-max', 'multiple-of', 'min-length', 'max-length',
  'min-bytes', 'max-bytes', 'pattern', 'min-count', 'max-count', 'finite', 'float32', 'offsets',
  'version', 'prefix', 'contains', 'min-contains', 'max-contains', 'unique', 'unique-by',
  'min-precision', 'max-precision', 'min-exponent', 'max-exponent', 'bits', 'before-now',
  'after-now', 'within', 'resolution', 'format', 'encoding', 'media-type', 'content', 'encodes',
  'encodes-seq'
]);

const COUNTS = ['min-length', 'max-length', 'min-bytes', 'max-bytes', 'min-count', 'max-count', 'min-contains', 'max-contains', 'min-precision', 'max-precision'];
const FLAGS = ['finite', 'float32', 'unique', 'before-now', 'after-now', 'prefix'];
const BOUNDS = ['min', 'max', 'exclusive-min', 'exclusive-max'];
const ENCODINGS = ['base64', 'base64url', 'base32', 'base16'];

/** What `content` reads a string as, by its media type. */
const CONTENT_READERS = [null, 'application/dxn', 'application/dxnb'];

/**
 * A refine's constraints by name, every key one DXNS.md §2 knows and
 * every argument one it takes: a misspelt key would otherwise refuse
 * every value, silently, and a bad argument fail at check time. The
 * types are compiled here; `unique-by`, `format`, `resolution` and
 * `encoding` become names.
 * @param {Map<unknown, unknown>} written @param {Map<string, unknown>} aliases
 * @returns {{[k: string]: unknown}}
 */
function refineConstraints(written, aliases) {
  const named = constraintNames(written);
  const unknown = Object.keys(named)
    .sort(byCodepoint)
    .find((key) => !REFINE_KEYS.has(key));
  if (unknown !== undefined) throw new SchemaCompileError(`${unknown} is no refine constraint (DXNS.md §2)`);
  if (!('contains' in named) && ('min-contains' in named || 'max-contains' in named)) {
    throw new SchemaCompileError('min-contains and max-contains count the items a contains matches');
  }
  namedArg(named, 'unique-by', null);
  namedArg(named, 'format', Format.names());
  namedArg(named, 'resolution', resolutions());
  namedArg(named, 'encoding', ENCODINGS);
  for (const key of Object.keys(named).sort(byCodepoint)) {
    const what = argument(key, named[key]);
    if (what !== null) throw new SchemaCompileError(`${key} takes ${what}, not ${shown(named[key])}`);
  }
  contentReadable(named);
  for (const key of TYPE_KEYS) {
    if (key in named) named[key] = compileTypeExpr(named[key], aliases);
  }
  return named;
}

/**
 * What `key` takes when `arg` is not of that kind; `null` when it is, or
 * when the key takes anything.
 * @param {string} key @param {unknown} arg @returns {string | null}
 */
function argument(key, arg) {
  if (COUNTS.includes(key)) return typeof arg === 'bigint' && arg >= 0n ? null : 'a non-negative integer';
  if (key === 'min-exponent' || key === 'max-exponent') return typeof arg === 'bigint' ? null : 'an integer';
  if (FLAGS.includes(key)) return typeof arg === 'boolean' ? null : 'true or false';
  if (BOUNDS.includes(key)) {
    return comparable(arg) ? null : 'a number, date, time, datetime, local date-time or a duration without years or months';
  }
  switch (key) {
    case 'multiple-of':
      return nonzeroNumber(arg) ? null : 'a number other than 0';
    case 'pattern':
      return arg instanceof DXNRegex ? null : 'a regex, @regex "..."';
    case 'version':
      return arg === 4n || arg === 6n ? null : '4 or 6';
    case 'offsets': {
      const items = listItems(arg);
      return items !== null && items.every(isOffset) ? null : 'a list of offsets, "Z" or "±HH:MM"';
    }
    case 'bits': {
      const items = listItems(arg);
      return items !== null && items.every((n) => typeof n === 'bigint' && n >= 0n) ? null : 'a list of bit numbers, non-negative integers';
    }
    case 'within':
      return span(arg) ? null : 'a duration without years or months';
    // RFC 6838's type/subtype, without parameters.
    case 'media-type':
      return typeof arg === 'string' && MEDIA_TYPE.test(arg) ? null : 'a media type, "type/subtype"';
    default:
      return null;
  }
}

const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
const OFFSET = /^[+-](?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

/** A list's items, `null` for a value that is no list. @param {unknown} value @returns {unknown[] | null} */
function listItems(value) {
  if (value instanceof DXNList) return value.items;
  return Array.isArray(value) ? value : null;
}

/** Whether `value` is an offset, `Z` or `±HH:MM`. @param {unknown} value @returns {boolean} */
function isOffset(value) {
  return value === 'Z' || (typeof value === 'string' && OFFSET.test(value));
}

/**
 * `content` reads a DXN document: text, or `.dxnb` under
 * application/dxnb, which a string holds only encoded.
 * @param {{[k: string]: unknown}} named
 */
function contentReadable(named) {
  if (!('content' in named)) return;
  const written = named['media-type'];
  const media = typeof written === 'string' ? written.toLowerCase() : null;
  if (!CONTENT_READERS.includes(media)) {
    throw new SchemaCompileError(`content reads application/dxn or application/dxnb, not ${shown(media)}`);
  }
  if (media === 'application/dxnb' && !('encoding' in named)) {
    throw new SchemaCompileError('content under application/dxnb needs an encoding: a string holds no raw bytes');
  }
}

/**
 * The constraints keyed by their names; a key that is no name is a
 * compile error, not a crash.
 * @param {Map<unknown, unknown>} written
 * @returns {{[k: string]: unknown}}
 */
function constraintNames(written) {
  /** @type {{[k: string]: unknown}} */
  const named = {};
  for (const [key, value] of written.entries()) {
    const name = nameOf(key);
    if (name === null) throw new SchemaCompileError(`a refine constraint's key is a name, not ${shown(key)}`);
    named[name] = value;
  }
  return named;
}

/**
 * `key`'s argument made a name, in place, one of `allowed` when they are
 * given.
 * @param {{[k: string]: unknown}} named @param {string} key @param {string[] | null} allowed
 */
function namedArg(named, key, allowed) {
  if (!(key in named)) return;
  const arg = named[key];
  const name = nameOf(arg);
  if (name === null || (allowed !== null && !allowed.includes(name))) {
    throw new SchemaCompileError(`${key} takes ${expected(allowed)}, not ${shown(arg)}`);
  }
  named[key] = name;
}

/** @param {string[] | null} allowed @returns {string} */
function expected(allowed) {
  return allowed === null ? 'a name' : `one of ${[...allowed].sort(byCodepoint).map((a) => `:${a}`).join(' ')}`;
}

/** A keyword's, symbol's or string's name; `null` for any other value. @param {unknown} value @returns {string | null} */
function nameOf(value) {
  if (value instanceof DXNKeyword || value instanceof DXNSymbol) return value.name;
  if (typeof value === 'string') return value;
  return null;
}

/**
 * A value as an error message shows it: in its canonical DXN form
 * (DXN.md §1.5), as the reference's `Dextrin.Canonical.print/1` writes it,
 * when it has one.
 * @param {unknown} value @returns {string}
 */
function shown(value) {
  try {
    return canonical(value);
  } catch {
    return describe(value);
  }
}

/** Strings in code point order, as Elixir's `Enum.sort/1` orders them. @param {string} a @param {string} b */
function byCodepoint(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

// ---- annotations, {:doc T %{...}} (DXNS.md §1b) ---------------------------

/** Whether `value` is written `{:doc ...}`. @param {unknown} value */
function isDoc(value) {
  return value instanceof DXNTuple && value.items[0] instanceof DXNKeyword && value.items[0].name === 'doc';
}

/**
 * An entry's value without the `{:doc ...}` around it.
 * @param {unknown} value @returns {unknown}
 */
function undoc(value) {
  return isDoc(value) && /** @type {DXNTuple} */ (value).items.length === 3 ? /** @type {DXNTuple} */ (value).items[1] : value;
}

/**
 * A doc's annotations by name, each of its kind; `type` is what they
 * annotate -- `'schema'` for a whole schema, `'value'` for one of an
 * enum's values -- so `values` can be checked against an enum's literals.
 * `values` becomes a `Map` from each literal to its own annotations, by
 * name.
 * @param {unknown} raw @param {any} type
 * @returns {{[k: string]: unknown}}
 */
function annotations(raw, type) {
  if (!(raw instanceof Map)) throw new SchemaCompileError(`a doc's annotations are a map, %{description: ...}, not ${shown(raw)}`);
  const named = constraintNames(raw);
  for (const key of Object.keys(named).sort(byCodepoint)) {
    const what = annotation(key, named[key], type);
    if (what !== null) throw new SchemaCompileError(`a doc's ${key} is ${what}, not ${shown(named[key])}`);
  }
  if ('values' in named) {
    const values = /** @type {Map<unknown, unknown>} */ (named.values);
    named.values = new Map(Array.from(values, ([literal, notes]) => [literal, annotations(notes, 'value')]));
  }
  return named;
}

/**
 * What `key` takes when `value` is not of that kind; `null` when it is. A
 * key that is no annotation, and an enum's value that is wrong, throw.
 * @param {string} key @param {unknown} value @param {any} type
 * @returns {string | null}
 */
function annotation(key, value, type) {
  switch (key) {
    case 'title':
    case 'description':
      return typeof value === 'string' ? null : 'a string';
    case 'examples':
      return value instanceof DXNList ? null : 'a list';
    case 'read-only':
    case 'write-only':
      return typeof value === 'boolean' ? null : 'true or false';
    case 'deprecated':
      return typeof value === 'boolean' || typeof value === 'string' ? null : 'true, false or a reason';
    case 'meta':
      return value instanceof Map ? null : 'a map';
    case 'values':
      if (!(value instanceof Map) || type === null || typeof type !== 'object' || type.form !== 'enum') {
        return "a map of an enum's values to their annotations, on an enum";
      }
      enumValues(value, type.literals);
      return null;
    default:
      throw new SchemaCompileError(`${key} is no annotation; a doc holds ${ANNOTATION_KEYS.join(', ')}`);
  }
}

/**
 * An enum's `values:`: each key one of its `literals`, each value a map of
 * annotations holding no `values` of its own.
 * @param {Map<unknown, unknown>} values @param {unknown[]} literals
 */
function enumValues(values, literals) {
  for (const [literal, notes] of Array.from(values).sort(([a], [b]) => dxnCompare(a, b))) {
    if (!literals.some((l) => dxnEquals(l, literal))) {
      throw new SchemaCompileError(`a doc's values annotate the enum's own values; ${shown(literal)} is none of them`);
    }
    if (!(notes instanceof Map)) throw new SchemaCompileError("a doc's values hold a map of annotations for each value");
    if (Array.from(notes.keys()).some((k) => k instanceof DXNKeyword && k.name === 'values')) {
      throw new SchemaCompileError("a value's annotations hold no values of their own");
    }
    annotations(notes, 'value');
  }
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
