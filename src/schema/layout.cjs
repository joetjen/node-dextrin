'use strict';

/**
 * @fileoverview The names a `.dxns` file's entries have, from where the
 * file lies under its root (DXN.md §4.6) -- one rule for every reader of
 * a tree: the docs generator, `tree.cjs` and the file resolver; the port
 * of `Dextrin.Schema.Layout`.
 *
 * - **A file named like one entry holds that entry**: `acme/shop/
 *   Customer-v2.dxns`, `acme/shop/Order/v1.dxns` and `acme.shop.Product.dxns`
 *   hold `acme.shop/Customer`, `acme.shop/Order` and `acme.shop/Product`,
 *   and the version their name says. Every other entry in such a file is
 *   internal to it: `acme.shop.Order/Line`.
 * - **A file holding no entry named like it is a namespace file**:
 *   `acme.common.dxns` holds `acme.common/Money` and the rest.
 * - **A name with no namespace is its own file**: `HealthCheck.dxns`
 *   holding `HealthCheck`.
 */

/**
 * @typedef {{names: Map<string, string>, holder: string | null, version: number | null, internal: string[]}} Layout
 */

/**
 * The layout of the file at `relative` (to its root, `/`-separated),
 * holding the entries `keys`.
 * @param {string} relative
 * @param {string[]} keys
 * @returns {Layout}
 */
function of(relative, keys) {
  const { stem, version } = stemOf(relative);
  const own = /** @type {string} */ (stem[stem.length - 1]);
  const holder = keys.includes(own) ? own : null;
  const namespace = stem.slice(0, -1).join('.');
  const whole = stem.join('.');
  const names = new Map(keys.map((key) => [key, key === holder ? join(namespace, key) : join(whole, key)]));
  return {
    names,
    holder,
    version: holder ? version : null,
    internal: holder ? keys.filter((k) => k !== holder) : []
  };
}

/**
 * A file's dotted stem and the version its name says: `Customer-v2` and
 * `Order/v1` carry one, anything else none.
 * @param {string} relative
 */
function stemOf(relative) {
  const parts = relative.replace(/\.dxns$/, '').split('/');
  const last = /** @type {string} */ (parts.pop());
  /** @type {string[]} */
  let nameParts;
  /** @type {number | null} */
  let version = null;
  let m;
  if (parts.length > 0 && /^v[1-9][0-9]*$/.test(last)) {
    nameParts = parts;
    version = Number(last.slice(1));
  } else if ((m = /^(.+)-v([1-9][0-9]*)$/.exec(last))) {
    nameParts = [...parts, /** @type {string} */ (m[1])];
    version = Number(m[2]);
  } else {
    nameParts = [...parts, last];
  }
  return { stem: nameParts.flatMap((p) => p.split('.')), version };
}

/** @param {string} namespace @param {string} name */
function join(namespace, name) {
  return namespace === '' ? name : `${namespace}/${name}`;
}

module.exports = { of };
