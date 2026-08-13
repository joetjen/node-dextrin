'use strict';

/**
 * @fileoverview The result of compiling one `%schema{}` entry from a
 * `.dxns` document (`schema/compiler.cjs`) — enough to both validate
 * a decoded value and convert it both directions between `.dxnb`'s
 * always-positional wire shape and a named field map. Mirrors
 * `Dextrin.Schema.Compiled`.
 *
 * `fields` is ordered — that order is the canonical position <-> name
 * mapping `.dxnb`'s positional struct encoding needs, which is
 * exactly why a schema's own `fields:` has to be an `@ordered %{...}`
 * in the source document, not a plain `map` (`.dxn`'s `map` type
 * makes no ordering guarantee, but field order here is semantically
 * load-bearing, not incidental).
 *
 * @typedef {(resolved: {[k: string]: unknown}) => true | string} RefineFn
 * `resolved` is this schema's own already-type-checked field values;
 * return `true` to accept the value, or a `string` describing why not.
 */

class Compiled {
  /**
   * @param {{name?: string | null, fields?: import('./field.cjs')[], closed?: boolean, forbidden?: string[], refineFn?: RefineFn | null}} spec
   */
  constructor({ name = null, fields = [], closed = false, forbidden = [], refineFn = null } = {}) {
    this.name = name;
    this.fields = fields;
    this.closed = closed;
    this.forbidden = forbidden;
    this.refineFn = refineFn;
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
