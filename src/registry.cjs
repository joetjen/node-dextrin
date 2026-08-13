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

class Registry {
  constructor() {
    /** @type {Map<string, (value: unknown) => unknown>} tag name -> decoder. */
    this.tags = new Map();
    /** @type {Map<Function, [string, (value: unknown) => unknown]>} class -> [tag name, encoder]. */
    this.tagEncoders = new Map();
    /** @type {Map<string, import('./schema/compiled.cjs')>} struct name -> compiled schema. */
    this.structs = new Map();
    /** @type {Map<string, (fields: {[k: string]: unknown}) => unknown>} struct name -> materializer. */
    this.materializers = new Map();
    /** @type {((name: string) => import('./schema/compiled.cjs') | undefined) | null} */
    this.resolver = null;
    /** @type {Map<string, unknown>} named type -> compiled TypeExpr. */
    this.typeAliases = new Map();
    /** @type {Map<string, Function>} struct name -> JS class. */
    this.structModules = new Map();
    /** @type {boolean} */
    this.trusted = true;
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
    copy.structModules = new Map(this.structModules);
    copy.trusted = this.trusted;
    return copy;
  }

  /**
   * Marks (or unmarks) this registry as decoding a *trusted* source —
   * the default. Currently the one thing this affects is `keyword`:
   * trusted (the default) decodes it as a real, global `Symbol.for`;
   * untrusted decodes it as `DXNKeyword` instead, so no decode path is
   * ever forced through the global symbol registry's own
   * never-garbage-collected interning for attacker-controlled text.
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
   * @param {string} name
   * @param {import('./schema/compiled.cjs')} compiled
   * @returns {Registry}
   */
  putStructSchema(name, compiled) {
    const copy = this.clone();
    copy.structs.set(name, compiled);
    return copy;
  }

  /**
   * @param {string} name
   * @param {(fields: {[k: string]: unknown}) => unknown} materializer
   * @returns {Registry}
   */
  putStructMaterializer(name, materializer) {
    const copy = this.clone();
    copy.materializers.set(name, materializer);
    return copy;
  }

  /** @param {(name: string) => import('./schema/compiled.cjs') | undefined} resolver @returns {Registry} */
  putResolver(resolver) {
    const copy = this.clone();
    copy.resolver = resolver;
    return copy;
  }

  /**
   * Looks up a compiled schema by struct name, consulting the lazy
   * resolver (if any) on a miss and caching the result. Whether
   * schemas are all compiled up front or resolved on demand (a
   * resolver reading a file, calling a schema service, ...) is
   * entirely the caller's choice — this is what makes both paths
   * look identical to everything else, which never needs to know
   * which one is in play.
   * @param {string} name
   * @returns {{compiled: import('./schema/compiled.cjs'), registry: Registry} | undefined}
   */
  fetchStructSchema(name) {
    const cached = this.structs.get(name);
    if (cached) return { compiled: cached, registry: this };
    if (!this.resolver) return undefined;
    const resolved = this.resolver(name);
    if (!resolved) return undefined;
    return { compiled: resolved, registry: this.putStructSchema(name, resolved) };
  }

  /** @param {string} name @returns {((fields: {[k: string]: unknown}) => unknown) | undefined} */
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
    return copy;
  }

  /** @param {string} name @returns {unknown} */
  fetchTypeAlias(name) {
    return this.typeAliases.get(name);
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
