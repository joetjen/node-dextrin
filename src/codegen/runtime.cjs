'use strict';

/**
 * @fileoverview The few functions code generated from a schema calls
 * (`codegen/javascript.cjs`, design/codegen-node.md), the port of
 * php-dextrin's `Codegen\Runtime` and dextrin's `Dextrin.Codegen.Runtime`:
 * one per form a check takes (a shape, a list, a union, ...), ways to read
 * a struct's fields, to say what a value is in an error, to decode a
 * constant written as DXN text, and to write a value back as DXN. None of
 * them reads a schema; everything a schema says is in the generated code.
 *
 * **Deprecation warnings** (T698; DXNS.md §1b, as
 * `schema/deprecations.cjs` words them): a value that goes through
 * something deprecated is *noted* while it is read, and the notes are
 * settled when the outermost read ends (`reading`) --
 *
 *   - so a variant tried and refused stays silent: `attempt` drops what it
 *     noted;
 *   - so `'error'` refuses the whole value, whichever check noted it;
 *   - so a read that fails anyway reports nothing.
 *
 * A read runs to its end before another starts (reading is synchronous),
 * so its mode and notes are kept here while it runs. "Once" is per
 * generated class and deprecated thing, numbered when the class is
 * generated: there is no registry to hold it.
 *
 * **Field bags** -- a struct's fields by name, as the per-version readers
 * take and answer them -- have no prototype, so a field named `__proto__`
 * is a field like any other.
 */

const Deprecations = require('../schema/deprecations.cjs');
const TypeExpr = require('../schema/type-expr.cjs');
const Field = require('../schema/field.cjs');
const { dxnEquals } = require('../values/equality.cjs');
const DXNKeyword = require('../values/keyword.cjs');
const DXNList = require('../values/list.cjs');
const InvalidData = require('./invalid-data.cjs');

/**
 * How a read reports what is deprecated (T698): `deprecations` --
 * `'once'` per generated class and deprecated thing (the default),
 * `'every'` time, `'off'`, or `'error'`, which refuses the value -- and
 * `onDeprecated`, which receives each warning in place of
 * `process.emitWarning`.
 * @typedef {{deprecations?: 'once' | 'every' | 'off' | 'error' | undefined, onDeprecated?: ((warning: Warning) => void) | null | undefined}} ReadOptions
 */

/** @typedef {import('../schema/deprecations.cjs').Warning} Warning */

/** A struct's or shape's fields by name. @typedef {{[name: string]: unknown}} Fields */

/** A check: the value as checked, or a thrown `InvalidData`. @typedef {(value: unknown) => unknown} Check */

/**
 * A field as a check takes it: its name, whether it is required, its
 * check (`null` for a field that must be absent, `:never`), and its
 * default (`null` for none).
 * @typedef {[string, boolean, Check | null, (() => unknown) | null]} Spec
 */

/** @typedef {{owner: object, slot: number, warning: Warning}} Note */

/** The read under way, if one is. @type {{mode: string, notes: Note[]} | null} */
let current = null;

/** Which deprecated things have warned, by generated class. @type {WeakMap<object, Set<number>>} */
const seen = new WeakMap();

/** The classes `verify` has found complete. @type {WeakSet<object>} */
const verified = new WeakSet();

// ---- reading, and deprecations -------------------------------------------------

/**
 * `read()`, a read or a check, with deprecation warnings as `options`
 * says ({@link ReadOptions}). Inside another read it only runs `read`: the
 * outermost read settles the notes.
 * @template T
 * @param {ReadOptions | undefined} options
 * @param {() => T} read
 * @returns {T}
 * @throws {InvalidData} the read's refusal, or the one `'error'` makes of a deprecation
 * @throws {RangeError} for an unknown `deprecations`
 */
function reading(options, read) {
  if (current) return read();
  const mode = options?.deprecations ?? 'once';
  if (!Deprecations.MODES.includes(mode)) throw new RangeError(`deprecations: is once, every, off or error, got ${String(mode)}`);
  current = { mode, notes: [] };
  /** @type {T} */
  let result;
  /** @type {Note[]} */
  let notes;
  try {
    result = read();
    notes = current.notes;
  } finally {
    current = null;
  }
  settle(notes, mode, options?.onDeprecated ?? null);
  return result;
}

