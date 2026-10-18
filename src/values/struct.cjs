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
 */
class DXNStruct {
  /**
   * @param {string} name
   * @param {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} fields
   * @param {number | null} [version]
   */
  constructor(name, fields, version = null) {
    if (typeof name !== 'string') throw new TypeError('DXNStruct name must be a string');
    this.name = name;
    this.fields = fields;
    /** @type {number | null} */
    this.version = version;
  }

  /**
   * This struct holding `fields` instead, and otherwise unchanged — what
   * every walk over a struct's fields goes through, so a walk never
   * rebuilds a struct from its name and loses its version.
   * @param {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} fields
   * @returns {DXNStruct}
   */
  withFields(fields) {
    return new DXNStruct(this.name, fields, this.version);
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
   * @returns {DXNStruct}
   */
  static keyed(name, pairs, version = null) {
    return new DXNStruct(name, { type: 'keyed', pairs }, version);
  }

  /**
   * @param {string} name
   * @param {unknown[]} values
   * @param {number | null} [version]
   * @returns {DXNStruct}
   */
  static positional(name, values, version = null) {
    return new DXNStruct(name, { type: 'positional', values }, version);
  }
}

DXNStruct.prototype.dxnType = 'struct';

module.exports = DXNStruct;
