'use strict';

/**
 * @fileoverview A `.dxn` document with everything it holds: its value,
 * and every comment, blank line and comma around it
 * (`design/comment-retention.md` in `dextrin`), mirroring
 * `Dextrin.Document`.
 *
 * `decode` keeps only the value, which is right for data and wrong for a
 * file people annotate: decoding, changing one entry and encoding again
 * deletes every comment. A document keeps the syntax tree instead --
 * every token, with the trivia between them -- and the value beside it:
 *
 *     const doc = Document.parse(source);
 *     Document.toValue(doc);   // what decode returns
 *     Document.render(doc);    // source, byte for byte
 *
 * **One parser.** The tree is recorded by the same parser `decode` runs
 * (`text/parser.cjs`'s `parseTree`), so a document parses exactly when
 * `decode` would, and refuses with the same errors.
 *
 * **Edits** -- `replace`, `delete`, `insert` -- name what they change by
 * a path from the value: a map's key as it decodes (`Symbol.for('deps')`,
 * `'x'`), a struct's field name, a list's, tuple's or set's index. Each
 * splices the source at the edited node and parses the result again, so
 * every byte it does not touch is rendered as it was.
 *
 * **A comment belongs to an entry**, by lines alone: a block starting on
 * an entry's own line is its *trailing* block, however many lines it runs
 * to; every other block of comment lines is *above* the next entry, and a
 * blank line separates blocks. A deleted entry takes its trailing block
 * and the blocks above it; a replaced value keeps every comment around
 * it; an inserted entry goes above the comments of the entry it lands
 * before.
 *
 * **`update`** turns a new value into these edits, leaving what is equal
 * alone, and refuses by default where guessing which edit was meant
 * would lose a comment (`onAmbiguity`).
 */

const { parseTree } = require('./text/parser.cjs');
const DXNError = require('./error.cjs');
const DXNStruct = require('./values/struct.cjs');
const DXNList = require('./values/list.cjs');
const DXNKeyword = require('./values/keyword.cjs');
const { dxnEquals } = require('./values/equality.cjs');
const Formatter = require('./document/formatter.cjs');

/**
 * @typedef {import('./text/parser.cjs').SyntaxNode} SyntaxNode
 * @typedef {import('./text/lexer.cjs').Token} Token
 * @typedef {{trusted?: boolean, strict?: boolean, registry?: import('./registry.cjs')}} Options
 * @typedef {{source: string, tree: SyntaxNode, tokens: Token[], value: unknown, opts: Options}} Doc
 * @typedef {unknown[]} Path
 * @typedef {{op: 'replace', path: Path, value: unknown} | {op: 'delete', path: Path} | {op: 'insert', path: Path, where: unknown, value: unknown}} Change
 * @typedef {[number, number]} Span a `[from, to)` range of the source.
 */

/**
 * Why an edit was refused: `document/not-found`, `document/exists`,
 * `document/ambiguous` or `document/not-a-collection`, with the path.
 */
class DocumentError extends Error {
  /**
   * @param {'not-found' | 'exists' | 'ambiguous' | 'not-a-collection'} reason
   * @param {Path} path
   */
  constructor(reason, path) {
    super(`${reason}: ${path.map(describe).join(' ')}`);
    this.name = 'DocumentError';
    this.reason = reason;
    this.path = path;
    /** The refusal's category, `document/<reason>`. */
    this.category = `document/${reason}`;
  }
}

/** @param {unknown} step @returns {string} */
function describe(step) {
  return typeof step === 'symbol' ? `:${Symbol.keyFor(step) ?? step.description}` : String(step);
}

/**
 * Parses `source`, keeping everything in it. `opts` are `decode`'s and
 * mean the same; so do the errors.
 * @param {string} source
 * @param {Options} [opts]
 * @returns {Doc}
 */
function parse(source, opts = {}) {
  try {
    const { value, tree, tokens } = parseTree(source, opts);
    return { source, tree, tokens, value, opts };
  } catch (err) {
    throw DXNError.wrap(err, 'parse');
  }
}

/** The value `doc` holds: what `decode` gives for its source. @param {Doc} doc */
function toValue(doc) {
  return doc.value;
}

/** `doc` as `.dxn` text: its source, byte for byte, when nothing was edited. @param {Doc} doc */
function render(doc) {
  return doc.source;
}

/**
 * `doc` laid out the way the pretty printer lays out a value, with every
 * comment kept beside the entry it belongs to. Layout only: every token
 * is written as it was.
 * @param {Doc} doc
 * @param {{indent?: number}} [opts]
 */
