'use strict';

/**
 * @fileoverview Multi-line, indented `.dxn` rendering — the `pretty:
 * true` option on the top-level `encode`, built on top of
 * `src/text/printer.cjs`. Mirrors `Dextrin.Text.Formatter`
 * structurally: every empty collection and every scalar falls through
 * to the single-line printer unchanged (there's nothing multi-line
 * about `[]` or `42`).
 *
 * **The layout** (Jan, 2026-10-20): the top-level collection always
 * breaks, one entry per line, however short it is. A nested collection
 * is written on one line, its entries single-space separated, when that
 * line -- its indent and its key included -- fits the width (`width`,
 * 80); otherwise it breaks too, and what it holds is laid out again by
 * the same rule. Columns are counted in code points.
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
const DEFAULT_WIDTH = 80;

/**
 * The options every function here passes on: the caller's, plus `$flat`
 * (laying out a value inside a one-line one) and `$room` (the columns
 * left on the current line after its indent and key).
 * @typedef {{indent?: number, width?: number, registry?: import('../registry.cjs'), $flat?: boolean, $room?: number, [k: string]: unknown}} Opts
 */
/**
 * @param {unknown} value
 * @param {Opts} [opts]
 * @returns {string}
 */
function pretty(value, opts = {}) {
  return layout(value, 0, opts);
}

/**
 * A nested value on one line when that fits the room its line leaves
 * it, and laid out over lines otherwise. The top level (depth 0) and a
 * value inside a one-line one go straight to `layout`.
 * @param {unknown} value
 * @param {number} depth
 * @param {Opts} opts
 * @returns {string}
 */
function render(value, depth, opts) {
  if (depth === 0 || opts.$flat) return layout(value, depth, opts);
  const oneLine = layout(value, depth, { ...opts, $flat: true });
  return columns(oneLine) <= room(opts) ? oneLine : layout(value, depth, opts);
}

/** @param {string} text */
function columns(text) {
  return [...text].length;
}

/** @param {Opts} opts */
function width(opts) {
  return opts.width ?? DEFAULT_WIDTH;
}

/**
 * The columns left for a value after its line's indent and key; the
 * whole width when nothing said otherwise.
 * @param {Opts} opts
 */
function room(opts) {
  return opts.$room ?? width(opts);
}

/**
 * `opts` with the room a value has after `used` columns of its line.
 * @param {Opts} opts
 * @param {number} used
 * @returns {Opts}
 */
function withRoom(opts, used) {
  return { ...opts, $room: width(opts) - used };
}

/**
 * The rendered entries between `open` and `close`: single-space
 * separated on one line, or one per line, indented.
 * @param {string} open
 * @param {string[]} rendered
 * @param {string} close
 * @param {string} innerIndent
 * @param {string} outerIndent
 * @param {Opts} opts
 */
