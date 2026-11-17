'use strict';

/**
 * @fileoverview The version discipline check (DXNS.md §8), mirroring
 * `Dextrin.Schema.Compat`: compares the schemas of a previous release
 * with the current ones.
 *
 *   - A schema whose content changed must have a new version: a version
 *     present in both whose fields differ -- a field added, removed,
 *     moved, or one whose type, requiredness or default changed -- is a
 *     problem, because two documents claiming to be `User` v3 must mean
 *     the same thing.
 *   - A version never goes down.
 *   - Informational: for each schema, every older version still loaded
 *     beside the latest, with the fields the latest added, removed and
 *     changed since -- a checklist for the materializer's branches.
 *
 * There are no compatibility modes and no append-only rule. A field's
 * description is documentation, not content, and so are annotations
 * (`{:doc}`): documenting or deprecating a version that shipped is no
 * change. What a schema takes beyond its fields (`DXNS.md` §4c) is
 * content.
 *
 * Named types with versions (`%type(N)`, `DXNS.md` §5c) follow the same
 * two rules, their annotations aside; a named type has no materializer,
 * so no upgrade checklist.
 */

const { isDeepStrictEqual } = require('node:util');
const Field = require('./field.cjs');

/**
 * @typedef {{schema: string, version: number, problem: 'changed-without-new-version'}
 *   | {schema: string, problem: 'version-went-down', from: number, to: number}
 *   | {type: string, version: number, problem: 'changed-without-new-version'}
 *   | {type: string, problem: 'version-went-down', from: number, to: number}} Problem
 * @typedef {{schema: string, from: number, to: number, added: string[], removed: string[], changed: string[]}} Upgrade
 * @typedef {import('./compiled.cjs')} Compiled
 */

/**
 * `oldRegistry`'s schemas against `newRegistry`'s: the problems, and the
 * upgrade checklist for `newRegistry`, each sorted by schema name and
 * version.
 * @param {import('../registry.cjs')} oldRegistry
 * @param {import('../registry.cjs')} newRegistry
 * @returns {{problems: Problem[], upgrades: Upgrade[]}}
 */
function check(oldRegistry, newRegistry) {
  return {
    problems: [...problems(oldRegistry.structs, newRegistry.structs), ...typeProblems(oldRegistry.typeVersions, newRegistry.typeVersions)],
    upgrades: upgrades(newRegistry.structs)
  };
}

/**
 * The same two rules for named types with versions (`DXNS.md` §5c), each
 * problem naming the type under `type`.
 * @param {Map<string, Map<number, unknown>>} before @param {Map<string, Map<number, unknown>>} now @returns {Problem[]}
 */
function typeProblems(before, now) {
  /** @type {Problem[]} */
  const found = [];
  for (const [name, versions] of sorted(now)) {
    const old = before.get(name);
    if (!old) continue;
    for (const [version, type] of sorted(versions)) {
      if (old.has(version) && !isDeepStrictEqual(meaning(old.get(version)), meaning(type))) {
        found.push({ type: name, version, problem: 'changed-without-new-version' });
      }
    }
    const from = latest(old);
    const to = latest(versions);
    if (to < from) found.push({ type: name, problem: 'version-went-down', from, to });
  }
  return found;
}

/** @param {Map<string, Map<number, Compiled>>} before @param {Map<string, Map<number, Compiled>>} now @returns {Problem[]} */
function problems(before, now) {
  /** @type {Problem[]} */
  const found = [];
  for (const [name, versions] of sorted(now)) {
    const old = before.get(name);
    if (!old) continue;
    for (const [version, compiled] of sorted(versions)) {
      const was = old.get(version);
      if (was && !isDeepStrictEqual(shape(was), shape(compiled))) {
        found.push({ schema: name, version, problem: 'changed-without-new-version' });
      }
    }
    const from = latest(old);
    const to = latest(versions);
    if (to < from) found.push({ schema: name, problem: 'version-went-down', from, to });
  }
  return found;
}

/** @param {Map<string, Map<number, Compiled>>} now @returns {Upgrade[]} */
function upgrades(now) {
  /** @type {Upgrade[]} */
  const found = [];
  for (const [name, versions] of sorted(now)) {
    const to = latest(versions);
    const newest = /** @type {Compiled} */ (versions.get(to));
    for (const [from, older] of sorted(versions)) {
      if (from < to) found.push(upgrade(name, from, older, to, newest));
    }
  }
  return found;
}

/** @param {string} name @param {number} from @param {Compiled} older @param {number} to @param {Compiled} newest @returns {Upgrade} */
function upgrade(name, from, older, to, newest) {
  const before = new Map(older.fields.map((f) => [f.name, fieldShape(f)]));
  const now = new Map(newest.fields.map((f) => [f.name, fieldShape(f)]));
  return {
    schema: name,
    from,
    to,
    added: newest.fields.filter((f) => !before.has(f.name)).map((f) => f.name),
    removed: older.fields.filter((f) => !now.has(f.name)).map((f) => f.name),
    changed: newest.fields.filter((f) => before.has(f.name) && !isDeepStrictEqual(before.get(f.name), now.get(f.name))).map((f) => f.name),
  };
}

/**
 * A map's entries sorted by key -- names by code point, versions
 * numerically.
 * @template {string | number} K, V
 * @param {Map<K, V>} map
 * @returns {[K, V][]}
 */
function sorted(map) {
  return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** @param {Map<number, unknown>} versions @returns {number} */
function latest(versions) {
  return Math.max(...versions.keys());
}

/**
 * What a schema's content is, for this check: its fields in order, and
 * what it takes beyond them (`DXNS.md` §4c).
 * @param {Compiled} compiled
 */
function shape(compiled) {
  return [compiled.fields.map((f) => [f.name, fieldShape(f)]), meaning(compiled.extras)];
}

/** @param {Field} field */
function fieldShape(field) {
  return [field.required, meaning(field.type), field.default];
}

/**
 * What a type takes, without its annotations: they check nothing, so
 * documenting or deprecating a version that shipped (`DXNS.md` §1b) is no
 * change. A field's description goes too.
 * @param {unknown} type @returns {unknown}
 */
function meaning(type) {
  if (Array.isArray(type)) return type.map(meaning);
  if (type instanceof Field) return [type.name, type.required, meaning(type.type), type.default];
  if (type === null || typeof type !== 'object' || Object.getPrototypeOf(type) !== Object.prototype) return type;
  const t = /** @type {any} */ (type);
  if (t.form === 'doc') return meaning(t.elem);
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, meaning(v)]));
}

module.exports = { check };
