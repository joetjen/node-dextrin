// dextrin:schema acme.shop/Pet

import { AbstractPet } from './AbstractPet.js';

/**
 * The schema acme.shop/Pet. Its properties and methods come from
 * AbstractPet, which `dextrin gen-js` rewrites; this file is yours
 * and is never rewritten. A hand-written upgrade the schema needs is a
 * static method here, and the static block below fails when one is
 * missing.
 */
export class Pet extends AbstractPet {
  static {
    this.verify();
  }

  /**
   * The one hand-written part of this fixture, as a user writes it:
   * `born` was an integer in version 1 and is a string in version 2.
   * Everything else under generated/ is written by `dextrin gen-js` from
   * ../schemas (see test/codegen/javascript.spec.js); regenerate it,
   * never edit it.
   * @param {import('./AbstractPet.js').UpgradeV1Fields} fields
   * @returns {import('./AbstractPet.js').FieldsV2}
   */
  static upgradeV1(fields) {
    return { ...fields, born: String(fields.born) };
  }
}
