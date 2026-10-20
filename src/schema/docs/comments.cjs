'use strict';

/**
 * @fileoverview Which comment belongs to which definition, in a `.dxns`
 * document's syntax tree (Jan, 2026-10-20) -- the port of
 * `Dextrin.Schema.Docs.Comments`:
 *
 * - **the block of comment lines directly above an entry** belongs to it,
 *   when no blank line separates the block from the entry;
 * - **a comment on the entry's own line**, after it, belongs to it too,
 *   and so does every comment line straight below that one.
 *
 * A block a blank line cuts off from what follows belongs to nothing
 * there; before a document's value, it is the document's own
 * description. A comment's text is its line without the `#` and the one
 * space after it, and a bare `#` is a blank line, which separates
 * paragraphs.
 *
 * Here the trivia is the source between two tokens -- a *gap* -- where the
 * reference has trivia tokens; the answers are the same.
 */

/** @typedef {{above: string[], after: string[]}} Attached */

/**
 * A comment's text: without its `#` and the one space after it.
 * @param {string} comment
 * @returns {string}
 */
function commentText(comment) {
  let text = comment.replace(/\s+$/, '');
  if (text.startsWith('#')) text = text.slice(1);
  if (text.startsWith(' ')) text = text.slice(1);
  return text;
}

/**
 * The comments in `text`, the trivia before a document's value -- what it
 * says about itself: a blank line between them, like a bare `#`,
 * separates paragraphs.
 * @param {string} text
 * @returns {string}
 */
function leading(text) {
  /** @type {string[]} */
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) lines.push(commentText(line));
    else if (line === '') lines.push('');
  }
  // A run of blank lines is one paragraph break.
  /** @type {string[]} */
  const out = [];
  for (const line of lines) {
    if (line === '' && out[out.length - 1] === '') continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * For each entry of a container, in order, the comment lines attached to
 * it. `parts` is the container's inside: the gaps between its tokens, and
 * its entries, in order.
 * @param {Array<{gap: string} | {entry: true}>} parts
 * @returns {Attached[]}
 */
function attached(parts) {
  /** @type {Attached[]} */
  const done = [];
  /** @type {Attached | null} */
  let current = null;
  /** @type {string[]} */
  let block = [];
  let newlines = 0;
  let onLine = false;

  const close = () => {
    if (current) done.push(current);
    current = null;
  };

  for (const part of parts) {
    if ('entry' in part) {
      const above = newlines <= 1 ? block : [];
      close();
      current = { above, after: [] };
      block = [];
      newlines = 0;
      onLine = true;
      continue;
    }
    for (const event of part.gap.match(/#[^\n]*|\n/g) ?? []) {
      if (event === '\n') {
        newlines += 1;
        onLine = false;
      } else if (onLine && current) {
        current.after.push(commentText(event));
      } else if (current && current.after.length > 0 && newlines === 1 && block.length === 0) {
        // A comment straight below an entry's trailing comment continues it.
        current.after.push(commentText(event));
        newlines = 0;
      } else {
        if (newlines >= 2) block = [];
        block = [...block, commentText(event)];
        newlines = 0;
      }
    }
  }
  close();
  return done;
}

module.exports = { attached, leading, commentText };
