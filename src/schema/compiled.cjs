'use strict';

/**
 * @fileoverview The result of compiling one `%schema(N){}` entry from a
 * `.dxns` document (`schema/compiler.cjs`) — enough to both validate
 * a decoded value and convert it both directions between `.dxnb`'s
 * always-positional wire shape and a named field map. Mirrors
 * `Dextrin.Schema.Compiled`.
 *
 * `fields` is ordered — that order is the canonical position <-> name
 * mapping `.dxnb`'s positional struct encoding needs, and it is the
 * order the fields are written in the `%schema(N){...}` body.
 *
 * `version` is which version of `name` this is (`DXN.md` §4.8), 1 for
 * a schema written without a header.
 */

class Compiled {
  /**
   * @param {{name?: string | null, version?: number, fields?: import('./field.cjs')[]}} spec
   */
  constructor({ name = null, version = 1, fields = [] } = {}) {
    this.name = name;
    this.version = version;
    this.fields = fields;
  }

  /** @returns {string[]} */
  fieldNames() {
    return this.fields.map((f) => f.name);
  }

  /**
   * `instance` -- a registered application class instance -- as the
   * keyed struct it is written as (DXN.md §4.3, §4.7). A field it does
   * not have, or holds as `undefined`, is absent, never null: a reader
   * refuses null unless the type admits it. An own property the schema
   * does not declare is an extra field, written back with the struct,
   * as an Elixir struct's undeclared keys are.
   * @param {object} instance
   * @returns {import('../values/struct.cjs')}
   */
  structOf(instance) {
    const DXNStruct = require('../values/struct.cjs');
    const declared = new Set(this.fieldNames());
    const own = /** @type {{[k: string]: unknown}} */ (instance);
    /** @type {Array<[string, unknown]>} */
    const pairs = this.fieldNames()
      .filter((name) => own[name] !== undefined)
      .map((name) => [name, own[name]]);
    /** @type {Array<[unknown, unknown]>} */
    const extra = Object.keys(own)
      .filter((key) => !declared.has(key) && own[key] !== undefined)
      .map((key) => [key, own[key]]);
    return DXNStruct.keyed(/** @type {string} */ (this.name), pairs, null, extra);
  }
}

module.exports = Compiled;
