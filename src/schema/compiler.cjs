'use strict';

/**
 * @fileoverview Compiles a parsed `.dxns` document (an ordinary
 * decoded DXN value — a `.dxns` file is valid `.dxn`, whose one piece of
 * grammar for schemas is what a `%schema` or `%shape` is built from,
 * `DXNS.md` §4b; what makes it a *schema* document is purely the shape
 * of the value it parses to: a map from name to type expression) into
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
const Bases = require('./bases.cjs');
const { canonical } = require('../canonical.cjs');
const DXNRegex = require('../values/regex.cjs');
const { resolutions, comparable, nonzeroNumber, span, TYPE_KEYS, instantiate, paramName, matches } = require('./type-expr.cjs');
const Format = require('./format.cjs');
const Deprecations = require('./deprecations.cjs');
const { dxnEquals, dxnCompare } = require('../values/equality.cjs');

const PRIMITIVES = new Set([
  'nil', 'boolean', 'integer', 'float', 'decimal', 'rational', 'string', 'char', 'symbol', 'keyword',
  'list', 'tuple', 'map', 'ordered-map', 'set', 'sorted-set', 'array',
  'date', 'time', 'datetime', 'local-datetime', 'duration', 'uuid', 'objectid', 'ip', 'uri', 'bytes', 'bits', 'regex'
]);

/** The sized integers' ranges (DXNS.md §1's sugar). */
const SIZED = new Map([
  ['int8', [-128n, 127n]],
  ['int16', [-32_768n, 32_767n]],
  ['uint8', [0n, 255n]],
  ['uint16', [0n, 65_535n]],
  ['int32', [-2_147_483_648n, 2_147_483_647n]],
  ['int64', [-9_223_372_036_854_775_808n, 9_223_372_036_854_775_807n]],
  ['uint32', [0n, 4_294_967_295n]],
  ['uint64', [0n, 18_446_744_073_709_551_615n]]
]);

/** What a doc may say about a type (DXNS.md §1b), in the order its refusal names them. */
const ANNOTATION_KEYS = [
  'title', 'description', 'examples', 'read-only', 'write-only', 'deprecated', 'meta', 'values',
  'discriminator', 'secret', 'key', 'visibility', 'messages'
];

/** The stages a field may be seen in, what `visibility` names (DXNS.md §1b). */
const VISIBILITIES = ['create', 'read', 'update', 'delete', 'query'];

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
  const written = [];
  for (const [name, value] of namedEntries) {
    const inner = undoc(value);
    if (inner instanceof DXNStruct && inner.name === 'schema') schemaEntries.push([name, /** @type {any} */ (value)]);
    else written.push([name, value]);
  }

  // `Color: %type(2)[T]` (Way B, DXNS.md §5c): the definition `T`, at
  // version 2; a plain definition is version 1.
  /** @type {Map<string, number>} */
  const versions = new Map();
  const aliasEntries = written.map(([name, raw]) => {
    let found;
    try {
      found = typeVersion(raw);
    } catch (err) {
      throw new SchemaCompileError(`named type ${JSON.stringify(name)}: ${errorMessage(err)}`);
    }
    versions.set(name, found.version);
    return /** @type {[string, unknown]} */ ([name, found.type]);
  });

  const aliased = compileAliases(aliasEntries, baseRegistry, names, schemaEntries, versions);
  const document = new Map([...aliasEntries, ...schemaEntries]);
  let registry = aliased.registry;
  for (const [name, entry] of schemaEntries) {
    let compiled;
    try {
      // A schema built from others (DXNS.md §4b) takes the fields built
      // for it, each now resolved; any other is compiled from its body.
      // A generic's use in either asks which schema extends which, so the
      // registry and the document go along.
      const built = aliased.built.get(name);
      const lookup = { registry, document, versions };
      compiled = built
        ? builtEntry(entry, built, withLookup(new Map(registry.typeAliases), lookup))
        : compileEntry(entry, scopeOf(registry.typeAliases, names, lookup));
    } catch (err) {
      throw new SchemaCompileError(`schema ${JSON.stringify(name)}: ${errorMessage(err)}`);
    }
    // A discriminator in a field's type, its variants resolved.
    discriminators(
      new Map([[name, { form: 'shape', name, fields: compiled.fields, extras: compiled.extras }]]),
      { document, compiled: registry.typeAliases, scope: scopeOf(registry.typeAliases, names, { registry, document, versions }), registry },
      aliased.built
    );
    compiled.name = name;
    registry = registry.addStructSchema(name, compiled);
  }
  // What the document's entries use that is deprecated (DXNS.md §1b), kept
  // in the registry.
  return registry.withWarnings(Deprecations.compileWarnings(namedEntries, names, registry));
}

/**
 * A named type's entry as written, without its version (`DXNS.md` §5c):
 * `%type(N)[T]` is `T` at version `N`, a `{:doc}` around it staying around
 * `T`; any other definition is version 1. A malformed `%type` throws.
 * @param {unknown} raw @returns {{type: unknown, version: number}}
 */
function typeVersion(raw) {
  if (isDoc(raw) && /** @type {DXNTuple} */ (raw).items.length === 3) {
    const [doc, inner, notes] = /** @type {DXNTuple} */ (raw).items;
    const found = typeVersion(inner);
    return { type: new DXNTuple([doc, found.type, notes]), version: found.version };
  }
  if (raw instanceof DXNStruct && raw.name === 'type') {
    const fits =
      typeof raw.version === 'number' && raw.fields.type === 'positional' && raw.fields.values.length === 1 && raw.extra.length === 0 && raw.bases.length === 0;
    if (!fits) throw new SchemaCompileError('a version of a named type is %type(N)[type]: one type, at version N');
    return { type: /** @type {any} */ (raw.fields).values[0], version: /** @type {number} */ (raw.version) };
  }
  return { type: raw, version: 1 };
}

/**
 * The schema built for `entry` (`DXNS.md` §4b): the fields `built` holds
 * for it, each type resolved against `known`, its bases and extras as
 * built, and the annotations a `{:doc ...}` around it gives.
 * @param {unknown} entry
 * @param {Built} built
 * @param {Map<string, any>} known
 * @returns {Compiled}
 */
function builtEntry(entry, built, known) {
  const notes = isDoc(entry) && /** @type {DXNTuple} */ (entry).items.length === 3 ? annotations(/** @type {DXNTuple} */ (entry).items[2], 'schema') : {};
  const fields = built.fields.map((f) => new Field({ ...f, default: f.default, type: resolved(f.type, known, []) }));
  const version = /** @type {DXNStruct} */ (undoc(entry)).version ?? 1;
  return new Compiled({ version, fields, annotations: notes, bases: built.bases, extras: resolvedExtras(built.extras, known, []) });
}

