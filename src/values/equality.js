// The ES module face of equality.cjs, as every other `.js` here is its
// `.cjs`: an `import` of it, which Node and every bundler resolve alike.
// It reached the module through `createRequire(import.meta.url)`, which a
// bundle written as CommonJS has no value for.
import equality from './equality.cjs';

export const { dxnEquals, dxnCompare, canonicalKey, kindOf, KIND_RANK } = equality;
