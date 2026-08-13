'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `keyword` (`:name` in value position), **untrusted-decode**
 * shape. The trusted-decode shape (the default) is a real, global
 * `Symbol.for(name)` instead — see the top-level `decode`/`decodeBinary`
 * `trusted:` option, once the text/binary codecs land.
 *
 * `Symbol.for` is a genuine JS primitive, globally interned by string —
 * the closest native analog to a BEAM atom (which is why the trusted
 * path uses it directly rather than another wrapper class). This class
 * exists for the untrusted path, for the same reason
 * `Dextrin.Keyword` exists in Elixir: decoding attacker-controlled
 * text/binary must never be forced through *any* process-lifetime
 * interning table (`Symbol.for`'s global symbol registry is never
 * garbage collected, same risk profile as a BEAM atom table).
 */
class DXNKeyword {
  /** @param {string} name */
  constructor(name) {
    if (typeof name !== 'string') throw new TypeError('DXNKeyword name must be a string');
    this.name = name;
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
   * @returns {symbol} `Symbol.for(name)` — an explicit, deliberate
   * opt-in to global-registry interning (the same reason this class
   * exists in the first place), so this conversion is never called
   * implicitly by decode itself.
   */
  toSymbol() {
    return Symbol.for(this.name);
  }

  /**
   * @param {symbol} sym
   * @returns {DXNKeyword}
   */
  static fromSymbol(sym) {
    if (typeof sym !== 'symbol') throw new TypeError('DXNKeyword.fromSymbol expects a symbol');
    const key = Symbol.keyFor(sym);
    return new DXNKeyword(key !== undefined ? key : (sym.description ?? ''));
  }
}

DXNKeyword.prototype.dxnType = 'keyword';

module.exports = DXNKeyword;
