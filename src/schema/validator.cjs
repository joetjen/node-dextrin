'use strict';

/**
 * @fileoverview Checks a value's fields against a `Compiled` schema
 * (required fields and their types) — shared by decode (`materialize`,
 * which also produces a materialized result) and encode-time
 * validation (`validateForEncode`/`validateTreeForEncode`), mirroring
 * `Dextrin.Schema.Validator`. Both directions reuse the exact same
 * `resolveFields`/`TypeExpr.matches` field-checking; encode's own
 * values are wrapped in the same `Validated` marker decode already
 * uses, via `wrapAndCheck`, so there's one type-checking
 * implementation, not two that could drift.
 *
 * **One genuine difference from `Dextrin.Schema.Validator`**: encode
 * here can *transform* `value`, not just answer ok/error —
 * `resolveFields`'s `coerce` option (see `coercion.cjs`) may replace a
 * field's value with its coerced form (a plain `number` becoming a
 * `DXNRational` for a `:rational` field, say), and that coerced value
 * has to actually reach the printer/binary encoder, not just pass a
 * check and be discarded. `wrapAndCheck` therefore rebuilds every
 * container it walks from its (possibly-coerced) children rather than
 * returning `value` unchanged, the way `Dextrin.Schema.Validator`'s
 * own `wrap_and_check/2` does today (it has nothing to transform).
 *
 * Enforcement is decode-time and fail-fast, with no lenient escape
 * hatch to get the materialized value anyway — a violation is always
 * a thrown error.
 */

