// dextrin:schema dep/Item

import { AbstractItem } from './AbstractItem.js';

/**
 * The schema dep/Item. Its properties and methods come from
 * AbstractItem, which `dextrin gen-js` rewrites; this file is yours
 * and is never rewritten. A hand-written upgrade the schema needs is a
 * static method here, and the static block below fails when one is
 * missing.
 */
export class Item extends AbstractItem {
  static {
    this.verify();
  }
}
