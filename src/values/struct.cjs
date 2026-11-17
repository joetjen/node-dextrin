'use strict';

const { dxnEquals, dxnCompare } = require('./equality.cjs');

/**
 * Opaque DXN `struct` value, produced when no schema is known for its
 * name (`DXN.md` §1.4: "a reader lacking the schema... returns an
 * opaque tagged value rather than failing").
 *
 * `fields` is one of two shapes, deliberately not normalized to a
 * single common one — `.dxn`'s keyed literal form carries field
 * *names*; `.dxnb`'s wire form is always positional (`DXN.md` §2.1)
 * and never carries names at all. Without a schema there is no way to
 * recover one shape from the other, so this class says which shape it
 * actually is rather than pretend they're interchangeable — mirrors
 * `Dextrin.Struct` exactly.
 *
 * `version` is the schema version the struct was written with —
 * `%Name(3){...}`, `DXN.md` §4.8 — or `null` when it was written
 * without one.
 *
 * `extra` holds the fields a struct carries beyond its declared ones
 * (`DXN.md` §4.7), as `[key, value]` pairs in the order they were
 * written: a name for a named field, any other map key (§1.6) as
 * itself. In text they are entries after the fields or the items; in
 * `.dxnb`, one trailing tag-215 map.
 *
 * `bases` and `drops` are what a `%schema` or `%shape` is built from
 * (`DXNS.md` §4b): `bases` the head's `extends` and `includes` names, as
 * `[kind, name, version]` in the order written (`version` `null` when the
 * head names none), and `drops` the body's `- field` names, `"*"` for
 * `- *` (closed, `DXNS.md` §4c). `rest` is the body's `* K => V`
 * entries, `{key, value}` each in the order written: what its extras must
 * be. Every other struct has none of these; the schema compiler reads
 * them.
 */
class DXNStruct {
  /**
   * @param {string} name
   * @param {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} fields
   * @param {number | null} [version]
   * @param {Array<[unknown, unknown]>} [extra]
   * @param {Base[]} [bases]
   * @param {string[]} [drops]
   * @param {Rest[]} [rest]
   */
  constructor(name, fields, version = null, extra = [], bases = [], drops = [], rest = []) {
    if (typeof name !== 'string') throw new TypeError('DXNStruct name must be a string');
    this.name = name;
    this.fields = fields;
    /** @type {number | null} */
    this.version = version;
    /** @type {Array<[unknown, unknown]>} */
    this.extra = extra;
    /** @type {Base[]} */
    this.bases = bases;
    /** @type {string[]} */
    this.drops = drops;
    /** @type {Rest[]} */
    this.rest = rest;
  }

  /**
   * This struct holding `fields` instead, and otherwise unchanged — what
   * every walk over a struct's fields goes through, so a walk never
   * rebuilds a struct from its name and loses its version, or what it is
   * built from.
   * @param {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} fields
   * @returns {DXNStruct}
   */
  withFields(fields) {
    return new DXNStruct(this.name, fields, this.version, this.extra, this.bases, this.drops, this.rest);
  }

  /**
   * Whether this is a `%schema` or `%shape` built from others (`DXNS.md`
   * §4b): one naming a base, or leaving a field out. `- *` closes a body
   * and `* K => V` types its extras (§4c); neither makes it built.
   * @returns {boolean}
   */
  isBuilt() {
    return this.bases.length > 0 || this.drops.some((field) => field !== '*');
  }

  /**
   * Whether this `%schema` or `%shape` says something only text can say:
   * built from others (`DXNS.md` §4b), closed (`- *`) or with typed
   * extras (`* K => V`, §4c). Such a struct has no `.dxnb` form, and a
   * reader keeps it as written rather than reading it with a schema.
   * @returns {boolean}
   */
  isSchemaSyntax() {
    return this.bases.length > 0 || this.drops.length > 0 || this.rest.length > 0;
  }

