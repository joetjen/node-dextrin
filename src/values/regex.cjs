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
   */
  toRegExp() {
    const unsupported = FLAG_NAMES.filter((f) => !NATIVE_FLAG_NAMES.includes(/** @type {any} */ (f)) && this.flags[f]);
    if (unsupported.length > 0) {
      throw new Error(`DXNRegex#toRegExp: flag(s) ${unsupported.join(', ')} have no native RegExp equivalent`);
    }
    const nativeFlags = NATIVE_FLAG_NAMES.filter((f) => this.flags[f]).join('');
    return new RegExp(this.pattern, nativeFlags);
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

DXNRegex.prototype.dxnType = 'regex';

module.exports = DXNRegex;