/**
 * What was built for a schema or shape built from others: its fields,
 * its bases as `Compiled` records them, and its extras (`DXNS.md` §4c).
 * @typedef {{fields: Field[], bases: import('../values/struct.cjs').Base[], extras: Extras}} Built
 */

/**
 * What a schema or shape takes beyond its fields (`DXNS.md` §4c): its
 * `* K => V` entries, `[K, V]` each in order, and whether `- *` closes
 * it. A key no field declares matches the V of every entry whose K takes
 * it; a key no entry takes is kept, unless the body is closed.
 * @typedef {import('./compiled.cjs').Extras} Extras
 */

/** Extras that say nothing: any extra is kept, and a strict decode refuses it. @returns {Extras} */
function openExtras() {
  return { entries: [], closed: false };
}

/**
 * `extras` with the types of its `* K => V` entries resolved, as a
 * field's are.
 * @param {Extras} extras @param {Map<string, any>} known @param {string[]} path @returns {Extras}
 */
function resolvedExtras(extras, known, path) {
  return { ...extras, entries: extras.entries.map(([k, v]) => /** @type {[any, any]} */ ([resolved(k, known, path), resolved(v, known, path)])) };
}

/**
 * What a `%schema`'s or `%shape`'s own body says of its extras (`DXNS.md`
 * §4c): its `* K => V` entries compiled in `scope`, and whether `- *`
 * closes it; `null` when it says nothing.
 * @param {DXNStruct} raw @param {Map<string, unknown>} scope @returns {Extras | null}
 */
function ownExtras(raw, scope) {
  const closed = raw.drops.includes('*');
  if (raw.rest.length === 0 && !closed) return null;
  return {
    entries: raw.rest.map((entry) => /** @type {[any, any]} */ ([compileTypeExpr(entry.key, scope), compileTypeExpr(entry.value, scope)])),
    closed
  };
}

/**
 * The `- field`s of a body: its drops but `- *`, which closes it instead.
 * @param {string[]} drops @returns {string[]}
 */
function fieldDrops(drops) {
  return drops.filter((field) => field !== '*');
}

/**
 * Compiles the document's named types into `registry`, and builds every
 * schema or shape built from others (`DXNS.md` §4b) -- once the plain
 * named types are compiled and before any is resolved, since a base may
 * be any schema or shape of the document, or one already loaded. A built
 * shape joins the named types; what was built for a schema comes back in
 * `built`, by name.
 * @param {Array<[string, unknown]>} aliasEntries
 * @param {import('../registry.cjs')} registry
 * @param {Map<string, string>} names
 * @param {Array<[string, unknown]>} schemaEntries
 * @param {Map<string, number>} versions each named type's version (`DXNS.md` §5c).
 * @returns {{registry: import('../registry.cjs'), built: Map<string, Built>}}
 */
function compileAliases(aliasEntries, registry, names, schemaEntries, versions) {
  // Every named type in a document sees every other (design/
  // shapes-and-case.md): each is compiled with its siblings standing as
  // `{form: 'named'}`, and those are put in place once all are read -- so
  // the order of a map's entries, which DXN does not give, never matters.
  /** @type {Array<[string, unknown]>} */
  const siblings = aliasEntries.map(([n]) => [n, { form: 'named', name: n }]);
  const document = new Map([...aliasEntries, ...schemaEntries]);
  const scope = scopeOf(new Map([...registry.typeAliases, ...siblings]), names, { registry, document, versions });
  const extending = aliasEntries.filter(([, v]) => isBuilt(v));
  /** @type {Map<string, any>} */
  const compiled = new Map();
  for (const [name, rawValue] of aliasEntries) {
    if (isBuilt(rawValue)) continue;
    try {
      compiled.set(name, compileNamed(name, rawValue, scope));
    } catch (err) {
      throw new SchemaCompileError(`named type ${JSON.stringify(name)}: ${errorMessage(err)}`);
    }
  }
  /** @type {Lookup} */
  const lookup = { document, compiled, scope, registry };
  /** @type {Map<string, Built>} */
  const built = new Map();
  for (const [name] of [...extending, ...schemaEntries.filter(([, v]) => isBuilt(v))]) build(name, [], lookup, built);
  withBuiltShapes(compiled, extending, built);
  guarded(compiled);
  discriminators(compiled, lookup, built);
  const known = withLookup(new Map([...registry.typeAliases, ...compiled]), { registry, document, versions });
  let result = registry;
  for (const [name] of aliasEntries) {
    let typeExpr;
    try {
      const own = compiled.get(name);
      typeExpr =
        own.form === 'generic'
          ? { ...own, body: resolved(own.body, withLookup(new Map([...known, ...paramBounds(own.params)]), /** @type {any} */ (known).lookup), [name]) }
          : resolved(own, known, [name]);
    } catch (err) {
      throw new SchemaCompileError(`named type ${JSON.stringify(name)}: ${errorMessage(err)}`);
    }
    result = result.putTypeVersion(name, versions.get(name) ?? 1, typeExpr);
  }
  return { registry: result, built };
}

// ---- discriminators (DXNS.md §1b) -------------------------------------------

/**
 * Every variant under a `discriminator` has that field: the field a
 * value's variant is chosen by. Each named type is looked at in name
 * order; the variants of a schema or a shape of the document, or of one
 * loaded, are found by name.
 * @param {Map<string, any>} compiled @param {Lookup} lookup @param {Map<string, Built>} built
 */
function discriminators(compiled, lookup, built) {
  for (const name of Array.from(compiled.keys()).sort(byCodepoint)) {
    for (const [field, variants] of discriminated(compiled.get(name))) {
      for (const variant of variants) {
        const names = variantFields(variant, lookup, built, []);
        if (names === null) {
          throw new SchemaCompileError(
            `${JSON.stringify(name)}: its discriminator ${field} needs every variant to be a schema or a shape; ${variantLabel(variant)} is not`
          );
        }
        if (!names.includes(field)) {
          throw new SchemaCompileError(`${JSON.stringify(name)}: its discriminator ${field} is no field of ${variantLabel(variant)}`);
        }
      }
    }
  }
}

/**
 * Every `{:doc {:any-of ...} %{discriminator: f}}` in `type`, a field's
 * type included, as `[f, variants]`.
 * @param {unknown} type @returns {Array<[string, any[]]>}
 */
