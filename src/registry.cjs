'use strict';

/**
 * @fileoverview Extension point for both `struct` and `custom-tag`
 * decoding/encoding, mirroring `Dextrin.Registry`. No entry for a
 * given name → decode falls back to an opaque `DXNStruct`/
 * `DXNCustomTag` — never a hard failure, since neither type requires
 * a registration to be representable at all.
 *
 * Struct entries only ever come from a compiled `.dxns` schema
 * (`schema/compiler.cjs`) plus an optional materializer layered on
 * top — there is no `putStruct` that hand-writes a struct's shape
 * directly, because `struct` is schema-dependent by design: the
 * schema supplies field names/order/types, a materializer only
 * decides what nicer decoded shape to produce from an
 * already-schema-validated field map.
 *
 * `Registry` instances are plain, immutable-by-convention data —
 * every `put*` method returns a *new* `Registry`, never mutates
 * `this` — threaded explicitly through `decode`/`encode`/
 * `schema.compile`, never a global or a class with hidden state.
 */

const DXNError = require('./error.cjs');
const Compiled = require('./schema/compiled.cjs');
const DXNStruct = require('./values/struct.cjs');
const Deprecations = require('./schema/deprecations.cjs');
const { dxnEquals } = require('./values/equality.cjs');

/** @typedef {import('./schema/deprecations.cjs').Warning} Warning */

/**
 * `compiled` under `name`, otherwise the same.
 * @param {import('./schema/compiled.cjs')} compiled
 * @param {string} name
 * @returns {import('./schema/compiled.cjs')}
 */
function renamed(compiled, name) {
  const { version, fields, annotations, bases, extras } = compiled;
  return new Compiled({ name, version, fields, annotations, bases, extras });
}

class Registry {
  constructor() {
    /** @type {Map<string, (value: unknown) => unknown>} tag name -> decoder. */
    this.tags = new Map();
    /** @type {Map<Function, [string, (value: unknown) => unknown]>} class -> [tag name, encoder]. */
    this.tagEncoders = new Map();
    /** @type {Map<string, Map<number, import('./schema/compiled.cjs')>>} struct name -> version -> compiled schema. */
    this.structs = new Map();
    /** @type {Map<string, (name: string, version: number, fields: {[k: string]: unknown}) => unknown>} struct name -> materializer. */
    this.materializers = new Map();
    /** @type {((name: string) => import('./schema/compiled.cjs') | import('./schema/compiled.cjs')[] | undefined) | null} */
    this.resolver = null;
    /** @type {Map<string, unknown>} named type -> compiled TypeExpr, its latest version's. */
    this.typeAliases = new Map();
    /**
     * Every version of a named type (`DXNS.md` §5c, Way B of dextrin's
     * design/typespec.md); `typeAliases` holds the latest of each.
     * @type {Map<string, Map<number, unknown>>}
     */
    this.typeVersions = new Map();
    /** @type {Map<string, Function>} struct name -> JS class. */
    this.structModules = new Map();
    /** @type {boolean} */
    this.trusted = false;
    /** @type {boolean} refuse extra fields on schema-backed structs (`putStrict`). */
    this.strict = false;
    // G10 of dextrin's design/typespec.md (`schema/deprecations.cjs`):
    // how often data going through something deprecated warns, who hears
    // it, which deprecated things have a slot, which of those have
    // warned, and what compiling found.
    /** @type {'once' | 'every' | 'off' | 'error'} */
    this.deprecations = 'once';
    /** @type {((warning: Warning) => void) | null} */
    this.onDeprecated = null;
    /** @type {Set<string>} the deprecated things that warn once, a slot each. */
    this.deprecationSlots = new Set();
    /**
     * The slots that have warned: one set, shared by every copy of this
     * registry, so "once" outlives a single decode.
     * @type {Set<string>}
     */
    this.deprecationSeen = new Set();
    /** @type {Warning[]} what compiling into this registry found deprecated, in the order compiled. */
    this.warnings = [];
  }

