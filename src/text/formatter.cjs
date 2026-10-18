'use strict';

/**
 * @fileoverview Multi-line, indented `.dxn` rendering — the `pretty:
 * true` option on the top-level `encode`, built on top of
 * `src/text/printer.cjs`. Mirrors `Dextrin.Text.Formatter`
 * structurally: every non-empty collection gets one entry per line,
 * indented one level deeper than its container; every empty
 * collection and every scalar falls through to the single-line
 * printer unchanged (there's nothing multi-line about `[]` or `42`).
 *
 * Comments cannot be preserved here, or by any formatter built on this
 * library's decode-then-reprint approach, for the same reason
 * `Dextrin.Text.Formatter`'s own moduledoc gives: the lexer discards
 * `#` comments as trivia before a value ever exists to carry them
 * forward.
 */

const { checkPairs } = require('../map-key.cjs');
const Printer = require('./printer.cjs');

const DXNList = require('../values/list.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNSortedSet = require('../values/sorted-set.cjs');
const DXNOrderedMap = require('../values/ordered-map.cjs');
const DXNStruct = require('../values/struct.cjs');

const DEFAULT_INDENT = 2;

/**
 * @param {unknown} value
 * @param {{indent?: number, registry?: import('../registry.cjs'), [k: string]: unknown}} [opts]
 * @returns {string}
 */
function pretty(value, opts = {}) {
  return render(value, 0, opts);
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @param {{indent?: number, registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 * @returns {string}
 */
function render(value, depth, opts) {
  if (value instanceof DXNList && value.items.length > 0) {
    return bracketed('[', value.items, ']', depth, opts);
  }
  if (value instanceof DXNTuple && value.items.length > 0) {
    return bracketed('{', value.items, '}', depth, opts);
  }
  if (value instanceof Set) {
    return value.size === 0 ? '@{}' : bracketed('@{', Array.from(value), '}', depth, opts);
  }
  if (value instanceof DXNSortedSet) {
    return value.items.length === 0 ? '@sorted-set @{}' : `@sorted-set ${bracketed('@{', value.items, '}', depth, opts)}`;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '@array[]' : `@array${bracketed('[', value, ']', depth, opts)}`;
  }
  if (value instanceof DXNOrderedMap) {
    checkPairs(value.pairs);
    return value.pairs.length === 0 ? '@ordered %{}' : `@ordered ${bracketedEntries('%{', value.pairs, '}', depth, opts)}`;
  }
  if (value instanceof Map && value.size > 0) {
    checkPairs(value.entries());
    return bracketedEntries('%{', Array.from(value.entries()), '}', depth, opts);
  }
  if (value instanceof DXNStruct && value.fields.type === 'keyed' && value.fields.pairs.length > 0) {
    return `${DXNStruct.head(value.name, value.version)}${bracketedKeywordEntries('{', value.fields.pairs, '}', depth, opts)}`;
  }
  if (value instanceof DXNStruct && value.fields.type === 'positional' && value.fields.values.length > 0) {
    return `${DXNStruct.head(value.name, value.version)}${bracketed('[', value.fields.values, ']', depth, opts)}`;
  }

  // A registered application class instance — rebuilt as the
  // equivalent keyed DXNStruct and re-rendered through the clause
  // above, so it gets the same multi-line treatment as an opaque
  // DXNStruct with the same shape, rather than inconsistently
  // squashing to single-line just because a schema happens to be
  // registered for this one name. No match at all falls through to
  // the scalar/Printer.print path below unchanged.
  const registry = opts.registry;
  if (registry && value !== null && typeof value === 'object' && !(value instanceof DXNStruct)) {
    const name = registry.fetchSchemaNameForModule(value.constructor);
    const found = name && registry.fetchStructSchema(name);
    if (found) return render(DXNStruct.keyed(name, found.compiled.fieldValues(value)), depth, opts);
  }

  // Every scalar, every empty collection, and any struct-shaped
  // extension type the printer already handles directly (Regex, Date,
  // Decimal, DXNUUID, ...) needs no multi-line treatment.
  return Printer.print(value, opts);
}

/** @param {{indent?: number}} opts */
function indentUnit(opts) {
  return ' '.repeat(opts.indent ?? DEFAULT_INDENT);
}

/**
 * @param {string} open
 * @param {unknown[]} items
 * @param {string} close
 * @param {number} depth
 * @param {{indent?: number, registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 */
function bracketed(open, items, close, depth, opts) {
  const innerDepth = depth + 1;
  const unit = indentUnit(opts);
  const innerIndent = unit.repeat(innerDepth);
  const outerIndent = unit.repeat(depth);
  const body = items.map((item) => innerIndent + render(item, innerDepth, opts)).join('\n');
  return `${open}\n${body}\n${outerIndent}${close}`;
}

/**
 * @param {string} open
 * @param {Array<[unknown, unknown]>} pairs
 * @param {string} close
 * @param {number} depth
 * @param {{indent?: number, registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 */
function bracketedEntries(open, pairs, close, depth, opts) {
  const innerDepth = depth + 1;
  const unit = indentUnit(opts);
  const innerIndent = unit.repeat(innerDepth);
  const outerIndent = unit.repeat(depth);
  const body = pairs.map(([key, value]) => innerIndent + renderEntry(key, value, innerDepth, opts)).join('\n');
  return `${open}\n${body}\n${outerIndent}${close}`;
}

/**
 * @param {string} open
 * @param {Array<[string, unknown]>} pairs
 * @param {string} close
 * @param {number} depth
 * @param {{indent?: number, registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 */
function bracketedKeywordEntries(open, pairs, close, depth, opts) {
  const innerDepth = depth + 1;
  const unit = indentUnit(opts);
  const innerIndent = unit.repeat(innerDepth);
  const outerIndent = unit.repeat(depth);
  const body = pairs.map(([name, value]) => innerIndent + renderKeywordEntry(name, value, innerDepth, opts)).join('\n');
  return `${open}\n${body}\n${outerIndent}${close}`;
}

/**
 * Same colon-shorthand-vs-arrow-form rule as `Printer`'s own entry
 * printing — the shorthand only exists for a bare identifier; any
 * other name has no colon form at all. Used both for a struct's field
 * names (unambiguously keyword-shaped by construction) and, via
 * `renderEntry` below, for a `Map`/`DXNOrderedMap` entry whose key is
 * already confirmed keyword-shaped.
 * @param {string} name
 * @param {unknown} value
 * @param {number} depth
 * @param {{indent?: number, registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 */
function renderKeywordEntry(name, value, depth, opts) {
  if (Printer.isBareIdentifier(name)) return `${name}: ${render(value, depth, opts)}`;
  return `:${Printer.quoteString(name)} => ${render(value, depth, opts)}`;
}

/**
 * @param {unknown} key
 * @param {unknown} value
 * @param {number} depth
 * @param {{indent?: number, registry?: import('../registry.cjs'), [k: string]: unknown}} opts
 */
function renderEntry(key, value, depth, opts) {
  const name = Printer.keywordEntryName(key);
  if (name !== null) return renderKeywordEntry(name, value, depth, opts);
  return `${Printer.print(key, opts)} => ${render(value, depth, opts)}`;
}

module.exports = { pretty };
