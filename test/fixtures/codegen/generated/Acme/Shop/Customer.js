// dextrin:schema acme.shop/Customer

import { AbstractCustomer } from './AbstractCustomer.js';

/**
 * The schema acme.shop/Customer. Its properties and methods come from
 * AbstractCustomer, which `dextrin gen-js` rewrites; this file is yours
 * and is never rewritten. A hand-written upgrade the schema needs is a
 * static method here, and the static block below fails when one is
 * missing.
 */
export class Customer extends AbstractCustomer {
  static {
    this.verify();
  }
}
