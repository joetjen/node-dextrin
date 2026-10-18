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
    return version === null ? `%${name}` : `%${name}(${version})`;
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