  /** @returns {Registry} a shallow copy, ready for one field to be overwritten. */
  clone() {
    const copy = new Registry();
    copy.tags = new Map(this.tags);
    copy.tagEncoders = new Map(this.tagEncoders);
    copy.structs = new Map(this.structs);
    copy.materializers = new Map(this.materializers);
    copy.resolver = this.resolver;
    copy.typeAliases = new Map(this.typeAliases);
    copy.typeVersions = new Map(this.typeVersions);
    copy.structModules = new Map(this.structModules);
    copy.trusted = this.trusted;
    copy.strict = this.strict;
    copy.deprecations = this.deprecations;
    copy.onDeprecated = this.onDeprecated;
    copy.deprecationSlots = this.deprecationSlots;
    copy.deprecationSeen = this.deprecationSeen;
    copy.warnings = this.warnings;
    return copy;
  }

  /**
   * This registry with what a decode's or an encode's options say of it:
   * `strict`, `deprecations` and `onDeprecated`, each when given. The
   * reference's `Dextrin.Registry.from_options/1`.
   * @param {{strict?: boolean, deprecations?: 'once' | 'every' | 'off' | 'error', onDeprecated?: ((warning: Warning) => void) | null}} opts
   * @returns {Registry}
   */
  withOptions(opts) {
    /** @type {Registry} */
    let registry = this;
    if (opts.strict !== undefined) registry = registry.putStrict(opts.strict);
    if (opts.deprecations !== undefined) registry = registry.putDeprecations(opts.deprecations);
    if (opts.onDeprecated !== undefined) registry = registry.putOnDeprecated(opts.onDeprecated);
    return registry;
  }

  /**
   * How often data going through something deprecated warns (G10,
   * `schema/deprecations.cjs`): `'once'` per registry and deprecated
   * thing, the default; `'every'` time; `'off'`; or `'error'`, which
   * refuses the data (`schema/deprecated`). `decode`/`encode` take it as
   * `deprecations:`.
   * @param {'once' | 'every' | 'off' | 'error'} how
   * @returns {Registry}
   */
  putDeprecations(how) {
    if (!['once', 'every', 'off', 'error'].includes(how)) {
      throw new TypeError(`deprecations is 'once', 'every', 'off' or 'error', not ${String(how)}`);
    }
    const copy = this.clone();
    copy.deprecations = how;
    return copy;
  }

  /**
   * Who hears a deprecation warning, in place of `process.emitWarning`: a
   * function of one warning, or `null` for the platform's warnings.
   * `decode`/`encode` take it as `onDeprecated:`.
   * @param {((warning: Warning) => void) | null} fn
   * @returns {Registry}
   */
  putOnDeprecated(fn) {
    if (fn !== null && typeof fn !== 'function') throw new TypeError('onDeprecated is a function of one warning, or null');
    const copy = this.clone();
    copy.onDeprecated = fn;
    return copy;
  }

  /**
   * This registry with `warnings` -- what compiling found deprecated --
   * after those it holds.
   * @param {Warning[]} warnings
   * @returns {Registry}
   */
  withWarnings(warnings) {
    if (warnings.length === 0) return this;
    const copy = this.clone();
    copy.warnings = [...this.warnings, ...warnings];
    return copy;
  }

  /**
   * `copy` -- a fresh clone of this registry -- with a slot for each
   * deprecated thing `item` holds, a schema version or a named type's
   * definition; the slots it had keep theirs, and what they have seen.
   * Called as each is put in the registry, so one loaded later by a
   * resolver has its slots too.
   * @param {Registry} copy
   * @param {unknown} item
   * @returns {Registry}
   */
  static slotted(copy, item) {
    const fresh = Deprecations.keys(item).filter((key) => !copy.deprecationSlots.has(key));
    if (fresh.length > 0) copy.deprecationSlots = new Set([...copy.deprecationSlots, ...fresh]);
    return copy;
  }