/**
 * A value went through something deprecated: `slot` of the generated class
 * `owner`, named `name` at `version` (either `null` where it has none),
 * for `why`. Outside a read it is settled at once, as `'once'`.
 * @param {object} owner the generated class, whose "once" it is
 * @param {number} slot which of its deprecated things
 * @param {string | null} name @param {number | null} version @param {string | null} why
 */
function deprecated(owner, slot, name, version, why) {
  const note = { owner, slot, warning: Deprecations.warning(name, version, why) };
  if (!current) {
    settle([note], 'once', null);
    return;
  }
  if (current.mode !== 'off') current.notes.push(note);
}

/**
 * `value` went through an enum whose deprecated values are `values`, each
 * `[literal, slot, why]`: noted when it is one of them.
 * @param {object} owner @param {unknown} value @param {Array<[unknown, number, string | null]>} values
 */
function deprecatedValue(owner, value, values) {
  for (const [literal, slot, why] of values) {
    if (dxnEquals(plain(literal), plain(value))) {
      deprecated(owner, slot, null, null, why);
      return;
    }
  }
}

/**
 * `check(value)`, a variant tried: what it noted is kept only when it
 * takes the value.
 * @param {Check} check @param {unknown} value @returns {unknown}
 */
function attempt(check, value) {
  const before = current ? current.notes.length : 0;
  try {
    return check(value);
  } catch (err) {
    if (current && err instanceof InvalidData) current.notes.length = before;
    throw err;
  }
}

/** @param {Note[]} notes @param {string} mode @param {((warning: Warning) => void) | null} hear */
function settle(notes, mode, hear) {
  if (notes.length === 0) return;
  if (mode === 'error') throw new InvalidData(Deprecations.text(notes[0].warning), [], Deprecations.CATEGORY);
  for (const { owner, slot, warning } of notes) {
    let slots = seen.get(owner);
    if (!slots) seen.set(owner, (slots = new Set()));
    if (mode === 'every' || !slots.has(slot)) {
      slots.add(slot);
      Deprecations.tell(warning, hear);
    }
  }
}

/** An enum's literal may be a keyword, written either way. @param {unknown} value @returns {unknown} */
function plain(value) {
  if (typeof value === 'symbol') return new DXNKeyword(Symbol.keyFor(value) ?? value.description ?? '');
  return value;
}

// ---- the user's class -----------------------------------------------------------

/**
 * Whether `cls`, a user's class extending a generated one, has every
 * hand-written upgrade its schema needs: `needs` holds each one's method
 * and what it upgrades. Throws a `TypeError` naming the class and the
 * first method missing; checked once per class.
 * @param {Function} cls @param {Array<[string, string]>} needs
 */
function verify(cls, needs) {
  if (verified.has(cls)) return;
  const own = /** @type {{[k: string]: unknown}} */ (/** @type {unknown} */ (cls));
  for (const [method, why] of needs) {
    if (typeof own[method] !== 'function') {
      throw new TypeError(`${cls.name} needs a static ${method}(fields): ${why}`);
    }
  }
  verified.add(cls);
}

// ---- structs -------------------------------------------------------------------

/**
 * A struct's fields by name: keyed as they are, positional by `names`, a
 * version's fields in order. Its extra fields (keys that are no name) are
 * left out.
 * @param {import('../values/struct.cjs')} struct @param {string[]} names
 * @returns {Fields}
 * @throws {InvalidData} a positional struct with another number of fields (`schema/field-count`)
 */
function named(struct, names) {
  /** @type {Fields} */
  const fields = Object.create(null);
  if (struct.fields.type === 'keyed') {
    for (const [name, value] of struct.fields.pairs) fields[name] = value;
    return fields;
  }
  const values = struct.fields.values;
  if (values.length !== names.length) {
    throw new InvalidData(`expected ${names.length} positional field(s), got ${values.length}`, [], 'schema/field-count');
  }
  names.forEach((name, i) => {
    fields[name] = values[i];
  });
  return fields;
}

