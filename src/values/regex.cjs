'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

const FLAG_NAMES = /** @type {const} */ (['i', 'm', 's', 'u', 'x', 'f', 'r']);
/** Flags with a direct native `RegExp` equivalent. */
const NATIVE_FLAG_NAMES = /** @type {const} */ (['i', 'm', 's', 'u']);

/**
 * DXN `regex` (`~r/pattern/flags`, Erlang `:re`/PCRE-style semantics).
 * Not compiled to a native `RegExp` on decode — `x` (extended/verbose
 * whitespace-and-comments mode), `f` (firstline), and `r` (ungreedy)
 * have no JS `RegExp` equivalent, so this class keeps the raw
 * pattern/flags data instead, the same way `Regex.t()` wraps Erlang
 * `:re` options rather than any single compiled form. `i`/`m`/`s`/`u`
 * map 1:1 to native flags — `toRegExp()` succeeds only when none of
 * `x`/`f`/`r` are set, rather than silently dropping them.
 */
class DXNRegex {
  /**
   * @param {string} pattern
   * @param {{i?: boolean, m?: boolean, s?: boolean, u?: boolean, x?: boolean, f?: boolean, r?: boolean}} [flags]
   */
  constructor(pattern, flags = {}) {
    if (typeof pattern !== 'string') throw new TypeError('DXNRegex pattern must be a string');
    this.pattern = pattern;
    /** @type {{i: boolean, m: boolean, s: boolean, u: boolean, x: boolean, f: boolean, r: boolean}} */
    this.flags = {
      i: Boolean(flags.i),
      m: Boolean(flags.m),
      s: Boolean(flags.s),
      u: Boolean(flags.u),
      x: Boolean(flags.x),
      f: Boolean(flags.f),
      r: Boolean(flags.r)
    };
  }

  /** @param {unknown} other @returns {boolean} */
  equals(other) {
    return dxnEquals(this, other);
  }

  /** @param {unknown} other @returns {-1 | 0 | 1} */
  compare(other) {
    return dxnCompare(this, other);
  }

  /**
   * @returns {RegExp} only when `x`/`f`/`r` are all unset — those have
   * no native `RegExp` equivalent, so this throws rather than produce
   * a `RegExp` that silently drops part of the pattern's meaning.
   * PCRE's `\A`, `\z`, `\Z` and `\x{H}` are written as JavaScript says
   * them, and a pattern that needs it is read in Unicode mode
   * (`fromPcre` below).
   */
  toRegExp() {
    const unsupported = FLAG_NAMES.filter((f) => !NATIVE_FLAG_NAMES.includes(/** @type {any} */ (f)) && this.flags[f]);
    if (unsupported.length > 0) {
      throw new Error(`DXNRegex#toRegExp: flag(s) ${unsupported.join(', ')} have no native RegExp equivalent`);
    }
    const nativeFlags = NATIVE_FLAG_NAMES.filter((f) => this.flags[f]).join('');
    const { source, unicode } = fromPcre(this.pattern);
    if (unicode && !this.flags.u) {
      try {
        return new RegExp(source, nativeFlags + 'u');
      } catch {
        // Not valid in JavaScript's Unicode mode: read as it is written.
      }
    }
    return new RegExp(source, nativeFlags);
  }

  /**
   * @param {RegExp} re
   * @returns {DXNRegex}
   */
  static fromRegExp(re) {
    if (!(re instanceof RegExp)) throw new TypeError('DXNRegex.fromRegExp expects a RegExp');
    return new DXNRegex(re.source, { i: re.ignoreCase, m: re.multiline, s: re.dotAll, u: re.unicode });
  }
}

/**
 * A PCRE pattern in JavaScript's dialect, where the two say the same with
 * other words: `\A`, `\z` and `\Z` (the start, the very end, the end
 * or before a final newline) as lookarounds, `\x{H}` as `\uHHHH` or
 * `\u{H}`. `unicode` says whether the pattern needs JavaScript's Unicode
 * mode -- a code point beyond `\uffff`, or a property, `\p{...}` --
 * which PCRE reads without asking. Anything else is passed on as written;
 * what JavaScript's engine reads otherwise, or not at all (inline
 * modifiers, atomic groups), is the documented limit of the platform
 * (DXN.md §1.2).
 * @param {string} pattern
 * @returns {{source: string, unicode: boolean}}
 */
function fromPcre(pattern) {
  let source = '';
  let unicode = false;
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c !== '\\' || i + 1 >= pattern.length) {
      if (c === '[' && !inClass) inClass = true;
      else if (c === ']' && inClass) inClass = false;
      source += c;
      continue;
    }
    const d = pattern[i + 1];
    const hex = d === 'x' ? /^\{([0-9A-Fa-f]+)\}/.exec(pattern.slice(i + 2)) : null;
    if (hex) {
      const point = parseInt(hex[1], 16);
      if (point > 0xffff) unicode = true;
      source += point > 0xffff ? `\\u{${hex[1]}}` : `\\u${point.toString(16).padStart(4, '0')}`;
      i += 1 + hex[0].length;
      continue;
    }
    if (!inClass && d === 'A') source += '(?<![\\s\\S])';
    else if (!inClass && d === 'z') source += '(?![\\s\\S])';
    else if (!inClass && d === 'Z') source += '(?=\\n?(?![\\s\\S]))';
    else {
      if ((d === 'p' || d === 'P') && pattern[i + 2] === '{') unicode = true;
      source += c + d;
    }
    i += 1;
  }
  return { source, unicode };
}

DXNRegex.prototype.dxnType = 'regex';

module.exports = DXNRegex;
