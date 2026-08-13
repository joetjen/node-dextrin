'use strict';

/**
 * @fileoverview `dextrin_js`'s standard library of named types
 * (`priv/schema/std.dxns`, ported verbatim from `dextrin`'s own) —
 * common refinements like `PositiveInteger`/`NonEmptyString`, so a
 * schema author doesn't redefine them by hand. Built the same way any
 * consumer's own named types would be — nothing about them is
 * special-cased in `schema/compiler.cjs`. Deliberately excludes
 * anything domain-specific (email, phone number, URL-shaped string):
 * what counts as a valid one is an application decision this library
 * shouldn't guess at.
 *
 * Opt-in: pass `registry()`'s result as `schema.compile`'s
 * `baseRegistry` to make these names available to your own document.
 *
 *     const value = decode(myDxnsSource);
 *     const registry = Std.registry();
 *     const compiled = compile(value, registry);
 */

const fs = require('node:fs');
const path = require('node:path');
const parser = require('../text/parser.cjs');
const Compiler = require('./compiler.cjs');
const Registry = require('../registry.cjs');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'priv', 'schema', 'std.dxns'), 'utf8');

/** The standard library's own `.dxns` source. @returns {string} */
function source() {
  return SOURCE;
}

/**
 * Compiles the standard library into `baseRegistry` (a fresh
 * `Registry` by default), returning its named types merged in
 * alongside anything `baseRegistry` already had.
 * @param {import('../registry.cjs')} [baseRegistry]
 * @returns {import('../registry.cjs')}
 */
function registry(baseRegistry = new Registry()) {
  const doc = parser.parse(SOURCE);
  return Compiler.compile(doc, baseRegistry);
}

module.exports = { source, registry };
