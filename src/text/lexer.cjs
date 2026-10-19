'use strict';

/**
 * @fileoverview Hand-written `.dxn` tokenizer, directly off `DXN.md`
 * §1.1's lexical grammar. No parser-generator dependency — the
 * grammar is small and fully normative, so generating a lexer/parser
 * from it would be an unneeded abstraction for a hand port (unlike
 * `dextrin`'s own Elixir side, which needed one anyway for other
 * reasons — see `Dextrin.Text.Grammar`'s own moduledoc).
 *
 * `ws = { " " | "\t" | "\n" | "\r" | "," }` is "fully insignificant,
 * everywhere" per `DXN.md` — this lexer skips it (and `#` comments)
 * between every token rather than emitting whitespace tokens at all.
 *
 * A few sigils bind tighter than plain "insignificant whitespace
 * everywhere" would suggest, matching `dextrin`'s own grammar/lexer
 * choices (inferred from its `Actions` module's dedicated token
 * types, e.g. `:MAP_KEY`, since `DXN.md`'s EBNF alone doesn't spell
 * out lexer-level tokenization):
 *   - `~D[`/`~T[`/`~U[`/`~r/` are each lexed as one compound token —
 *     no whitespace may appear between `~` and the letter that follows.
 *   - `identifier ":"` (the map-entry colon-shorthand key) is lexed as
 *     one `MAP_KEY` token when the `:` immediately follows the
 *     identifier with no whitespace between them; otherwise the `:`
 *     starts a fresh `KEYWORD` token instead (`:name` in value
 *     position), and the identifier is left as a separate token.
 *   - `keyword` (`:name` / `:"..."`) similarly requires no whitespace
 *     between `:` and what follows.
 *
 * Unicode identifier characters use JS's `\p{ID_Start}`/
 * `\p{ID_Continue}` regex properties rather than `DXN.md`'s own
 * `XID_Start`/`XID_Continue` (UAX #31) — the closest built-in
 * ECMAScript regex Unicode property alias; ECMAScript doesn't expose
 * `\p{XID_Start}`/`\p{XID_Continue}` directly. The two property sets
 * differ only for a small set of characters excluded from XID for
 * NFKC-normalization stability, which this lexer doesn't attempt to
 * replicate — a documented, minor divergence, not a silent one.
 */

const RESERVED = new Set(['nil', 'true', 'false', 'NaN', 'Infinity']);

const ID_START = /[\p{ID_Start}_]/u;
const ID_CONTINUE = /[\p{ID_Continue}\-?!]/u;

/**
 * @typedef {{type: string, value: any, start: number, end: number, isQuoted?: boolean}} Token
 */

class LexError extends Error {
  /**
   * @param {string} message
   * @param {number} offset
   */
  constructor(message, offset) {
    super(message);
    this.name = 'LexError';
    this.offset = offset;
    /** `DXN.md` §5's category for text that does not lex. */
    this.category = 'syntax';
  }
}

/**
 * @param {string} src
 * @returns {Token[]}
 */