  /**
   * Marks this registry as decoding *strictly*: a schema-backed struct
   * that carries a field its schema does not declare is refused
   * (`schema/undeclared-field`, `DXN.md` §4.7) instead of keeping it as
   * an extra field. A config loader decodes strictly; a message consumer
   * does not. `decode`/`decodeBinary` take it as `strict: true`.
   * @param {boolean} strict
   * @returns {Registry}
   */
  putStrict(strict) {
    const copy = this.clone();
    copy.strict = strict;
    return copy;
  }

  /**
   * Marks (or unmarks) this registry as decoding a *trusted* source, vs.
   * an untrusted one -- the default. Currently the one thing this
   * affects is `keyword`: untrusted (the default) decodes it as
   * `DXNKeyword`, so no decode path is ever forced through the global
   * symbol registry's never-garbage-collected interning by the input;
   * trusted decodes it as a real, global `Symbol.for`. A decode's own
   * `trusted:` option wins over this.
   * `symbol` is deliberately unaffected either way.
   * @param {boolean} trusted
   * @returns {Registry}
   */
  putTrusted(trusted) {
    const copy = this.clone();
    copy.trusted = trusted;
    return copy;
  }

  /**
   * @param {string} name
   * @param {(value: unknown) => unknown} decoder
   * @returns {Registry}
   */
  putTag(name, decoder) {
    const copy = this.clone();
    copy.tags.set(name, decoder);
    return copy;
  }

  /** @param {string} name @returns {((value: unknown) => unknown) | undefined} */
  fetchTag(name) {
    return this.tags.get(name);
  }

  /**
   * The reverse of `putTag`: registers how to turn an application
   * value (keyed by its constructor) back into `@name value` on
   * encode — decode-side dispatch happens by wire tag name, encode
   * needs to dispatch by JS class instead, so the two directions need
   * separate tables.
   * @param {Function} klass
   * @param {string} name
   * @param {(value: unknown) => unknown} encoder
   * @returns {Registry}
   */
  putTagEncoder(klass, name, encoder) {
    const copy = this.clone();
    copy.tagEncoders.set(klass, [name, encoder]);
    return copy;
  }

  /** @param {Function} klass @returns {[string, (value: unknown) => unknown] | undefined} */
  fetchTagEncoder(klass) {
    return this.tagEncoders.get(klass);
  }

  /**
   * `compiled` as version `compiled.version` of the schema `name`,
   * whether or not that version was loaded already — the unchecked
   * setter a resolver's answer goes through. Loading a document's
   * schemas goes through `addStructSchema`, a hot swap through
   * `replaceStructSchema`.
   * @param {string} name
   * @param {import('./schema/compiled.cjs')} compiled
   * @returns {Registry}
   */
  putStructSchema(name, compiled) {
    const copy = this.clone();
    const versions = new Map(this.structs.get(name) ?? []);
    versions.set(compiled.version, compiled);
    copy.structs.set(name, versions);
    return Registry.slotted(copy, compiled.name === name ? compiled : renamed(compiled, name));
  }

  /**
   * Loads `compiled` as a new version of the schema `name`. A version
   * that is already loaded is refused as `schema/duplicate-version`
   * (`DXN.md` §4.8): two documents both claiming to be `User` v3 is a
   * mistake, not an update.
   * @param {string} name
   * @param {import('./schema/compiled.cjs')} compiled
   * @returns {Registry}
   * @throws {DXNError}
   */
  addStructSchema(name, compiled) {
    if (this.isLoaded(name, compiled.version)) {
      throw new DXNError(`schema ${JSON.stringify(name)} version ${compiled.version} is already loaded`, {
        stage: 'schema',
        category: 'schema/duplicate-version'
      });
    }
    return this.putStructSchema(name, compiled);
  }