function discriminated(type) {
  if (Array.isArray(type)) return type.flatMap(discriminated);
  if (type instanceof Field) return discriminated(type.type);
  if (type === null || typeof type !== 'object' || Object.getPrototypeOf(type) !== Object.prototype) return [];
  const t = /** @type {any} */ (type);
  if (t.form === 'doc') {
    const own = typeof t.notes.discriminator === 'string' ? [/** @type {[string, any[]]} */ ([t.notes.discriminator, variantList(t.elem)])] : [];
    return [...own, ...discriminated(t.elem)];
  }
  return Object.values(t).flatMap(discriminated);
}

/** An any-of's or one-of's variants, through annotations. @param {any} type @returns {any[]} */
function variantList(type) {
  return type.form === 'doc' ? variantList(type.elem) : type.variants;
}

/**
 * The names of a variant's fields: a shape's, or a schema's of the
 * document or one loaded; `null` for a variant that is neither.
 * @param {any} variant @param {Lookup} lookup @param {Map<string, Built>} built @param {string[]} seen
 * @returns {string[] | null}
 */
function variantFields(variant, lookup, built, seen) {
  switch (variant.form) {
    case 'doc':
      return variantFields(variant.elem, lookup, built, seen);
    case 'shape':
      return variant.fields.map((/** @type {Field} */ f) => f.name);
    case 'named': {
      const known = new Map([...lookup.registry.typeAliases, ...lookup.compiled]);
      const type = known.get(variant.name);
      return type === undefined || seen.includes(variant.name) ? null : variantFields(type, lookup, built, [variant.name, ...seen]);
    }
    case 'reference': {
      // A variant pinned to a version (DXNS.md §5c): that version's fields
      // when it is loaded, otherwise judged by its name as an unpinned one.
      if (variant.version !== undefined) {
        const pinned = lookup.registry.fetchStructSchema(variant.name, variant.version);
        if (pinned) return pinned.compiled.fields.map((f) => f.name);
      }
      const own = built.get(variant.name);
      if (own) return own.fields.map((f) => f.name);
      const raw = undoc(lookup.document.get(variant.name));
      if (raw instanceof DXNStruct && raw.name === 'schema' && raw.fields.type === 'keyed') {
        try {
          return raw.fields.pairs.map(([key, value]) => compileField(key, value, lookup.scope).name);
        } catch {
          return null;
        }
      }
      const found = lookup.registry.fetchStructSchema(variant.name);
      return found ? found.compiled.fields.map((f) => f.name) : null;
    }
    default:
      return null;
  }
}

/** @param {any} variant @returns {string} */
function variantLabel(variant) {
  if (variant.form === 'doc') return variantLabel(variant.elem);
  if (variant.form === 'named' || variant.form === 'reference') return variant.name;
  return 'an inline variant';
}

// ---- built from others (DXNS.md §4b) ---------------------------------------

/**
 * Where a base is looked for: the document's entries by full name, its
 * plain named types compiled, the scope they compile in, and the
 * registry holding what is already loaded.
 * @typedef {{document: Map<string, unknown>, compiled: Map<string, any>, scope: Map<string, unknown>, registry: import('../registry.cjs')}} Lookup
 */

/**
 * Whether `entry` is a `%schema` or `%shape` built from others.
 * @param {unknown} entry @returns {boolean}
 */
function isBuilt(entry) {
  const inner = undoc(entry);
  return inner instanceof DXNStruct && (inner.name === 'schema' || inner.name === 'shape') && inner.isBuilt();
}

/**
 * Builds the document's entry `name` from its bases into `built`, with
 * the bases as `Compiled` records them. `path` holds the entries being
 * built, so one that reaches itself is seen.
 * @param {string} name @param {string[]} path @param {Lookup} lookup @param {Map<string, Built>} built
 */
function build(name, path, lookup, built) {
  if (built.has(name)) return;
  if (path.includes(name)) throw new SchemaCompileError(`${JSON.stringify(name)} is built from itself`);
  const raw = /** @type {DXNStruct} */ (undoc(lookup.document.get(name)));
  if (raw.bases.length === 0) throw new SchemaCompileError(`${JSON.stringify(name)} drops a field, but names no base to drop it from`);
  if (raw.name === 'shape' && raw.version !== null) throw new SchemaCompileError('a shape has no version: %shape extends Base {field: type, ...}');
  if (raw.fields.type !== 'keyed') throw new SchemaCompileError(`a ${raw.name} lists its fields by name: %${raw.name}(N){field: type, ...}`);
  distinctBases(name, raw.bases);
  const own = ownFields(name, raw.fields.pairs, lookup.scope);
  let bodyExtras;
  try {
    bodyExtras = ownExtras(raw, lookup.scope);
  } catch (err) {
    throw new SchemaCompileError(`${JSON.stringify(name)}: ${errorMessage(err)}`);
  }
  const found = foundBases(name, raw.bases, [name, ...path], lookup, built);
  // Two fields of one name from two bases compare with their types in
  // place: a base of this document still names its sibling types, one
  // already loaded has them resolved.
  const known = new Map([...lookup.registry.typeAliases, ...lookup.compiled]);
  /** @param {Field} a @param {Field} b */
  const same = (a, b) => dxnEquals(inPlace(a, known, []), inPlace(b, known, []));
  let fields;
  try {
    fields = Bases.merge(found, own, fieldDrops(raw.drops), same);
  } catch (err) {
    throw new SchemaCompileError(`${JSON.stringify(name)}: ${errorMessage(err)}`);
  }
  const extras = mergedExtras(name, found, own, bodyExtras, known);
  builtCases(name, fields);
  built.set(name, {
    fields,
    bases: found.map((b) => /** @type {import('../values/struct.cjs').Base} */ ([b.kind, b.name, b.version])),
    extras
  });
}

/**
 * A built body's extras (`DXNS.md` §4c): its own when it says; otherwise
 * what its bases say, which must agree -- a base that says nothing is
 * open and agrees with any. What `extends` a closed base can pass as it
 * only when it stays closed and adds no field.
 * @param {string} name @param {Found[]} found @param {Field[]} own @param {Extras | null} ownExtras
 * @param {Map<string, any>} known
 * @returns {Extras}
 */
