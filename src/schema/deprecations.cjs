'use strict';

/**
 * @fileoverview Warnings for what is deprecated (G10 of dextrin's
 * design/typespec.md; `DXNS.md` §1b): "mark Schemas in Dextrin as
 * deprecated, and generate a warning when they are used", one version of
 * a schema as well as the whole schema. Mirrors
 * `Dextrin.Schema.Deprecations`.
 *
 * `deprecated: true | "why"` stands on a version of a schema, a named
 * type, a field's type, a union variant, or an enum value (`values:`). It
 * warns in two places:
 *
 *   - **when a schema compiles** against something deprecated -- a field
 *     naming a deprecated schema or named type, a base, or a base pinned
 *     to a deprecated version (`includes Pet(1)`). The registry keeps
 *     those warnings (`registry.warnings`). Something deprecated naming
 *     something deprecated stays silent.
 *   - **when data goes through it**, decoding or encoding: a struct
 *     written with a deprecated version, or of a schema whose latest
 *     version is deprecated, and a value accepted through a deprecated
 *     type, variant or enum value.
 *
 * The registry's `deprecations` says how often data warns -- `'once'` per
 * registry and deprecated thing (the default), `'every'` time, `'off'`,
 * or `'error'`, which refuses the data (`schema/deprecated`).
 * `onDeprecated` receives each warning in place of `process.emitWarning`.
 *
 * "Once" outlives a single decode: the registry holds a slot for each
 * deprecated thing, given out as its schema or named type is put in the
 * registry, and a set of the slots that have warned, which every copy of
 * that registry shares (the reference keeps an `:atomics` array). A thing
 * with no slot -- a generic's use, filled in when it is checked -- warns
 * each time rather than never.
 */

