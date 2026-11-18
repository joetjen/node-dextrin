'use strict';

/**
 * @fileoverview Data that code generated from a schema refuses
 * (`codegen/javascript.cjs`, design/codegen-node.md), the port of
 * php-dextrin's `JOetjen\Dextrin\Codegen\InvalidData`.
 */

const DXNError = require('../error.cjs');

/**
 * Data that code generated from a schema refuses: a `DXNError` at stage
 * `schema` that names the field it stands in, as node-dextrin's `decode`
 * throws a `DXNError`. `path` is that field, outermost first -- a struct's
 * or shape's field name, `[2]` for a list's third item, a map key as DXN
 * writes it -- and `reason` what is wrong with the value there. The
 * message is both: `customer.code: "nope" does not meet %{pattern:@regex
 * "^[A-Z]{3}$"}`.
 *
 * `category` is DXN.md §5's: `schema/type-mismatch`,
 * `schema/missing-field`, `schema/undeclared-field`, `schema/field-count`,
 * `schema/unknown-version` or `schema/deprecated`.
 */
class InvalidData extends DXNError {
  /**
   * @param {string} reason what is wrong with the value
   * @param {string[]} [path] the field it stands in, outermost first
   * @param {string} [category] its category (DXN.md §5)
   */
  constructor(reason, path = [], category = 'schema/type-mismatch') {
    super(InvalidData.text(path, reason), { stage: 'schema', category });
    this.name = 'InvalidData';
    /** What is wrong with the value. @type {string} */
    this.reason = reason;
    /** The field, outermost first; `[]` for the value itself. @type {string[]} */
    this.path = path;
  }

  /**
   * A value that is not what was expected.
   * @example
   * InvalidData.expected('string', 1n).message
   * // => 'expected string, got 1'
   * @param {string} what what was expected, in words or as DXNS names it
   * @param {unknown} value what was given
   * @returns {InvalidData}
   */
  static expected(what, value) {
    // Required here, not at the top: the runtime requires this module.
    const { show } = require('./runtime.cjs');
    return new InvalidData(`expected ${what}, got ${show(value)}`);
  }

  /**
   * This refusal one field further out: `segment` before its path.
   * @param {string} segment the field, item (`[n]`) or key it stands in
   * @returns {InvalidData}
   */
  under(segment) {
    return new InvalidData(this.reason, [segment, ...this.path], this.category ?? 'schema/type-mismatch');
  }

  /**
   * The path in words -- names joined by dots, an item's `[n]` straight
   * after its list -- then the reason.
   * @param {string[]} path @param {string} reason @returns {string}
   */
  static text(path, reason) {
    let where = '';
    for (const segment of path) where += where === '' || segment.startsWith('[') ? segment : `.${segment}`;
    return where === '' ? reason : `${where}: ${reason}`;
  }
}

module.exports = InvalidData;