  /**
   * How this struct opens when written at `version`: its `head`, then the
   * `extends` and `includes` clauses a `%schema` or `%shape` is built
   * from (`DXNS.md` §4b), in the order the bases were written, and one
   * space before the body. Shared by every text writer, so they agree.
   *
   * @example
   * new DXNStruct('schema', {type: 'keyed', pairs: []}, 2, [], [['extends', 'User', 3], ['includes', 'Audit', null]]).opening(2)
   * // => '%schema(2) extends User(3) includes Audit '
   * @param {number | null} [version]
   * @returns {string}
   */
  opening(version = this.version) {
    const head = DXNStruct.head(this.name, version);
    if (this.bases.length === 0) return head;
    /** @type {string[]} */
    const clauses = [];
    let kind = null;
    for (const [baseKind, base, baseVersion] of this.bases) {
      // A run of bases of one kind stands under one word.
      if (baseKind !== kind) clauses.push(baseKind);
      kind = baseKind;
      clauses.push(DXNStruct.typeName(base, baseVersion));
    }
    return `${head} ${clauses.join(' ')} `;
  }

  /**
   * The `- field` entries of a `%schema` or `%shape` that leaves
   * inherited fields out (`DXNS.md` §4b), as they are written.
   * @returns {string[]}
   */
  dropEntries() {
    return this.drops.map((field) => `- ${field}`);
  }

  /**
   * An entry's key as an extra field's key: a keyword, symbol or string
   * is a name (its text); any other map key (`DXN.md` §1.6) is kept as
   * itself.
   * @param {unknown} key
   * @returns {unknown}
   */
  static extraKey(key) {
    if (typeof key === 'string') return key;
    const dxnType = key !== null && typeof key === 'object' ? /** @type {any} */ (key).dxnType : undefined;
    if (dxnType === 'keyword' || dxnType === 'symbol') return /** @type {{name: string}} */ (key).name;
    if (typeof key === 'symbol') return Symbol.keyFor(key) ?? key.description ?? '';
    return key;
  }

  /**
   * Whether `key` is a name — a keyword, symbol or string — and so can
   * be a field name rather than only an extra field's key.
   * @param {unknown} key
   * @returns {boolean}
   */
  static isName(key) {
    return typeof DXNStruct.extraKey(key) === 'string';
  }

  /**
   * How a struct literal opens: `%Name`, or `%Name(3)` when it carries a
   * version. Shared by every writer, so they agree.
   * @param {string} name
   * @param {number | null} [version]
   * @returns {string}
   */
  static head(name, version = null) {
    return `%${DXNStruct.typeName(name, version)}`;
  }

  /**
   * The struct's name as `.dxnb` writes it: `Name`, or `Name(3)` when it
   * carries a version (`DXN.md` §2.4, §4.8).
   * @param {string} name
   * @param {number | null} [version]
   * @returns {string}
   */
  static typeName(name, version = null) {
    return version === null ? name : `${name}(${version})`;
  }

  /**
   * The other direction: a `.dxnb` type name read back into its name and
   * version, or `null` when its version is not a positive integer.
   * @param {string} text
   * @returns {{name: string, version: number | null} | null}
   */
  static parseTypeName(text) {
    if (!text.includes('(') && !text.includes(')')) return { name: text, version: null };
    const match = /^([^()]+)\(([0-9]+)\)$/s.exec(text);
    if (!match) return null;
    const version = Number(match[2]);
    return Number.isSafeInteger(version) && version > 0 ? { name: match[1], version } : null;
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
   * @param {string} name
   * @param {Array<[string, unknown]>} pairs
   * @param {number | null} [version]
   * @param {Array<[unknown, unknown]>} [extra]
   * @returns {DXNStruct}
   */
  static keyed(name, pairs, version = null, extra = []) {
    return new DXNStruct(name, { type: 'keyed', pairs }, version, extra);
  }

  /**
   * @param {string} name
   * @param {unknown[]} values
   * @param {number | null} [version]
   * @param {Array<[unknown, unknown]>} [extra]
   * @returns {DXNStruct}
   */
  static positional(name, values, version = null, extra = []) {
    return new DXNStruct(name, { type: 'positional', values }, version, extra);
  }
}

/**
 * @typedef {{key: unknown, value: unknown}} Rest
 *   A `%schema`'s or `%shape`'s `* K => V` (`DXNS.md` §4c): the type
 *   every extra key matches, and the type of its value, as written.
 */

/**
 * @typedef {['extends' | 'includes', string, number | null]} Base
 *   One base a `%schema` or `%shape` is built from: the clause naming it,
 *   its name, and the version its head names, `null` when none.
 */

DXNStruct.prototype.dxnType = 'struct';

module.exports = DXNStruct;
