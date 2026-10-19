'use strict';

/**
 * @fileoverview A document laid out the way the pretty printer lays out a
 * value -- every non-empty collection over lines, one entry per line,
 * indented -- with every comment kept beside the entry it belongs to,
 * mirroring `Dextrin.Document.Formatter`.
 *
 * **Layout only.** Every token is written exactly as it was -- a
 * literal's spelling, a key's form, an escape -- and only the space
 * between tokens changes: indentation, line breaks, commas, and blank
 * lines, of which at most one is kept wherever the source had any
 * between entries. A document with no comments therefore comes out as
 * the pretty printer writes its value.
 *
 * **Where a comment goes**, by lines alone: a comment on the line of the
 * token or entry before it trails that, and so does every comment line
 * straight after it, aligned under its `#`; any other block of comment
 * lines goes above the next entry, or at the end of its collection when
 * none follows. A comment between a key or a tag and its value stays
 * between them, and the value moves to the next line.
 */

/**
 * @typedef {import('../text/parser.cjs').SyntaxNode} SyntaxNode
 * @typedef {import('../document.cjs').Doc} Doc
 * @typedef {{blank: boolean, lines: string[]}} Block
 * @typedef {{node: SyntaxNode, above: Block[], blank: boolean, trailing: string[]}} Slot
 */

/**
 * The text of `doc`, laid out. `indent` is the spaces per level (2).
 * @param {Doc} doc
 * @param {{indent?: number}} [opts]
 * @returns {string}
 */
function format(doc, opts = {}) {
  const step = ' '.repeat(opts.indent ?? 2);
  const tree = doc.tree;
  const header = tree.children.filter((n) => n.kind === 'header');
  const head = header.map((n) => `${tokensText(doc, n.first, n.last)}\n`).join('');
  const value = /** @type {SyntaxNode} */ (tree.children.find((n) => n.kind === 'value'));
  const from = header.length > 0 ? doc.tokens[header[header.length - 1].last].end : 0;
  const sequence = [{ gap: doc.source.slice(from, start(doc, value)) }, { node: value }, { gap: doc.source.slice(end(doc, value)) }];
  return head + lines(slots(sequence, false), '', (node) => valueText(doc, node, '', step));
}

// ---- slots: which comment belongs where -------------------------------------

/**
 * A container's inside, as what is laid out: each entry with the comment
 * blocks above it and the block trailing it, the blocks at its end, and
 * the block trailing whatever opened it when `onLine` -- a comment
 * straight after `[` stays beside it.
 * @param {Array<{gap: string} | {node: SyntaxNode}>} sequence
 * @param {boolean} onLine
 * @returns {{entries: Slot[], open: string[], terminal: Block[]}}
 */
