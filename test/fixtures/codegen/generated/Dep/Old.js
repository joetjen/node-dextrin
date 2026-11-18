// dextrin:schema dep/Old

import { AbstractOld } from './AbstractOld.js';

/**
 * The schema dep/Old. Its properties and methods come from
 * AbstractOld, which `dextrin gen-js` rewrites; this file is yours
 * and is never rewritten. A hand-written upgrade the schema needs is a
 * static method here, and the static block below fails when one is
 * missing.
 */
export class Old extends AbstractOld {
  static {
    this.verify();
  }
}
