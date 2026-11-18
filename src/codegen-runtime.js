// The ES module entry of `@joetjen/dextrin/codegen-runtime`: the CommonJS
// one, re-exported, as every other `.js` file here is its `.cjs`.
import InvalidData from './codegen/invalid-data.cjs';
import Runtime from './codegen/runtime.cjs';

/** @typedef {import('./codegen/runtime.cjs').ReadOptions} ReadOptions */
/** @typedef {import('./codegen/runtime.cjs').Fields} Fields */

export { InvalidData, Runtime };