function mergedExtras(name, found, own, ownExtras, known) {
  /** @type {Extras[]} */
  const said = [];
  for (const base of found) {
    if (dxnEquals(base.extras, openExtras())) continue;
    const inPlaceExtras = inPlace(base.extras, known, []);
    if (!said.some((other) => dxnEquals(inPlace(other, known, []), inPlaceExtras))) said.push(base.extras);
  }
  const closedBase = found.find((b) => b.kind === 'extends' && b.extras.closed);
  if (closedBase && (addedFields(own, closedBase).length > 0 || (ownExtras !== null && !dxnEquals(ownExtras, closedBase.extras)))) {
    throw new SchemaCompileError(
      `${JSON.stringify(name)} extends ${closedBase.name}, which is closed (- *): ` +
        `it adds no field and no extras, or includes ${closedBase.name} instead`
    );
  }
  if (ownExtras !== null) return ownExtras;
  if (said.length > 1) {
    throw new SchemaCompileError(`${JSON.stringify(name)}: its bases differ in their extras (- * or * K => V); say which in its body`);
  }
  return said.length === 1 ? said[0] : openExtras();
}

/**
 * The fields of `own` that `base` does not have.
 * @param {Field[]} own @param {Found} base @returns {Field[]}
 */
function addedFields(own, base) {
  const names = new Set(base.fields.map((f) => f.name));
  return own.filter((f) => !names.has(f.name));
}

/**
 * `type` -- a type, a field, or anything holding them -- with every
 * `{form: 'named'}` replaced by its definition in `known`: what a field
 * compares as, however its base was found. A name already being replaced
 * on the way, or one `known` does not hold, stays as it is.
 * @param {unknown} type @param {Map<string, any>} known @param {string[]} path @returns {any}
 */
function inPlace(type, known, path) {
  if (Array.isArray(type)) return type.map((t) => inPlace(t, known, path));
  if (type instanceof Field) return new Field({ ...type, default: type.default, type: inPlace(type.type, known, path) });
  if (type === null || typeof type !== 'object' || Object.getPrototypeOf(type) !== Object.prototype) return type;
  const t = /** @type {any} */ (type);
  if (t.form === 'named') {
    const target = known.get(t.name);
    return target === undefined || path.includes(t.name) ? t : inPlace(target, known, [t.name, ...path]);
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, inPlace(v, known, path)]));
}

/** @param {string} name @param {import('../values/struct.cjs').Base[]} bases */
function distinctBases(name, bases) {
  const written = bases.map(([, base]) => base);
  const twice = written.find((base, i) => written.indexOf(base) !== i);
  if (twice !== undefined) throw new SchemaCompileError(`${JSON.stringify(name)} names ${twice} twice in its head`);
}

/**
 * The fields the body of `name` declares itself.
 * @param {string} name @param {Array<[string, unknown]>} pairs @param {Map<string, unknown>} scope @returns {Field[]}
 */
function ownFields(name, pairs, scope) {
  try {
    const fields = pairs.map(([key, value]) => {
      try {
        return compileField(key, value, scope);
      } catch (err) {
        throw new SchemaCompileError(`field ${JSON.stringify(key)}: ${errorMessage(err)}`);
      }
    });
    distinctNames(fields);
    return fields;
  } catch (err) {
    throw new SchemaCompileError(`${JSON.stringify(name)}: ${errorMessage(err)}`);
  }
}

/**
 * A `{:case}` in a field names a field of the result (DXNS.md §4b), so
 * one whose field was dropped is refused.
 * @param {string} name @param {Field[]} fields
 */
function builtCases(name, fields) {
  const names = new Set(fields.map((f) => f.name));
  const missing = fields.flatMap((f) => caseNames(f.type)).find((field) => !names.has(field));
  if (missing !== undefined) throw new SchemaCompileError(`${JSON.stringify(name)}: {:case ${missing} ...} names no field of it`);
}

/**
 * The sibling fields every `{:case}` in a compiled type names, short of a
 * shape, whose cases name its own fields.
 * @param {unknown} type @returns {string[]}
 */
function caseNames(type) {
  if (Array.isArray(type)) return type.flatMap(caseNames);
  if (type === null || typeof type !== 'object' || Object.getPrototypeOf(type) !== Object.prototype) return [];
  const t = /** @type {any} */ (type);
  if (t.form === 'shape') return [];
  if (t.form === 'case') return [t.field, ...caseNames(t.branches), ...caseNames(t.otherwise)];
  return Object.values(t).flatMap(caseNames);
}

/**
 * One base, found: the clause naming it, its full name, its fields, its
 * extras (`DXNS.md` §4c), and the version it was taken at (`null` for a
 * shape).
 * @typedef {import('./bases.cjs').FoundBase & {version: number | null, extras: Extras}} Found
 */

/**
 * Each base of the head, found. A base of the document that is itself
 * built is built first.
 * @param {string} name @param {import('../values/struct.cjs').Base[]} bases @param {string[]} path
 * @param {Lookup} lookup @param {Map<string, Built>} built
 * @returns {Found[]}
 */
function foundBases(name, bases, path, lookup, built) {
  return bases.map(([kind, base, version]) => {
    // A tree's full name for a sibling written bare (DXNS.md §6).
    const written = /** @type {Map<string, string> | undefined} */ (/** @type {any} */ (lookup.scope).names)?.get(base) ?? base;
    const full = baseTarget(written, lookup, []);
    try {
      const at = foundBase(full, version, path, lookup, built);
      return { kind, name: full, fields: at.fields, extras: at.extras, version: at.version };
    } catch (err) {
      if (err instanceof SchemaCompileError) throw err;
      throw new SchemaCompileError(`${JSON.stringify(name)}: base ${base}: ${errorMessage(err)}`);
    }
  });
}

/**
 * The fields and extras of `base` at `version`, and the version they are:
 * from the document when it is there, else from what is loaded. A reason
 * a base cannot be used is thrown as a plain `Error`.
 * @param {string} base @param {number | null} version @param {string[]} path
 * @param {Lookup} lookup @param {Map<string, Built>} built
 * @returns {AtVersion}
 */
function foundBase(base, version, path, lookup, built) {
  const used = genericUse(base, lookup);
  if (used !== null) {
    if (version !== null) throw new Error(`a shape has no versions, so ${base}(${version}) names none`);
    return { ...used, version: null };
  }
  if (!lookup.document.has(base)) return loadedBase(base, version, lookup.registry);
  const raw = undoc(lookup.document.get(base));
  if (!(raw instanceof DXNStruct) || (raw.name !== 'schema' && raw.name !== 'shape')) throw new Error('a base is a %schema or a %shape');
  if (raw.name === 'shape' && version !== null) throw new Error(`a shape has no versions, so ${base}(${version}) names none`);
  if (isBuilt(raw)) {
    build(base, path, lookup, built);
    const own = /** @type {Built} */ (built.get(base));
    return atVersion(base, raw, version, { fields: own.fields, extras: own.extras }, lookup);
  }
  if (raw.name === 'shape') return { .../** @type {ShapeBody} */ (shapeBody(lookup.compiled.get(base))), version: null };
  const compiled = compileEntry(raw, lookup.scope);
  return atVersion(base, raw, version, { fields: compiled.fields, extras: compiled.extras }, lookup);
}

