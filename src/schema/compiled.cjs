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
   * Reads `instance`'s fields (an arbitrary registered JS class
   * instance, not a `DXNStruct`) out in this schema's own canonical
   * field order — the same order `.dxnb`'s positional wire encoding
   * needs. A field this schema declares but `instance` doesn't have
   * is `undefined`, same as any other absent field; extra instance
   * properties the schema doesn't know about are simply not included.
   * @param {object} instance
   * @returns {Array<[string, unknown]>}
   */
  fieldValues(instance) {
    return this.fieldNames().map((name) => [name, (/** @type {{[k: string]: unknown}} */ (instance))[name]]);
  }
}

module.exports = Compiled;
