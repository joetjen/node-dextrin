// dextrin:schema acme.shop/Order

import { AbstractOrder } from './AbstractOrder.js';

/**
 * The schema acme.shop/Order. Its properties and methods come from
 * AbstractOrder, which `dextrin gen-js` rewrites; this file is yours
 * and is never rewritten. A hand-written upgrade the schema needs is a
 * static method here, and the static block below fails when one is
 * missing.
 */
export class Order extends AbstractOrder {
  static {
    this.verify();
  }
}
