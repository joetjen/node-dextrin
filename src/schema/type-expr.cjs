'use strict';

/**
 * @fileoverview Internal, compiled representation of a `.dxns` type
 * expression — the vocabulary of DXN.md §4.1 (`any`, `never`,
 * `primitive`, `reference`, `list-of`, `set-of`, `tuple-of`, `map-of`,
 * `array-of`, `ordered-map-of`, `sorted-set-of`, `enum`, `one-of`,
 * `any-of`, `all-of`, `not`, `nilable`, `refine`) `schema/compiler.cjs` turns
 * a parsed `.dxns` value into, and what `matches` below checks a
 * decoded value against — mirroring `Dextrin.Schema.TypeExpr`. (The
 * 13th Elixir form, `struct`, isn't a distinct compiled shape there
 * either — a `%schema{}` entry compiles straight to `Compiled`, never
 * to a `TypeExpr` a *field* could hold; `reference` is what a field
 * uses to point at one.)
 *
 * This vocabulary is fixed, not extensible from outside an actual
 * library change — what schema *authors* extend instead is composing
 * these forms into a reusable named type, which needs no new form at
 * all.
 *
 * @typedef {{form: 'any'}
 *   | {form: 'never'}
 *   | {form: 'primitive', name: string}
 *   | {form: 'reference', name: string}
 *   | {form: 'list-of', elem: TypeExpr}
 *   | {form: 'set-of', elem: TypeExpr}
 *   | {form: 'tuple-of', elems: TypeExpr[]}
 *   | {form: 'map-of', key: TypeExpr, value: TypeExpr}
 *   | {form: 'array-of', elem: TypeExpr}
 *   | {form: 'ordered-map-of', key: TypeExpr, value: TypeExpr}
 *   | {form: 'sorted-set-of', elem: TypeExpr}
 *   | {form: 'enum', literals: unknown[]}
 *   | {form: 'one-of', variants: TypeExpr[]}
 *   | {form: 'any-of', variants: TypeExpr[]}
 *   | {form: 'all-of', variants: TypeExpr[]}
 *   | {form: 'not', elem: TypeExpr}
 *   | {form: 'nilable', elem: TypeExpr}
 *   | {form: 'refine', base: TypeExpr, constraints: {[k: string]: unknown}}
 *   | {form: 'shape', name: string | null, fields: import('./field.cjs')[]}
 *   | {form: 'case', field: string, branches: Array<[unknown, TypeExpr]>, otherwise: TypeExpr | null}
 *   | {form: 'named', name: string}
 *   | {form: 'generic', params: string[], body: TypeExpr}
 *   | {form: 'apply', name: string, args: TypeExpr[]}
 *   | {form: 'param', name: string}} TypeExpr
 */