  /**
   * Replaces version `compiled.version` of the schema `name` — the hot
   * swap of a running system. **Replace only replaces**: a version that
   * is not loaded is refused as `schema/not-loaded`, so a typo in a hot
   * swap never quietly adds a version instead.
   * @param {string} name
   * @param {import('./schema/compiled.cjs')} compiled
   * @returns {Registry}
   * @throws {DXNError}
   */
  replaceStructSchema(name, compiled) {
    if (!this.isLoaded(name, compiled.version)) {
      throw new DXNError(
        `schema ${JSON.stringify(name)} version ${compiled.version} is not loaded, so there is nothing to replace`,
        { stage: 'schema', category: 'schema/not-loaded' }
      );
    }
    return this.putStructSchema(name, renamed(compiled, name));
  }

  /** @param {string} name @param {number} version @returns {boolean} */
  isLoaded(name, version) {
    return this.structs.get(name)?.has(version) ?? false;
  }

  /**
   * @param {string} name
   * The schema's materializer (`DXN.md` §4.8): called for every decoded
   * struct of `name`, whatever the version, with the schema's name, the
   * version the fields were read with and the fields keyed by string; it
   * answers the application's latest-version value, which is checked
   * against the latest schema, or throws.
   * @param {(name: string, version: number, fields: {[k: string]: unknown}) => unknown} materializer
   * @returns {Registry}
   */
  putStructMaterializer(name, materializer) {
    const copy = this.clone();
    copy.materializers.set(name, materializer);
    return copy;
  }

  /**
   * A lazy source of schemas, asked on a miss for a name: every version
   * it finds -- one compiled schema or a list of them, all loaded -- or
   * undefined. It throws (`schema/compile`) when the schemas it found
   * cannot be used: two files with one version, a file that is not the
   * version its name says, ...
   * @param {(name: string) => import('./schema/compiled.cjs') | import('./schema/compiled.cjs')[] | undefined} resolver
   * @returns {Registry}
   */
  putResolver(resolver) {
    const copy = this.clone();
    copy.resolver = resolver;
    return copy;
  }

  /**
   * Looks up a compiled schema by struct name: the latest version, or
   * with `version` exactly that one. A name not loaded at all consults
   * the lazy resolver (if any), which loads every version it finds. Whether schemas
   * are all compiled up front or resolved on demand (a resolver reading
   * a file, calling a schema service, ...) is entirely the caller's
   * choice — this is what makes both paths look identical to
   * everything else. **A named version never falls back to another**:
   * a struct is only ever read with the schema it was written against.
   * @param {string} name
   * @param {number} [version]
   * @returns {{compiled: import('./schema/compiled.cjs'), registry: Registry} | undefined}
   */
  fetchStructSchema(name, version) {
    const versions = this.structs.get(name);
    if (versions && versions.size > 0) {
      if (version !== undefined) {
        const exact = versions.get(version);
        return exact ? { compiled: exact, registry: this } : undefined;
      }
      const latest = Math.max(...versions.keys());
      return { compiled: /** @type {import('./schema/compiled.cjs')} */ (versions.get(latest)), registry: this };
    }
    const resolved = this.resolve(name);
    if (!resolved || version === undefined) return resolved;
    return resolved.registry.fetchStructSchema(name, version);
  }

  /**
   * What the resolver answers for `name`, every version of it loaded --
   * so an older struct reaches the materializer (DXNS.md §6, §4.8) --
   * and the latest answered. A resolver's refusal is thrown on.
   * @param {string} name
   * @returns {{compiled: import('./schema/compiled.cjs'), registry: Registry} | undefined}
   */
  resolve(name) {
    if (!this.resolver) return undefined;
    const resolved = this.resolver(name);
    const all = resolved === undefined ? [] : Array.isArray(resolved) ? resolved : [resolved];
    if (all.length === 0) return undefined;
    /** @type {Registry} */
    let registry = this;
    for (const compiled of all) registry = registry.putStructSchema(name, compiled);
    const latest = all.reduce((a, b) => (b.version > a.version ? b : a));
    return { compiled: latest, registry };
  }

