'use strict';

/**
 * @fileoverview Internal only — never appears in a value handed back
 * to `decode`/`decodeBinary`'s caller. Mirrors `Dextrin.Schema.Validated`.
 *
 * Tracks which schema produced a materialized value, so an outer
 * `{form: 'reference', name}` check can verify identity even after
 * materialization has replaced the value with a plain object that
 * carries no name of its own — unlike an *opaque* `DXNStruct`, which
 * already carries its own name and never needed this. `validator.cjs`'s
 * `materialize` (decode) and `wrapAndCheck` (encode-time validation)
 * both wrap every successfully-checked struct's result in one of
 * these; `strip` removes every occurrence, recursively, once the
 * value reaches somewhere that isn't itself another schema check.
 */

const DXNMap = require('../values/map.cjs');
const DXNList = require('../values/list.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNOrderedMap = require('../values/ordered-map.cjs');
const DXNSortedSet = require('../values/sorted-set.cjs');
const DXNStruct = require('../values/struct.cjs');
const DXNCustomTag = require('../values/custom-tag.cjs');

class Validated {
  /**
   * @param {string} name
   * @param {unknown} value
   * @param {string[]} [also] the schemas the value passes as besides its
   *   own: those its schema extends, and that it is a valid one of
   *   (`DXNS.md` §4b).
   * @param {{version?: number | null, asRead?: DXNStruct | null, refused?: Error | null}} [read]
   *   what a pinned field needs (`DXNS.md` §5c): see the fields below.
   */
  constructor(name, value, also = [], { version = null, asRead = null, refused = null } = {}) {
    this.name = name;
    this.value = value;
    /** @type {string[]} */
    this.also = also;
    /**
     * The version it was read or checked with (`null` when unknown).
     * @type {number | null}
     */
    this.version = version;
    /**
     * The struct as that version reads it, before any materializer: what
     * a field pinned to that version takes instead (`DXNS.md` §5c).
     * @type {DXNStruct | null}
     */
    this.asRead = asRead;
    /**
     * Why it has no value -- an older version with no materializer to
     * upgrade it -- which stands unless a pinned field takes `asRead`.
     * @type {Error | null}
     */
    this.refused = refused;
  }

  /**
   * This wrapper holding `value` instead, and otherwise the same.
   * @param {unknown} value
   * @param {{refused?: Error | null}} [changes]
   * @returns {Validated}
   */
  with(value, changes = {}) {
    return new Validated(this.name, value, this.also, {
      version: this.version,
      asRead: this.asRead,
      refused: changes.refused === undefined ? this.refused : changes.refused
    });
  }
}

/**
 * `value` with every wrapper removed, as `strip` does -- or, thrown, the
 * first refusal one still holds: a struct no field took as read, and that
 * could not be upgraded (`DXNS.md` §5c).
 * @param {unknown} value
 * @returns {unknown}
 */
function unwrap(value) {
  const error = refusal(value);
  if (error) throw error;
  return strip(value);
}

/**
 * The first refusal a wrapper in `value` holds, however deep; `null` when
 * none does.
 * @param {unknown} value
 * @returns {Error | null}
 */
function refusal(value) {
  if (value instanceof Validated) return value.refused ?? refusal(value.value);
  /** @param {Iterable<unknown>} items @returns {Error | null} */
  const first = (items) => {
    for (const item of items) {
      const found = refusal(item);
      if (found) return found;
    }
    return null;
  };
  if (Array.isArray(value)) return first(value);
  if (value instanceof DXNList || value instanceof DXNTuple || value instanceof DXNSortedSet) return first(value.items);
  if (value instanceof DXNOrderedMap) return first(value.pairs.flat());
  if (value instanceof Map) return first(Array.from(value.entries()).flat());
  if (value instanceof Set) return first(value);
  if (value instanceof DXNStruct) {
    return value.fields.type === 'keyed' ? first(value.fields.pairs.map(([, v]) => v)) : first(value.fields.values);
  }
  if (value instanceof DXNCustomTag) return refusal(value.value);
  return null;
}

/**
 * Recursively removes every `Validated` wrapper from a decoded value
 * tree.
 * @param {unknown} value
 * @returns {unknown}
 */
function strip(value) {
  if (value instanceof Validated) return strip(value.value);
  if (Array.isArray(value)) return value.map(strip);
  if (value instanceof DXNList) return new DXNList(value.items.map(strip));
  if (value instanceof DXNTuple) return new DXNTuple(value.items.map(strip));
  if (value instanceof DXNOrderedMap) return new DXNOrderedMap(value.pairs.map(([k, v]) => [strip(k), strip(v)]));
  if (value instanceof Map) return new DXNMap(Array.from(value.entries(), ([k, v]) => [strip(k), strip(v)]));
  if (value instanceof Set) return new Set(Array.from(value, strip));
  if (value instanceof DXNSortedSet) return DXNSortedSet.fromArray(value.items.map(strip));
  if (value instanceof DXNStruct) {
    return value.fields.type === 'keyed'
      ? value.withFields({ type: 'keyed', pairs: value.fields.pairs.map(([k, v]) => [k, strip(v)]) })
      : value.withFields({ type: 'positional', values: value.fields.values.map(strip) });
  }
  if (value instanceof DXNCustomTag) return new DXNCustomTag(value.name, strip(value.value));
  return value;
}

module.exports = Validated;
module.exports.strip = strip;
module.exports.unwrap = unwrap;
