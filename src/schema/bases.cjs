'use strict';

/**
 * @fileoverview The fields of a schema or shape built from others
 * (`DXNS.md` §4b): its bases' fields merged with its own body, mirroring
 * `Dextrin.Schema.Bases`.
 *
 * The order is the bases', in the order the head names them, each base's
 * in its own order. A field that arrives again keeps its first place, an
 * override stays where it is, and the body's own fields come last. The
 * same field from two bases is one field when both are identical; two
 * that differ are refused unless the body overrides or drops that field.
 *
 * The bases themselves -- which schema or shape a name means, at which
 * version -- are found by `compiler.cjs`; this module only merges what it
 * is handed.
 */

const { dxnEquals } = require('../values/equality.cjs');

/**
 * One base, found: the clause naming it, its name, and its fields.
 * @typedef {{kind: 'extends' | 'includes', name: string, fields: import('./field.cjs')[]}} FoundBase
 */

/**
 * `own` and `drops` merged onto `bases`' fields. A refusal throws an
 * `Error` whose message says why in words; the compiler gives it its
 * category.
 *
 * @example
 * const base = {kind: 'extends', name: 'P', fields: [new Field({name: 'a'}), new Field({name: 'b', required: false})]};
 * merge([base], [new Field({name: 'c'})], ['b']).map((f) => f.name);
 * // => ['a', 'c']
 * @param {FoundBase[]} bases
 * @param {import('./field.cjs')[]} own
 * @param {string[]} drops
 * @param {(a: import('./field.cjs'), b: import('./field.cjs')) => boolean} [same] whether two fields
 *   of one name from two bases are the same field; the compiler compares
 *   them with their types in place.
 * @returns {import('./field.cjs')[]}
 */
function merge(bases, own, drops, same = dxnEquals) {
  const ownNames = new Set(own.map((f) => f.name));
  distinctDrops(drops);
  const inheritedFields = inherited(bases, new Set([...ownNames, ...drops]), same);
  dropsInherited(drops, inheritedFields, ownNames);
  dropsOptional(drops, bases);
  const kept = inheritedFields.filter((f) => !drops.includes(f.name));
  const byName = new Map(own.map((f) => [f.name, f]));
  const placed = new Set(kept.map((f) => f.name));
  return [...kept.map((f) => byName.get(f.name) ?? f), ...own.filter((f) => !placed.has(f.name))];
}

/**
 * Every base's fields in turn, each name once, its first place kept. Two
 * different fields of one name are refused unless `settled` -- the body
 * overrides or drops it.
 * @param {FoundBase[]} bases
 * @param {Set<string>} settled
 * @param {(a: import('./field.cjs'), b: import('./field.cjs')) => boolean} same
 * @returns {import('./field.cjs')[]}
 */
function inherited(bases, settled, same) {
  /** @type {import('./field.cjs')[]} */
  const fields = [];
  /** @type {Map<string, import('./field.cjs')>} */
  const seen = new Map();
  for (const base of bases) {
    for (const field of base.fields) {
      const first = seen.get(field.name);
      if (first === undefined) {
        fields.push(field);
        seen.set(field.name, field);
      } else if (!same(first, field) && !settled.has(field.name)) {
        throw new Error(`field ${JSON.stringify(field.name)} differs between its bases; override it, or drop it`);
      }
    }
  }
  return fields;
}

/** @param {string[]} drops */
function distinctDrops(drops) {
  const twice = drops.find((name, i) => drops.indexOf(name) !== i);
  if (twice !== undefined) throw new Error(`field ${JSON.stringify(twice)} is dropped twice`);
}

/**
 * Each dropped field is one a base has, and none the body declares.
 * @param {string[]} drops
 * @param {import('./field.cjs')[]} inheritedFields
 * @param {Set<string>} ownNames
 */
function dropsInherited(drops, inheritedFields, ownNames) {
  const names = new Set(inheritedFields.map((f) => f.name));
  const missing = drops.find((name) => !names.has(name));
  if (missing !== undefined) throw new Error(`- ${missing} drops a field no base has`);
  const declared = drops.find((name) => ownNames.has(name));
  if (declared !== undefined) throw new Error(`field ${JSON.stringify(declared)} is both dropped and declared`);
}

/**
 * No value without a required field of an `extends` base could pass as
 * that base; `includes` is for leaving one out.
 * @param {string[]} drops
 * @param {FoundBase[]} bases
 */
function dropsOptional(drops, bases) {
  for (const base of bases) {
    if (base.kind !== 'extends') continue;
    const field = base.fields.find((f) => f.required && drops.includes(f.name));
    if (field) {
      throw new Error(
        `- ${field.name} drops a required field of ${base.name}, which this schema extends; include ${base.name} instead`
      );
    }
  }
}

module.exports = { merge };
