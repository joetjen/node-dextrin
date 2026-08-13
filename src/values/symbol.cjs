'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * DXN `symbol` — a bare, unevaluated identifier reference. Wraps a
 * plain string, never a JS `Symbol.for` global symbol: `symbol` is
 * deliberately unaffected by the `trusted`/untrusted decode distinction
 * that `keyword` gets (see `DXNKeyword`) — it's always this wrapper,
 * both trusted and untrusted, mirroring `Dextrin.Symbol` exactly.
 */
class DXNSymbol {
  /** @param {string} name */
  constructor(name) {
    if (typeof name !== 'string') throw new TypeError('DXNSymbol name must be a string');
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
   * @returns {symbol} a **non-global** `Symbol(name)` — safe to create
   * freely, unlike `Symbol.for`, since it's garbage collected like any
   * other JS value rather than interned forever.
   */
  toSymbol() {
    return Symbol(this.name);
  }

  /**
   * @param {symbol} sym
   * @returns {DXNSymbol}
   */
  static fromSymbol(sym) {
    if (typeof sym !== 'symbol') throw new TypeError('DXNSymbol.fromSymbol expects a symbol');
    return new DXNSymbol(sym.description ?? '');
  }
}

DXNSymbol.prototype.dxnType = 'symbol';

module.exports = DXNSymbol;