const { dxnEquals } = require('../values/equality.cjs');
const DXNChar = require('../values/char.cjs');
const DXNSymbol = require('../values/symbol.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const DXNList = require('../values/list.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNOrderedMap = require('../values/ordered-map.cjs');
const DXNSortedSet = require('../values/sorted-set.cjs');
const DXNStruct = require('../values/struct.cjs');
const DXNDecimal = require('../values/decimal.cjs');
const DXNRational = require('../values/rational.cjs');
const DXNDate = require('../values/date.cjs');
const DXNTime = require('../values/time.cjs');
const DXNLocalDateTime = require('../values/local-date-time.cjs');
const { offsetName } = require('../text/temporal.cjs');
const DXNDateTime = require('../values/date-time.cjs');
const DXNDuration = require('../values/duration.cjs');
const DXNUUID = require('../values/uuid.cjs');
const DXNObjectId = require('../values/object-id.cjs');
const DXNIp = require('../values/ip.cjs');
const DXNURI = require('../values/uri.cjs');
const DXNBytes = require('../values/bytes.cjs');
const DXNBits = require('../values/bits.cjs');
const DXNRegex = require('../values/regex.cjs');
const Validated = require('./validated.cjs');
const Field = require('./field.cjs');

/** What `conform` answers when a value does not match. */
const NO = Symbol('no match');

/**
 * What a check knows besides the type and the value: the registry
 * (`null` when there is none -- strict and trusted are then off), and the
 * fields of the nearest enclosing struct or shape by name, which a
 * `{:case}` reads its sibling from (`null` outside any).
 * @typedef {{registry: import('../registry.cjs') | null, siblings: Map<string, unknown> | null}} Context
 */

/**
 * The context for a check with `registry`, the fields `siblings` around it.
 * @param {import('../registry.cjs') | null} registry
 * @param {Map<string, unknown> | null} [siblings]
 * @returns {Context}
 */
function context(registry, siblings = null) {
  return { registry, siblings };
}

/**
 * Whether `value` matches `type` — shared by both decode
 * (`validator.cjs`'s `materialize`) and encode-time validation
 * (`validateForEncode`): the same recursive check, the same function,
 * for both directions. It is `conform` answered as a boolean, so there is
 * one check, not two.
 *
 * `{form: 'reference', name}` checks the *originating schema's* name,
 * not the value's own shape — which is how it correctly rejects a
 * materialized value that satisfies its own schema but is the wrong
 * one for this field. Three sources carry that name: an *opaque*,
 * unregistered `DXNStruct` carries its own wire name directly; a
 * value that went through a registered schema (decode *or*
 * encode-time validation alike) carries it via `Validated`; the
 * third, encode-only source: `registry` (`null` for decode, which
 * never needs it) lets a *real, unwrapped* application class
 * instance's own constructor be checked against whatever class was
 * registered for `name` — needed only for a value that turned out to
 * have no schema of its own to be wrapped by.
 *
 * @param {TypeExpr} type
 * @param {unknown} value
 * @param {import('../registry.cjs') | null} [registry]
 * @returns {boolean}
 */
function matches(type, value, registry = null) {
  return conform(type, value, context(registry)) !== NO;
}

/**
 * `value` checked against `type` in `ctx`: the value with every shape's
 * missing defaults filled in (design/shapes-and-case.md, Jan,
 * 2026-10-20), or `NO`. Nothing but a shape changes a value.
 * @param {TypeExpr} type
 * @param {unknown} value
 * @param {Context} ctx
 * @returns {unknown}
 */
function conform(type, value, ctx) {
  switch (type.form) {
    case 'any':
      return value;
    case 'never':
      return NO;
    case 'reference':
      return matchesReference(type.name, value, ctx.registry) ? value : NO;
    case 'case': {
      // A field's type is chosen by its sibling's value, wherever in the
      // field's type the case stands.
      const chosen = chosenType(type, ctx.siblings);
      return chosen === null ? NO : conform(chosen, value, ctx);
    }
    case 'named': {
      // A recursive named type's reference to itself (DXN.md §4.5), looked
      // up when it is checked; with no registry there is nothing to look in.
      const named = ctx.registry ? ctx.registry.typeAliases.get(type.name) : undefined;
      return named ? conform(/** @type {TypeExpr} */ (named), value, ctx) : NO;
    }
    case 'apply': {
      // One use of a generic: its body, the arguments standing where its
      // parameters stand.
      const generic = /** @type {any} */ (ctx.registry ? ctx.registry.typeAliases.get(type.name) : undefined);
      if (!generic || generic.form !== 'generic' || generic.params.length !== type.args.length) return NO;
      const bound = new Map(generic.params.map((/** @type {string} */ p, /** @type {number} */ i) => [p, type.args[i]]));
      return conform(substitute(generic.body, bound), value, ctx);
    }
    case 'param':
    case 'generic':
      return NO;
    default:
      break;
  }

  if (value instanceof Validated) {
    const inner = conform(type, value.value, ctx);
    return inner === NO ? NO : new Validated(value.name, inner);
  }

  switch (type.form) {
    case 'primitive':
      return primitiveMatches(type.name, value) ? value : NO;
    case 'shape':
      return value instanceof Map ? shape(type.fields, value, ctx) : NO;
    case 'list-of': {
      if (!(value instanceof DXNList)) return NO;
      const items = all(value.items, (v) => conform(type.elem, v, ctx));
      return items === NO ? NO : new DXNList(/** @type {unknown[]} */ (items));
    }
    case 'set-of': {
      if (!(value instanceof Set)) return NO;
      const items = all(Array.from(value), (v) => conform(type.elem, v, ctx));
      return items === NO ? NO : new Set(/** @type {unknown[]} */ (items));
    }
    case 'tuple-of': {
      if (!(value instanceof DXNTuple) || type.elems.length !== value.items.length) return NO;
      const items = all(value.items, (v, i) => conform(type.elems[i], v, ctx));
      return items === NO ? NO : new DXNTuple(/** @type {unknown[]} */ (items));
    }
    case 'map-of': {
      if (!(value instanceof Map)) return NO;
      const pairs = all(Array.from(value.entries()), ([k, v]) => pair(type.key, type.value, k, v, ctx));
      return pairs === NO ? NO : sameMap(value, /** @type {Array<[unknown, unknown]>} */ (pairs));
    }
    case 'array-of': {
      if (!Array.isArray(value)) return NO;
      const items = all(value, (v) => conform(type.elem, v, ctx));
      return items;
    }
    case 'ordered-map-of': {
      if (!(value instanceof DXNOrderedMap)) return NO;
      const pairs = all(value.pairs, ([k, v]) => pair(type.key, type.value, k, v, ctx));
      return pairs === NO ? NO : new DXNOrderedMap(/** @type {Array<[unknown, unknown]>} */ (pairs));
    }
    case 'sorted-set-of': {
      if (!(value instanceof DXNSortedSet)) return NO;
      const items = all(value.items, (v) => conform(type.elem, v, ctx));
      return items === NO ? NO : value;
    }
    case 'enum':
      return type.literals.some((literal) => keywordAwareEq(literal, value)) ? value : NO;
    case 'one-of': {
      // Exactly one variant matches (JSON Schema's oneOf; Jan,
      // 2026-10-20): every variant is tried, stopping at a second match.
      /** @type {unknown} */
      let found = NO;
      for (const t of type.variants) {
        const c = conform(t, value, ctx);
        if (c === NO) continue;
        if (found !== NO) return NO;
        found = c;
      }
      return found;
    }
    case 'any-of':
      // One or more match (JSON Schema's anyOf): the first that does.
      for (const t of type.variants) {
        const c = conform(t, value, ctx);
        if (c !== NO) return c;
      }
      return NO;
    case 'not':
      return conform(type.elem, value, ctx) === NO ? value : NO;
    case 'all-of': {
      // Every variant, each taking what the one before it answered.
      let current = value;
      for (const t of type.variants) {
        current = conform(t, current, ctx);
        if (current === NO) return NO;
      }
      return current;
    }
    case 'nilable':
      return value === null ? null : conform(type.elem, value, ctx);
    case 'refine': {
      const c = conform(type.base, value, ctx);
      return c !== NO && satisfiesConstraints(c, type.constraints) ? c : NO;
    }
    default:
      return NO;
  }
}

/**
 * Every item conformed, in order, or `NO` at the first that is not.
 * @param {unknown[]} items
 * @param {(item: any, index: number) => unknown} one
 * @returns {unknown[] | typeof NO}
 */
function all(items, one) {
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const c = one(items[i], i);
    if (c === NO) return NO;
    out.push(c);
  }
  return out;
}