/**
 * A struct's or shape's fields checked as `specs` say and answered by
 * name, defaults filled. A field not in `specs` is left out.
 * @param {Fields} fields @param {Spec[]} specs
 * @returns {Fields}
 * @throws {InvalidData} the first field refused, named
 */
function fields(fields, specs) {
  /** @type {Fields} */
  const out = Object.create(null);
  for (const [name, required, check, fill] of specs) {
    if (Object.hasOwn(fields, name)) out[name] = checked(name, check, fields[name]);
    else if (fill !== null) out[name] = fill();
    else if (required) throw new InvalidData(`missing required field ${name}`, [], 'schema/missing-field');
  }
  return out;
}

/**
 * A closed schema's version (`- *`) takes no field it does not declare:
 * the first of `fields` not among `names` is refused, before any field is
 * checked.
 * @param {Fields} fields @param {string[]} names
 * @throws {InvalidData} naming the field (`schema/undeclared-field`)
 */
function closed(fields, names) {
  for (const name of Object.keys(fields)) {
    if (!names.includes(name)) {
      throw new InvalidData(`field "${name}" is not declared, and the schema takes no other`, [], 'schema/undeclared-field');
    }
  }
}

/**
 * A generated object's fields, `[name, value]` each, as a field bag
 * without those holding `undefined`, which are absent.
 * @param {Array<[string, unknown]>} pairs @returns {Fields}
 */
function present(pairs) {
  /** @type {Fields} */
  const out = Object.create(null);
  for (const [name, value] of pairs) if (value !== undefined) out[name] = value;
  return out;
}

/**
 * A generated object's fields as a struct's pairs, written back as DXN
 * (`toDxn`), those holding `undefined` left out.
 * @param {Array<[string, unknown]>} pairs @returns {Array<[string, unknown]>}
 */
function pairs(pairs) {
  return pairs.filter(([, value]) => value !== undefined).map(([name, value]) => [name, toDxn(value)]);
}

/** A field bag of one's own, to change. @param {Fields} fields @returns {Fields} */
function copy(fields) {
  return Object.assign(Object.create(null), fields);
}

/**
 * `from` moved to `to` in `fields`, where it is.
 * @param {Fields} fields @param {string} from @param {string} to
 */
function move(fields, from, to) {
  if (!Object.hasOwn(fields, from)) return;
  fields[to] = fields[from];
  delete fields[from];
}

/** @param {string} name @param {Check | null} check @param {unknown} value @returns {unknown} */
function checked(name, check, value) {
  if (check === null) throw new InvalidData('no value is allowed here').under(name);
  try {
    return check(value);
  } catch (err) {
    if (err instanceof InvalidData) throw err.under(name);
    throw err;
  }
}

// ---- the forms -----------------------------------------------------------------

/**
 * A value of the primitive `name` (`TypeExpr.isPrimitive`).
 * @param {string} name @param {unknown} value @returns {unknown}
 */
function primitive(name, value) {
  if (!TypeExpr.isPrimitive(name, value)) throw InvalidData.expected(name, value);
  return value;
}

/** Each refine's constraints by name, made once from the map it was decoded as. @type {WeakMap<object, {[k: string]: unknown}>} */
const constraintsOf = new WeakMap();

/**
 * A value meeting `constraints`, a refine's, written as DXN and decoded
 * (`value`); `base` is the primitive it refines, `null` for none.
 * @param {unknown} value @param {unknown} constraints @param {string | null} base @returns {unknown}
 */
function refine(value, constraints, base) {
  const map = /** @type {Map<unknown, unknown>} */ (constraints);
  let byName = constraintsOf.get(map);
  if (!byName) {
    byName = {};
    for (const [key, arg] of map) byName[/** @type {string} */ (keyName(key))] = arg;
    constraintsOf.set(map, byName);
  }
  if (!TypeExpr.meetsConstraints(value, byName, base)) throw new InvalidData(`${show(value)} does not meet ${show(constraints)}`);
  return value;
}

/**
 * One of an enum's `literals`, a list decoded from DXN text.
 * @param {unknown} value @param {unknown} literals @returns {unknown}
 */
function enumOf(value, literals) {
  const items = /** @type {DXNList} */ (literals).items;
  if (!TypeExpr.isEnumMember(items, value)) throw new InvalidData(`expected one of ${show(literals)}, got ${show(value)}`);
  return value;
}

