import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dxnEquals, dxnCompare, canonicalKey, kindOf, KIND_RANK } = require('./equality.cjs');

export { dxnEquals, dxnCompare, canonicalKey, kindOf, KIND_RANK };