function format(doc, opts = {}) {
  return Formatter.format(doc, opts);
}

// ---- edits ----------------------------------------------------------------

/**
 * `doc` with the value at `path` replaced by `value`, written as `encode`
 * writes it -- over lines at the indentation it replaces when it needs
 * more than one. Every comment around it stays.
 * @param {Doc} doc
 * @param {Path} path
 * @param {unknown} value
 * @returns {Doc}
 */
function replace(doc, path, value) {
  const found = located(doc, path);
  const body = bodyNode(found.value);
  const [from, to] = span(doc, body);
  return spliced(doc, from, to, written(doc, value, indentation(doc.source, from)));
}

/**
 * `doc` without the entry at `path` -- a map's key and value, a list's
 * item -- and without the comments that belong to it.
 * @param {Doc} doc
 * @param {Path} path
 * @returns {Doc}
 */
function remove(doc, path) {
  const found = located(doc, path);
  const [from, to] = ownedSpan(doc, /** @type {SyntaxNode} */ (found.entry), found.siblings);
  return spliced(doc, from, to, '');
}

/**
 * `doc` with `value` added to the collection at `path`: before the item
 * at `where` in a list, tuple or set (`-1` for the end), or under the new
 * key `where` in a map or a struct, after its last entry. A key already
 * there is refused; that is `replace`'s.
 * @param {Doc} doc
 * @param {Path} path
 * @param {unknown} where
 * @param {unknown} value
 * @returns {Doc}
 */
function insert(doc, path, where, value) {
  const collection = collectionAt(doc, path);
  const keyed = collection.kind === 'map' || collection.kind === 'keyed';
  if (keyed && entries(collection).some((entry) => sameKey(keyOf(doc, entry, collection.kind), where))) {
    throw new DocumentError('exists', [...path, where]);
  }
  const text = keyed ? entryText(doc, collection, where, value) : written(doc, value, '');
  return inserted(doc, collection, where, text);
}

/**
 * `doc` holding `value`, by the fewest edits that make it, and those
 * edits. Lists compare item by item along their longest common
 * subsequence. A deleted item followed by an inserted one is ambiguous --
 * a replace keeps the deleted one's comments, a delete and an insert drop
 * them -- and `onAmbiguity` decides: `'safe'` (the default) reads a
 * replace where the deleted item owns no comment and refuses where it
 * does; `'guess'` always reads a replace; `'error'` refuses every one.
 * @param {Doc} doc
 * @param {unknown} value
 * @param {{onAmbiguity?: 'safe' | 'guess' | 'error'}} [opts]
 * @returns {{doc: Doc, changes: Change[]}}
 */
function update(doc, value, opts = {}) {
  const mode = opts.onAmbiguity ?? 'safe';
  const changes = changesBetween(doc, [], doc.value, value, mode);
  let current = doc;
  for (const change of changes) {
    if (change.op === 'replace') current = replace(current, change.path, change.value);
    else if (change.op === 'delete') current = remove(current, change.path);
    else current = insert(current, change.path, change.where, change.value);
  }
  return { doc: current, changes };
}

// ---- update's edits ---------------------------------------------------------

/**
 * The edits that turn `old`, at `path`, into `now`. Paths are where the
 * edit applies once every edit before it has been made.
 * @param {Doc} doc
 * @param {Path} path
 * @param {unknown} old
 * @param {unknown} now
 * @param {string} mode
 * @returns {Change[]}
 */
function changesBetween(doc, path, old, now, mode) {
  if (dxnEquals(old, now)) return [];
  if (old instanceof Map && now instanceof Map && !(old instanceof DXNStruct)) return keyedChanges(doc, path, old, now, mode);
  if (
    old instanceof DXNStruct &&
    now instanceof DXNStruct &&
    old.name === now.name &&
    old.version === now.version &&
    old.fields.type === 'keyed' &&
    now.fields.type === 'keyed'
  ) {
    return keyedChanges(doc, path, new Map(old.fields.pairs), new Map(now.fields.pairs), mode);
  }
  if (old instanceof DXNList && now instanceof DXNList) return listedChanges(doc, path, old.items, now.items, mode);
  return [{ op: 'replace', path, value: now }];
}

/**
 * A map's or a keyed struct's entries: the keys gone are deleted, the keys
 * kept are compared, the keys new are inserted after the last.
 * @param {Doc} doc
 * @param {Path} path
 * @param {Map<unknown, unknown>} old
 * @param {Map<unknown, unknown>} now
 * @param {string} mode
 * @returns {Change[]}
 */