/**
 * A shape's fields and extras, as a base gives them.
 * @typedef {{fields: Field[], extras: Extras}} ShapeBody
 */

/**
 * A base's fields and extras at the version they were taken at (`null`
 * for a shape).
 * @typedef {ShapeBody & {version: number | null}} AtVersion
 */

/**
 * A base named by a named type that stands for a schema or a shape
 * (`Human: Person`) is that schema or shape: its name, followed through
 * such names. Any other name is itself.
 * @param {string} name @param {Lookup} lookup @param {string[]} seen @returns {string}
 */
function baseTarget(name, lookup, seen) {
  const raw = undoc(lookup.document.get(name));
  if (raw instanceof DXNStruct && (raw.name === 'schema' || raw.name === 'shape')) return name;
  if (seen.includes(name)) return name;
  const type = new Map([...lookup.registry.typeAliases, ...lookup.compiled]).get(name);
  if (type === undefined) return name;
  const target = undocType(type);
  return target.form === 'reference' || target.form === 'named' ? baseTarget(target.name, lookup, [name, ...seen]) : name;
}

/**
 * A named type that is one use of a generic standing for a shape
 * (`PageOfInt: {:of Page :integer}`): that shape's fields and extras;
 * `null` for any other name.
 * @param {string} name @param {Lookup} lookup @returns {ShapeBody | null}
 */
function genericUse(name, lookup) {
  const known = new Map([...lookup.registry.typeAliases, ...lookup.compiled]);
  const type = known.get(name);
  if (type === undefined) return null;
  const use = undocType(type);
  if (use.form !== 'apply') return null;
  const definition = known.get(use.name);
  if (definition === undefined) return null;
  const generic = undocType(definition);
  if (generic.form !== 'generic') return null;
  // Its defaults filled: a use may leave them out.
  let args;
  try {
    args = filledArgs(use.name, use.args, known);
  } catch {
    return null;
  }
  return shapeBody(instantiate(generic.params, generic.body, args));
}

/** A compiled type without the annotations around it. @param {any} type @returns {any} */
function undocType(type) {
  return type && type.form === 'doc' ? undocType(type.elem) : type;
}

/**
 * A schema of the document at the version the head asks for: its own,
 * or one already loaded. Without a version, the latest of them. A shape
 * has none.
 * @param {string} base @param {DXNStruct} raw @param {number | null} version @param {ShapeBody} body @param {Lookup} lookup
 * @returns {AtVersion}
 */
function atVersion(base, raw, version, body, lookup) {
  if (raw.name === 'shape') return { ...body, version: null };
  const own = raw.version ?? 1;
  // What is loaded, the resolver asked as for any other base.
  const loaded = lookup.registry.fetchStructSchema(base);
  const wanted = version ?? Math.max(own, loaded ? loaded.compiled.version : own);
  return wanted === own ? { ...body, version: own } : loadedBase(base, wanted, lookup.registry);
}

/**
 * A base already loaded: a schema at `version`, or its latest without
 * one; or a shape, which has no versions.
 * @param {string} base @param {number | null} version @param {import('../registry.cjs')} registry
 * @returns {AtVersion}
 */
function loadedBase(base, version, registry) {
  const found = version === null ? registry.fetchStructSchema(base) : registry.fetchStructSchema(base, version);
  if (found) return { fields: found.compiled.fields, extras: found.compiled.extras, version: found.compiled.version };
  const type = registry.typeAliases.get(base);
  if (version !== null) throw new Error(`${base}(${version}) is not loaded`);
  if (type === undefined) throw new Error(`no schema or shape is named ${base}`);
  const body = shapeBody(type);
  if (body === null) throw new Error('a base is a %schema or a %shape');
  return { ...body, version: null };
}

/**
 * A shape's fields and extras, through its annotations; `null` for any
 * other type.
 * @param {any} type @returns {ShapeBody | null}
 */
function shapeBody(type) {
  if (type && type.form === 'shape') return { fields: type.fields, extras: type.extras ?? openExtras() };
  if (type && type.form === 'doc') return shapeBody(type.elem);
  return null;
}

/**
 * Every built shape joins the named types under its name, as a plain one
 * does, with its annotations.
 * @param {Map<string, any>} compiled @param {Array<[string, unknown]>} extending @param {Map<string, Built>} built
 */
function withBuiltShapes(compiled, extending, built) {
  for (const [name, entry] of extending) {
    const own = /** @type {Built} */ (built.get(name));
    const shape = { form: 'shape', name, fields: own.fields, extras: own.extras };
    if (isDoc(entry) && /** @type {DXNTuple} */ (entry).items.length === 3) {
      try {
        compiled.set(name, { form: 'doc', elem: shape, notes: annotations(/** @type {DXNTuple} */ (entry).items[2], shape) });
      } catch (err) {
        throw new SchemaCompileError(`named type ${JSON.stringify(name)}: ${errorMessage(err)}`);
      }
    } else {
      compiled.set(name, shape);
    }
  }
}

/**
 * The scope names compile in: the named types, the document's `names`,
 * and where a generic's bound looks for which schema extends which.
 * @param {Map<string, unknown>} aliases @param {Map<string, string>} names @param {Lookup0 | null} [lookup]
 */
function scopeOf(aliases, names, lookup = null) {
  const scope = new Map(aliases);
  /** @type {any} */ (scope).names = names;
  return lookup ? withLookup(scope, lookup) : scope;
}

/**
 * The registry and the document a generic's bound looks in, for a schema
 * that extends another; and the version each named type of the document
 * has (`DXNS.md` §5c), so a pin to a sibling (`Color(2)`) is seen.
 * @typedef {{registry: import('../registry.cjs'), document: Map<string, unknown>, versions?: Map<string, number>}} Lookup0
 */

/**
 * `known`, carrying `lookup`: what more than the named types a bound check
 * needs. @template {Map<string, any>} M @param {M} known @param {Lookup0 | null} lookup @returns {M}
 */