/** @param {TypeExpr} keyType @param {TypeExpr} valueType @param {unknown} k @param {unknown} v @param {Context} ctx */
function pair(keyType, valueType, k, v, ctx) {
  const ck = conform(keyType, k, ctx);
  if (ck === NO) return NO;
  const cv = conform(valueType, v, ctx);
  return cv === NO ? NO : [ck, cv];
}

/** A map of the same kind as `like` holding `pairs`. @param {Map<unknown, unknown>} like @param {Array<[unknown, unknown]>} pairs */
function sameMap(like, pairs) {
  const Kind = /** @type {any} */ (like.constructor);
  return new Kind(pairs);
}

// ---- {:case} ----------------------------------------------------------------

/**
 * The type `kase`'s branches give the sibling field's value; its `else`
 * (`null` without one) when none is equal, or the sibling is absent.
 * @param {any} kase
 * @param {Map<string, unknown> | null} siblings
 * @returns {TypeExpr | null}
 */
function chosenType(kase, siblings) {
  if (!siblings || !siblings.has(kase.field)) return kase.otherwise;
  const sibling = Validated.strip(siblings.get(kase.field));
  for (const [literal, type] of kase.branches) {
    if (keywordAwareEq(literal, sibling)) return type;
  }
  return kase.otherwise;
}