function keyedChanges(doc, path, old, now, mode) {
  /** @type {Change[]} */
  const gone = [];
  /** @type {Change[]} */
  const kept = [];
  /** @type {Change[]} */
  const added = [];
  for (const [key, value] of old) {
    if (!now.has(key)) gone.push({ op: 'delete', path: [...path, key] });
    else kept.push(...changesBetween(doc, [...path, key], value, now.get(key), mode));
  }
  for (const [key, value] of now) if (!old.has(key)) added.push({ op: 'insert', path, where: key, value });
  return [...gone, ...kept, ...added];
}

/**
 * A list's edit script, item by item: `at` is where the next edit applies,
 * `was` where the item it looks at sat in the document as parsed -- which
 * is where its comments are.
 * @param {Doc} doc
 * @param {Path} path
 * @param {unknown[]} old
 * @param {unknown[]} now
 * @param {string} mode
 * @returns {Change[]}
 */
function listedChanges(doc, path, old, now, mode) {
  /** @type {Change[]} */
  const changes = [];
  let at = 0;
  let was = 0;
  for (const run of script(old, now)) {
    if (run.op === 'eq') {
      at += run.count;
      was += run.count;
      continue;
    }
    // A deleted run followed by an inserted one pairs item for item.
    const paired = run.op === 'del' ? Math.min(run.items.length, run.inserted.length) : 0;
    for (let i = 0; i < paired; i += 1) {
      if (mode === 'error' || (mode === 'safe' && ownsComment(doc, [...path, was]))) {
        throw new DocumentError('ambiguous', [...path, was]);
      }
      changes.push(...changesBetween(doc, [...path, at], run.items[i], run.inserted[i], mode));
      at += 1;
      was += 1;
    }
    if (run.op === 'del') {
      for (let i = paired; i < run.items.length; i += 1) {
        changes.push({ op: 'delete', path: [...path, at] });
        was += 1;
      }
    }
    for (const value of run.inserted.slice(paired)) {
      changes.push({ op: 'insert', path, where: at, value });
      at += 1;
    }
  }
  return changes;
}

/**
 * `old` into `now` as runs along their longest common subsequence: an
 * equal run, or a deleted run with whatever was inserted in its place
 * (`inserted`, possibly none), or an inserted run alone.
 * @param {unknown[]} old
 * @param {unknown[]} now
 * @returns {Array<{op: 'eq', count: number} | {op: 'del', items: unknown[], inserted: unknown[]} | {op: 'ins', items: never[], inserted: unknown[]}>}
 */
function script(old, now) {
  const n = old.length;
  const m = now.length;
  /** @type {number[][]} */
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = dxnEquals(old[i], now[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  /** @type {Array<'eq' | 'del' | 'ins'>} */
  const steps = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && dxnEquals(old[i], now[j])) {
      steps.push('eq');
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
      steps.push('del');
      i += 1;
    } else {
      steps.push('ins');
      j += 1;
    }
  }
  /** @type {any[]} */
  const runs = [];
  i = 0;
  j = 0;
  for (let k = 0; k < steps.length; ) {
    if (steps[k] === 'eq') {
      let count = 0;
      while (steps[k] === 'eq') {
        count += 1;
        k += 1;
      }
      runs.push({ op: 'eq', count });
      i += count;
      j += count;
      continue;
    }
    /** @type {unknown[]} */
    const items = [];
    /** @type {unknown[]} */
    const inserted = [];
    while (k < steps.length && steps[k] !== 'eq') {
      if (steps[k] === 'del') items.push(old[i++]);
      else inserted.push(now[j++]);
      k += 1;
    }
    runs.push(items.length > 0 ? { op: 'del', items, inserted } : { op: 'ins', items: [], inserted });
  }
  return runs;
}

/** @param {Doc} doc @param {Path} path */
function ownsComment(doc, path) {
  const found = located(doc, path);
  const [from, to] = ownedSpan(doc, /** @type {SyntaxNode} */ (found.entry), found.siblings);
  return comments(doc).some(([c]) => c >= from && c < to);
}

// ---- finding a path -----------------------------------------------------------

/**
 * What a path leads to: the `value` node it names, the node standing for
 * the whole entry, and the entries beside it.
 * @param {Doc} doc
 * @param {Path} path
 * @returns {{value: SyntaxNode, entry: SyntaxNode | null, siblings: SyntaxNode[]}}
 */