function withLookup(known, lookup) {
  /** @type {any} */ (known).lookup = lookup;
  return known;
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
    const [, written, body] = raw.items;
    const list = written instanceof DXNList ? written.items : Array.isArray(written) ? written : null;
    if (raw.items.length !== 3 || !list) {
      throw new SchemaCompileError("a generic's parameters are symbols: {:generic [t ...] body}");
    }
    const params = parameters(list, scope);
    const names = params.map(paramName);
    if (body instanceof DXNStruct && body.name === 'schema') {
      throw new SchemaCompileError(
        'a struct schema cannot be generic: a struct goes on the wire under its one name; make the generic a %shape, or give each use a schema of its own'
      );
    }
    /** @type {Array<[string, unknown]>} */
    const bound = names.map((n) => [n, { form: 'param', name: n }]);
    const inner = scopeOf(new Map([...scope, ...bound, ...paramBounds(params)]), /** @type {any} */ (scope).names, /** @type {any} */ (scope).lookup ?? null);
    return { form: 'generic', params, body: compileNamed(name, body, inner) };
  }
  const type = compileTypeExpr(raw, scope);
  return type.form === 'shape' && type.name === null ? { ...type, name } : type;
}

/**
 * `{:generic [t ...] body}`'s parameters, distinct: a bare symbol, or
 * `{t bound}` or `{t bound default}`, the bound and default compiled in
 * the scope around the generic. A bare parameter stays its name; one with
 * a bound or a default is `{name, bound, default}`, `default` `null` for
 * none. A parameter without a default follows none with one, and a
 * default is within its own bound.
 * @param {unknown[]} list @param {Map<string, unknown>} scope
 * @returns {import('./type-expr.cjs').Param[]}
 */
function parameters(list, scope) {
  const params = list.map((p) => parameter(p, scope));
  const names = params.map(paramName);
  if (params.length === 0) throw new SchemaCompileError("a generic's parameters are symbols: {:generic [t ...] body}");
  if (new Set(names).size !== names.length) throw new SchemaCompileError('a generic names a parameter twice');
  const defaulted = params.map((p) => paramDefault(p) !== null);
  if (defaulted.some((d, i) => d && defaulted[i + 1] === false)) {
    throw new SchemaCompileError("a generic's parameter without a default cannot follow one with a default");
  }
  const bad = params.find((p) => {
    const given = paramDefault(p);
    return given !== null && !withinBound(given, paramBound(p), scope);
  });
  if (bad !== undefined) throw new SchemaCompileError(`${paramName(bad)}'s default is outside its own bound`);
  return params;
}

/** @param {unknown} written @param {Map<string, unknown>} scope @returns {import('./type-expr.cjs').Param} */
function parameter(written, scope) {
  if (written instanceof DXNSymbol) return written.name;
  if (written instanceof DXNTuple && written.items[0] instanceof DXNSymbol && (written.items.length === 2 || written.items.length === 3)) {
    const [name, bound, given] = written.items;
    return {
      name: /** @type {DXNSymbol} */ (name).name,
      bound: compileTypeExpr(bound, scope),
      default: written.items.length === 3 ? compileTypeExpr(given, scope) : null
    };
  }
  throw new SchemaCompileError(`a generic's parameter is a symbol, {t bound} or {t bound default}, not ${shown(written)}`);
}

/**
 * The key a generic parameter's bound travels under in the scope of its
 * generic's body: no name can be written so.
 * @param {string} name @returns {string}
 */
function boundKey(name) {
  return `\0bound\0${name}`;
}

/**
 * A generic's parameters' bounds, under the keys a use inside its body
 * finds them by; a bare parameter's is `:any`.
 * @param {import('./type-expr.cjs').Param[]} params @returns {Array<[string, any]>}
 */
function paramBounds(params) {
  return params.map((p) => [boundKey(paramName(p)), paramBound(p) ?? { form: 'any' }]);
}

/** A parameter's bound; `null` for a bare one, which takes anything. @param {import('./type-expr.cjs').Param} param @returns {any} */
function paramBound(param) {
  return typeof param === 'string' ? null : param.bound;
}

/** A parameter's default; `null` when it has none. @param {import('./type-expr.cjs').Param} param @returns {any} */
function paramDefault(param) {
  return typeof param === 'string' ? null : param.default;
}

/**
 * `args` for the generic `name`: every parameter given or defaulted, the
 * defaults filled in, each argument within its parameter's bound. A
 * sibling not yet compiled takes them as they are; they are filled once
 * it is.
 * @param {string} name @param {any[]} args @param {Map<string, any>} known @returns {any[]}
 */
function filledArgs(name, args, known) {
  const target = known.get(name);
  if (target && target.form === 'named') return args;
  if (!target || target.form !== 'generic') throw new SchemaCompileError(`{:of ${name} ...} names no generic`);
  /** @type {import('./type-expr.cjs').Param[]} */
  const params = target.params;
  const required = params.filter((p) => paramDefault(p) === null).length;
  if (args.length < required || args.length > params.length) {
    const arity = required === params.length ? `${required}` : `${required} to ${params.length}`;
    throw new SchemaCompileError(`${name} takes ${arity} type argument(s), {:of ${name} ...} gives ${args.length}`);
  }
  const filled = [...args, ...params.slice(args.length).map(paramDefault)];
  const outside = params.findIndex((p, i) => !withinBound(filled[i], paramBound(p), known));
  if (outside >= 0) {
    throw new SchemaCompileError(
      `{:of ${name} ...}'s ${paramName(params[outside])} takes what its bound takes; ${inspectArg(filled[outside])} is outside it`
    );
  }
  return filled;
}

/** An argument as a refusal names it. @param {any} arg @returns {string} */
function inspectArg(arg) {
  if (arg.form === 'named' || arg.form === 'reference' || arg.form === 'param') return arg.name;
  if (arg.form === 'primitive') return `:${arg.name}`;
  return arg.form;
}

/**
 * Whether `arg` is `bound`, or narrower (see `within`). A sibling not yet
 * compiled, as argument or bound, passes for now: `resolved` checks again,
 * through `filledArgs`, with every definition in hand.
 * @param {any} arg @param {any} bound @param {Map<string, any>} known @returns {boolean}
 */
function withinBound(arg, bound, known) {
  return pending(arg, known) || pending(bound, known) || within(arg, bound, known);
}

/** Whether `type` names a sibling not yet compiled. @param {any} type @param {Map<string, any>} known @returns {boolean} */
function pending(type, known) {
  if (type === null || type.form !== 'named') return false;
  const target = known.get(type.name);
  return target !== undefined && target.form === 'named' && target.name === type.name;
}

/**
 * Whether `arg` is `bound`, or narrower: a refine or annotation of it, a
 * name standing for it, a const or enum whose values it takes, a
 * parameter whose own bound is within it, or a schema that extends it; a
 * bound naming a type is that type. Nothing broader is worked out: DXNS
 * has no general subtyping, so anything else is outside. A `null` or
 * `:any` bound takes everything.
 * @param {any} arg @param {any} bound @param {Map<string, any>} known @returns {boolean}
 */