function tokenize(src) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  const len = src.length;

  const isDigit = (/** @type {string} */ c) => c >= '0' && c <= '9';

  function skipTrivia() {
    for (;;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') {
        i += 1;
      } else if (c === '#') {
        while (i < len && src[i] !== '\n') i += 1;
      } else {
        break;
      }
    }
  }

  /**
   * @returns {string} the identifier text (letters already validated
   * present at `i`).
   */
  function readIdentifierRun() {
    let start = i;
    i += 1; // first char already validated by caller
    readSegmentsRest();
    // A name is segments joined by "." with at most one "/" between a
    // namespace and a name (DXN.md §1.1): Foo.Bar/Baz.
    if (src[i] === '/' && ID_START.test(src[i + 1] ?? '')) {
      i += 2;
      readSegmentsRest();
    }
    return src.slice(start, i);
  }

  /**
   * The rest of a run of segments joined by ".", the first character of
   * the first one already read. A "." not followed by a segment's start
   * is left where it is, and refused by whatever reads it next.
   */
  function readSegmentsRest() {
    while (i < len && ID_CONTINUE.test(src[i])) i += 1;
    while (src[i] === '.' && ID_START.test(src[i + 1] ?? '')) {
      i += 2;
      while (i < len && ID_CONTINUE.test(src[i])) i += 1;
    }
  }

  function readNumber() {
    const start = i;
    if (src[i] === '-') i += 1;

    // "-Infinity" — the only signed reserved word.
    if (src.startsWith('Infinity', i) && !ID_CONTINUE.test(src[i + 'Infinity'.length] ?? '')) {
      i += 'Infinity'.length;
      return { type: 'FLOAT', value: src.slice(start, i), start, end: i };
    }

    if (!isDigit(src[i])) throw new LexError(`invalid number literal at offset ${start}`, start);
    while (i < len && isDigit(src[i])) i += 1;

    if (src[i] === '/' && isDigit(src[i + 1])) {
      i += 1;
      while (i < len && isDigit(src[i])) i += 1;
      return { type: 'RATIONAL', value: src.slice(start, i), start, end: i };
    }

    let hasFraction = false;
    if (src[i] === '.' && isDigit(src[i + 1])) {
      hasFraction = true;
      i += 1;
      while (i < len && isDigit(src[i])) i += 1;
    }

    // decimal = int (.digits)? "M" — checked before exponent: decimal
    // has no exponent form at all, so "M" must win over "e"/"E" here.
    if (src[i] === 'M') {
      i += 1;
      return { type: 'DECIMAL', value: src.slice(start, i), start, end: i };
    }

    let isFloat = hasFraction;
    if ((src[i] === 'e' || src[i] === 'E') && looksLikeExponent(src, i)) {
      isFloat = true;
      i += 1;
      if (src[i] === '+' || src[i] === '-') i += 1;
      while (i < len && isDigit(src[i])) i += 1;
    }

    return { type: isFloat ? 'FLOAT' : 'INTEGER', value: src.slice(start, i), start, end: i };
  }

  /**
   * @param {string} s
   * @param {number} at index of the 'e'/'E'.
   */
  function looksLikeExponent(s, at) {
    let j = at + 1;
    if (s[j] === '+' || s[j] === '-') j += 1;
    return isDigit(s[j]);
  }

  function readString() {
    const start = i;
    i += 1; // opening quote
    while (i < len && src[i] !== '"') {
      if (src[i] === '\\') {
        i += 2;
      } else {
        i += 1;
      }
    }
    if (src[i] !== '"') throw new LexError('unterminated string literal', start);
    i += 1; // closing quote
    return { type: 'STRING', value: src.slice(start + 1, i - 1), start, end: i };
  }

  /**
   * Reads a delimited sigil body up to (not including) `close`,
   * honoring `\close` as an escaped literal delimiter (kept verbatim
   * in the captured body — only the regex sigil actually needs this,
   * but it's harmless for the bracket-delimited sigils too).
   * @param {string} close
   */
  function readUntil(close) {
    const start = i;
    while (i < len && src[i] !== close) {
      if (src[i] === '\\' && src[i + 1] === close) {
        i += 2;
      } else {
        i += 1;
      }
    }
    if (src[i] !== close) throw new LexError(`expected '${close}'`, start);
    const body = src.slice(start, i);
    i += 1; // closing delimiter
    return body;
  }

  while (true) {
    skipTrivia();
    if (i >= len) break;
    const start = i;
    const c = src[i];

    if (c === '[') {
      tokens.push({ type: 'LBRACKET', value: '[', start, end: ++i });
    } else if (c === ']') {
      tokens.push({ type: 'RBRACKET', value: ']', start, end: ++i });
    } else if (c === '{') {
      tokens.push({ type: 'LBRACE', value: '{', start, end: ++i });
    } else if (c === '}') {
      tokens.push({ type: 'RBRACE', value: '}', start, end: ++i });
    } else if (c === '(') {
      tokens.push({ type: 'LPAREN', value: '(', start, end: ++i });
    } else if (c === ')') {
      tokens.push({ type: 'RPAREN', value: ')', start, end: ++i });
    } else if (c === '"') {
      tokens.push(readString());
    } else if (c === '?') {
      i += 1;
      if (src[i] === '\\') {
        const escStart = i;
        i += 1;
        // consume exactly one escape's worth of source text.
        if (src[i] === 'x') {
          i += 1;
          if (src[i] !== '{') throw new LexError("invalid \\x{...} escape in char literal", escStart);
          i += 1;
          while (i < len && /[0-9a-fA-F]/.test(src[i])) i += 1;
          if (src[i] !== '}') throw new LexError("invalid \\x{...} escape in char literal", escStart);
          i += 1;
        } else {
          i += 1;
        }
      } else if (src[i] !== undefined) {
        i += [...src.slice(i)][0].length; // one codepoint, surrogate-pair safe
      }
      tokens.push({ type: 'CHAR', value: src.slice(start + 1, i), start, end: i });
    } else if (c === '~') {
      if (src.startsWith('~D[', i)) {
        i += 3;
        tokens.push({ type: 'DATE_SIGIL', value: readUntil(']'), start, end: i });
      } else if (src.startsWith('~T[', i)) {
        i += 3;
        tokens.push({ type: 'TIME_SIGIL', value: readUntil(']'), start, end: i });
      } else if (src.startsWith('~U[', i)) {
        i += 3;
        tokens.push({ type: 'INSTANT_SIGIL', value: readUntil(']'), start, end: i });
      } else if (src.startsWith('~r/', i)) {
        i += 3;
        const pattern = readUntil('/');
        let flagsStart = i;
        while (i < len && /[imsuxfr]/.test(src[i])) i += 1;
        tokens.push({
          type: 'REGEX_SIGIL',
          value: { pattern, flags: src.slice(flagsStart, i) },
          start,
          end: i
        });
      } else {
        throw new LexError(`unrecognized sigil at offset ${start}`, start);
      }
    } else if (c === '@') {
      i += 1;
      tokens.push({ type: 'AT', value: '@', start, end: i });
    } else if (c === '%') {
      i += 1;
      tokens.push({ type: 'PERCENT', value: '%', start, end: i });
    } else if (c === ':') {
      i += 1;
      if (src[i] === '"') {
        const str = readString();
        tokens.push({ type: 'KEYWORD', value: str.value, isQuoted: true, start, end: i });
      } else if (ID_START.test(src[i] ?? '')) {
        const name = readIdentifierRun();
        tokens.push({ type: 'KEYWORD', value: name, isQuoted: false, start, end: i });
      } else {
        throw new LexError(`':' must be followed by an identifier or string`, start);
      }
    } else if (c === '=' && src[i + 1] === '>') {
      i += 2;
      tokens.push({ type: 'ARROW', value: '=>', start, end: i });
    } else if (isDigit(c) || (c === '-' && isDigit(src[i + 1]))) {
      tokens.push(readNumber());
    } else if (c === '-' && src.startsWith('Infinity', i + 1)) {
      tokens.push(readNumber());
    } else if (ID_START.test(c)) {
      const name = readIdentifierRun();
      if (src[i] === ':') {
        i += 1;
        tokens.push({ type: 'MAP_KEY', value: name, start, end: i });
      } else if (RESERVED.has(name)) {
        pushReserved(tokens, name, start, i);
      } else {
        tokens.push({ type: 'IDENTIFIER', value: name, start, end: i });
      }
    } else {
      throw new LexError(`unexpected character '${c}' at offset ${start}`, start);
    }
  }

  tokens.push({ type: 'EOF', value: null, start: len, end: len });
  return tokens;
}

/**
 * @param {Token[]} tokens
 * @param {string} name
 * @param {number} start
 * @param {number} end
 */
function pushReserved(tokens, name, start, end) {
  if (name === 'nil') tokens.push({ type: 'NIL', value: null, start, end });
  else if (name === 'true') tokens.push({ type: 'TRUE', value: true, start, end });
  else if (name === 'false') tokens.push({ type: 'FALSE', value: false, start, end });
  else if (name === 'NaN') tokens.push({ type: 'FLOAT', value: 'NaN', start, end });
  else if (name === 'Infinity') tokens.push({ type: 'FLOAT', value: 'Infinity', start, end });
}

module.exports = { tokenize, LexError };