function joined(open, rendered, close, innerIndent, outerIndent, opts) {
  if (opts.$flat) return `${open}${rendered.join(' ')}${close}`;
  return `${open}\n${rendered.map((line) => innerIndent + line).join('\n')}\n${outerIndent}${close}`;
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @param {Opts} opts
 * @returns {string}
 */
function layout(value, depth, opts) {
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
  if (value instanceof DXNStruct && value.fields.type === 'keyed' && value.fields.pairs.length + value.extra.length > 0) {
    const lines = value.fields.pairs.map(([name, field]) => (/** @type {number} */ d) => renderKeywordEntry(name, field, d, opts));
    return `${Printer.writtenHead(value, opts)}${bracketedLines('{', [...lines, ...extraLines(value, opts)], '}', depth, opts)}`;
  }
  if (value instanceof DXNStruct && value.fields.type === 'positional' && value.fields.values.length + value.extra.length > 0) {
    // A positional struct's items, then its extra fields as entries, one
    // per line like the items (DXN.md §1.2).
    const lines = value.fields.values.map((item) => (/** @type {number} */ d) => render(item, d, opts));
    return `${Printer.writtenHead(value, opts)}${bracketedLines('[', [...lines, ...extraLines(value, opts)], ']', depth, opts)}`;
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
    if (found) return render(found.compiled.structOf(value), depth, opts);
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
 * A struct's extra fields as lines to render: a name like a field name,
 * any other map key as itself.
 * @param {DXNStruct} value
 * @param {Opts} opts
 * @returns {Array<(depth: number) => string>}
 */
function extraLines(value, opts) {
  return value.extra.map(([key, field]) =>
    typeof key === 'string'
      ? (/** @type {number} */ d) => renderKeywordEntry(key, field, d, opts)
      : (/** @type {number} */ d) => renderEntry(key, field, d, opts)
  );
}

/**
 * @param {string} open
 * @param {Array<(depth: number) => string>} lines each renders itself at a depth.
 * @param {string} close
 * @param {number} depth
 * @param {Opts} opts
 */
function bracketedLines(open, lines, close, depth, opts) {
  const innerDepth = depth + 1;
  const unit = indentUnit(opts);
  return joined(open, lines.map((line) => line(innerDepth)), close, unit.repeat(innerDepth), unit.repeat(depth), opts);
}

/**
 * @param {string} open
 * @param {unknown[]} items
 * @param {string} close
 * @param {number} depth
 * @param {Opts} opts
 */
function bracketed(open, items, close, depth, opts) {
  const innerDepth = depth + 1;
  const unit = indentUnit(opts);
  const innerIndent = unit.repeat(innerDepth);
  const outerIndent = unit.repeat(depth);
  const itemOpts = withRoom(opts, columns(innerIndent));
  const rendered = items.map((item) => render(item, innerDepth, itemOpts));
  return joined(open, rendered, close, innerIndent, outerIndent, opts);
}

/**
 * @param {string} open
 * @param {Array<[unknown, unknown]>} pairs
 * @param {string} close
 * @param {number} depth
 * @param {Opts} opts
 */
function bracketedEntries(open, pairs, close, depth, opts) {
  const innerDepth = depth + 1;
  const unit = indentUnit(opts);
  const innerIndent = unit.repeat(innerDepth);
  const outerIndent = unit.repeat(depth);
  const rendered = pairs.map(([key, value]) => renderEntry(key, value, innerDepth, opts));
  return joined(open, rendered, close, innerIndent, outerIndent, opts);
}

/**
 * @param {string} open
 * @param {Array<[string, unknown]>} pairs
 * @param {string} close
 * @param {number} depth
 * @param {Opts} opts
 */
function bracketedKeywordEntries(open, pairs, close, depth, opts) {
  const innerDepth = depth + 1;
  const unit = indentUnit(opts);
  const innerIndent = unit.repeat(innerDepth);
  const outerIndent = unit.repeat(depth);
  const rendered = pairs.map(([name, value]) => renderKeywordEntry(name, value, innerDepth, opts));
  return joined(open, rendered, close, innerIndent, outerIndent, opts);
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
 * @param {Opts} opts
 */
function renderKeywordEntry(name, value, depth, opts) {
  const prefix = Printer.isBareIdentifier(name) ? `${name}: ` : `:${Printer.quoteString(name)} => `;
  return prefix + render(value, depth, keyedRoom(opts, depth, prefix));
}

/**
 * `opts` with the room a value has after `prefix` on a line indented
 * `depth` levels.
 * @param {Opts} opts
 * @param {number} depth
 * @param {string} prefix
 * @returns {Opts}
 */
function keyedRoom(opts, depth, prefix) {
  return withRoom(opts, columns(indentUnit(opts).repeat(depth) + prefix));
}

/**
 * @param {unknown} key
 * @param {unknown} value
 * @param {number} depth
 * @param {Opts} opts
 */
function renderEntry(key, value, depth, opts) {
  const name = Printer.keywordEntryName(key);
  if (name !== null) return renderKeywordEntry(name, value, depth, opts);
  const prefix = `${Printer.print(key, opts)} => `;
  return prefix + render(value, depth, keyedRoom(opts, depth, prefix));
}

module.exports = { pretty };