/**
 * A list, every item checked: a new list of what the checks answer.
 * @param {unknown} value @param {Check} check @returns {DXNList}
 * @throws {InvalidData} the first item refused, as `[n]`
 */
function listOf(value, check) {
  if (!(value instanceof DXNList)) throw InvalidData.expected('a list', value);
  return new DXNList(value.items.map((item, i) => checked(`[${i}]`, check, item)));
}

/**
 * A map, every key and value checked: a map of the same kind, its values
 * as the checks answer them, its keys as they are.
 * @param {unknown} value @param {Check} key @param {Check} item @returns {Map<unknown, unknown>}
 * @throws {InvalidData} the first entry refused, under its key
 */
function mapOf(value, key, item) {
  if (!(value instanceof Map)) throw InvalidData.expected('a map', value);
  /** @type {Array<[unknown, unknown]>} */
  const entries = [];
  for (const [k, v] of value) {
    const shown = show(k);
    checked(shown, key, k);
    entries.push([k, checked(shown, item, v)]);
  }
  return sameMap(value, entries);
}

/**
 * A map checked as a `%shape`: each declared field matched by name,
 * whatever spelling its key has, and checked, as `specs` say (`fields`);
 * a missing one with a default takes it under a keyword key. With
 * `isClosed`, a key no field declares is refused. Answers a map of the
 * same kind.
 * @param {unknown} value @param {Spec[]} specs @param {boolean} isClosed @returns {Map<unknown, unknown>}
 * @throws {InvalidData} the first field refused, named
 */
function shape(value, specs, isClosed) {
  if (!(value instanceof Map)) throw InvalidData.expected('a map', value);
  /** @type {Array<[unknown, unknown]>} */
  const entries = Array.from(value);
  /** @type {Map<string, number>} */
  const at = new Map();
  entries.forEach(([key], i) => {
    const name = keyName(key);
    if (name === null) return;
    if (at.has(name)) throw new InvalidData('given twice').under(name);
    at.set(name, i);
  });
  const declared = new Set();
  for (const [name, required, check, fill] of specs) {
    declared.add(name);
    const i = at.get(name);
    if (i !== undefined) entries[i] = [entries[i][0], checked(name, check, entries[i][1])];
    else if (fill !== null) entries.push([new DXNKeyword(name), fill()]);
    else if (required) throw new InvalidData(`missing required field ${name}`, [], 'schema/missing-field');
  }
  if (isClosed) {
    for (const [key] of entries) {
      const name = keyName(key);
      if (name === null || !declared.has(name)) {
        throw new InvalidData(`${show(key)} is no field, and the shape is closed`, [], 'schema/undeclared-field');
      }
    }
  }
  return sameMap(value, entries);
}

/** A map of the same kind as `like` holding `entries`. @param {Map<unknown, unknown>} like @param {Array<[unknown, unknown]>} entries @returns {Map<unknown, unknown>} */
function sameMap(like, entries) {
  const Kind = /** @type {new (entries: Array<[unknown, unknown]>) => Map<unknown, unknown>} */ (like.constructor);
  return new Kind(entries);
}

/** The name a map key gives a field, or `null`. @param {unknown} key @returns {string | null} */
function keyName(key) {
  if (key instanceof DXNKeyword) return key.name;
  if (typeof key === 'symbol') return Symbol.keyFor(key) ?? key.description ?? null;
  if (typeof key === 'string') return key;
  return null;
}

/**
 * The first of `variants` that takes the value (`{:any-of}`).
 * @param {unknown} value @param {Check[]} variants @returns {unknown}
 */
function anyOf(value, variants) {
  for (const variant of variants) {
    try {
      return attempt(variant, value);
    } catch (err) {
      if (!(err instanceof InvalidData)) throw err;
    }
  }
  throw InvalidData.expected('one of its variants', value);
}

/**
 * The one of `variants` that takes the value (`{:one-of}`).
 * @param {unknown} value @param {Check[]} variants @returns {unknown}
 */
