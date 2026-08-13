'use strict';

/**
 * @fileoverview Lets a class's *own* library ship a DXN schema for it
 * — field names, types, required/optional, closed/forbidden,
 * refinements, a materializer — without that library ever taking a
 * runtime dependency on `dextrin`. The `struct` (schema-backed)
 * counterpart to what `Registry#putTagEncoder` already does for
 * simple scalar-wrapping `custom-tag` values: an extension point
 * owned by the *consuming* application, not forced onto every
 * class-defining library it might want to use with `dextrin`.
 *
 * Mirrors `Dextrin.Schema.Provider`'s *concept* exactly (a compiled
 * `.dxns` schema, a class association, an optional materializer, all
 * wired via one `registerProvider` call), but not its Elixir-specific
 * mechanics: Elixir needs a formal `@behaviour` plus
 * `Code.ensure_loaded?/1` guarding specifically because Mix compiles
 * everything ahead of time, so a *compile-time* contract is what
 * catches a missing/misspelled callback, and an *optional* Mix
 * dependency needs an explicit "is this even loaded" check. Neither
 * concern exists the same way in Node: a module either resolves via
 * `require`/`import` or it doesn't (already a clear, immediate
 * failure), and nothing here needs compiling ahead of time — so this
 * is deliberately just a plain, duck-typed object shape (documented
 * via the `DXNSchemaProvider` JSDoc typedef below, structurally
 * checked by `tsc --checkJs` for anyone implementing it against that
 * type) rather than a formal interface/class hierarchy.
 *
 * A provider's own package can therefore define one of these directly
 * in a small companion module, `require`d lazily (inside whatever
 * function actually calls `registerProvider`) by an application that
 * wants both packages — no special optional-dependency ceremony
 * needed at all.
 *
 * @typedef {{
 *   dxnSchema: () => string,
 *   dxnSchemaName: () => string,
 *   dxnClass: () => Function,
 *   dxnMaterialize?: (resolved: {[k: string]: unknown}) => unknown
 * }} DXNSchemaProvider
 */

const parser = require('../text/parser.cjs');

/**
 * Compiles and registers one `DXNSchemaProvider` into `registry`, in
 * order:
 *
 *   1. Decodes and compiles `provider.dxnSchema()`'s source into
 *      `registry`. Every named type and every `%schema{}` entry that
 *      document defines gets folded in, not only the one
 *      `dxnSchemaName()` points at.
 *   2. Looks up `dxnSchemaName()` in the now-compiled registry — if
 *      it isn't there (the provider declared a name its own document
 *      doesn't define), throws a specific error naming both, rather
 *      than silently registering nothing.
 *   3. Associates `dxnClass()` with that schema name
 *      (`Registry#putStructModule`) — what lets `encode`/`encodeBinary`
 *      serialize instances of it directly and lets `{form:
 *      'reference', name}` checks recognize it.
 *   4. If `provider.dxnMaterialize` exists, registers it
 *      (`Registry#putStructMaterializer`). If not, decoding this
 *      schema falls back to the default plain field object.
 *
 * @param {import('../registry.cjs')} registry
 * @param {DXNSchemaProvider} provider
 * @param {(schemaDoc: unknown, baseRegistry: import('../registry.cjs')) => import('../registry.cjs')} compile
 * @returns {import('../registry.cjs')}
 */
function registerProvider(registry, provider, compile) {
  const doc = parser.parse(provider.dxnSchema());
  let compiled = compile(doc, registry);

  const name = provider.dxnSchemaName();
  const found = compiled.fetchStructSchema(name);
  if (!found) {
    throw new Error(`provider's dxnSchemaName() returned ${JSON.stringify(name)}, but its own dxnSchema() document has no such schema entry`);
  }
  compiled = found.registry;

  compiled = compiled.putStructModule(name, provider.dxnClass());
  if (typeof provider.dxnMaterialize === 'function') {
    compiled = compiled.putStructMaterializer(name, provider.dxnMaterialize);
  }
  return compiled;
}

module.exports = { registerProvider };
