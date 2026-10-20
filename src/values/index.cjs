'use strict';

/**
 * @fileoverview Barrel module for the DXN value model — every wrapper
 * class plus the shared equality/ordering kernel, and the closed
 * `DXNValue` type union documenting every shape a decoded DXN value
 * can take. Mirrors `Dextrin.Value`'s own moduledoc structure: one JS
 * shape per DXN type, preferring a native value and falling back to a
 * `DXN*` wrapper only where nothing native fits without losing
 * information (see each class's own JSDoc for why).
 *
 * Two shapes are worth calling out here, the same way `Dextrin.Value`
 * calls out its own non-obvious ones:
 *
 *   - `integer` is always `BigInt`, never `number` — the one place
 *     fidelity to Elixir's arbitrary-precision guarantee requires
 *     *not* picking the closest-looking native type.
 *   - `float` is a plain `number`, including `NaN`/`Infinity`/
 *     `-Infinity` — unlike Elixir, which needs atoms for those three
 *     because the BEAM can't construct a non-finite float term. JS
 *     `number` natively holds all of IEEE-754, so no wrapper is
 *     needed here at all; this is a case where JS's native type is a
 *     *better* fit than Elixir's own.
 *
 * `Map`/`Set` are typed `<unknown, unknown>`/`<unknown>` rather than
 * `<DXNValue, DXNValue>`/`<DXNValue>` — TS's JSDoc `@typedef`
 * circularity checker tolerates self-reference through a plain
 * array/union position (`DXNValue[]`, below) but not through a
 * generic type argument; this is a checker limitation, not a real
 * type-precision loss anyone should try to "fix" back.
 * @typedef {null
 *   | boolean
 *   | bigint
 *   | number
 *   | import('./decimal.cjs')
 *   | import('./rational.cjs')
 *   | string
 *   | import('./char.cjs')
 *   | import('./symbol.cjs')
 *   | symbol
 *   | import('./keyword.cjs')
 *   | import('./list.cjs')
 *   | import('./tuple.cjs')
 *   | Map<unknown, unknown>
 *   | import('./ordered-map.cjs')
 *   | Set<unknown>
 *   | import('./sorted-set.cjs')
 *   | import('./struct.cjs')
 *   | DXNArray
 *   | import('./date.cjs')
 *   | import('./time.cjs')
 *   | import('./date-time.cjs')
 *   | import('./local-date-time.cjs')
 *   | import('./duration.cjs')
 *   | import('./uuid.cjs')
 *   | import('./uri.cjs')
 *   | import('./bytes.cjs')
 *   | import('./regex.cjs')
 *   | import('./custom-tag.cjs')} DXNValue
 *
 * DXN `array` (native JS `Array`) — split into its own named alias
 * rather than inlined as `DXNValue[]` directly inside the union above:
 * TS's JSDoc `@typedef` circularity checker rejects a typedef whose
 * own body contains its own name (`DXNValue[]` inside `DXNValue`
 * itself), even though the equivalent mutual recursion through a
 * second name — this indirection — is fine and resolves correctly.
 * @typedef {DXNValue[]} DXNArray
 */

// One name at a time, not one object: `tsc` declares a class exported
// this way as a type as well as a value, so a TypeScript user can write
// `x: DXNStruct` (`npm run types`); an object's members are values only.
const DXNChar = require('./char.cjs');
const DXNSymbol = require('./symbol.cjs');
const DXNKeyword = require('./keyword.cjs');
const DXNList = require('./list.cjs');
const DXNTuple = require('./tuple.cjs');
const DXNOrderedMap = require('./ordered-map.cjs');
const DXNMap = require('./map.cjs');
const DXNSortedSet = require('./sorted-set.cjs');
const DXNStruct = require('./struct.cjs');
const DXNDecimal = require('./decimal.cjs');
const DXNRational = require('./rational.cjs');
const DXNDate = require('./date.cjs');
const DXNTime = require('./time.cjs');
const DXNDateTime = require('./date-time.cjs');
const DXNLocalDateTime = require('./local-date-time.cjs');
const DXNDuration = require('./duration.cjs');
const DXNUUID = require('./uuid.cjs');
const DXNURI = require('./uri.cjs');
const DXNBytes = require('./bytes.cjs');
const DXNBits = require('./bits.cjs');
const DXNRegex = require('./regex.cjs');
const DXNCustomTag = require('./custom-tag.cjs');
const { dxnEquals, dxnCompare, canonicalKey, kindOf, KIND_RANK } = require('./equality.cjs');

module.exports.DXNChar = DXNChar;
module.exports.DXNSymbol = DXNSymbol;
module.exports.DXNKeyword = DXNKeyword;
module.exports.DXNList = DXNList;
module.exports.DXNTuple = DXNTuple;
module.exports.DXNOrderedMap = DXNOrderedMap;
module.exports.DXNMap = DXNMap;
module.exports.DXNSortedSet = DXNSortedSet;
module.exports.DXNStruct = DXNStruct;
module.exports.DXNDecimal = DXNDecimal;
module.exports.DXNRational = DXNRational;
module.exports.DXNDate = DXNDate;
module.exports.DXNTime = DXNTime;
module.exports.DXNDateTime = DXNDateTime;
module.exports.DXNLocalDateTime = DXNLocalDateTime;
module.exports.DXNDuration = DXNDuration;
module.exports.DXNUUID = DXNUUID;
module.exports.DXNURI = DXNURI;
module.exports.DXNBytes = DXNBytes;
module.exports.DXNBits = DXNBits;
module.exports.DXNRegex = DXNRegex;
module.exports.DXNCustomTag = DXNCustomTag;
module.exports.dxnEquals = dxnEquals;
module.exports.dxnCompare = dxnCompare;
module.exports.canonicalKey = canonicalKey;
module.exports.kindOf = kindOf;
module.exports.KIND_RANK = KIND_RANK;