function oneOf(value, variants) {
  const taken = [];
  for (const variant of variants) {
    try {
      taken.push(attempt(variant, value));
    } catch (err) {
      if (!(err instanceof InvalidData)) throw err;
    }
  }
  if (taken.length === 1) return taken[0];
  if (taken.length === 0) throw InvalidData.expected('one of its variants', value);
  throw new InvalidData(`more than one variant takes ${show(value)}`);
}

/**
 * The value through every one of `variants`, each taking what the one
 * before answered (`{:all-of}`).
 * @param {unknown} value @param {Check[]} variants @returns {unknown}
 */
function allOf(value, variants) {
  let current = value;
  for (const variant of variants) current = variant(current);
  return current;
}

/**
 * A value `excluded` does not take (`{:not}`).
 * @param {unknown} value @param {Check} excluded @returns {unknown}
 */
function not(value, excluded) {
  try {
    attempt(excluded, value);
  } catch (err) {
    if (err instanceof InvalidData) return value;
    throw err;
  }
  throw new InvalidData(`${show(value)} is what is excluded`);
}

/**
 * A value `test` takes checked by `then`, any other by `otherwise`
 * (`{:if}`).
 * @param {unknown} value @param {Check} test @param {Check} then @param {Check} otherwise @returns {unknown}
 */
function ifThen(value, test, then, otherwise) {
  try {
    attempt(test, value);
  } catch (err) {
    if (err instanceof InvalidData) return otherwise(value);
    throw err;
  }
  return then(value);
}

// ---- values --------------------------------------------------------------------

/**
 * A DXN value written as text, decoded: a constant of the generated code
 * (a default, a literal, a refine's constraints), which caches it.
 * @param {string} text @returns {unknown}
 */
function value(text) {
  // Required here, not at the top: the package entry requires the schema modules.
  return require('../dextrin.cjs').decode(text);
}

/**
 * The value `computed: :now` gives a field of the temporal type `kind`,
 * computed now: when a value is read or made, never when code is written.
 * @param {string} kind @returns {any} a date, time, datetime or local datetime, as `kind` says
 */
function computed(kind) {
  return Field.filled(Field.computedNow(kind));
}

/**
 * What a value is, for an error: its DXN text, or its type.
 * @param {unknown} value @returns {string}
 */
function show(value) {
  try {
    return require('../dextrin.cjs').encode(toDxn(value));
  } catch {
    return value === null ? 'null' : typeof value === 'object' ? (value.constructor?.name ?? 'object') : typeof value;
  }
}

/**
 * Whether `value` is an object of a generated class.
 * @param {unknown} value @returns {value is {toDxn(): unknown}}
 */
function isGenerated(value) {
  if (value === null || typeof value !== 'object') return false;
  const ctor = /** @type {{DXN_SCHEMA?: unknown}} */ (value.constructor);
  return typeof ctor?.DXN_SCHEMA === 'string' && typeof (/** @type {any} */ (value).toDxn) === 'function';
}

/**
 * `value` written back as DXN: a generated object as its own `toDxn()`
 * writes it, inside lists and maps too.
 * @param {unknown} value @returns {unknown}
 */
function toDxn(value) {
  if (isGenerated(value)) return value.toDxn();
  if (value instanceof DXNList) return new DXNList(value.items.map(toDxn));
  if (value instanceof Map) return sameMap(value, Array.from(value, ([k, v]) => [k, toDxn(v)]));
  return value;
}

/**
 * `value` with `read` applied to each value inside a list or map, however
 * deep it goes: what a generated decoder uses to read every struct it
 * knows, wherever it stands.
 * @param {unknown} value @param {(value: unknown) => unknown} read @returns {unknown}
 */
function walk(value, read) {
  if (value instanceof DXNList) return new DXNList(value.items.map(read));
  if (value instanceof Map) return sameMap(value, Array.from(value, ([k, v]) => [k, read(v)]));
  return value;
}

module.exports = {
  reading,
  deprecated,
  deprecatedValue,
  attempt,
  verify,
  named,
  fields,
  closed,
  present,
  pairs,
  copy,
  move,
  primitive,
  refine,
  enumOf,
  listOf,
  mapOf,
  shape,
  anyOf,
  oneOf,
  allOf,
  not,
  ifThen,
  value,
  computed,
  show,
  toDxn,
  walk
};
