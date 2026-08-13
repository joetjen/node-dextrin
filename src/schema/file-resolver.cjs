'use strict';

/**
 * @fileoverview An optional convenience `struct_resolver`
 * (`Registry#putResolver`) resolving `Namespace/Name` references to
 * `.dxns` files on disk, mirroring `Dextrin.Schema.FileResolver`.
 *
 * Composing multiple compiled schemas into one registry needs no
 * special mechanism at all — `schema.compile`'s `baseRegistry`
 * parameter threads across repeated calls. What genuinely needs a
 * policy decision is *automatically* resolving a bare `Namespace/Name`
 * reference to a file path, and this module is *one* reasonable,
 * swappable answer to that — not a mandated convention baked into
 * `Registry`/`schema.cjs` itself. Anyone with a different convention
 * writes their own resolver function directly against
 * `Registry#putResolver`; this module exists only because the
 * convention below is a common, unsurprising default.
 *
 * **Convention**: `Namespace/Name` resolves to
 * `<searchPath>/Namespace.dxns`, read for the specific entry named
 * `Name` — a `.dxns` file is already a map of possibly-many schema
 * names, so "Namespace" names the *file*, "Name" one schema defined
 * inside it. A bare reference with no `/` (`Name`) resolves to
 * `<searchPath>/Name.dxns`, read for the entry also named `Name`.
 */

const fs = require('node:fs');
const path = require('node:path');
const parser = require('../text/parser.cjs');
const Compiler = require('./compiler.cjs');
const Registry = require('../registry.cjs');

/**
 * Builds a `struct_resolver` searching `searchPaths` in order,
 * returning the first match. `predicates` is forwarded to
 * `schema.compile` for any `refine-fn:` the loaded files use.
 * @param {string[]} searchPaths
 * @param {{[name: string]: import('./compiled.cjs').RefineFn}} [predicates]
 * @returns {(name: string) => import('./compiled.cjs') | undefined}
 */
function forPaths(searchPaths, predicates = {}) {
  return (name) => {
    const [fileStem, entryName] = splitName(name);
    for (const dir of searchPaths) {
      const found = resolveIn(dir, fileStem, entryName, predicates);
      if (found) return found;
    }
    return undefined;
  };
}

/**
 * @param {string} dir
 * @param {string} fileStem
 * @param {string} entryName
 * @param {{[name: string]: import('./compiled.cjs').RefineFn}} predicates
 * @returns {import('./compiled.cjs') | undefined}
 */
function resolveIn(dir, fileStem, entryName, predicates) {
  const filePath = path.join(dir, `${fileStem}.dxns`);
  try {
    if (!fs.statSync(filePath).isFile()) return undefined;
    const source = fs.readFileSync(filePath, 'utf8');
    const doc = parser.parse(source);
    const registry = Compiler.compile(doc, new Registry(), predicates);
    const found = registry.fetchStructSchema(entryName);
    return found ? found.compiled : undefined;
  } catch {
    return undefined;
  }
}

/** @param {string} name @returns {[string, string]} */
function splitName(name) {
  const slash = name.indexOf('/');
  return slash === -1 ? [name, name] : [name.slice(0, slash), name.slice(slash + 1)];
}

module.exports = { forPaths };
