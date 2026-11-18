// The ES module entry: the CommonJS one, re-exported, as every other
// `.js` file here is its `.cjs`.
//
// **One implementation, not two.** This kept its own copies of decode,
// encode, decodeBinary and encodeBinary, reaching the rest through
// `createRequire(import.meta.url)` -- which a bundler writing CommonJS
// (the DXN VS Code extension's esbuild) cannot give it, so the bundle
// broke at load. An `import` of the `.cjs` is what Node and every bundler
// resolve alike.
import dextrin from './dextrin.cjs';

export const {
  version,
  decode,
  encode,
  decodeBinary,
  encodeBinary,
  canonical,
  answer,
  DXNError,
  Registry,
  Schema,
  Std,
  FileResolver,
  Format,
  SchemaDocs,
  SchemaTree,
  SchemaLayout,
  JsonSchema,
} = dextrin;
// Typed as the CommonJS one's: inferred, its declaration would name the
// document module's typedefs where they are not in scope, and fail to
// compile for a TypeScript user who checks libraries.
/** @type {typeof dextrin.Document} */
export const Document = dextrin.Document;
export * from './values/index.js';
export default dextrin;