// ---- %shape{} -----------------------------------------------------------------

/**
 * A plain map against a shape's fields: each declared field matched by
 * name, whatever spelling its key has (`name:`, `"name" =>`,
 * `:"name" =>`) and refused given twice; a missing field takes its
 * default, the key a keyword (a global symbol when the decode is
 * trusted); an extra key is kept, and refused by a strict decode -- as a
 * struct's fields are (design/shapes-and-case.md).
 * @param {import('./field.cjs')[]} fields
 * @param {Map<unknown, unknown>} map
 * @param {Context} ctx
 */
function shape(fields, map, ctx) {
  /** @type {Map<string, [unknown, unknown]>} */
  const named = new Map();
  for (const [key, value] of map.entries()) {
    const name = keyName(key);
    if (name === null) continue;
    if (named.has(name)) return NO;
    named.set(name, [key, value]);
  }
  const inner = { registry: ctx.registry, siblings: new Map(Array.from(named, ([n, [, v]]) => [n, v])) };
  const out = sameMap(map, Array.from(map.entries()));
  for (const field of fields) {
    const given = named.get(field.name);
    if (given) {
      const c = conform(field.type, given[1], inner);
      if (c === NO) return NO;
      out.set(given[0], c);
    } else if (field.default !== Field.NO_DEFAULT) {
      out.set(defaultKey(field.name, ctx), field.default);
    } else if (field.required) {
      return NO;
    }
  }
  if (ctx.registry && ctx.registry.strict) {
    const declared = new Set(fields.map((f) => f.name));
    for (const key of map.keys()) {
      const name = keyName(key);
      if (name === null || !declared.has(name)) return NO;
    }
  }
  return out;
}

/** The name a map key gives a field, or `null`. @param {unknown} key */
function keyName(key) {
  if (key instanceof DXNKeyword) return key.name;
  if (typeof key === 'symbol') return Symbol.keyFor(key) ?? key.description ?? null;
  if (typeof key === 'string') return key;
  return null;
}

/** @param {string} name @param {Context} ctx */
function defaultKey(name, ctx) {
  return ctx.registry && ctx.registry.trusted ? Symbol.for(name) : new DXNKeyword(name);
}

// ---- generics -----------------------------------------------------------------

/**
 * `type` with each parameter `bound` names replaced by its argument.
 * @param {any} type
 * @param {Map<string, TypeExpr>} bound
 * @returns {any}
 */
