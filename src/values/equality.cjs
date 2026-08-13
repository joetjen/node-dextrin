'use strict';

/**
 * @fileoverview Shared structural-equality/ordering kernel backing every
 * DXN value shape — native JS values (`null`, `boolean`, `bigint`,
 * `number`, `string`, `Array`, `Map`, `Set`, `Uint8Array`) and every
 * `DXN*` wrapper class under `src/values/`.
 *
 * Exists because JS's own `===`/`Map`/`Set` use reference (SameValueZero)
 * equality for compound values, where DXN (mirroring Erlang/Elixir term
 * equality) needs structural equality throughout — two lists with the
 * same elements in the same order are the same DXN value regardless of
 * which `Array` instance holds them.
 *
 * `DXN.md` doesn't fix a normative order across *different* DXN types
 * (only per-type ordering, e.g. within `sorted-set`), so `KIND_RANK`
 * below is this library's own implementation-defined choice, documented
 * here rather than left implicit — it does not attempt to match Erlang's
 * own term order.
 */

/**
 * Every `DXN*` wrapper class sets this on its prototype (e.g.
 * `DXNSymbol.prototype.dxnType = 'symbol'`) so this module can recognize
 * and generically compare instances without importing every class here
 * (which would be circular — each class imports *this* module instead).
 * @typedef {{ dxnType: string }} DXNTagged
 */

const KIND_ORDER = [
  'nil',
  'boolean',
  'integer',
  'float',
  'decimal',
  'rational',
  'string',
  'char',
  'symbol',
  'keyword',
  'list',
  'tuple',
  'map',
  'ordered-map',
  'set',
  'sorted-set',
  'struct',
  'array',
  'date',
  'time',
  'timestamp',
  'datetime',
  'duration',
  'uuid',
  'uri',
  'bytes',
  'regex',
  'custom-tag',
  'unknown'
];

/** @type {Record<string, number>} */
const KIND_RANK = Object.fromEntries(KIND_ORDER.map((kind, index) => [kind, index]));

/**
 * Identifies the DXN "kind" of a value for cross-type ranking and
 * same-kind dispatch. Native JS shapes are recognized directly;
 * `DXN*` wrapper instances are recognized via their shared `dxnType`
 * prototype tag.
 * @param {unknown} value
 * @returns {string}
 */
function kindOf(value) {
  if (value === null || value === undefined) return 'nil';
  const t = typeof value;
  if (t === 'boolean') return 'boolean';
  if (t === 'bigint') return 'integer';
  if (t === 'number') return 'float';
  if (t === 'string') return 'string';
  if (t === 'symbol') {
    return Symbol.keyFor(/** @type {symbol} */ (value)) !== undefined ? 'keyword' : 'symbol';
  }
  if (Array.isArray(value)) return 'array';
  if (value instanceof Map) return 'map';
  if (value instanceof Set) return 'set';
  if (value instanceof Uint8Array) return 'bytes';
  if (t === 'object' && typeof (/** @type {any} */ (value).dxnType) === 'string') {
    return /** @type {DXNTagged} */ (value).dxnType;
  }
  return 'unknown';
}

/**
 * @param {number} n
 * @returns {-1 | 0 | 1}
 */