const { canonical } = require('../canonical.cjs');
const { dxnEquals } = require('../values/equality.cjs');
const Compiled = require('./compiled.cjs');
const Field = require('./field.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const DXNSymbol = require('../values/symbol.cjs');
const DXNTuple = require('../values/tuple.cjs');
const DXNList = require('../values/list.cjs');
const DXNStruct = require('../values/struct.cjs');
const DXNCustomTag = require('../values/custom-tag.cjs');

/** The category of every deprecation warning, and of the error `'error'` makes of one. */
const CATEGORY = 'schema/deprecated';

/**
 * One warning: what is deprecated (`name` and `version` where it has
 * them), the reason it gives (`null` for `deprecated: true`), its
 * category, and, at compile time, the schema or type that uses it.
 * @typedef {{name: string | null, version: number | null, message: string | null, category: string, at: string | null}} Warning
 */

/** How often data going through something deprecated warns. @typedef {'once' | 'every' | 'off' | 'error'} How */

/**
 * Whether `notes`, an annotation object, deprecates what it stands on:
 * `{why}`, `why` the reason or `null`; `null` when it does not.
 * @param {unknown} notes @returns {{why: string | null} | null}
 */
function reason(notes) {
  if (notes === null || typeof notes !== 'object') return null;
  const deprecated = /** @type {{[k: string]: unknown}} */ (notes).deprecated;
  if (typeof deprecated === 'string') return { why: deprecated };
  if (deprecated === true) return { why: null };
  return null;
}

/**
 * A warning about `name` at `version`, for `why`, used at `at`.
 * @param {string | null} name @param {number | null} version @param {string | null} why @param {string | null} [at]
 * @returns {Warning}
 */
function warning(name, version, why, at = null) {
  return { name, version, message: why, category: CATEGORY, at };
}

/**
 * A warning in words.
 * @example
 * text({name: 'Pet', version: 1, message: 'use Pet(2)', category: 'schema/deprecated', at: null})
 * // => 'Pet(1) is deprecated: use Pet(2)'
 * @param {Warning} w @returns {string}
 */
function text(w) {
  let what;
  if (w.name === null) what = 'a deprecated type or value';
  else if (w.version === null) what = w.name;
  else what = `${w.name}(${w.version})`;
  const used = w.at ? `${w.at} uses ${what}, which is deprecated` : `${what} is deprecated`;
  return w.message ? `${used}: ${w.message}` : used;
}

// ---- data going through it -----------------------------------------------------

/**
 * A struct of `name` written with `version` (`null`: the latest) has been
 * read or checked: a warning for that version when it is deprecated, and
 * for the latest when that is -- the whole schema. Throws the error
 * `deprecations: 'error'` makes of the first.
 * @param {import('../registry.cjs')} registry @param {string} name @param {number | null} version
 */
function structUsed(registry, name, version) {
  if (registry.deprecations === 'off') return;
  let found;
  try {
    found = registry.fetchStructSchema(name);
  } catch {
    return;
  }
  if (!found) return;
  const latest = found.compiled.version;
  for (const at of new Set([version ?? latest, latest])) versionUsed(registry, name, at);
}

/** @param {import('../registry.cjs')} registry @param {string} name @param {number} version */
function versionUsed(registry, name, version) {
  const found = registry.fetchStructSchema(name, version);
  const deprecated = found ? reason(found.compiled.annotations) : null;
  if (deprecated) used(registry, `schema\0${name}\0${version}`, warning(name, version, deprecated.why));
}

/**
 * A value went through `node`, a `{form: 'doc'}` whose `notes` deprecate
 * what it stands on, or through `conformed`, one of its deprecated enum
 * values: reported as the registry says. Answers `false` when
 * `deprecations: 'error'` refuses it, `true` otherwise.
 * @param {import('../registry.cjs') | null} registry @param {object} node @param {unknown} conformed
 * @param {{[k: string]: unknown}} notes @returns {boolean}
 */
function nodeUsed(registry, node, conformed, notes) {
  if (!registry || registry.deprecations === 'off') return true;
  try {
    wholeNode(registry, node, notes);
    enumValue(registry, node, conformed, notes);
    return true;
  } catch (err) {
    if (/** @type {any} */ (err).category === CATEGORY) return false;
    throw err;
  }
}

/** @param {import('../registry.cjs')} registry @param {object} node @param {{[k: string]: unknown}} notes */
function wholeNode(registry, node, notes) {
  const deprecated = reason(notes);
  if (!deprecated) return;
  const title = typeof notes.title === 'string' ? notes.title : null;
  used(registry, `node\0${structuralKey(node)}`, warning(title, null, deprecated.why));
}

/** @param {import('../registry.cjs')} registry @param {object} node @param {unknown} conformed @param {{[k: string]: unknown}} notes */
function enumValue(registry, node, conformed, notes) {
  if (!(notes.values instanceof Map)) return;
  for (const [literal, valueNotes] of notes.values) {
    if (!sameLiteral(literal, conformed)) continue;
    const deprecated = reason(valueNotes);
    if (deprecated) used(registry, `value\0${structuralKey(node)}\0${shown(literal)}`, warning(null, null, deprecated.why));
    return;
  }
}

/**
 * An enum value's annotation is keyed by the literal as written; the value
 * may be a keyword or, decoded trusted, a global symbol.
 * @param {unknown} literal @param {unknown} value @returns {boolean}
 */
function sameLiteral(literal, value) {
  return dxnEquals(plain(literal), plain(value));
}

/** @param {unknown} value @returns {unknown} */
function plain(value) {
  if (typeof value === 'symbol') return new DXNKeyword(Symbol.keyFor(value) ?? value.description ?? '');
  return value;
}

/**
 * One use of the deprecated thing `key`, reported as the registry says.
 * @param {import('../registry.cjs')} registry @param {string} key @param {Warning} w
 */
function used(registry, key, w) {
  if (registry.deprecations === 'error') {
    // Required here, not at the top: the validator reads this module.
    const { SchemaValidationError } = require('./validator.cjs');
    throw new SchemaValidationError(text(w), CATEGORY);
  }
  if (registry.deprecations === 'every' || firstUse(registry, key)) report(registry, w);
}

/** Whether `key` warns now: the first time for a slotted thing, every time for another. @param {import('../registry.cjs')} registry @param {string} key */
function firstUse(registry, key) {
  if (!registry.deprecationSlots.has(key)) return true;
  if (registry.deprecationSeen.has(key)) return false;
  registry.deprecationSeen.add(key);
  return true;
}

/**
 * `w` told to the registry's `onDeprecated`, or else to the platform's
 * warnings: `process.emitWarning` as a `DeprecationWarning`, or
 * `console.warn` where there is no `process`.
 * @param {import('../registry.cjs')} registry @param {Warning} w
 */
function report(registry, w) {
  tell(w, registry.onDeprecated);
}

/**
 * `w` told to `onDeprecated`, or else to the platform's warnings:
 * `process.emitWarning(text, {type: 'DeprecationWarning', code:
 * 'DXN_DEPRECATED'})`, or `console.warn` where there is no `process`.
 * What a registry does, and what code generated from a schema
 * (`codegen/`) does without one.
 * @param {Warning} w @param {((warning: Warning) => void) | null | undefined} onDeprecated
 */
function tell(w, onDeprecated) {
  if (typeof onDeprecated === 'function') {
    onDeprecated(w);
    return;
  }
  if (typeof process !== 'undefined' && process && typeof process.emitWarning === 'function') {
    process.emitWarning(text(w), { type: 'DeprecationWarning', code: 'DXN_DEPRECATED' });
  } else {
    console.warn(text(w));
  }
}

// ---- compiling -------------------------------------------------------------------

/**
 * The slots `item` -- a schema version (`Compiled`) or a named type's
 * definition -- holds: one for each deprecated thing in it.
 * @param {unknown} item @returns {string[]}
 */
function keys(item) {
  if (item instanceof Compiled) {
    const own = reason(item.annotations) ? [`schema\0${item.name}\0${item.version}`] : [];
    return [...own, ...item.fields.flatMap((f) => nodeKeys(f.type))];
  }
  return nodeKeys(item);
}

/**
 * Every `{form: 'doc'}` in `type` that deprecates, and every deprecated
 * enum value it annotates, however deep.
 * @param {unknown} type @returns {string[]}
 */
function nodeKeys(type) {
  if (Array.isArray(type)) return type.flatMap(nodeKeys);
  if (type instanceof Field) return nodeKeys(type.type);
  if (type === null || typeof type !== 'object' || Object.getPrototypeOf(type) !== Object.prototype) return [];
  const t = /** @type {any} */ (type);
  if (t.form === 'doc' && t.notes && typeof t.notes === 'object') {
    const own = reason(t.notes) ? [`node\0${structuralKey(t)}`] : [];
    /** @type {string[]} */
    const values = [];
    if (t.notes.values instanceof Map) {
      for (const [literal, valueNotes] of t.notes.values) {
        if (reason(valueNotes)) values.push(`value\0${structuralKey(t)}\0${shown(literal)}`);
      }
    }
    return [...own, ...values, ...nodeKeys(t.elem)];
  }
  return Object.values(t).flatMap(nodeKeys);
}

/**
 * The warnings compiling `entries` -- a document's `[name, raw]` entries
 * as written, now in `registry` -- gives: each entry that is not itself
 * deprecated and names something that is, by a type reference anywhere
 * in its body or a base in its head, ordered by the entry's name. A
 * reference names no version unless it pins one (`Pet(1)`, `DXNS.md`
 * §5c), so it warns when the latest is deprecated; a pinned reference or
 * a base pinned to a version (`includes Pet(1)`) warns when that one is.
 * `names` maps a name as written to the name it was loaded under.
 * @param {Array<[string, unknown]>} entries @param {Map<string, string>} names @param {import('../registry.cjs')} registry
 * @returns {Warning[]}
 */
function compileWarnings(entries, names, registry) {
  /** @type {Warning[]} */
  const found = [];
  const byName = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [at, raw] of byName) {
    if (deprecatedEntry(raw)) continue;
    const seen = new Set();
    for (const [name, version] of usedNames(raw)) {
      const once = `${name}\0${version}`;
      if (seen.has(once)) continue;
      seen.add(once);
      const full = names.get(name) ?? name;
      if (full === at) continue;
      const target = deprecatedTarget(registry, full, version);
      if (target) found.push(warning(full, target.version, target.why, at));
    }
  }
  return found;
}