  /**
   * `struct` as it is written here: carrying the version it says itself
   * when that version is loaded -- what a field pinned to it needs
   * (`DXNS.md` §5c) -- and otherwise the latest loaded version of its
   * schema (`DXNS.md` §8). A struct whose name has no schema keeps its
   * own version, or none. Every writer goes through this — text, the
   * formatter and binary — so encoding writes the latest unless the
   * struct carries a loaded version of its own, and never writes one no
   * schema stands behind.
   * @param {DXNStruct} struct
   * @returns {DXNStruct}
   */
  asWritten(struct) {
    // No schema to stand behind a version: the struct keeps its own. A
    // resolver's refusal surfaces where the struct is read or checked.
    let found;
    try {
      if (struct.version !== null && this.fetchStructSchema(struct.name, struct.version)) return struct;
      found = this.fetchStructSchema(struct.name);
    } catch {
      found = undefined;
    }
    return found ? new DXNStruct(struct.name, struct.fields, found.compiled.version) : struct;
  }

  /** @param {string} name @returns {((name: string, version: number, fields: {[k: string]: unknown}) => unknown) | undefined} */
  fetchMaterializer(name) {
    return this.materializers.get(name);
  }

  /**
   * @param {string} name
   * @param {unknown} typeExpr
   * @returns {Registry}
   */
  putTypeAlias(name, typeExpr) {
    const copy = this.clone();
    copy.typeAliases.set(name, typeExpr);
    return Registry.slotted(copy, typeExpr);
  }

  /** @param {string} name @returns {unknown} */
  fetchTypeAlias(name) {
    return this.typeAliases.get(name);
  }

  /**
   * Loads `typeExpr` as version `version` of the named type `name`
   * (`DXNS.md` §5c, Way B of dextrin's design/typespec.md): `name` then
   * means the latest version loaded, and `fetchTypeVersion` finds each.
   * Loading a version already loaded with another definition is refused
   * as `schema/duplicate-version`; the same definition again changes
   * nothing.
   * @param {string} name
   * @param {number} version
   * @param {unknown} typeExpr
   * @returns {Registry}
   * @throws {DXNError}
   */
  putTypeVersion(name, version, typeExpr) {
    const versions = this.typeVersions.get(name) ?? new Map();
    if (versions.has(version)) {
      if (dxnEquals(versions.get(version), typeExpr)) return this;
      throw new DXNError(`named type ${JSON.stringify(name)} version ${version} is already loaded, defined otherwise`, {
        stage: 'schema',
        category: 'schema/duplicate-version'
      });
    }
    const grown = new Map(versions).set(version, typeExpr);
    const latest = Math.max(...grown.keys());
    const copy = this.clone();
    copy.typeVersions.set(name, grown);
    return Registry.slotted(copy, typeExpr).putTypeAlias(name, grown.get(latest));
  }

  /**
   * Version `version` of the named type `name`, when it is loaded.
   * @param {string} name
   * @param {number} version
   * @returns {unknown}
   */
  fetchTypeVersion(name, version) {
    return this.typeVersions.get(name)?.get(version);
  }

  /**
   * Declares which JS class a schema's data is expected to be — used
   * only for `{:reference, name}` checks during encode-time
   * validation. Decode-time reference checks don't need this: they
   * carry an internal provenance marker regardless of materializer
   * shape (`schema/validated.cjs`).
   * @param {string} name
   * @param {Function} klass
   * @returns {Registry}
   */
  putStructModule(name, klass) {
    const copy = this.clone();
    copy.structModules.set(name, klass);
    return copy;
  }

  /** @param {string} name @returns {Function | undefined} */
  fetchStructModule(name) {
    return this.structModules.get(name);
  }

  /**
   * The reverse of `fetchStructModule`: given an application value's
   * own class, finds the schema name it was registered under (if
   * any) — what lets automatic encode-time validation recognize a
   * plain JS class instance as "this is a Foo" without being told so
   * explicitly.
   * @param {Function} klass
   * @returns {string | undefined}
   */
  fetchSchemaNameForModule(klass) {
    for (const [name, registered] of this.structModules.entries()) {
      if (registered === klass) return name;
    }
    return undefined;
  }
}

module.exports = Registry;
