'use strict';

/**
 * @fileoverview Which schema a decoded struct is read with, given the
 * version it was written with and the versions loaded (`DXN.md` §4.8).
 * Shared by the text parser and the binary decoder, so both answer every
 * case the same way — mirrors `Dextrin.Schema.Reader`:
 *
 * - **No version, or the latest loaded:** read with the latest, exactly.
 * - **Newer than anything loaded:** read against the latest. Text matches
 *   fields by name; binary assumes positions are unchanged, drops the
 *   items beyond the reader's own and leaves missing optional fields
 *   absent. A newer version that reordered or removed fields is misread,
 *   without an error whenever the types agree — the documented risk of
 *   reading forward.
 * - **Older and loaded:** read with that version's own schema and handed
 *   to the materializer, which upgrades it. Without one it is refused,
 *   `schema/no-materializer`: reading old data as if it were the latest
 *   would be a guess.
 * - **Older and not loaded:** refused, `schema/unknown-version`, even
 *   with a materializer, which would receive no field names.
 *
 * **What is built from the fields:** the schema's materializer, when one
 * is registered, is called for every struct of its schema, whatever the
 * version, as `materializer(name, version, fields)` — `version` being the
 * one the fields were read with, `fields` an object keyed by field-name
 * string. Its result is checked against the latest schema; a throw, or a
 * result the latest schema rejects, is `schema/materializer`. Without a
 * materializer the latest version comes back as a `DXNStruct` at that
 * version, its fields in the schema's order. Nested structs are built
 * first.
 */

const DXNError = require('../error.cjs');
const DXNStruct = require('../values/struct.cjs');
const Validated = require('./validated.cjs');
const Validator = require('./validator.cjs');

/**
 * @typedef {{type: 'keyed', pairs: Array<[string, unknown]>} | {type: 'positional', values: unknown[]}} Fields
 */

/**
 * `fields` of the struct `name`, written at `version` (`null` when it
 * says none), read against `registry`. Answers `{value, registry}`, or
 * `null` when `name` has no schema at all — the struct stays opaque.
 * Throws a categorised `DXNError`, or a `SchemaValidationError` the
 * caller wraps as a schema violation.
 * @param {import('../registry.cjs')} registry
 * @param {string} name
 * @param {number | null} version
 * @param {Fields} fields
 * @returns {{value: unknown, registry: import('../registry.cjs')} | null}
 */
function read(registry, name, version, fields) {
  const found = registry.fetchStructSchema(name);
  if (!found) return null;
  const latest = found.compiled;
  const current = found.registry;

  if (version === null || version === latest.version) return materialized(current, latest, latest, fields);
  if (version > latest.version) return materialized(current, latest, latest, forward(latest, fields));

  const older = current.fetchStructSchema(name, version);
  if (!older) {
    throw new DXNError(`struct ${JSON.stringify(name)} was written with version ${version}, which is not loaded`, {
      stage: 'schema',
      category: 'schema/unknown-version'
    });
  }
  if (!current.fetchMaterializer(name)) {
    throw new DXNError(
      `struct ${JSON.stringify(name)} was written with the older version ${version}, ` +
        'and no materializer is registered to upgrade it',
      { stage: 'schema', category: 'schema/no-materializer' }
    );
  }
  return materialized(current, older.compiled, latest, fields);
}

/**
 * A newer writer's positional items, by the reader's own field order:
 * positions are assumed unchanged, items beyond the reader's fields are
 * dropped, and fields beyond the items are absent. Keyed fields already
 * carry their names.
 * @param {import('./compiled.cjs')} latest
 * @param {Fields} fields
 * @returns {Fields}
 */
function forward(latest, fields) {
  if (fields.type === 'keyed') return fields;
  const names = latest.fieldNames();
  const count = Math.min(names.length, fields.values.length);
  /** @type {Array<[string, unknown]>} */
  const pairs = [];
  for (let i = 0; i < count; i += 1) pairs.push([names[i], fields.values[i]]);
  return { type: 'keyed', pairs };
}

/**
 * The fields read with `reading`, then built into a value: by the
 * materializer when there is one, checked against `latest`; as a generic
 * struct at `latest`'s version when there is none. Wrapped in
 * `Validated` so an outer schema's reference can tell where it came from.
 * @param {import('../registry.cjs')} registry
 * @param {import('./compiled.cjs')} reading
 * @param {import('./compiled.cjs')} latest
 * @param {Fields} fields
 * @returns {{value: unknown, registry: import('../registry.cjs')}}
 */
function materialized(registry, reading, latest, fields) {
  const name = /** @type {string} */ (reading.name);
  const pairs = Validator.resolve(reading, fields, registry);
  const materializer = registry.fetchMaterializer(name);
  const value = materializer
    ? built(registry, materializer, reading, latest, pairs)
    : DXNStruct.keyed(name, pairs, latest.version);
  return { value: new Validated(name, value), registry };
}

/**
 * @param {import('../registry.cjs')} registry
 * @param {(name: string, version: number, fields: {[k: string]: unknown}) => unknown} materializer
 * @param {import('./compiled.cjs')} reading
 * @param {import('./compiled.cjs')} latest
 * @param {Array<[string, unknown]>} pairs
 * @returns {unknown}
 */
function built(registry, materializer, reading, latest, pairs) {
  const name = /** @type {string} */ (reading.name);
  let value;
  try {
    value = materializer(name, reading.version, Object.fromEntries(pairs));
  } catch (err) {
    throw materializerError(name, `refused: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    Validator.validateForEncode(latest, value, registry, { coerce: false });
  } catch (err) {
    throw materializerError(
      name,
      `answered a value version ${latest.version} rejects: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return value;
}

/** @param {string} name @param {string} what @returns {DXNError} */
function materializerError(name, what) {
  return new DXNError(`the materializer for ${JSON.stringify(name)} ${what}`, {
    stage: 'schema',
    category: 'schema/materializer'
  });
}

module.exports = { read };
