'use strict';

/**
 * @fileoverview Internal, compiled representation of a `.dxns` type
 * expression — the 12-form vocabulary (`any`, `primitive`,
 * `reference`, `list-of`, `set-of`, `tuple-of`, `map-of`, `enum`,
 * `one-of`, `all-of`, `nilable`, `refine`) `schema/compiler.cjs` turns
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
 *   | {form: 'primitive', name: string}
 *   | {form: 'reference', name: string}
 *   | {form: 'list-of', elem: TypeExpr}
 *   | {form: 'set-of', elem: TypeExpr}
 *   | {form: 'tuple-of', elems: TypeExpr[]}
 *   | {form: 'map-of', key: TypeExpr, value: TypeExpr}
 *   | {form: 'enum', literals: unknown[]}
 *   | {form: 'one-of', variants: TypeExpr[]}
 *   | {form: 'all-of', variants: TypeExpr[]}
 *   | {form: 'nilable', elem: TypeExpr}
 *   | {form: 'refine', base: TypeExpr, constraints: {[k: string]: unknown}}} TypeExpr
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
const DXNTimestamp = require('../values/timestamp.cjs');
const DXNDateTime = require('../values/date-time.cjs');
const DXNDuration = require('../values/duration.cjs');
const DXNUUID = require('../values/uuid.cjs');
const DXNURI = require('../values/uri.cjs');
const DXNBytes = require('../values/bytes.cjs');
const DXNBits = require('../values/bits.cjs');
const DXNRegex = require('../values/regex.cjs');
const Validated = require('./validated.cjs');

/**
 * Whether `value` matches `type` — shared by both decode
 * (`validator.cjs`'s `materialize`) and encode-time validation
 * (`validateForEncode`): the same recursive check, the same function,
 * for both directions.
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
  if (type.form === 'any') return true;

  if (type.form === 'reference') return matchesReference(type.name, value, registry);

  if (value instanceof Validated) return matches(type, value.value, registry);

  switch (type.form) {
    case 'primitive':
      return primitiveMatches(type.name, value);
    case 'list-of':
      return value instanceof DXNList && value.items.every((v) => matches(type.elem, v, registry));
    case 'set-of':
      return value instanceof Set && Array.from(value).every((v) => matches(type.elem, v, registry));
    case 'tuple-of':
      return (
        value instanceof DXNTuple &&
        type.elems.length === value.items.length &&
        type.elems.every((t, i) => matches(t, value.items[i], registry))
      );
    case 'map-of':
      return (
        value instanceof Map &&
        Array.from(value.entries()).every(([k, v]) => matches(type.key, k, registry) && matches(type.value, v, registry))
      );
    case 'enum':
      return type.literals.some((literal) => keywordAwareEq(literal, value));
    case 'one-of':
      return type.variants.some((t) => matches(t, value, registry));
    case 'all-of':
      return type.variants.every((t) => matches(t, value, registry));
    case 'nilable':
      return value === null || matches(type.elem, value, registry);
    case 'refine':
      return matches(type.base, value, registry) && satisfiesConstraints(value, type.constraints);
    default:
      return false;
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
    case 'timestamp':
      // A native `Date` is an instant, so it always means a timestamp.
      return value instanceof DXNTimestamp || value instanceof Date;
    case 'datetime':
      return value instanceof DXNDateTime;
    case 'duration':
      return value instanceof DXNDuration;
    case 'uuid':
      return value instanceof DXNUUID;
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
    default:
      return false;
  }
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

module.exports = { matches };
