'use strict';

/**
 * @fileoverview One compiled field spec inside a `Compiled` schema,
 * mirroring `Dextrin.Schema.Field`. `required` comes from the
 * `?`-suffixed key convention (a field key ending in `?` is optional;
 * no separate flag exists in `.dxns` itself); `default`/`description`
 * only ever come from the `%field{...}` escape hatch, since
 * optionality is already fully covered by the key suffix.
 */

const NO_DEFAULT = Symbol('no-default');

class Field {
  /**
   * @param {{name: string, required?: boolean, type?: import('./type-expr.cjs').TypeExpr, default?: unknown, description?: string | null}} spec
   */
  constructor({ name, required = true, type = { form: 'any' }, default: defaultValue = NO_DEFAULT, description = null }) {
    this.name = name;
    this.required = required;
    this.type = type;
    this.default = defaultValue;
    this.description = description;
  }
}

Field.NO_DEFAULT = NO_DEFAULT;

module.exports = Field;
