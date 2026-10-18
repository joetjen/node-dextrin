import DXNStruct from '../../src/values/struct.js';

/**
 * A decoded value with every keyed `DXNStruct` in it turned into a plain
 * object of its fields — for tests about what a schema accepts, which
 * care about the checked fields and not about the generic struct a
 * schema with no materializer decodes to (DXN.md §4.8).
 * @param {unknown} value
 * @returns {unknown}
 */
export function fieldsOf(value) {
  if (value instanceof DXNStruct && value.fields.type === 'keyed') {
    return Object.fromEntries(value.fields.pairs.map(([k, v]) => [k, fieldsOf(v)]));
  }
  if (Array.isArray(value)) return value.map(fieldsOf);
  return value;
}
