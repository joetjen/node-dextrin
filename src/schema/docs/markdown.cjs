'use strict';

/**
 * @fileoverview The Markdown a schema's comments are written in, as HTML --
 * the port of `Dextrin.Schema.Docs.Markdown`, a small, fixed subset, so
 * that every implementation renders a comment the same:
 *
 * - **blocks**: paragraphs, separated by a blank line; a bullet list, each
 *   item a line starting `- `; a numbered list, each item a line starting
 *   `1. ` (any number). An item continues on the lines below it that are
 *   indented.
 * - **inline**: `` `code` ``, `**strong**`, `*emphasis*`, and
 *   `[text](https://...)` links.
 *
 * A code span that names a definition the documentation knows becomes a
 * link to it; `link` answers the address for a name, or `null`.
 */

/**
 * `text` with the characters HTML gives a meaning to escaped.
 * @param {string} text
 */
function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * `text` as HTML, `link` resolving a code span to an address.
 * @param {string} text
 * @param {(code: string) => string | null} link
 */
function toHtml(text, link) {
  /** @type {string[][]} */
  const blocks = [];
  /** @type {boolean | null} */
  let blankRun = null;
  for (const line of text.split('\n')) {
    const blank = line.trim() === '';
    if (blank !== blankRun) blocks.push([]);
    blocks[blocks.length - 1].push(line);
    blankRun = blank;
  }
  return blocks
    .filter((lines) => lines[0].trim() !== '')
    .map((lines) => block(lines, link))
    .join('\n');
}

/** @param {string[]} lines @param {(code: string) => string | null} link */
function block(lines, link) {
  const first = lines[0];
  if (first.startsWith('- ')) return list('ul', items(lines, /^- /), link);
  if (/^\d+\. /.test(first)) return list('ol', items(lines, /^\d+\. /), link);
  return `<p>${inline(lines.map((l) => l.trim()).join(' '), link)}</p>`;
}

/**
 * The items of a list: each line the marker starts begins one, and an
 * indented line below it continues it.
 * @param {string[]} lines
 * @param {RegExp} marker
 */
function items(lines, marker) {
  /** @type {string[]} */
  const out = [];
  for (const line of lines) {
    if (marker.test(line)) out.push(line.replace(marker, ''));
    else if (out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

/** @param {string} tag @param {string[]} entries @param {(code: string) => string | null} link */
function list(tag, entries, link) {
  return `<${tag}>${entries.map((i) => `<li>${inline(i, link)}</li>`).join('')}</${tag}>`;
}

/**
 * One line of text with its inline markup as HTML.
 * @param {string} text
 * @param {(code: string) => string | null} link
 */
function inline(text, link) {
  // Code spans first, so nothing inside one is read as markup.
  return text
    .split(/(`[^`]+`)/)
    .map((part) => {
      const code = /^`([^`]+)`$/.exec(part);
      return code ? codeSpan(code[1], link) : markup(escape(part));
    })
    .join('');
}

/** @param {string} code @param {(code: string) => string | null} link */
function codeSpan(code, link) {
  const href = link(code);
  if (href === null) return `<code>${escape(code)}</code>`;
  return `<a class="ref" href="${escape(href)}"><code>${escape(code)}</code></a>`;
}

/** @param {string} text */
function markup(text) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

module.exports = { toHtml, inline, escape };