function located(doc, path) {
  const root = /** @type {SyntaxNode} */ (doc.tree.children.find((n) => n.kind === 'value'));
  /** @type {{value: SyntaxNode, entry: SyntaxNode | null, siblings: SyntaxNode[]}} */
  let found = { value: root, entry: null, siblings: [] };
  path.forEach((step, depth) => {
    const next = stepInto(doc, collectionNode(found.value), step);
    if (!next) throw new DocumentError('not-found', path.slice(0, depth + 1));
    found = next;
  });
  return found;
}

/**
 * @param {Doc} doc
 * @param {SyntaxNode | null} node
 * @param {unknown} step
 * @returns {{value: SyntaxNode, entry: SyntaxNode, siblings: SyntaxNode[]} | null}
 */
function stepInto(doc, node, step) {
  if (!node) return null;
  if (node.kind === 'map' || node.kind === 'keyed' || (node.kind === 'positional' && !isIndex(step))) {
    const all = entries(node);
    const kind = node.kind === 'map' ? 'map' : 'keyed';
    const entry = all.find((e) => sameKey(keyOf(doc, e, kind), step));
    return entry ? { value: entryValue(entry), entry, siblings: all } : null;
  }
  if (['list', 'tuple', 'set', 'positional'].includes(node.kind) && isIndex(step)) {
    const all = items(node);
    const item = all[Number(step)];
    return item ? { value: item, entry: item, siblings: all } : null;
  }
  return null;
}

/** @param {unknown} step @returns {boolean} */
function isIndex(step) {
  return (typeof step === 'number' && Number.isInteger(step)) || typeof step === 'bigint';
}

/** @param {Doc} doc @param {Path} path @returns {SyntaxNode} */
function collectionAt(doc, path) {
  const node = collectionNode(located(doc, path).value);
  if (!node || !['map', 'keyed', 'positional', 'list', 'tuple', 'set'].includes(node.kind)) {
    throw new DocumentError('not-a-collection', path);
  }
  return node;
}

/**
 * The collection or scalar a `value` node holds, past its discards; a
 * struct's keyed or positional body.
 * @param {SyntaxNode} value
 * @returns {SyntaxNode | null}
 */
function collectionNode(value) {
  const inner = bodyNode(value).children[0];
  if (!inner) return null;
  if (inner.kind === 'struct') return inner.children.find((c) => c.kind === 'keyed' || c.kind === 'positional') ?? null;
  return inner;
}

/** @param {SyntaxNode} value @returns {SyntaxNode} */
function bodyNode(value) {
  return /** @type {SyntaxNode} */ (value.children.find((c) => c.kind === 'body'));
}

/** @param {SyntaxNode} node */
function entries(node) {
  return node.children.filter((c) => c.kind === 'entry');
}

/** @param {SyntaxNode} node */
function items(node) {
  return node.children.filter((c) => c.kind === 'value');
}

/** @param {SyntaxNode} entry @returns {SyntaxNode} */
function entryValue(entry) {
  const values = entry.children.filter((c) => c.kind === 'value');
  return values[values.length - 1];
}

/**
 * A map entry's key as it decodes: a shorthand `name:` is the keyword
 * `:name` in a map and the field name `'name'` in a struct; an arrow
 * entry's key is its value.
 * @param {Doc} doc
 * @param {SyntaxNode} entry
 * @param {string} kind
 * @returns {unknown}
 */
function keyOf(doc, entry, kind) {
  if (entry.key !== undefined) {
    const name = doc.tokens[entry.key].value;
    return kind === 'map' ? parseTree(`:${name}`, doc.opts).value : name;
  }
  const [from, to] = span(doc, entry.children[0]);
  return parseTree(doc.source.slice(from, to), doc.opts).value;
}

/**
 * Whether the key `a` a document holds is the path's step `b`. A path is
 * the caller's own code, so a keyword in it -- a global `Symbol.for` or a
 * `DXNKeyword` -- names a keyword key of that name however the document
 * decoded it (untrusted by default, as `DXNKeyword`).
 * @param {unknown} a
 * @param {unknown} b
 */
function sameKey(a, b) {
  if (typeof a === 'string' && typeof b === 'symbol') return false;
  const name = (/** @type {unknown} */ k) =>
    typeof k === 'symbol' ? Symbol.keyFor(k) : k instanceof DXNKeyword ? k.name : undefined;
  const [na, nb] = [name(a), name(b)];
  if (na !== undefined && nb !== undefined) return na === nb;
  return dxnEquals(a, b);
}