function within(arg, bound, known) {
  if (bound === null || bound.form === 'any') return true;
  if (sameType(arg, bound)) return true;
  if (arg.form === 'doc') return withinBound(arg.elem, bound, known);
  if (bound.form === 'doc') return withinBound(arg, bound.elem, known);
  if (arg.form === 'refine') return withinBound(arg.base, bound, known);
  if (arg.form === 'enum') {
    const resolvedBound = boundResolved(bound, known);
    return arg.literals.every((/** @type {unknown} */ literal) => matches(resolvedBound, literal));
  }
  // A parameter passed on is within a bound when its own bound is.
  if (arg.form === 'param') {
    const own = known.get(boundKey(arg.name));
    return own !== undefined && withinBound(own, bound, known);
  }
  if (arg.form === 'named') {
    const type = known.get(arg.name);
    if (type === undefined || (type.form === 'named' && type.name === arg.name)) return false;
    return withinBound(type, bound, known);
  }
  // A pinned reference is within what its schema is within (DXNS.md §5c).
  if (arg.form === 'reference' && arg.version !== undefined) return withinBound({ form: 'reference', name: arg.name }, bound, known);
  if (arg.form === 'reference' && bound.form === 'reference' && bound.version === undefined) return extendsBase(arg.name, bound.name, known, []);
  if (bound.form === 'named') {
    const type = known.get(bound.name);
    if (type === undefined || (type.form === 'named' && type.name === bound.name)) return false;
    return withinBound(arg, type, known);
  }
  return false;
}

/** A bound that is a name, as the type it stands for. @param {any} bound @param {Map<string, any>} known @returns {any} */
function boundResolved(bound, known) {
  if (bound.form !== 'named') return bound;
  const type = known.get(bound.name);
  if (type === undefined || (type.form === 'named' && type.name === bound.name)) return bound;
  return boundResolved(type, known);
}

/**
 * Whether two compiled types are the same, part for part.
 * @param {unknown} a @param {unknown} b @returns {boolean}
 */
function sameType(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameType(x, b[i]));
  }
  const structural = (/** @type {unknown} */ x) =>
    x !== null && typeof x === 'object' && (Object.getPrototypeOf(x) === Object.prototype || x instanceof Field);
  if (structural(a) || structural(b)) {
    if (!structural(a) || !structural(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    const ka = Object.keys(/** @type {object} */ (a));
    const kb = Object.keys(/** @type {object} */ (b));
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameType(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
  }
  return dxnEquals(a, b);
}

/**
 * Whether the schema `name` extends `base`, directly or through others,
 * in this document or as loaded.
 * @param {string} name @param {string} base @param {Map<string, any>} known @param {string[]} seen @returns {boolean}
 */
function extendsBase(name, base, known, seen) {
  if (name === base) return true;
  if (seen.includes(name)) return false;
  return extendedBases(name, known).some((b) => extendsBase(b, base, known, [name, ...seen]));
}

/** The bases the schema `name` extends. @param {string} name @param {Map<string, any>} known @returns {string[]} */
function extendedBases(name, known) {
  /** @type {Lookup0 | null} */
  const lookup = /** @type {any} */ (known).lookup ?? null;
  if (lookup === null) return [];
  const raw = undoc(lookup.document.get(name));
  /** @type {import('../values/struct.cjs').Base[]} */
  let bases = [];
  if (raw instanceof DXNStruct && raw.name === 'schema') bases = raw.bases;
  else bases = lookup.registry.fetchStructSchema(name)?.compiled.bases ?? [];
  return bases.filter(([kind]) => kind === 'extends').map(([, b]) => b);
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
      return { ...type, args: filledArgs(type.name, type.args.map((/** @type {any} */ a) => resolved(a, known, path)), known) };
    case 'generic':
      throw new SchemaCompileError("a generic is a named type's whole definition, {:generic [t ...] body}");
    case 'shape':
      return {
        ...type,
        fields: type.fields.map((/** @type {Field} */ f) => new Field({ ...f, default: f.default, type: resolved(f.type, known, path) })),
        extras: resolvedExtras(type.extras ?? openExtras(), known, path)
      };
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

/** @param {string} name @param {any} generic */
function takesArguments(name, generic) {
  return `${name} is generic: write {:of ${name} ${generic.params.map(paramName).join(' ')}}, with a type for each`;
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
  return new Compiled({ version: entry.version ?? 1, fields, extras: ownExtras(entry, aliases) ?? openExtras() });
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
      default: fieldDefault(fieldPairs, type, aliases),
      description: /** @type {string | null} */ (getField(fieldPairs, 'description', null))
    });
  }

  return new Field({ name, required: !optional, type: compileTypeExpr(value, aliases) });
}

/**
 * A field's default: the value written, or one computed when the field is
 * filled. `computed: :now` takes a date, time, datetime or local
 * date-time, possibly refined, annotated or nilable, and never stands
 * beside a `default`.
 * @param {Array<[string, unknown]>} pairs @param {any} type @param {Map<string, unknown>} aliases @returns {unknown}
 */
function fieldDefault(pairs, type, aliases) {
  const written = hasField(pairs, 'default') ? getField(pairs, 'default') : Field.NO_DEFAULT;
  if (!hasField(pairs, 'computed')) return written;
  if (written !== Field.NO_DEFAULT) throw new SchemaCompileError('a %field has a default or is computed, not both');
  const computed = getField(pairs, 'computed');
  if (nameOf(computed) !== 'now') throw new SchemaCompileError(`a %field is computed: :now, the one value there is; not ${shown(computed)}`);
  const kind = temporalKind(type, aliases);
  if (kind === null) {
    throw new SchemaCompileError(`a %field computed: :now is a date, time, datetime or local-datetime, not ${inspectType(type)}`);
  }
  return Field.computedNow(kind);
}

/** The temporal type `type` is, through refines, annotations, nil and names; `null` for any other. @param {any} type @param {Map<string, unknown>} aliases @returns {string | null} */
function temporalKind(type, aliases) {
  switch (type.form) {
    case 'primitive':
      return ['date', 'time', 'datetime', 'local-datetime'].includes(type.name) ? type.name : null;
    case 'refine':
      return temporalKind(type.base, aliases);
    case 'doc':
    case 'nilable':
      return temporalKind(type.elem, aliases);
    case 'named': {
      const named = /** @type {any} */ (aliases.get(type.name));
      if (named === undefined || (named.form === 'named' && named.name === type.name)) return null;
      return temporalKind(named, aliases);
    }
    default:
      return null;
  }
}

