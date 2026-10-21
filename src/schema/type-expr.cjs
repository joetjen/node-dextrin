'use strict';

/**
 * @fileoverview Internal, compiled representation of a `.dxns` type
 * expression — the vocabulary of DXN.md §4.1 (`any`, `never`,
 * `primitive`, `reference`, `list-of`, `list-items`, `set-of`, `tuple-of`,
 * `tuple-of-all`, `map-of`, `array-of`, `tagged`, `doc`, `if`, `ordered-map-of`, `sorted-set-of`, `enum`, `one-of`,
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
 *   | {form: 'list-items', particles: Particle[]}
 *   | {form: 'set-of', elem: TypeExpr}
 *   | {form: 'tuple-of', elems: TypeExpr[]}
 *   | {form: 'tuple-of-all', elem: TypeExpr}
 *   | {form: 'tagged', name: string, elem: TypeExpr}
 *   | {form: 'doc', elem: TypeExpr, notes: {[k: string]: unknown}}
 *   | {form: 'if', test: TypeExpr, consequent: TypeExpr, alternative: TypeExpr}
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

/**
 * One of a `{:list-items}`'s items: a type for exactly one item, or a
 * repeat of a group of them, `max` null when there is no upper bound
 * (DXN.md §4.1a).
 * @typedef {{kind: 'one', type: TypeExpr}
 *   | {kind: 'repeat', group: Particle[], min: number, max: number | null}} Particle
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
const DXNCustomTag = require('../values/custom-tag.cjs');
const { daysFromCivil } = require('../values/calendar.cjs');
const { single } = require('../binary/float.cjs');
const Validated = require('./validated.cjs');
const Field = require('./field.cjs');
const { canonical } = require('../canonical.cjs');
const Format = require('./format.cjs');

/** A refine's keys whose argument is a type (DXN.md §4.2). */
const TYPE_KEYS = ['contains', 'content', 'encodes', 'encodes-seq'];

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
    // Annotations change nothing a type takes.
    case 'doc':
      return conform(type.elem, value, ctx);
    // A value that is a `test` is checked as a `consequent`, any other as
    // an `alternative` -- what the test would fill in is not kept.
    case 'if':
      return conform(conform(type.test, value, ctx) === NO ? type.alternative : type.consequent, value, ctx);
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
    case 'list-items': {
      if (!(value instanceof DXNList)) return NO;
      const items = listItems(type.particles, value.items, ctx, allTaken);
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
    case 'tuple-of-all': {
      if (!(value instanceof DXNTuple)) return NO;
      const items = all(value.items, (v) => conform(type.elem, v, ctx));
      return items === NO ? NO : new DXNTuple(/** @type {unknown[]} */ (items));
    }
    case 'tagged':
      return tagged(type.name, type.elem, value, ctx);
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
      return c !== NO && satisfiesConstraints(c, type.constraints, type.base, ctx) ? c : NO;
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

/**
 * A custom tag named `name` whose value is an `elem`, the value conformed;
 * or an application's value that the registry's tag encoder writes as
 * one, kept as it is.
 * @param {string} name @param {TypeExpr} elem @param {unknown} value @param {Context} ctx
 * @returns {unknown}
 */
function tagged(name, elem, value, ctx) {
  if (value instanceof DXNCustomTag) {
    if (value.name !== name) return NO;
    const inner = conform(elem, value.value, ctx);
    return inner === NO ? NO : new DXNCustomTag(name, inner);
  }
  if (!ctx.registry || value === null || typeof value !== 'object') return NO;
  const encoder = ctx.registry.fetchTagEncoder(/** @type {Function} */ (value.constructor));
  if (!encoder || encoder[0] !== name) return NO;
  let written;
  try {
    written = encoder[1](value);
  } catch {
    return NO;
  }
  return conform(elem, written, ctx) === NO ? NO : value;
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

// ---- list items -------------------------------------------------------------

/**
 * `particles` matched against the front of `left`, then `rest` against
 * what they leave: the items conformed, in order, or `NO`. A repeat takes
 * as many items as it can while the rest still matches, and gives back
 * one at a time until it does (DXN.md §4.1a).
 * @param {Particle[]} particles
 * @param {unknown[]} left
 * @param {Context} ctx
 * @param {(left: unknown[]) => unknown[] | typeof NO} rest
 * @returns {unknown[] | typeof NO}
 */
function listItems(particles, left, ctx, rest) {
  if (particles.length === 0) return rest(left);
  const [first, ...more] = particles;
  if (first.kind === 'one') {
    if (left.length === 0) return NO;
    const conformed = conform(first.type, left[0], ctx);
    if (conformed === NO) return NO;
    const tail = listItems(more, left.slice(1), ctx, rest);
    return tail === NO ? NO : [conformed, ...tail];
  }
  return repeat(first.group, first.min, first.max, left, ctx, (after) => listItems(more, after, ctx, rest));
}

/**
 * One more repetition first, while `most` allows it; stopping once
 * `least` is reached. A repetition that took no item is the last: every
 * further one would take none either, so `least` is met by them.
 * @param {Particle[]} group
 * @param {number} least
 * @param {number | null} most
 * @param {unknown[]} left
 * @param {Context} ctx
 * @param {(left: unknown[]) => unknown[] | typeof NO} rest
 * @returns {unknown[] | typeof NO}
 */
function repeat(group, least, most, left, ctx, rest) {
  const again =
    most === null || most > 0
      ? listItems(group, left, ctx, (afterOne) =>
          afterOne.length === left.length
            ? rest(afterOne)
            : repeat(group, Math.max(least - 1, 0), most === null ? null : most - 1, afterOne, ctx, rest)
        )
      : NO;
  if (again !== NO) return again;
  return least === 0 ? rest(left) : NO;
}

/** The end of a `{:list-items}`: every item taken. @param {unknown[]} left @returns {unknown[] | typeof NO} */
function allTaken(left) {
  return left.length === 0 ? [] : NO;
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
      return {
        ...type,
        base: substitute(type.base, bound),
        constraints: Object.fromEntries(
          Object.entries(type.constraints).map(([key, t]) => (TYPE_KEYS.includes(key) ? [key, substitute(t, bound)] : [key, t]))
        )
      };
    case 'if':
      return {
        ...type,
        test: substitute(type.test, bound),
        consequent: substitute(type.consequent, bound),
        alternative: substitute(type.alternative, bound)
      };
    case 'list-items':
      return { ...type, particles: type.particles.map((/** @type {Particle} */ p) => substituteParticle(p, bound)) };
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
    case 'tuple-of-all':
    case 'not':
    case 'nilable':
    case 'tagged':
    case 'doc':
      return { ...type, elem: substitute(type.elem, bound) };
    case 'map-of':
    case 'ordered-map-of':
      return { ...type, key: substitute(type.key, bound), value: substitute(type.value, bound) };
    default:
      return type;
  }
}

/** @param {Particle} particle @param {Map<string, TypeExpr>} bound @returns {Particle} */
function substituteParticle(particle, bound) {
  return particle.kind === 'one'
    ? { kind: 'one', type: substitute(particle.type, bound) }
    : { ...particle, group: particle.group.map((p) => substituteParticle(p, bound)) };
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

/** A resolution's unit, in nanoseconds. */
const RESOLUTIONS = new Map([
  ['second', 1_000_000_000n],
  ['millisecond', 1_000_000n],
  ['microsecond', 1_000n],
  ['nanosecond', 1n]
]);

/** The units a `resolution` takes. @returns {string[]} */
function resolutions() {
  return Array.from(RESOLUTIONS.keys());
}

/**
 * Every constraint holds. A constraint on a value it does not apply to
 * -- a length on an integer, a range on a string -- refuses it (DXN.md
 * §4.2, Jan, 2026-10-20). `base`, the refine's base type, decides what a
 * byte string's length counts.
 * @param {unknown} value
 * @param {{[k: string]: unknown}} constraints
 * @param {TypeExpr} base
 * @param {Context} ctx
 * @returns {boolean}
 */
function satisfiesConstraints(value, constraints, base, ctx) {
  return Object.entries(constraints).every(([key, arg]) => {
    switch (key) {
      case 'contains':
        return contains(/** @type {TypeExpr} */ (arg), constraints, value, ctx);
      case 'content':
        return content(/** @type {TypeExpr} */ (arg), constraints, value, ctx);
      case 'encodes':
        return encodes(/** @type {TypeExpr} */ (arg), value, ctx);
      case 'encodes-seq':
        return encodesSeq(/** @type {TypeExpr} */ (arg), value, ctx);
      case 'min-length':
        return within(lengthOf(value, base), arg, null);
      case 'max-length':
        return within(lengthOf(value, base), null, arg);
      default:
        return satisfiesConstraint(key, arg, value);
    }
  });
}

/**
 * Between `min-contains` (1 when not given) and `max-contains` of the
 * collection's items are a `type`.
 * @param {TypeExpr} type @param {{[k: string]: unknown}} constraints @param {unknown} value @param {Context} ctx
 */
function contains(type, constraints, value, ctx) {
  const items = itemsOf(value);
  if (items === null) return false;
  const count = items.filter((item) => conform(type, item, ctx) !== NO).length;
  return within(count, constraints['min-contains'] ?? 1, constraints['max-contains'] ?? null);
}

/**
 * The string, decoded by its `encoding` when it has one, is a DXN
 * document whose value is a `type`: `.dxnb` under application/dxnb, text
 * otherwise.
 * @param {TypeExpr} type @param {{[k: string]: unknown}} constraints @param {unknown} value @param {Context} ctx
 * @returns {boolean}
 */
function content(type, constraints, value, ctx) {
  if (typeof value !== 'string') return false;
  const bytes = decoded(/** @type {string | undefined} */ (constraints.encoding), value);
  if (bytes === null) return false;
  const document = readContent(contentMedia(constraints), bytes);
  return document !== NO && conform(type, document.value, ctx) !== NO;
}

/** The media type `content` reads by, in lower case; `null` for none. @param {{[k: string]: unknown}} constraints */
function contentMedia(constraints) {
  const media = constraints['media-type'];
  return typeof media === 'string' ? media.toLowerCase() : null;
}

/**
 * The document `bytes` hold, `.dxnb` under application/dxnb, text
 * otherwise; `NO` when they hold none. A string with no encoding is its
 * own text.
 * @param {string | null} media @param {Buffer | string} bytes
 * @returns {{value: unknown} | typeof NO}
 */
function readContent(media, bytes) {
  // Required here, not at the top: the decoders check schemas with this module.
  const dextrin = require('../dextrin.cjs');
  try {
    if (media === 'application/dxnb') return { value: dextrin.decodeBinary(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes) };
    const text = typeof bytes === 'string' ? bytes : UTF8_STRICT.decode(bytes);
    if (/\p{Cs}/u.test(text)) return NO;
    return { value: dextrin.decode(text) };
  } catch {
    return NO;
  }
}

/**
 * The bytes are a `.dxnb` document whose value is a `type`.
 * @param {TypeExpr} type @param {unknown} value @param {Context} ctx @returns {boolean}
 */
function encodes(type, value, ctx) {
  if (!(value instanceof DXNBytes)) return false;
  let document;
  try {
    document = require('../dextrin.cjs').decodeBinary(value.data);
  } catch {
    return false;
  }
  return conform(type, document, ctx) !== NO;
}

/**
 * The bytes are `.dxnb` documents back to back, each a `type`; none at
 * all too.
 * @param {TypeExpr} type @param {unknown} value @param {Context} ctx @returns {boolean}
 */
function encodesSeq(type, value, ctx) {
  if (!(value instanceof DXNBytes)) return false;
  let documents;
  try {
    documents = require('../binary/decoder.cjs').decodeSequence(value.data);
  } catch {
    return false;
  }
  return documents.every((document) => conform(type, document, ctx) !== NO);
}

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

/** RFC 4648's alphabets, each with the padding its encoding takes (DXN.md §4.2). */
const ENCODED = {
  base64: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  base64urlPadded: /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}==|[A-Za-z0-9_-]{3}=)?$/,
  base64urlBare: /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/,
  base32: /^(?:[A-Z2-7]{8})*(?:[A-Z2-7]{2}={6}|[A-Z2-7]{4}={4}|[A-Z2-7]{5}={3}|[A-Z2-7]{7}=)?$/,
  base16: /^(?:[0-9A-Fa-f]{2})*$/
};