function substitute(type, bound) {
  switch (type.form) {
    case 'param':
      return bound.get(type.name) ?? type;
    case 'apply':
      return { ...type, args: type.args.map((/** @type {any} */ a) => substitute(a, bound)) };
    case 'shape':
      return { ...type, fields: type.fields.map((/** @type {any} */ f) => Object.assign(Object.create(Object.getPrototypeOf(f)), f, { type: substitute(f.type, bound) })) };
    case 'case':
      return {
        ...type,
        branches: type.branches.map((/** @type {[unknown, any]} */ [l, t]) => [l, substitute(t, bound)]),
        otherwise: type.otherwise === null ? null : substitute(type.otherwise, bound)
      };
    case 'refine':
      return { ...type, base: substitute(type.base, bound) };
    case 'tuple-of':
      return { ...type, elems: type.elems.map((/** @type {any} */ t) => substitute(t, bound)) };
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return { ...type, variants: type.variants.map((/** @type {any} */ t) => substitute(t, bound)) };
    case 'list-of':
    case 'set-of':
    case 'array-of':
    case 'sorted-set-of':
    case 'not':
    case 'nilable':
      return { ...type, elem: substitute(type.elem, bound) };
    case 'map-of':
    case 'ordered-map-of':
      return { ...type, key: substitute(type.key, bound), value: substitute(type.value, bound) };
    default:
      return type;
  }
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {import('../registry.cjs') | null} registry
 * @returns {boolean}
 */
function matchesReference(name, value, registry) {
  if (value instanceof DXNStruct) return value.name === name;
  if (value instanceof Validated) return value.name === name;
  // A struct is matched only by a struct (DXN.md §4.7): past a struct or
  // checked value of the right name, only the class registered for
  // `name` is one. A `Map`, or any other value, is not a struct, however
  // much it looks like one -- nothing is converted to make it match.
  if (registry && value !== null && typeof value === 'object' && value.constructor) {
    const registered = registry.fetchStructModule(name);
    if (registered) return value.constructor === registered;
  }
  return false;
}

// ---- primitives (DXN.md §1.3's 28 non-header types) ------------------------

/** @param {string} name @param {unknown} value @returns {boolean} */
function primitiveMatches(name, value) {
  switch (name) {
    case 'nil':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'bigint';
    case 'float':
      return typeof value === 'number';
    case 'decimal':
      return value instanceof DXNDecimal;
    case 'rational':
      return value instanceof DXNRational;
    case 'string':
      return typeof value === 'string';
    case 'char':
      return value instanceof DXNChar;
    case 'symbol':
      return value instanceof DXNSymbol;
    case 'keyword':
      return typeof value === 'symbol' || value instanceof DXNKeyword;
    case 'list':
      return value instanceof DXNList;
    case 'tuple':
      return value instanceof DXNTuple;
    case 'map':
      return value instanceof Map;
    case 'ordered-map':
      return value instanceof DXNOrderedMap;
    case 'set':
      return value instanceof Set;
    case 'sorted-set':
      return value instanceof DXNSortedSet;
    case 'array':
      return Array.isArray(value);
    case 'date':
      return value instanceof DXNDate;
    case 'time':
      return value instanceof DXNTime;
    // A datetime is one type whatever its offset, UTC included (Jan,
    // 2026-10-20). A native `Date` is an instant, so it always means a
    // datetime in UTC.
    case 'datetime':
      return value instanceof DXNDateTime || value instanceof Date;
    case 'local-datetime':
      return value instanceof DXNLocalDateTime;
    case 'duration':
      return value instanceof DXNDuration;
    case 'uuid':
      return value instanceof DXNUUID;
    case 'objectid':
      return value instanceof DXNObjectId;
    case 'ip':
      return value instanceof DXNIp;
    case 'uri':
      return value instanceof DXNURI;
    case 'bytes':
      return value instanceof DXNBytes;
    // Bits and bytes are one value space (DXN.md §4.1): `:bits` takes both.
    case 'bits':
      return value instanceof DXNBits || value instanceof DXNBytes;
    case 'regex':
      return value instanceof DXNRegex;
    default:
      return false;
  }
}

/**
 * A schema's `enum` literals always come from `.dxns` *compilation*
 * as `DXNKeyword` (`schema/compiler.cjs` normalizes them the same
 * way regardless of how the schema source itself was decoded), but
 * the *data* being checked against them can be either keyword shape
 * depending on the caller's own `trusted:` choice — plain `dxnEquals`
 * would only ever match the untrusted (`DXNKeyword`) shape.
 * @param {unknown} literal
 * @param {unknown} value
 * @returns {boolean}
 */
function keywordAwareEq(literal, value) {
  if (literal instanceof DXNKeyword && typeof value === 'symbol') {
    const name = Symbol.keyFor(value) ?? value.description ?? '';
    return literal.name === name;
  }
  return dxnEquals(literal, value);
}

// ---- refine constraints -----------------------------------------------------

/**
 * @param {unknown} value
 * @param {{[k: string]: unknown}} constraints
 * @returns {boolean}
 */
function satisfiesConstraints(value, constraints) {
  return Object.entries(constraints).every(([key, arg]) => satisfiesConstraint(key, arg, value));
}

/**
 * @param {string} key
 * @param {unknown} arg
 * @param {unknown} value
 * @returns {boolean}
 */
function satisfiesConstraint(key, arg, value) {
  // NaN lies outside every range, as every IEEE 754 comparison with it is
  // false -- which `<`/`>` on a `number` already answer; the infinities
  // compare as the numbers they are (Jan, 2026-10-20).
  switch (key) {
    case 'min':
      return toComparableNumber(value) >= toComparableNumber(arg);
    case 'max':
      return toComparableNumber(value) <= toComparableNumber(arg);
    case 'exclusive-min':
      return toComparableNumber(value) > toComparableNumber(arg);
    case 'exclusive-max':
      return toComparableNumber(value) < toComparableNumber(arg);
    case 'multiple-of':
      return isMultipleOf(toComparableNumber(value), toComparableNumber(arg));
    case 'min-length':
      return typeof value === 'string' && Array.from(value).length >= /** @type {number} */ (arg);
    case 'max-length':
      return typeof value === 'string' && Array.from(value).length <= /** @type {number} */ (arg);
    case 'pattern':
      return typeof value === 'string' && arg instanceof DXNRegex && arg.toRegExp().test(value);
    case 'min-count':
      return countOf(value) >= /** @type {number} */ (arg);
    case 'max-count':
      return countOf(value) <= /** @type {number} */ (arg);
    case 'finite':
      return arg !== true || typeof value !== 'number' || Number.isFinite(value);
    // The datetime's offset is one of these, `Z` or `±HH:MM`.
    case 'offsets': {
      const offsets = arg instanceof DXNList ? arg.items : Array.isArray(arg) ? arg : [];
      return offsets.includes(offsetName(datetimeOffset(value)));
    }
    // An ip's family, 4 or 6, and whether it is a prefix (DXN.md §4.2).
    case 'version':
      return value instanceof DXNIp && (typeof arg === 'bigint' || typeof arg === 'number') && Number(arg) === value.version;
    case 'prefix':
      return value instanceof DXNIp && (value.prefix !== null) === (arg === true);
    default:
      return false;
  }
}

/**
 * A datetime's offset in minutes: a native `Date`'s is UTC's, 0.
 * @param {unknown} value
 * @returns {number}
 */
function datetimeOffset(value) {
  if (value instanceof DXNDateTime) return value.offsetMinutes;
  if (value instanceof Date) return 0;
  throw new TypeError(`an offsets constraint applies to a datetime, not ${String(value)}`);
}

/** @param {unknown} value @returns {number} */
function countOf(value) {
  if (value instanceof DXNList || value instanceof DXNTuple) return value.items.length;
  if (value instanceof DXNSortedSet) return value.items.length;
  if (value instanceof Set) return value.size;
  return NaN;
}

/** @param {number} a @param {number} b @returns {boolean} */
function isMultipleOf(a, b) {
  return a % b === 0;
}

/** @param {unknown} value @returns {number} */
function toComparableNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (value instanceof DXNDecimal) return value.toNumber();
  if (value instanceof DXNRational) return value.toNumber();
  throw new TypeError(`cannot compare a non-numeric value in a refine constraint: ${String(value)}`);
}

module.exports = { matches, conform, context, NO };
