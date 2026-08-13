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
 */
class DXNStruct {
  /**
   * @param {string} name
   * @param {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} fields
   */
  constructor(name, fields) {
    if (typeof name !== 'string') throw new TypeError('DXNStruct name must be a string');
    this.name = name;
    this.fields = fields;
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
   * @returns {DXNStruct}
   */
  static keyed(name, pairs) {
    return new DXNStruct(name, { type: 'keyed', pairs });
  }

  /**
   * @param {string} name
   * @param {unknown[]} values
   * @returns {DXNStruct}
   */
  static positional(name, values) {
    return new DXNStruct(name, { type: 'positional', values });
  }
}

DXNStruct.prototype.dxnType = 'struct';

module.exports = DXNStruct;
