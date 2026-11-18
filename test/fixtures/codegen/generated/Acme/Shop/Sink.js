// dextrin:schema acme.shop/Sink

import { AbstractSink } from './AbstractSink.js';

/**
 * The schema acme.shop/Sink. Its properties and methods come from
 * AbstractSink, which `dextrin gen-js` rewrites; this file is yours
 * and is never rewritten. A hand-written upgrade the schema needs is a
 * static method here, and the static block below fails when one is
 * missing.
 */
export class Sink extends AbstractSink {
  static {
    this.verify();
  }
}
