'use strict';

/**
 * @fileoverview Schema-driven type coercion on encode — a capability
 * with no Elixir `dextrin` equivalent, added on the JS side because
 * the value model's own `DXN*.fromX` conversion helpers
 * (`src/values/*.cjs`) already make the coercion table trivial to
 * build: every class's documented native-type converter doubles as
 * an encode-time coercion, with no separate registration.
 *
 * `tryCoerce(type, value)` is attempted by `validator.cjs` only when a
 * value doesn't already match its field's declared type — never
 * during decode, which always knows its own concrete wire type
 * unambiguously and has nothing to coerce. Governed by the top-level
 * `encode`/`encodeBinary` `coerce:` option, default `true`.
 */

const DXNChar = require('../values/char.cjs');
const DXNSymbol = require('../values/symbol.cjs');
const DXNList = require('../values/list.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNOrderedMap = require('../values/ordered-map.cjs');
const DXNSortedSet = require('../values/sorted-set.cjs');
const DXNDecimal = require('../values/decimal.cjs');
const DXNRational = require('../values/rational.cjs');
const DXNDate = require('../values/date.cjs');
const DXNTimestamp = require('../values/timestamp.cjs');
const DXNDateTime = require('../values/date-time.cjs');
const DXNUUID = require('../values/uuid.cjs');
const DXNURI = require('../values/uri.cjs');
const DXNRegex = require('../values/regex.cjs');

/** @type {Record<string, (value: unknown) => unknown>} */
const PRIMITIVE_COERCIONS = {
  rational: (v) => (typeof v === 'number' ? DXNRational.fromNumber(v) : undefined),
  decimal: (v) => (typeof v === 'number' ? DXNDecimal.fromNumber(v) : undefined),
  char: (v) => (typeof v === 'string' ? tryOr(() => DXNChar.fromString(v)) : undefined),
  symbol: (v) => (typeof v === 'symbol' ? DXNSymbol.fromSymbol(v) : undefined),
  list: (v) => (Array.isArray(v) ? DXNList.fromArray(v) : undefined),
  tuple: (v) => (Array.isArray(v) ? DXNTuple.fromArray(v) : undefined),
  'ordered-map': (v) => (v instanceof Map ? DXNOrderedMap.fromMap(v) : undefined),
  'sorted-set': (v) => (Array.isArray(v) ? DXNSortedSet.fromArray(v) : v instanceof Set ? DXNSortedSet.fromSet(v) : undefined),
  array: (v) => (v instanceof DXNList ? v.toArray() : undefined),
  date: (v) => (v instanceof Date ? tryOr(() => DXNDate.fromDate(v)) : undefined),
  timestamp: (v) => (v instanceof Date ? DXNTimestamp.fromDate(v) : undefined),
  // A plain JS Date has no offset of its own to read — falls back to
  // the runtime's local timezone offset, a documented, not-fully-
  // general default (see the project plan's own note on this).
  datetime: (v) => (v instanceof Date ? DXNDateTime.fromDate(v, -v.getTimezoneOffset()) : undefined),
  uuid: (v) => (typeof v === 'string' ? tryOr(() => DXNUUID.fromString(v)) : undefined),
  uri: (v) => (typeof v === 'string' ? DXNURI.fromString(v) : undefined),
  regex: (v) => (v instanceof RegExp ? DXNRegex.fromRegExp(v) : undefined)
};

/**
 * @template T
 * @param {() => T} fn
 * @returns {T | undefined}
 */
function tryOr(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Attempts to coerce `value` toward `type`. Returns the coerced value
 * on success, or `undefined` if no applicable coercion exists (the
 * caller falls back to treating this as an ordinary type mismatch).
 * Never throws — a coercion attempt that fails (e.g. an invalid UUID
 * string) is simply not a coercion, not a distinct error.
 * @param {import('./type-expr.cjs').TypeExpr} type
 * @param {unknown} value
 * @returns {unknown}
 */
function tryCoerce(type, value) {
  switch (type.form) {
    case 'primitive':
      return PRIMITIVE_COERCIONS[type.name]?.(value);

    case 'list-of':
      if (!Array.isArray(value)) return undefined;
      return DXNList.fromArray(value.map((v) => coerceOrOriginal(type.elem, v)));

    case 'set-of':
      if (Array.isArray(value)) return new Set(value.map((v) => coerceOrOriginal(type.elem, v)));
      if (value instanceof Set) return new Set(Array.from(value, (v) => coerceOrOriginal(type.elem, v)));
      return undefined;

    case 'tuple-of':
      if (!Array.isArray(value) || value.length !== type.elems.length) return undefined;
      return DXNTuple.fromArray(value.map((v, i) => coerceOrOriginal(type.elems[i], v)));

    case 'nilable':
      return value === null ? undefined : tryCoerce(type.elem, value);

    case 'one-of':
      for (const variant of type.variants) {
        const coerced = tryCoerce(variant, value);
        if (coerced !== undefined) return coerced;
      }
      return undefined;

    case 'refine':
      return tryCoerce(type.base, value);

    default:
      return undefined;
  }
}

/**
 * @param {import('./type-expr.cjs').TypeExpr} type
 * @param {unknown} value
 * @returns {unknown} the coerced value, or `value` itself unchanged
 * if no coercion applies (used for element-wise coercion, where a
 * non-coercible element should still pass through for the outer
 * type-check to judge on its own merits).
 */
function coerceOrOriginal(type, value) {
  const coerced = tryCoerce(type, value);
  return coerced === undefined ? value : coerced;
}

module.exports = { tryCoerce };