function slots(sequence, onLine) {
  /** @type {Slot[]} */
  const entries = [];
  /** @type {string[]} */
  const open = [];
  /** @type {Block[]} */
  let pending = [];
  let newlines = 0;
  let trailing = false;
  /** @type {Slot | null} */
  let target = null;

  for (const part of sequence) {
    if ('node' in part) {
      // A blank line straight before the entry: after its comments, or,
      // with none, after the entry before it -- never right after an
      // opening bracket.
      /** @type {boolean} */
      const blank = newlines >= 2 && (pending.length > 0 || target !== null);
      target = { node: part.node, above: pending, blank, trailing: [] };
      entries.push(target);
      pending = [];
      newlines = 0;
      onLine = true;
      trailing = false;
      continue;
    }
    for (const event of part.gap.match(/#[^\n]*|\n/g) ?? []) {
      if (event === '\n') {
        onLine = false;
        newlines += 1;
      } else if (onLine || (trailing && newlines === 1)) {
        (target ? target.trailing : open).push(event.trimEnd());
        trailing = true;
        newlines = 0;
      } else {
        const blank = newlines >= 2 && target !== null;
        const block = pending[pending.length - 1];
        if (block && !blank && newlines <= 1) block.lines.push(event.trimEnd());
        else pending.push({ blank, lines: [event.trimEnd()] });
        trailing = false;
        newlines = 0;
      }
    }
  }
  return { entries, open, terminal: pending };
}

// ---- lines ------------------------------------------------------------------

/**
 * A container's entries and comments, one line each at `indent`.
 * @param {{entries: Slot[], terminal: Block[]}} laid
 * @param {string} indent
 * @param {(node: SyntaxNode) => string} render
 */
function lines(laid, indent, render) {
  const body = laid.entries.map(
    (slot) => aboveLines(slot.above, indent) + (slot.blank ? '\n' : '') + trailed(indent + render(slot.node), slot.trailing) + '\n'
  );
  return (body.join('') + aboveLines(laid.terminal, indent)).replace(/\n+$/, '');
}

/** @param {Block[]} blocks @param {string} indent */
function aboveLines(blocks, indent) {
  return blocks.map((block) => (block.blank ? '\n' : '') + block.lines.map((line) => `${indent}${line}\n`).join('')).join('');
}

/**
 * `text` with its trailing comments: the first two spaces after its last
 * line, the rest aligned under it.
 * @param {string} text
 * @param {string[]} comments
 */
function trailed(text, comments) {
  if (comments.length === 0) return text;
  const lastLine = /** @type {string} */ (text.split('\n').pop());
  const pad = ' '.repeat(Array.from(lastLine).length + 2);
  return [`${text}  ${comments[0]}`, ...comments.slice(1).map((c) => pad + c)].join('\n');
}

// ---- values -----------------------------------------------------------------

/** @param {Doc} doc @param {SyntaxNode} node @param {string} indent @param {string} step @returns {string} */
function valueText(doc, node, indent, step) {
  return node.children
    .map((child) => {
      if (child.kind === 'discard') {
        const inner = /** @type {SyntaxNode} */ (child.children.find((c) => c.kind === 'value'));
        return `@_ ${valueText(doc, inner, indent, step)}`;
      }
      return bodyText(doc, child, indent, step);
    })
    .join(' ');
}

/** @param {Doc} doc @param {SyntaxNode} body @param {string} indent @param {string} step @returns {string} */
function bodyText(doc, body, indent, step) {
  const inner = body.children[0];
  if (!inner) return tokensText(doc, body.first, body.last);
  if (['list', 'tuple', 'set', 'map'].includes(inner.kind)) return collection(doc, inner, '', indent, step);
  if (inner.kind === 'struct') {
    const part = /** @type {SyntaxNode} */ (inner.children.find((c) => c.kind === 'keyed' || c.kind === 'positional'));
    return collection(doc, part, tokensText(doc, inner.first, part.first - 1), indent, step);
  }
  if (inner.kind === 'tag') {
    // A tag and its value. Written together, `@array[1 2]` -- the spec's
    // own spelling -- they stay together; with anything between them,
    // one space does.
    const value = /** @type {SyntaxNode} */ (inner.children.find((c) => c.kind === 'value'));
    const name = tokensText(doc, inner.first, /** @type {number} */ (inner.name));
    const gap = doc.source.slice(doc.tokens[/** @type {number} */ (inner.name)].end, start(doc, value));
    if (gap === '') return name + valueText(doc, value, indent, step);
    return between(name, commentsIn(gap), (deeper) => valueText(doc, value, deeper, step), indent, step);
  }
  return tokensText(doc, inner.first, inner.last);
}

/**
 * A collection: its opening tokens after `head`, its entries one per line
 * a level deeper, its closing token -- or `[]` when it holds nothing, not
 * even a comment.
 * @param {Doc} doc
 * @param {SyntaxNode} node
 * @param {string} head
 * @param {string} indent
 * @param {string} step
 */
function collection(doc, node, head, indent, step) {
  const openAt = /** @type {number} */ (node.open);
  const open = head + tokensText(doc, node.first, openAt);
  const close = tokensText(doc, node.last, node.last);
  /** @type {Array<{gap: string} | {node: SyntaxNode}>} */
  const sequence = [];
  let from = doc.tokens[openAt].end;
  for (const child of node.children) {
    sequence.push({ gap: doc.source.slice(from, start(doc, child)) }, { node: child });
    from = end(doc, child);
  }
  sequence.push({ gap: doc.source.slice(from, doc.tokens[node.last].start) });
  const laid = slots(sequence, true);
  if (laid.entries.length === 0 && laid.open.length === 0 && laid.terminal.length === 0) return open + close;
  const deeper = indent + step;
  const body = lines(laid, deeper, (child) => item(doc, child, deeper, step));
  return `${trailed(open, laid.open)}\n${body}\n${indent}${close}`;
}

/** @param {Doc} doc @param {SyntaxNode} node @param {string} indent @param {string} step @returns {string} */
function item(doc, node, indent, step) {
  if (node.kind !== 'entry') return valueText(doc, node, indent, step);
  const values = node.children.filter((c) => c.kind === 'value');
  const value = values[values.length - 1];
  const render = (/** @type {string} */ deeper) => valueText(doc, value, deeper, step);
  if (node.key !== undefined) {
    const gap = doc.source.slice(doc.tokens[node.key].end, start(doc, value));
    return between(tokensText(doc, node.key, node.key), commentsIn(gap), render, indent, step);
  }
  const key = values[0];
  const gap = doc.source.slice(end(doc, key), start(doc, value));
  return between(`${valueText(doc, key, indent, step)} =>`, commentsIn(gap), render, indent, step);
}

/**
 * `prefix` and the value after it: on one line, or, with a comment
 * between them, the comment beside the prefix and the value on the next
 * line, a level deeper.
 * @param {string} prefix
 * @param {string[]} comments
 * @param {(indent: string) => string} render
 * @param {string} indent
 * @param {string} step
 */
function between(prefix, comments, render, indent, step) {
  if (comments.length === 0) return `${prefix} ${render(indent)}`;
  const deeper = indent + step;
  return `${trailed(prefix, comments)}\n${deeper}${render(deeper)}`;
}

/** @param {string} gap @returns {string[]} */
function commentsIn(gap) {
  return (gap.match(/#[^\n]*/g) ?? []).map((c) => c.trimEnd());
}

/** The tokens `first..last`, written together without the trivia between them. @param {Doc} doc @param {number} first @param {number} last */
function tokensText(doc, first, last) {
  return doc.tokens
    .slice(first, last + 1)
    .map((t) => doc.source.slice(t.start, t.end))
    .join('');
}

/** @param {Doc} doc @param {SyntaxNode} node */
function start(doc, node) {
  return doc.tokens[node.first].start;
}

/** @param {Doc} doc @param {SyntaxNode} node */
function end(doc, node) {
  return doc.tokens[node.last].end;
}

module.exports = { format };