function sign(n) {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/**
 * Structural equality between two DXN values, recursing into every
 * collection/wrapper shape. Two `NaN` floats are equal (DXN treats
 * `NaN` as one specific scalar value, not "incomparable" the way IEEE
 * 754 `===` does).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function dxnEquals(a, b) {
  if (a === b) return true;

  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb) return false;

  switch (ka) {
    case 'nil':
      return true;
    case 'float': {
      const na = /** @type {number} */ (a);
      const nb = /** @type {number} */ (b);
      return Number.isNaN(na) && Number.isNaN(nb);
    }
    case 'array': {
      const aa = /** @type {unknown[]} */ (a);
      const ab = /** @type {unknown[]} */ (b);
      if (aa.length !== ab.length) return false;
      return aa.every((item, i) => dxnEquals(item, ab[i]));
    }
    case 'bytes': {
      // 'bytes' covers both a bare Uint8Array (only ever seen as a
      // nested field, e.g. DXNBytes#data/DXNUUID#bytes) and a DXNBytes
      // wrapper instance itself (same kind tag, deliberately, so they
      // rank together) — the two need different comparison bodies.
      if (a instanceof Uint8Array && b instanceof Uint8Array) return bytesEqual(a, b);
      return objectEquals(/** @type {object} */ (a), /** @type {object} */ (b));
    }
    case 'map':
      return mapEquals(/** @type {Map<unknown, unknown>} */ (a), /** @type {Map<unknown, unknown>} */ (b));
    case 'set':
      return setEquals(/** @type {Set<unknown>} */ (a), /** @type {Set<unknown>} */ (b));
    default:
      if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
        return objectEquals(/** @type {object} */ (a), /** @type {object} */ (b));
      }
      return false;
  }
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * @param {Map<unknown, unknown>} a
 * @param {Map<unknown, unknown>} b
 */
function mapEquals(a, b) {
  if (a.size !== b.size) return false;
  const unmatched = Array.from(b.entries());
  outer: for (const [ka, va] of a.entries()) {
    for (let i = 0; i < unmatched.length; i += 1) {
      const [kb, vb] = unmatched[i];
      if (dxnEquals(ka, kb) && dxnEquals(va, vb)) {
        unmatched.splice(i, 1);
        continue outer;
      }
    }
    return false;
  }
  return true;
}

/**
 * @param {Set<unknown>} a
 * @param {Set<unknown>} b
 */
function setEquals(a, b) {
  if (a.size !== b.size) return false;
  const unmatched = Array.from(b.values());
  outer: for (const va of a.values()) {
    for (let i = 0; i < unmatched.length; i += 1) {
      if (dxnEquals(va, unmatched[i])) {
        unmatched.splice(i, 1);
        continue outer;
      }
    }
    return false;
  }
  return true;
}

/**
 * Generic fallback for `DXN*` wrapper instances and plain object
 * literals (e.g. `DXNStruct`'s `{type, pairs|values}` fields shape):
 * same constructor, same own-enumerable keys, `dxnEquals`-equal values.
 * @param {object} a
 * @param {object} b
 */
function objectEquals(a, b) {
  if (a.constructor !== b.constructor) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      dxnEquals(/** @type {any} */ (a)[key], /** @type {any} */ (b)[key])
  );
}

/**
 * Total order over DXN values. Cross-kind comparisons fall back to
 * `KIND_RANK` (this library's own implementation-defined choice, see
 * module doc); same-kind comparisons use each kind's natural order.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1 | 0 | 1}
 */
function dxnCompare(a, b) {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb) return sign(KIND_RANK[ka] - KIND_RANK[kb]);

  switch (ka) {
    case 'nil':
      return 0;
    case 'boolean':
      return a === b ? 0 : a ? 1 : -1;
    case 'integer': {
      const ba = /** @type {bigint} */ (a);
      const bb = /** @type {bigint} */ (b);
      return ba < bb ? -1 : ba > bb ? 1 : 0;
    }
    case 'float':
      return compareFloats(/** @type {number} */ (a), /** @type {number} */ (b));
    case 'string':
      return sign(/** @type {string} */ (a).localeCompare(/** @type {string} */ (b)));
    case 'array':
      return compareArrays(/** @type {unknown[]} */ (a), /** @type {unknown[]} */ (b));
    case 'bytes':
      if (a instanceof Uint8Array && b instanceof Uint8Array) return compareBytes(a, b);
      return compareObjects(/** @type {object} */ (a), /** @type {object} */ (b));
    case 'map':
    case 'set':
      // No natural element order for these kinds; canonicalKey gives a
      // deterministic (if not semantically meaningful) total order.
      return sign(canonicalKey(a) < canonicalKey(b) ? -1 : canonicalKey(a) > canonicalKey(b) ? 1 : 0);
    default:
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return sign(canonicalKey(a) < canonicalKey(b) ? -1 : canonicalKey(a) > canonicalKey(b) ? 1 : 0);
      }
      return compareObjects(/** @type {object} */ (a), /** @type {object} */ (b));
  }
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {-1 | 0 | 1}
 */
