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
   */
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }
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