/** Whether an entry as written is `{:doc ... %{deprecated: ...}}`, other than false or nil. @param {unknown} raw */
function deprecatedEntry(raw) {
  if (!(raw instanceof DXNTuple) || raw.items.length !== 3) return false;
  const [head, , notes] = raw.items;
  if (!(head instanceof DXNKeyword) || head.name !== 'doc' || !(notes instanceof Map)) return false;
  for (const [key, value] of notes) {
    const name = key instanceof DXNKeyword ? key.name : typeof key === 'string' ? key : null;
    if (name === 'deprecated' && value !== false && value !== null) return true;
  }
  return false;
}

/**
 * The names `raw` uses: every symbol in it, at no version, and each base
 * of a `%schema` or `%shape` head at the version it names. A body's
 * `* K => V` (`DXNS.md` §4c) uses names as its fields do.
 * @param {unknown} raw @returns {Array<[string, number | null]>}
 */
function usedNames(raw) {
  if (raw instanceof DXNStruct) {
    /** @type {Array<[string, number | null]>} */
    const bases = raw.bases.map(([, base, version]) => [base, version]);
    const fields = raw.fields.type === 'keyed' ? raw.fields.pairs.flatMap(([, v]) => usedNames(v)) : raw.fields.values.flatMap(usedNames);
    const rest = raw.rest.flatMap((entry) => [...usedNames(entry.key), ...usedNames(entry.value)]);
    return [...bases, ...fields, ...rest];
  }
  if (raw instanceof DXNSymbol) return [[raw.name, null]];
  // `Pet(1)`: the name at the version it pins.
  const pinned = DXNTuple.pinned(raw);
  if (pinned) return [[pinned.name, pinned.version]];
  if (raw instanceof DXNTuple || raw instanceof DXNList) return raw.items.flatMap(usedNames);
  if (raw instanceof DXNCustomTag) return usedNames(raw.value);
  if (Array.isArray(raw)) return raw.flatMap(usedNames);
  // A plain map, keys and values; an ordered map or a set is a leaf, as the
  // reference's structs are.
  if (raw instanceof Map && Object.getPrototypeOf(raw) === Map.prototype) {
    return Array.from(raw).flatMap(([k, v]) => [...usedNames(k), ...usedNames(v)]);
  }
  return [];
}

