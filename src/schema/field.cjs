'use strict';

/**
 * @fileoverview One compiled field spec inside a `Compiled` schema,
 * mirroring `Dextrin.Schema.Field`. `required` comes from the
 * `?`-suffixed key convention (a field key ending in `?` is optional;
 * no separate flag exists in `.dxns` itself); `default`/`description`
 * only ever come from the `%field{...}` escape hatch, since
 * optionality is already fully covered by the key suffix. A default
 * may be computed when the field is filled (`computed: :now`), and is
 * read through `Field.filled`.
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

/**
 * A default computed when the field is filled (`%field{computed: :now}`,
 * DXNS.md §4), as the reference's `{:computed, "now", kind}`: `kind` is the
 * temporal type it fills, `date`, `time`, `datetime` or `local-datetime`.
 * @typedef {{computed: 'now', kind: string}} Computed
 */

/**
 * The default `computed: :now` gives a field of the temporal type `kind`.
 * @param {string} kind @returns {Computed}
 */
function computedNow(kind) {
  return Object.freeze({ computed: /** @type {'now'} */ ('now'), kind });
}

/** Whether `value` is a computed default. @param {unknown} value @returns {value is Computed} */
function isComputed(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && /** @type {any} */ (value).computed === 'now';
}

/**
 * A field's `default` as the value it fills: computed now, in UTC, for a
 * computed one; as written otherwise. Required here, not at the top, so
 * the value classes stay out of this module's load.
 * @param {unknown} defaultValue @returns {unknown}
 */
function filled(defaultValue) {
  if (!isComputed(defaultValue)) return defaultValue;
  const millis = Date.now();
  const nanos = BigInt(millis) * 1_000_000n;
  switch (defaultValue.kind) {
    case 'date':
      return require('../values/date.cjs').fromDate(new Date(millis));
    case 'time': {
      const now = new Date(millis);
      const DXNTime = require('../values/time.cjs');
      return new DXNTime(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds() * 1_000_000);
    }
    case 'local-datetime':
      return new (require('../values/local-date-time.cjs'))(nanos);
    default:
      return new (require('../values/date-time.cjs'))(nanos, 0);
  }
}

/**
 * The value a missing field takes: its default, computed now for a
 * computed one; `Field.NO_DEFAULT` when it has none.
 * @param {Field} field @returns {unknown}
 */
function defaultValue(field) {
  return filled(field.default);
}

Field.NO_DEFAULT = NO_DEFAULT;
Field.computedNow = computedNow;
Field.isComputed = isComputed;
Field.filled = filled;
Field.defaultValue = defaultValue;

module.exports = Field;