/**
 * `text` decoded by RFC 4648's `encoding`, `null` when it is not valid in
 * it; no encoding leaves it as it is. base64 and base32 take their
 * padding, base64url with or without it, base16 either case. Checked by
 * the alphabets above, not by `Buffer.from`, which takes what they refuse.
 * @param {string | undefined} encoding @param {string} text
 * @returns {Buffer | string | null}
 */
function decoded(encoding, text) {
  switch (encoding) {
    case undefined:
      return text;
    case 'base64':
      return ENCODED.base64.test(text) ? Buffer.from(text, 'base64') : null;
    case 'base64url':
      return (text.includes('=') ? ENCODED.base64urlPadded : ENCODED.base64urlBare).test(text) ? Buffer.from(text, 'base64url') : null;
    case 'base32':
      return ENCODED.base32.test(text) ? base32(text) : null;
    case 'base16':
      return ENCODED.base16.test(text) ? Buffer.from(text, 'hex') : null;
    default:
      return null;
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The bytes of base32 `text`, already known valid; trailing bits are dropped. @param {string} text @returns {Buffer} */
function base32(text) {
  const out = [];
  let bits = 0;
  let acc = 0;
  for (const c of text.replace(/=+$/, '')) {
    acc = ((acc << 5) | BASE32.indexOf(c)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Whether `count` lies between `least` and `most`, either `null` for no
 * bound; a `null` count, of a value that has none, never does.
 * @param {number | bigint | null} count @param {unknown} least @param {unknown} most
 * @returns {boolean}
 */
function within(count, least, most) {
  if (count === null) return false;
  return (least === null || count >= /** @type {number | bigint} */ (least)) && (most === null || count <= /** @type {number | bigint} */ (most));
}

/**
 * @param {string} key
 * @param {unknown} arg
 * @param {unknown} value
 * @returns {boolean}
 */
function satisfiesConstraint(key, arg, value) {
  // NaN lies outside every range, as every IEEE 754 comparison with it is
  // false; the infinities compare as the numbers they are (Jan,
  // 2026-10-20). Dates, times and durations compare with their own kind.
  switch (key) {
    case 'min':
      return ['gt', 'eq'].includes(compare(value, arg));
    case 'max':
      return ['lt', 'eq'].includes(compare(value, arg));
    case 'exclusive-min':
      return compare(value, arg) === 'gt';
    case 'exclusive-max':
      return compare(value, arg) === 'lt';
    case 'finite': {
      const o = ordinal(value);
      if (arg === true) return o !== null && o.kind === 'number' && !(typeof o.at === 'number' && !Number.isFinite(o.at));
      if (arg === false) return o !== null && o.kind === 'number';
      return false;
    }
    // A float single precision holds exactly; NaN and the infinities it holds.
    case 'float32':
      if (typeof value !== 'number') return false;
      return arg !== true || !Number.isFinite(value) || single(value);
    // An ip's family, 4 or 6, and whether it is a prefix (DXN.md §4.2).
    case 'version':
      return value instanceof DXNIp && (typeof arg === 'bigint' || typeof arg === 'number') && Number(arg) === value.version;
    case 'prefix':
      return value instanceof DXNIp && (value.prefix !== null) === (arg === true);
    // The datetime's offset is one of these, `Z` or `±HH:MM`.
    case 'offsets': {
      const offsets = arg instanceof DXNList ? arg.items : Array.isArray(arg) ? arg : null;
      const minutes = datetimeOffset(value);
      return offsets !== null && minutes !== null && offsets.includes(offsetName(minutes));
    }
    case 'multiple-of': {
      const o = ordinal(value);
      if (o === null || o.kind !== 'number' || (typeof o.at === 'number' && !Number.isFinite(o.at))) return false;
      return isMultipleOf(/** @type {number | bigint} */ (o.at), arg);
    }
    case 'min-bytes':
      return within(utf8Size(value), arg, null);
    case 'max-bytes':
      return within(utf8Size(value), null, arg);
    case 'pattern': {
      if (!(arg instanceof DXNRegex)) return false;
      const text = patternText(value);
      return text !== null && arg.toRegExp().test(text);
    }
    case 'min-count':
      return within(countOf(value), arg, null);
    case 'max-count':
      return within(countOf(value), null, arg);
    // Counted with `contains`, which reads them.
    case 'min-contains':
    case 'max-contains':
      return true;
    case 'unique':
      if (arg === false) return itemsOf(value) !== null;
      return arg === true && distinct(itemsOf(value), (item) => ({ id: identity(item) }));
    // Items without the field are compared with none.
    case 'unique-by':
      return distinct(itemsOf(value), (item) => fieldIdentity(item, /** @type {string} */ (arg)));
    // A decimal's precision is its coefficient's digit count, as written
    // (`1.50M` has three); its exponent the power of ten that scales them.
    case 'min-precision':
      return within(precision(value), arg, null);
    case 'max-precision':
      return within(precision(value), null, arg);
    case 'min-exponent':
      return within(value instanceof DXNDecimal ? value.exponent : null, arg, null);
    case 'max-exponent':
      return within(value instanceof DXNDecimal ? value.exponent : null, null, arg);
    // Only the bits numbered in `arg` are set (RFC 8610's `.bits`): an
    // unsigned integer's from its lowest, a byte string's from its first
    // byte's lowest.
    case 'bits':
      return allowedBits(arg, value);
    // Against the time of the check.
    case 'before-now':
      return fromNow(value, arg, (d) => d < 0n);
    case 'after-now':
      return fromNow(value, arg, (d) => d > 0n);
    case 'within': {
      const span = ordinal(arg);
      if (span === null || span.kind !== 'duration') return false;
      const most = /** @type {bigint} */ (span.at);
      return fromNow(value, true, (d) => (d < 0n ? -d : d) <= most);
    }
    // The string is valid in RFC 4648's `arg`.
    case 'encoding':
      return typeof value === 'string' && decoded(/** @type {string} */ (arg), value) !== null;
    // What the string holds; it checks nothing more (`content` reads it).
    case 'media-type':
      return typeof value === 'string';
    // One of DXN.md §4.2a's formats, checked as `format.cjs` says.
    case 'format':
      return typeof value === 'string' && Format.valid(/** @type {string} */ (arg), value);
    // No part of the value is finer than `arg`.
    case 'resolution': {
      const nanos = nanosOf(value);
      const unit = RESOLUTIONS.get(/** @type {string} */ (arg));
      return nanos !== null && unit !== undefined && nanos % unit === 0n;
    }
    default:
      return false;
  }
}

/**
 * A datetime's offset in minutes, a native `Date`'s UTC's, 0; `null` for
 * a value that is no datetime.
 * @param {unknown} value
 * @returns {number | null}
 */
function datetimeOffset(value) {
  if (value instanceof DXNDateTime) return value.offsetMinutes;
  if (value instanceof Date) return 0;
  return null;
}

/**
 * The name of a keyword (a `DXNKeyword` or a JS symbol) or a `DXNSymbol`;
 * `null` for any other value.
 * @param {unknown} value
 * @returns {string | null}
 */
function nameText(value) {
  if (value instanceof DXNKeyword || value instanceof DXNSymbol) return value.name;
  if (typeof value === 'symbol') return Symbol.keyFor(value) ?? value.description ?? '';
  return null;
}

/**
 * A string's, keyword's or symbol's length in codepoints; a byte string's
 * in bytes, in bits under `:bits`; `null` for anything else.
 * @param {unknown} value @param {TypeExpr} base
 * @returns {number | null}
 */
function lengthOf(value, base) {
  const text = typeof value === 'string' ? value : nameText(value);
  if (text !== null) return Array.from(text).length;
  const underBits = base.form === 'primitive' && base.name === 'bits';
  if (value instanceof DXNBits) return underBits ? value.bitLength : value.data.length;
  if (value instanceof DXNBytes) return underBits ? value.data.length * 8 : value.data.length;
  return null;
}

/** A string's, keyword's or symbol's size in UTF-8 bytes; `null` for anything else. @param {unknown} value @returns {number | null} */
function utf8Size(value) {
  const text = typeof value === 'string' ? value : nameText(value);
  return text === null ? null : Buffer.byteLength(text, 'utf8');
}

/**
 * What a pattern matches: a name's text, or a byte string one character
 * per byte -- each byte the Latin-1 character it is, which is the byte
 * itself to a pattern without the `u` flag and that character to one
 * with it. A run of bits that is no whole bytes has no text.
 * @param {unknown} value
 * @returns {string | null}
 */
function patternText(value) {
  if (typeof value === 'string') return value;
  if (value instanceof DXNBytes) return Buffer.from(value.data).toString('latin1');
  return nameText(value);
}

/** A decimal's coefficient's digit count, as written; `null` for anything else. @param {unknown} value @returns {number | null} */
function precision(value) {
  return value instanceof DXNDecimal ? value.unscaledValue.toString().length : null;
}

/**
 * Whether `value` -- a non-negative integer, or a byte string of whole
 * bytes -- sets only the bits numbered in `allowed`.
 * @param {unknown} allowed @param {unknown} value
 * @returns {boolean}
 */
function allowedBits(allowed, value) {
  const numbers = allowed instanceof DXNList ? allowed.items : Array.isArray(allowed) ? allowed : null;
  if (numbers === null || !numbers.every((n) => typeof n === 'bigint')) return false;
  const bits = /** @type {bigint[]} */ (numbers);
  if (typeof value === 'bigint') return value >= 0n && (value & ~mask(bits, 0n, null)) === 0n;
  if (value instanceof DXNBytes) {
    return Array.from(value.data).every((byte, i) => (BigInt(byte) & ~mask(bits, BigInt(i * 8), 8n)) === 0n);
  }
  return false;
}

/**
 * The bits of `allowed` from bit `from` on, `width` of them (`null` for
 * all), shifted down to it.
 * @param {bigint[]} allowed @param {bigint} from @param {bigint | null} width
 * @returns {bigint}
 */
function mask(allowed, from, width) {
  return allowed
    .filter((n) => (width === null ? true : n >= from && n < from + width))
    .reduce((acc, n) => acc | (n - from < 0n ? 0n : 1n << (n - from)), 0n);
}

/**
 * Whether a datetime's distance from now, in nanoseconds, passes `test`;
 * `wanted` false asks nothing.
 * @param {unknown} value @param {unknown} wanted @param {(d: bigint) => boolean} test
 * @returns {boolean}
 */
function fromNow(value, wanted, test) {
  if (wanted === false) return true;
  if (wanted !== true) return false;
  const o = ordinal(value);
  return o !== null && o.kind === 'datetime' && test(/** @type {bigint} */ (o.at) - nowNanos());
}

/** The current time, in nanoseconds since the epoch. @returns {bigint} */
function nowNanos() {
  return BigInt(Date.now()) * 1_000_000n;
}

/**
 * A time's, datetime's, local date-time's or duration's nanoseconds, the
 * part a resolution looks at; `null` for anything else.
 * @param {unknown} value
 * @returns {bigint | null}
 */
function nanosOf(value) {
  if (value instanceof DXNDuration) return value.nanoseconds ?? 0n;
  const o = ordinal(value);
  return o !== null && ['time', 'datetime', 'local'].includes(o.kind) ? /** @type {bigint} */ (o.at) : null;
}

/** A collection's item count, `null` for a value that is none. @param {unknown} value @returns {number | null} */
function countOf(value) {
  const items = itemsOf(value);
  return items === null ? null : items.length;
}

/** A collection's items, `null` for a value that is none. @param {unknown} value @returns {unknown[] | null} */
function itemsOf(value) {
  if (value instanceof DXNList || value instanceof DXNTuple || value instanceof DXNSortedSet) return value.items;
  if (value instanceof Set) return Array.from(value);
  if (Array.isArray(value)) return value;
  return null;
}

/**
 * Whether no two of `items` give the same identity; `identify` answers
 * `{id}`, or `null` for an item left out.
 * @param {unknown[] | null} items @param {(item: unknown) => {id: unknown} | null} identify
 */
function distinct(items, identify) {
  if (items === null) return false;
  const ids = items.map(identify).flatMap((found) => (found === null ? [] : [found.id]));
  return new Set(ids).size === ids.length;
}

/**
 * Two values are the same when their canonical forms are (DXN.md §1.5):
 * `1` and `1.0` differ, as `name:` and `"name" =>` do. A value with no DXN
 * meaning, an application's object, is compared as itself.
 * @param {unknown} value @returns {unknown}
 */
function identity(value) {
  try {
    return canonical(Validated.strip(value));
  } catch {
    return value;
  }
}

/** @param {unknown} item @param {string} field @returns {{id: unknown} | null} */
function fieldIdentity(item, field) {
  const found = fieldOf(item, field);
  return found === null ? null : { id: identity(found.value) };
}

/**
 * The value of the field named `field`, whatever its key's spelling, or
 * `null` when there is none.
 * @param {unknown} value @param {string} field @returns {{value: unknown} | null}
 */
function fieldOf(value, field) {
  if (value instanceof Validated) return fieldOf(value.value, field);
  if (value instanceof DXNStruct) {
    if (value.fields.type !== 'keyed') return null;
    const pair = value.fields.pairs.find(([name]) => name === field);
    return pair ? { value: pair[1] } : null;
  }
  if (value instanceof Map) {
    for (const [key, v] of value.entries()) {
      if (keyName(key) === field) return { value: v };
    }
    return null;
  }
  if (value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, field)) {
    return { value: /** @type {any} */ (value)[field] };
  }
  return null;
}

/**
 * Whether `a` is a multiple of `b`: two integers exactly, anything else
 * as floats. A zero divisor has no multiples.
 * @param {number | bigint} a @param {unknown} b @returns {boolean}
 */
function isMultipleOf(a, b) {
  if (typeof a === 'bigint' && typeof b === 'bigint') return b !== 0n && a % b === 0n;
  const divisor = toNumber(b);
  return divisor !== null && Number(a) % divisor === 0;
}

/**
 * `'lt'`, `'eq'` or `'gt'`, or `'nan'` for two values that do not
 * compare: NaN with anything, or two values of different kinds.
 * @param {unknown} a @param {unknown} b @returns {'lt' | 'eq' | 'gt' | 'nan'}
 */
function compare(a, b) {
  const x = ordinal(a);
  const y = ordinal(b);
  if (x === null || y === null || x.kind !== y.kind) return 'nan';
  if (Number.isNaN(x.at) || Number.isNaN(y.at)) return 'nan';
  if (x.at < y.at) return 'lt';
  if (x.at > y.at) return 'gt';
  return 'eq';
}

/**
 * A value as its kind and its place in that kind's order: a number (NaN
 * and the infinities as the numbers they are), or a date, time, datetime,
 * local date-time or duration as a count of days or nanoseconds; `null`
 * for a value with no place. A duration with years or months has none:
 * their length varies.
 * @param {unknown} value
 * @returns {{kind: 'number' | 'date' | 'time' | 'datetime' | 'local' | 'duration', at: number | bigint} | null}
 */
function ordinal(value) {
  if (typeof value === 'number' || typeof value === 'bigint') return { kind: 'number', at: value };
  if (value instanceof DXNDecimal || value instanceof DXNRational) return { kind: 'number', at: value.toNumber() };
  if (value instanceof DXNDate) return { kind: 'date', at: daysFromCivil(value.year, value.month, value.day) };
  if (value instanceof DXNTime) {
    const seconds = BigInt(value.hour * 3600 + value.minute * 60 + value.second);
    return { kind: 'time', at: seconds * 1_000_000_000n + BigInt(value.nanosecond) };
  }
  if (value instanceof DXNDateTime) return { kind: 'datetime', at: value.epochNanoseconds };
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : { kind: 'datetime', at: BigInt(ms) * 1_000_000n };
  }
  if (value instanceof DXNLocalDateTime) return { kind: 'local', at: value.localNanoseconds };
  if (value instanceof DXNDuration && !value.years && !value.months) {
    const at =
      BigInt(value.weeks ?? 0) * 604_800_000_000_000n +
      BigInt(value.days ?? 0) * 86_400_000_000_000n +
      BigInt(value.hours ?? 0) * 3_600_000_000_000n +
      BigInt(value.minutes ?? 0) * 60_000_000_000n +
      (value.nanoseconds ?? 0n);
    return { kind: 'duration', at };
  }
  return null;
}

/** Whether `value` has a place in some kind's order: a range's bound. @param {unknown} value @returns {boolean} */
function comparable(value) {
  return ordinal(value) !== null;
}

/**
 * Whether `value` is a finite number other than zero: a `multiple-of`.
 * NaN and the infinities are none, as they are no number to the
 * reference.
 * @param {unknown} value @returns {boolean}
 */
function nonzeroNumber(value) {
  const o = ordinal(value);
  if (o === null || o.kind !== 'number') return false;
  return typeof o.at === 'bigint' ? o.at !== 0n : Number.isFinite(o.at) && o.at !== 0;
}

/** Whether `value` is a duration of a fixed length: a `within`. @param {unknown} value @returns {boolean} */
function span(value) {
  const o = ordinal(value);
  return o !== null && o.kind === 'duration';
}

/** A number of any kind as a float; `null` for any other value. @param {unknown} value @returns {number | null} */
function toNumber(value) {
  const o = ordinal(value);
  return o !== null && o.kind === 'number' ? Number(o.at) : null;
}

module.exports = { matches, conform, context, NO, resolutions, comparable, nonzeroNumber, span, TYPE_KEYS };