function compareFloats(a, b) {
  const nanA = Number.isNaN(a);
  const nanB = Number.isNaN(b);
  if (nanA && nanB) return 0;
  if (nanA) return 1; // NaN sorts after every other float, by convention.
  if (nanB) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {unknown[]} a
 * @param {unknown[]} b
 * @returns {-1 | 0 | 1}
 */
function compareArrays(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const c = dxnCompare(a[i], b[i]);
    if (c !== 0) return c;
  }
  return sign(a.length - b.length);
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {-1 | 0 | 1}
 */
function compareBytes(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) return sign(a[i] - b[i]);
  }
  return sign(a.length - b.length);
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {-1 | 0 | 1}
 */
function compareObjects(a, b) {
  if (a.constructor !== b.constructor) {
    return sign(canonicalKey(a) < canonicalKey(b) ? -1 : canonicalKey(a) > canonicalKey(b) ? 1 : 0);
  }
  const keys = Object.keys(a);
  for (const key of keys) {
    const c = dxnCompare(/** @type {any} */ (a)[key], /** @type {any} */ (b)[key]);
    if (c !== 0) return c;
  }
  return 0;
}

/**
 * A stable string encoding of a DXN value, equal for and only for
 * `dxnEquals`-equal values. Used internally for structural
 * dedup/sort (e.g. `DXNSortedSet`'s uniqueness invariant) and as a
 * deterministic tiebreaker for kinds with no natural element order
 * (`map`/`set`).
 * @param {unknown} value
 * @returns {string}
 */
function canonicalKey(value) {
  const kind = kindOf(value);
  switch (kind) {
    case 'nil':
      return 'n';
    case 'boolean':
      return `b:${value}`;
    case 'integer':
      return `i:${value}`;
    case 'float':
      return `f:${Number.isNaN(/** @type {number} */ (value)) ? 'NaN' : value}`;
    case 'string':
      return `s:${JSON.stringify(value)}`;
    case 'symbol':
    case 'keyword':
      return `y:${String(/** @type {symbol} */ (value).description)}`;
    case 'array':
      return `a:[${/** @type {unknown[]} */ (value).map(canonicalKey).join(',')}]`;
    case 'bytes':
      if (value instanceof Uint8Array) return `u:${Buffer.from(value).toString('hex')}`;
      return canonicalObjectKey(/** @type {object} */ (value), kind);
    case 'map':
      return `m:{${Array.from(/** @type {Map<unknown, unknown>} */ (value).entries())
        .map(([k, v]) => `${canonicalKey(k)}=>${canonicalKey(v)}`)
        .sort()
        .join(',')}}`;
    case 'set':
      return `st:{${Array.from(/** @type {Set<unknown>} */ (value).values())
        .map(canonicalKey)
        .sort()
        .join(',')}}`;
    default: {
      if (value === null || typeof value !== 'object') return `?:${String(value)}`;
      return canonicalObjectKey(/** @type {object} */ (value), kind);
    }
  }
}

/**
 * @param {object} obj
 * @param {string} kind
 * @returns {string}
 */
function canonicalObjectKey(obj, kind) {
  const entries = Object.keys(obj)
    .sort()
    .map((key) => `${key}=${canonicalKey(/** @type {any} */ (obj)[key])}`);
  return `${kind}:{${entries.join(',')}}`;
}

module.exports = { dxnEquals, dxnCompare, canonicalKey, kindOf, KIND_RANK };