/**
 * Whether `name` at `version` (`null`: the latest) is deprecated: a
 * schema's version, or a named type. Answers the reason and the version,
 * or `null`.
 * @param {import('../registry.cjs')} registry @param {string} name @param {number | null} version
 * @returns {{why: string | null, version: number | null} | null}
 */
function deprecatedTarget(registry, name, version) {
  const versions = registry.structs.get(name);
  if (versions && versions.size > 0) {
    const at = version ?? Math.max(...versions.keys());
    const compiled = versions.get(at);
    const deprecated = compiled ? reason(compiled.annotations) : null;
    return deprecated ? { why: deprecated.why, version: at } : null;
  }
  return deprecatedType(registry, name, version);
}

/**
 * Whether the named type `name` is deprecated, at `version` when one is
 * pinned (`DXNS.md` §5c): the version in the warning only where the type
 * has more than one.
 * @param {import('../registry.cjs')} registry @param {string} name @param {number | null} version
 * @returns {{why: string | null, version: number | null} | null}
 */
function deprecatedType(registry, name, version) {
  const versions = registry.typeVersions.get(name) ?? new Map();
  const type = /** @type {any} */ (version !== null ? versions.get(version) : registry.typeAliases.get(name));
  const shown = versions.size > 1 ? (version ?? Math.max(...versions.keys())) : null;
  if (!type) return null;
  const doc = type.form === 'doc' ? type : type.form === 'generic' && type.body && type.body.form === 'doc' ? type.body : null;
  const deprecated = doc ? reason(doc.notes) : null;
  return deprecated ? { why: deprecated.why, version: shown } : null;
}

// ---- helpers ---------------------------------------------------------------------

/** What `structuralKey` has worked out, by node. @type {WeakMap<object, string>} */
const KEYS = new WeakMap();

/**
 * A key for `value` that two structurally equal values share, as the
 * reference's `:erlang.phash2/1` of a node does: one slot for a
 * deprecated type, however many places it was copied into.
 * @param {unknown} value @returns {string}
 */
function structuralKey(value) {
  if (value !== null && typeof value === 'object') {
    const known = KEYS.get(value);
    if (known !== undefined) return known;
    const key = keyOf(value, []);
    KEYS.set(value, key);
    return key;
  }
  return keyOf(value, []);
}

/** @param {unknown} value @param {unknown[]} path @returns {string} */
function keyOf(value, path) {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return `@${Symbol.keyFor(value) ?? value.description ?? ''}`;
    case 'function':
      return 'fn';
    case 'object':
      break;
    default:
      return String(value);
  }
  if (value === null) return 'null';
  if (path.includes(value)) return 'cycle';
  const inner = [...path, value];
  if (Array.isArray(value)) return `[${value.map((v) => keyOf(v, inner)).join(',')}]`;
  if (value instanceof Map) return `Map{${Array.from(value, ([k, v]) => `${keyOf(k, inner)}=>${keyOf(v, inner)}`).join(',')}}`;
  if (value instanceof Set) return `Set{${Array.from(value, (v) => keyOf(v, inner)).join(',')}}`;
  const name = value.constructor ? value.constructor.name : 'Object';
  const own = /** @type {{[k: string]: unknown}} */ (value);
  return `${name}{${Object.keys(own)
    .sort()
    .map((k) => `${k}:${keyOf(own[k], inner)}`)
    .join(',')}}`;
}

/** A literal as a key shows it: in its canonical DXN form when it has one. @param {unknown} value @returns {string} */
function shown(value) {
  try {
    return canonical(value);
  } catch {
    return keyOf(value, []);
  }
}

/** How often data going through something deprecated may warn. @type {How[]} */
const MODES = ['once', 'every', 'off', 'error'];

module.exports = { CATEGORY, MODES, reason, warning, text, tell, structUsed, nodeUsed, keys, compileWarnings };