/** A node's `[from, to)` in the source. @param {Doc} doc @param {SyntaxNode} node @returns {Span} */
function span(doc, node) {
  return [doc.tokens[node.first].start, doc.tokens[node.last].end];
}

// ---- comments and lines -------------------------------------------------------

/**
 * Every comment in the document, as `[from, to)` -- the `#` to the end of
 * its line, newline excluded -- found in the trivia between tokens, where
 * a `#` can only begin one.
 * @param {Doc} doc
 * @returns {Span[]}
 */
function comments(doc) {
  /** @type {Span[]} */
  const found = [];
  let from = 0;
  for (const token of doc.tokens) {
    const gap = doc.source.slice(from, token.start);
    for (const match of gap.matchAll(/#[^\n]*/g)) {
      const at = from + /** @type {number} */ (match.index);
      found.push([at, at + match[0].length]);
    }
    from = token.end;
  }
  return found;
}

/**
 * The bytes an entry owns: the blocks above it and its trailing block,
 * whole lines, when it stands on a line of its own; itself and the
 * separator beside it when it shares its line.
 * @param {Doc} doc
 * @param {SyntaxNode} entry
 * @param {SyntaxNode[]} siblings
 * @returns {Span}
 */
function ownedSpan(doc, entry, siblings) {
  const source = doc.source;
  const all = comments(doc);
  const [from, to] = span(doc, entry);
  if (aloneBefore(source, from) && aloneAfter(source, all, to)) {
    return [aboveStart(source, all, from), trailingEnd(source, all, to)];
  }
  const last = siblings[siblings.length - 1];
  if (span(doc, last)[1] === to) return [from - /** @type {string} */ (source.slice(0, from).match(/[ \t,]*$/)?.[0]).length, to];
  return [from, to + /** @type {string} */ (source.slice(to).match(/^[ \t,]*/)?.[0]).length];
}

/** Whether nothing but whitespace and commas precedes `at` on its line. @param {string} source @param {number} at */
function aloneBefore(source, at) {
  return /^[ \t,]*$/.test(source.slice(lineStart(source, at), at));
}

/**
 * Whether nothing but whitespace, commas and a comment follows `at` on its line.
 * @param {string} source
 * @param {Span[]} all
 * @param {number} at
 */
function aloneAfter(source, all, at) {
  const end = lineEnd(source, at);
  const comment = all.find(([c]) => c >= at && c < end);
  return /^[ \t,]*$/.test(source.slice(at, comment ? comment[0] : end));
}

/**
 * The end of an entry's trailing block -- the comment on its own line and
 * every comment line straight after it -- or of its own line.
 * @param {string} source
 * @param {Span[]} all
 * @param {number} at
 */
function trailingEnd(source, all, at) {
  const end = lineEnd(source, at);
  const comment = all.find(([c]) => c >= at && c < end);
  return afterNewline(source, comment ? blockEnd(source, all, comment[1]) : end);
}

/** @param {string} source @param {Span[]} all @param {number} to @returns {number} */
function blockEnd(source, all, to) {
  const nextLine = afterNewline(source, to);
  const next = all.find(([c]) => c >= nextLine && aloneBefore(source, c));
  return next && lineStart(source, next[0]) === nextLine ? blockEnd(source, all, next[1]) : to;
}

/**
 * Where an entry's above blocks start: the comment lines straight above
 * it, blank lines between blocks allowed, up to a line of code -- less a
 * topmost block that continues the previous entry's trailing comment with
 * no blank line between.
 * @param {string} source
 * @param {Span[]} all
 * @param {number} at
 */
function aboveStart(source, all, at) {
  const ownStart = lineStart(source, at);
  /** @type {Span[]} */
  const above = [];
  let cursor = ownStart;
  for (const comment of all.filter(([, to]) => to <= ownStart).reverse()) {
    if (!aloneBefore(source, comment[0]) || !/^[ \t,\r\n]*$/.test(source.slice(comment[1], cursor))) break;
    above.unshift(comment);
    cursor = lineStart(source, comment[0]);
  }
  const blocks = blocksOf(source, above);
  if (blocks.length > 0) {
    const top = lineStart(source, blocks[0][0][0]);
    if (top > 0) {
      const previous = lineStart(source, top - 1);
      if (all.some(([c]) => c >= previous && c < top && !aloneBefore(source, c))) blocks.shift();
    }
  }
  return blocks.length > 0 ? lineStart(source, blocks[0][0][0]) : ownStart;
}

/** Comments, top to bottom, as blocks: a blank line ends one. @param {string} source @param {Span[]} list @returns {Span[][]} */
function blocksOf(source, list) {
  /** @type {Span[][]} */
  const blocks = [];
  for (const comment of list) {
    const block = blocks[blocks.length - 1];
    if (block && source.slice(block[block.length - 1][1], comment[0]).split('\n').length <= 2) block.push(comment);
    else blocks.push([comment]);
  }
  return blocks;
}

/** @param {string} source @param {number} at */
function lineStart(source, at) {
  return source.lastIndexOf('\n', at - 1) + 1;
}

/** @param {string} source @param {number} at */
function lineEnd(source, at) {
  const i = source.indexOf('\n', at);
  return i < 0 ? source.length : i;
}

/** @param {string} source @param {number} at */
function afterNewline(source, at) {
  return at < source.length ? at + 1 : at;
}

/** @param {string} source @param {number} at */
function indentation(source, at) {
  return /** @type {string} */ (source.slice(lineStart(source, at)).match(/^[ \t]*/)?.[0]);
}

// ---- writing ------------------------------------------------------------------

/**
 * `value` as `.dxn` text, its continuation lines at `indent`.
 * @param {Doc} doc
 * @param {unknown} value
 * @param {string} indent
 */
function written(doc, value, indent) {
  // Required here, not at the top: dextrin.cjs requires this module.
  const { encode } = require('./dextrin.cjs');
  return encode(value, { pretty: true, registry: doc.opts.registry }).split('\n').join(`\n${indent}`);
}

/**
 * The text of a new map entry, `key: value`, as the pretty printer writes
 * a one-entry map.
 * @param {Doc} doc
 * @param {SyntaxNode} collection
 * @param {unknown} key
 * @param {unknown} value
 */
function entryText(doc, collection, key, value) {
  const DXNMap = require('./values/map.cjs');
  const named = collection.kind === 'keyed' ? Symbol.for(String(key)) : key;
  const lines = written(doc, new DXNMap([[named, value]]), '').split('\n').slice(1, -1);
  return lines.map((line) => line.replace(/^ {2}/, '')).join('\n');
}

/**
 * @param {Doc} doc
 * @param {SyntaxNode} collection
 * @param {unknown} where
 * @param {string} text
 */
function inserted(doc, collection, where, text) {
  const source = doc.source;
  const all = comments(doc);
  const keyed = collection.kind === 'map' || collection.kind === 'keyed';
  const elements = keyed ? entries(collection) : items(collection);
  const asIndex = !keyed && isIndex(where) && Number(where) >= 0 ? Math.min(Number(where), elements.length) : elements.length;
  const before = elements[asIndex];
  const close = doc.tokens[collection.last].start;
  const multiline =
    elements.length > 0
      ? aloneBefore(source, span(doc, elements[0])[0]) && aloneAfter(source, all, span(doc, elements[0])[1])
      : lineStart(source, doc.tokens[collection.first].start) !== lineStart(source, close);
  const indented = (/** @type {string} */ indent) => indent + text.split('\n').join(`\n${indent}`) + '\n';

  if (multiline && before) {
    const at = aboveStart(source, all, span(doc, before)[0]);
    return spliced(doc, at, at, indented(indentation(source, span(doc, before)[0])));
  }
  if (multiline && elements.length > 0) {
    const last = span(doc, elements[elements.length - 1]);
    const at = trailingEnd(source, all, last[1]);
    return spliced(doc, at, at, indented(indentation(source, last[0])));
  }
  if (multiline) {
    const at = lineStart(source, close);
    return spliced(doc, at, at, indented(`${indentation(source, close)}  `));
  }
  if (before) {
    const at = span(doc, before)[0];
    return spliced(doc, at, at, `${text} `);
  }
  if (elements.length > 0) {
    const at = span(doc, elements[elements.length - 1])[1];
    return spliced(doc, at, at, ` ${text}`);
  }
  return spliced(doc, close, close, text);
}

/**
 * The document with `[from, to)` of its text replaced by `text`, parsed
 * again with the options it was parsed with.
 * @param {Doc} doc
 * @param {number} from
 * @param {number} to
 * @param {string} text
 */
function spliced(doc, from, to, text) {
  return parse(doc.source.slice(0, from) + text + doc.source.slice(to), doc.opts);
}

module.exports = { parse, toValue, render, format, replace, delete: remove, insert, update, DocumentError };
