// dextrin:schema dep/Box

import { AbstractBox } from './AbstractBox.js';

/**
 * The schema dep/Box. Its properties and methods come from
 * AbstractBox, which `dextrin gen-js` rewrites; this file is yours
 * and is never rewritten. A hand-written upgrade the schema needs is a
 * static method here, and the static block below fails when one is
 * missing.
 */
export class Box extends AbstractBox {
  static {
    this.verify();
  }
}
