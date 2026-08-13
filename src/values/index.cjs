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
 *   | import('./timestamp.cjs')
 *   | import('./date-time.cjs')
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

module.exports = {
  DXNChar: require('./char.cjs'),
  DXNSymbol: require('./symbol.cjs'),
  DXNKeyword: require('./keyword.cjs'),
  DXNList: require('./list.cjs'),
  DXNTuple: require('./tuple.cjs'),
  DXNOrderedMap: require('./ordered-map.cjs'),
  DXNSortedSet: require('./sorted-set.cjs'),
  DXNStruct: require('./struct.cjs'),
  DXNDecimal: require('./decimal.cjs'),
  DXNRational: require('./rational.cjs'),
  DXNDate: require('./date.cjs'),
  DXNTime: require('./time.cjs'),
  DXNTimestamp: require('./timestamp.cjs'),
  DXNDateTime: require('./date-time.cjs'),
  DXNDuration: require('./duration.cjs'),
  DXNUUID: require('./uuid.cjs'),
  DXNURI: require('./uri.cjs'),
  DXNBytes: require('./bytes.cjs'),
  DXNRegex: require('./regex.cjs'),
  DXNCustomTag: require('./custom-tag.cjs'),
  ...require('./equality.cjs')
};