/** A type's form, as a refusal names it. @param {unknown} type @returns {string} */
function inspectType(type) {
  if (typeof type === 'string') return `:${type}`;
  if (type !== null && typeof type === 'object' && 'form' in type) return String(/** @type {any} */ (type).form);
  return describe(type);
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
    // A shape built from others is a named entry of its document (DXNS.md
    // §4b), so that its bases are found before it is used.
    if (value.isBuilt()) {
      throw new SchemaCompileError('a shape built from others is an entry of its own, Name: %shape extends Base {...}, used by its name');
    }
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
    return { form: 'shape', name: null, fields, extras: ownExtras(value, aliases) ?? openExtras() };
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
    // `Pet(1)`, which DXN reads as `{:at Pet 1}` (DXNS.md §5c): a name
    // pinned to one version.
    if (tag === 'at') return pinnedType(value, aliases);
    // `{:of Name type ...}`: one use of the generic `Name`.
    if (tag === 'of') {
      if (!(rest[0] instanceof DXNSymbol) || rest.length < 2) throw new SchemaCompileError('a use of a generic is {:of Name type ...}');
      const name = fullName(rest[0].name, aliases);
      const args = rest.slice(1).map((v) => compileTypeExpr(v, aliases));
      return { form: 'apply', name, args: filledArgs(name, args, /** @type {Map<string, any>} */ (aliases)) };
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
 * `Pet(1)`, `{:at Pet 1}` (`DXNS.md` §5c): a name pinned to one version.
 * A named type's version is put in place -- a sibling at that version
 * stays by name -- and a version of a named type that is not loaded is a
 * compile error; any other name is a schema's, checked when a value
 * meets it.
 * @param {DXNTuple} value @param {Map<string, unknown>} aliases @returns {import('./type-expr.cjs').TypeExpr}
 */
function pinnedType(value, aliases) {
  const pinned = DXNTuple.pinned(value);
  if (!pinned) throw new SchemaCompileError('a pinned name is Name(N), {:at Name N}, N a positive integer');
  const name = fullName(pinned.name, aliases);
  /** @type {Lookup0 | null} */
  const lookup = /** @type {any} */ (aliases).lookup ?? null;
  const registry = lookup ? lookup.registry : null;
  const sibling = /** @type {any} */ (aliases.get(name));
  const isSibling = sibling !== undefined && sibling.form === 'named' && sibling.name === name;
  if (isSibling && lookup?.versions?.get(name) === pinned.version) return { form: 'named', name };
  const loaded = registry ? registry.fetchTypeVersion(name, pinned.version) : undefined;
  if (loaded !== undefined) return /** @type {any} */ (loaded);
  const namedType = isSibling || (registry !== null && registry.typeVersions.has(name)) || (aliases.has(name) && !name.startsWith('\0'));
  if (namedType) throw new SchemaCompileError(`${DXNTuple.pinnedText(name, pinned.version)} is not loaded`);
  return { form: 'reference', name, version: pinned.version };
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
  // `read-only` says `visibility: [:read]`; the two together would say it
  // twice, perhaps differently.
  if ('visibility' in named && 'read-only' in named) {
    throw new SchemaCompileError("a doc's read-only and visibility say the same thing; give visibility alone");
  }
  if ('values' in named) {
    const values = /** @type {Map<unknown, unknown>} */ (named.values);
    named.values = new Map(Array.from(values, ([literal, notes]) => [literal, annotations(notes, 'value')]));
  }
  return plainNames(named);
}

/**
 * The annotations whose values are names, as strings -- what a reader
 * compares, whatever spelling the document gave: `discriminator` a
 * string, `visibility` a list of strings, `messages` an object from each
 * refine key to its message.
 * @param {{[k: string]: unknown}} named @returns {{[k: string]: unknown}}
 */
function plainNames(named) {
  if ('discriminator' in named) named.discriminator = nameOf(named.discriminator);
  if ('visibility' in named) named.visibility = /** @type {unknown[]} */ (listItems(named.visibility)).map(nameOf);
  if ('messages' in named) {
    const messages = /** @type {Map<unknown, unknown>} */ (named.messages);
    named.messages = Object.fromEntries(Array.from(messages, ([key, message]) => [nameOf(key), message]));
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
    case 'secret':
      return typeof value === 'boolean' ? null : 'true or false';
    case 'key':
      return typeof value === 'boolean' || typeof value === 'string' ? null : 'true, false or a name';
    case 'visibility': {
      const items = listItems(value);
      if (items === null) return `a list of ${VISIBILITIES.join(', ')}`;
      const other = items.find((item) => !VISIBILITIES.includes(/** @type {string} */ (nameOf(item))));
      if (other !== undefined) {
        throw new SchemaCompileError(`a doc's visibility names ${shown(other)}, which is none of ${VISIBILITIES.join(', ')}`);
      }
      return null;
    }
    case 'messages':
      if (!(value instanceof Map) || value instanceof DXNOrderedMap) return 'a map of refine keys to messages';
      for (const [key, message] of Array.from(value).sort(([a], [b]) => dxnCompare(a, b))) {
        if (!REFINE_KEYS.has(/** @type {string} */ (nameOf(key)))) throw new SchemaCompileError(`a doc's messages are for refine keys; ${shown(key)} is none`);
        if (typeof message !== 'string') throw new SchemaCompileError(`a doc's messages are strings, not ${shown(message)}`);
      }
      return null;
    case 'discriminator':
      if (!(value instanceof DXNKeyword || value instanceof DXNSymbol || typeof value === 'string')) return "a field's name";
      if (!variantsType(type)) throw new SchemaCompileError(`a doc's discriminator stands on an any-of or a one-of, not ${inspectType(type)}`);
      return null;
    default:
      throw new SchemaCompileError(`${key} is no annotation; a doc holds ${ANNOTATION_KEYS.join(', ')}`);
  }
}

/** Whether `type` is an any-of or a one-of, through annotations. @param {any} type @returns {boolean} */
function variantsType(type) {
  if (type === null || typeof type !== 'object') return false;
  if (type.form === 'doc') return variantsType(type.elem);
  return type.form === 'any-of' || type.form === 'one-of';
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
    const normalized =
      value.fields.type === 'keyed'
        ? value.withFields({ type: 'keyed', pairs: value.fields.pairs.map(([k, v]) => [k, normalizeKeywords(v)]) })
        : value.withFields({ type: 'positional', values: value.fields.values.map(normalizeKeywords) });
    // A `* K => V`'s types are written as a field's are (DXNS.md §4c).
    normalized.rest = value.rest.map((entry) => ({ key: normalizeKeywords(entry.key), value: normalizeKeywords(entry.value) }));
    return normalized;
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