const DXNMap = require('../values/map.cjs');
const Field = require('./field.cjs');
const TypeExpr = require('./type-expr.cjs');
const Coercion = require('./coercion.cjs');
const Validated = require('./validated.cjs');
const DXNList = require('../values/list.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNOrderedMap = require('../values/ordered-map.cjs');
const DXNSortedSet = require('../values/sorted-set.cjs');
const DXNStruct = require('../values/struct.cjs');
const DXNCustomTag = require('../values/custom-tag.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const DXNSymbol = require('../values/symbol.cjs');

class SchemaValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/** What `resolveField` answers for an optional field that was not given and has no default. */
const ABSENT = Symbol('absent');

/**
 * `fields` checked against `compiled`: every declared field, in the
 * schema's own order, as `[name, value]` pairs. A required field that is
 * missing, or a value that does not match its declared type, is an
 * error; an optional field that is missing takes its default, or stays
 * absent when it has none — DXN tells an absent field from one written
 * `nil`. What is built from the result is `schema/reader.cjs`'s job.
 * Never coerces.
 * @param {import('./compiled.cjs')} compiled
 * @param {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} fields
 * @param {import('../registry.cjs')} registry
 * @returns {Array<[string, unknown]>}
 */
function resolve(compiled, fields, registry) {
  const given = toNameMap(compiled, fields);
  /** @type {Array<[string, unknown]>} */
  const pairs = [];
  for (const field of compiled.fields) {
    const value = resolveField(field, given, registry, { coerce: false });
    if (value !== ABSENT) pairs.push([field.name, value]);
  }
  return pairs;
}

/**
 * @param {import('./compiled.cjs')} compiled
 * @param {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} fields
 * @returns {{[name: string]: unknown}}
 */
function toNameMap(compiled, fields) {
  if (fields.type === 'keyed') return Object.fromEntries(fields.pairs);
  const names = compiled.fieldNames();
  if (names.length !== fields.values.length) {
    throw new SchemaValidationError(`expected ${names.length} positional field(s), got ${fields.values.length}`);
  }
  return Object.fromEntries(names.map((name, i) => [name, fields.values[i]]));
}

/**
 * @param {import('./compiled.cjs')} compiled
 * @param {{[k: string]: unknown}} given
 * @param {import('../registry.cjs')} registry
 * @param {{coerce: boolean}} opts
 * @returns {{[k: string]: unknown}}
 */
function resolveFields(compiled, given, registry, opts) {
  /** @type {{[k: string]: unknown}} */
  const resolved = {};
  for (const field of compiled.fields) {
    // An absent optional field still holds its position when a value
    // goes out, as null.
    const value = resolveField(field, given, registry, opts);
    resolved[field.name] = value === ABSENT ? null : value;
  }
  return resolved;
}

/**
 * @param {import('./field.cjs')} field
 * @param {{[k: string]: unknown}} given
 * @param {import('../registry.cjs')} registry
 * @param {{coerce: boolean}} opts
 * @returns {unknown} the checked value, or `ABSENT`.
 */
function resolveField(field, given, registry, opts) {
  if (Object.prototype.hasOwnProperty.call(given, field.name)) {
    return checkType(field.name, given[field.name], field.type, registry, opts);
  }
  if (field.default !== Field.NO_DEFAULT) return field.default;
  if (field.required) throw new SchemaValidationError(`missing required field ${JSON.stringify(field.name)}`);
  return ABSENT;
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {import('./type-expr.cjs').TypeExpr} type
 * @param {import('../registry.cjs')} registry
 * @param {{coerce: boolean}} opts
 * @returns {unknown}
 */
function checkType(name, value, type, registry, opts) {
  if (TypeExpr.matches(type, value, registry)) {
    // Stripped here, not deferred to the top: `value` is about to be
    // handed to *this* struct's own materializer (decode) or stored
    // as a checked field value (encode) — neither should ever see an
    // internal `Validated` wrapper once it's done its one job.
    return Validated.strip(value);
  }

  if (opts.coerce) {
    const coerced = Coercion.tryCoerce(type, value);
    if (coerced !== undefined && TypeExpr.matches(type, coerced, registry)) {
      return Validated.strip(coerced);
    }
  }

  throw new SchemaValidationError(`field ${JSON.stringify(name)} does not match its declared type`);
}

// ---- encode-time validation -------------------------------------------------
//
// The mirror image of `materialize`, for data on its way *out*:
// `value` here is ordinary JS data about to be encoded — a
// `DXNStruct` (the one shape that round-trips to `%Name{...}` wire
// syntax), a plain `Map`, or a real application class instance — and
// (unlike Elixir's equivalent) *may* come back transformed if
// `opts.coerce` lets a field's value be coerced toward its declared
// type; see this module's own doc for why.
//
// The one structural difference from decode: decode's nested structs
// arrive *already* `Validated`-wrapped, bottom-up, as a natural
// consequence of how decoding recurses. Encode has no such built-in
// recursion to piggyback on, so `wrapAndCheck` does it explicitly —
// walking `value`, checking (and rebuilding, with any coercions
// applied) every recognized struct, before `resolveFields` ever sees
// it.

/**
 * Checks `value` — ordinary JS data about to be encoded — against
 * `compiled`. Returns the checked (and, if `opts.coerce`, possibly
 * coerced) value, `Validated`-wrapped.
 * @param {import('./compiled.cjs')} compiled
 * @param {unknown} value
 * @param {import('../registry.cjs')} registry
 * @param {{coerce?: boolean}} [opts]
 * @returns {Validated}
 */
function validateForEncode(compiled, value, registry, opts = {}) {
  return checkCompiled(compiled, value, registry, { coerce: opts.coerce ?? true });
}

/**
 * Walks `value` looking for every `DXNStruct` or registered
 * application class instance anywhere in the tree and checks each one
 * against its own schema, if the registry has one — regardless of
 * what any enclosing field's declared type is, recursing fully into
 * whatever it finds. Returns the (possibly-coerced) tree.
 * @param {unknown} value
 * @param {import('../registry.cjs')} registry
 * @param {{coerce?: boolean}} [opts]
 * @returns {unknown}
 */
function validateTreeForEncode(value, registry, opts = {}) {
  return wrapAndCheck(value, registry, { coerce: opts.coerce ?? true });
}

/**
 * @param {import('./compiled.cjs')} compiled
 * @param {unknown} value
 * @param {import('../registry.cjs')} registry
 * @param {{coerce: boolean}} opts
 * @returns {Validated}
 */
function checkCompiled(compiled, value, registry, opts) {
  // An extra field never shadows a declared one (DXN.md §4.7), on the
  // way out as on the way in.
  if (value instanceof DXNStruct) {
    const declared = new Set(compiled.fieldNames());
    const shadowing = value.extra.find(([key]) => typeof key === 'string' && declared.has(key));
    if (shadowing) throw new SchemaValidationError(`extra field ${JSON.stringify(shadowing[0])} shadows a declared field`);
  }
  const given = toNameMapForEncode(compiled, value);
  const wrappedGiven = wrapGiven(given, registry, opts);
  const resolved = resolveFields(compiled, wrappedGiven, registry, opts);
  return new Validated(/** @type {string} */ (compiled.name), rebuildChecked(value, compiled, resolved));
}

/**
 * Rebuilds `value` in its *original* shape (a `DXNStruct`, or a real
 * application class instance) with `resolved`'s checked — and, if
 * `opts.coerce` applied, coerced — field values written back in.
 * Without this, `checkCompiled` would hand the printer/binary encoder
 * a bare `{[name]: value}` field map instead of something it actually
 * knows how to encode (a plain object has no name of its own to
 * recover `%Name{...}` wire syntax from) — the encode-time analog of
 * why `materialize`'s decode-side default already produces a real,
 * named result rather than discarding shape information.
 *
 * A value that was neither of those (a plain `Map`, or a bare object
 * literal — the "nameless top-level value" `schema:` exists to check
 * in the first place, see `dextrin.cjs`'s own doc) is *promoted* to a
 * keyed `DXNStruct` under `compiled`'s own name: having just checked
 * it against that specific schema, the natural encoded form is
 * `%Name{...}`, not a bare, nameless `%{...}` map with no record that
 * a check ever happened.
 * @param {unknown} value
 * @param {import('./compiled.cjs')} compiled
 * @param {{[k: string]: unknown}} resolved
 * @returns {unknown}
 */
function rebuildChecked(value, compiled, resolved) {
  if (value instanceof DXNStruct) {
    if (value.fields.type === 'keyed') {
      return value.withFields({ type: 'keyed', pairs: value.fields.pairs.map(([k]) => [k, resolved[k]]) });
    }
    return value.withFields({ type: 'positional', values: compiled.fieldNames().map((name) => resolved[name]) });
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Map) && value.constructor && value.constructor !== Object) {
    const rebuilt = Object.create(Object.getPrototypeOf(value));
    Object.assign(rebuilt, value);
    for (const [name, v] of Object.entries(resolved)) rebuilt[name] = v;
    return rebuilt;
  }
  return DXNStruct.keyed(/** @type {string} */ (compiled.name), compiled.fieldNames().map((name) => [name, resolved[name]]));
}

/**
 * @param {import('./compiled.cjs')} compiled
 * @param {unknown} value
 * @returns {{[k: string]: unknown}}
 */
function toNameMapForEncode(compiled, value) {
  if (value instanceof DXNStruct) {
    const fields = value.fields;
    if (fields.type === 'keyed') return Object.fromEntries(fields.pairs);
    const names = compiled.fieldNames();
    if (names.length !== fields.values.length) {
      throw new SchemaValidationError(`expected ${names.length} positional field(s), got ${fields.values.length}`);
    }
    return Object.fromEntries(names.map((name, i) => [name, fields.values[i]]));
  }
  if (value instanceof Map) return Object.fromEntries(Array.from(value.entries(), stringifyEntry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value));
  }
  throw new SchemaValidationError(`expected a map/struct/object to validate against a schema, got ${String(value)}`);
}

/**
 * A plain `Map` decoded straight from `.dxn` source (as opposed to
 * one a caller builds by hand before encoding) keys its shorthand
 * entries with a keyword (`Symbol`/`DXNKeyword`) or symbol
 * (`DXNSymbol`), never a bare string.
 * @param {[unknown, unknown]} entry
 * @returns {[string, unknown]}
 */
function stringifyEntry([k, v]) {
  if (typeof k === 'symbol') return [Symbol.keyFor(k) ?? k.description ?? '', v];
  if (k instanceof DXNKeyword) return [k.name, v];
  if (k instanceof DXNSymbol) return [k.name, v];
  if (typeof k === 'string') return [k, v];
  return [String(k), v];
}

/**
 * `wrapAndCheck` is the recursive core: for any value that's a named
 * struct with a registered schema, check it (`checkCompiled`) and
 * wrap the result in `Validated`; otherwise recurse into whatever
 * container it is, reconstructing it from the (possibly-coerced,
 * possibly-wrapped) results so a wrapped/coerced grandchild survives
 * all the way up to whichever ancestor's field type actually needs to
 * see it.
 * @param {unknown} value
 * @param {import('../registry.cjs')} registry
 * @param {{coerce: boolean}} opts
 * @returns {unknown}
 */
function wrapAndCheck(value, registry, opts) {
  const found = schemaNameFor(value, registry);
  if (found) {
    try {
      return checkCompiled(found.compiled, value, registry, opts);
    } catch (err) {
      throw new SchemaValidationError(`struct ${JSON.stringify(found.name)} violates its schema: ${errorMessage(err)}`);
    }
  }
  return wrapChildren(value, registry, opts);
}

/**
 * @param {unknown} value
 * @param {import('../registry.cjs')} registry
 * @returns {{name: string, compiled: import('./compiled.cjs')} | null}
 */
function schemaNameFor(value, registry) {
  if (value instanceof DXNStruct) {
    const found = registry.fetchStructSchema(value.name);
    return found ? { name: value.name, compiled: found.compiled } : null;
  }
  if (value !== null && typeof value === 'object' && value.constructor) {
    const name = registry.fetchSchemaNameForModule(value.constructor);
    if (!name) return null;
    const found = registry.fetchStructSchema(name);
    return found ? { name, compiled: found.compiled } : null;
  }
  return null;
}

/**
 * @param {{[k: string]: unknown}} given
 * @param {import('../registry.cjs')} registry
 * @param {{coerce: boolean}} opts
 * @returns {{[k: string]: unknown}}
 */
function wrapGiven(given, registry, opts) {
  return Object.fromEntries(Object.entries(given).map(([k, v]) => [k, wrapAndCheck(v, registry, opts)]));
}

/**
 * @param {unknown} value
 * @param {import('../registry.cjs')} registry
 * @param {{coerce: boolean}} opts
 * @returns {unknown}
 */
function wrapChildren(value, registry, opts) {
  if (Array.isArray(value)) return value.map((v) => wrapAndCheck(v, registry, opts));
  if (value instanceof DXNList) return new DXNList(value.items.map((v) => wrapAndCheck(v, registry, opts)));
  if (value instanceof DXNTuple) return new DXNTuple(value.items.map((v) => wrapAndCheck(v, registry, opts)));
  if (value instanceof DXNOrderedMap) {
    return new DXNOrderedMap(value.pairs.map(([k, v]) => [k, wrapAndCheck(v, registry, opts)]));
  }
  if (value instanceof Set) return new Set(Array.from(value, (v) => wrapAndCheck(v, registry, opts)));
  if (value instanceof DXNSortedSet) return DXNSortedSet.fromArray(value.items.map((v) => wrapAndCheck(v, registry, opts)));
  if (value instanceof DXNStruct) {
    return value.fields.type === 'keyed'
      ? value.withFields({ type: 'keyed', pairs: value.fields.pairs.map(([k, v]) => [k, wrapAndCheck(v, registry, opts)]) })
      : value.withFields({ type: 'positional', values: value.fields.values.map((v) => wrapAndCheck(v, registry, opts)) });
  }
  if (value instanceof DXNCustomTag) return new DXNCustomTag(value.name, wrapAndCheck(value.value, registry, opts));
  if (value instanceof Map) {
    return new DXNMap(Array.from(value.entries(), ([k, v]) => [k, wrapAndCheck(v, registry, opts)]));
  }
  // Every other DXN* leaf/composite wrapper (DXNChar, DXNSymbol,
  // DXNKeyword, DXNDecimal, DXNRational, DXNDate, DXNTime,
  // DXNTimestamp, DXNDateTime, DXNDuration, DXNUUID, DXNURI, DXNBytes,
  // DXNRegex, ...) is already a complete, opaque DXN value with
  // nothing schema-checkable inside it. A native `Date`/`RegExp`/any
  // typed array (`DXNBytes`/`DXNUUID`'s own backing storage, or a
  // plain value a coercion target like `DXNTimestamp.fromDate` needs
  // to see *unchanged*) carries real internal slots a generic
  // property-by-property rebuild can't reconstruct — `Object.entries`
  // on a `Date` finds no enumerable properties at all, silently
  // producing a broken date-shaped object with no internal time
  // value; the same class of corruption `Decoder`'s tag-29 `deepClone`
  // has to specifically avoid for typed arrays. All of these must
  // pass through the walk untouched rather than hit the generic
  // "reach into an unknown object" fallback below.
  if (value !== null && typeof value === 'object') {
    const tagged = typeof (/** @type {any} */ (value).dxnType) === 'string';
    if (tagged || value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value)) {
      return value;
    }
  }
  // A genuine application object with no schema of its own — still
  // worth reaching into, in case something deeper does have one.
  if (value !== null && typeof value === 'object' && value.constructor && value.constructor !== Object) {
    const rebuilt = Object.create(Object.getPrototypeOf(value));
    for (const [k, v] of Object.entries(value)) rebuilt[k] = wrapAndCheck(v, registry, opts);
    return rebuilt;
  }
  return value;
}

/** @param {unknown} err @returns {string} */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

module.exports = { resolve, validateForEncode, validateTreeForEncode, SchemaValidationError };
