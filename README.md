# dextrin_js

A Node.js port of [`dextrin`](https://github.com/joetjen/dextrin), an
Elixir implementation of DXN (Data eXchange Notation): a
human-writable text format (`.dxn`), a compact binary format
(`.dxnb`) built on CBOR, and a schema format (`.dxns`) — all three
sharing one in-memory value representation and one extension
mechanism.

**Status: early port, in progress.** The value model, the `.dxn` text
codec (`decode`/`encode`), and the `.dxnb` binary codec
(`decodeBinary`/`encodeBinary`) are implemented; `.dxns` schema
support lands in a later phase. See `CHANGELOG.md` for exactly what's
landed.

## Why a port, and why this value model

DXN's premise (see the Elixir project's own
[README](https://github.com/joetjen/dextrin#readme) for the full
case) is that a `.dxn` text document and a `.dxnb` binary document
are the *same* value space — scalar, collection, temporal, and
extended types precise enough for money, exact ratios, and
arbitrary-precision integers, with a schema-describable extension
story. `DXN.md` (ported here once the text/binary codecs land) is the
implementation-independent, normative spec; this library only needs
to satisfy it.

Where this library differs from the Elixir original, it's by design,
documented at the point of difference:

- Every DXN type decodes to a native JS value where one exists
  losslessly (`null`, `boolean`, `string`, `number` for `float`, a
  native `Map`/`Set`/`Array`, ...) and to a small `DXN*` wrapper class
  only where nothing native fits without losing information —
  mirroring the same design principle `dextrin`'s own `Dextrin.Value`
  follows, not necessarily the same type-by-type choice (see
  `src/values/` for each class's own rationale).
- `integer` is always `BigInt`, never `number` — JS `number` can't
  hold arbitrary precision the way Elixir's native integer does, so
  this is the one place fidelity requires a deviation from "closest
  native type."
- `float` needs *no* wrapper at all, unlike Elixir (which resorts to
  atoms for `NaN`/`Infinity`/`-Infinity` because the BEAM can't
  construct a non-finite float term) — JS `number` natively holds all
  of IEEE-754, so this is a case where the native JS type is a
  *better* fit than Elixir's own.
- Any wrapper class with a close-but-imperfect native JS counterpart
  ships two-way conversion helpers (`toX()` / `DXN*.fromX()`) rather
  than forcing you through the wrapper alone — e.g. `DXNRational.
  fromNumber()` (exact — every finite JS number is a binary fraction),
  `DXNOrderedMap.toMap()`/`.fromMap()`, `DXNRegex.toRegExp()` (guarded
  — only when no DXN-only flag is set).

## Value model

Every DXN type maps to either a native JS value or a small `DXN*`
wrapper class under `src/values/`. Full mapping table, including the
rationale for each wrapper-vs-native choice, lives in this project's
development plan for now and will move here as the port progresses.

```js
const { DXNRational, DXNUUID } = require('dextrin');

const r = new DXNRational(22n, 7n);
r.toNumber(); // => 3.142857142857143

DXNRational.fromNumber(0.5); // => DXNRational { numerator: 1n, denominator: 2n }

const id = DXNUUID.fromString('550e8400-e29b-41d4-a716-446655440000');
id.toString(); // => '550e8400-e29b-41d4-a716-446655440000'
```

## `.dxn` text

```js
const { decode, encode } = require('dextrin');

const value = decode('%{x: 1, y: 2}');
// => Map(2) { Symbol(x) => 1n, Symbol(y) => 2n }

encode(value);
// => '%{x:1,y:2}'

encode(value, { pretty: true });
// => '%{\n  x: 1\n  y: 2\n}'
```

`keyword` (`:name`) decodes as a real, global `Symbol.for(name)` by
default (`trusted: true`) — the closest native analog to a BEAM atom.
Pass `trusted: false` for any source you don't fully control; it then
decodes as `DXNKeyword` instead, the same way `Dextrin.Keyword` exists
on the Elixir side. `decode`/`encode` throw `DXNError` on failure —
see `src/error.cjs` for why that's a deliberate divergence from
`Dextrin`'s own `{:ok, _} | {:error, _}` tuples (an API-shape choice,
not a value-representation one).

No schema/registry support yet — every `struct` decodes as an opaque
`DXNStruct`, and every tag name other than the built-ins (`@uuid`,
`@duration`, `@ordered`, ...) decodes as `DXNCustomTag`. `.dxns` lands
in a later phase.

## `.dxnb` binary

```js
const { decode, decodeBinary, encodeBinary } = require('dextrin');

const value = decode('%{x: 1, y: 2}');
const bin = encodeBinary(value); // => Buffer, "DX" + version + CBOR
decodeBinary(bin); // => the same value back
```

Hand-rolled CBOR over `Buffer` (not built on a generic CBOR library —
bignum precision, timestamp integer-only encoding, and the private
tag block aren't things a generic library gets right by default; see
`src/binary/encoder.cjs`'s own doc). `decodeBinary` accepts documents
using the spec's value-sharing extensions (`DXN.md` §2.4/§2.5) even
though `encodeBinary` doesn't produce them yet — accepting is
spec-mandatory, producing is optional, and that asymmetry is
deliberate for now.

## Installation

```sh
npm install dextrin
```

(Not yet published — the API isn't stable until the text/binary
codecs land.)

## Development

```sh
npm install
npm run precommit
```

`npm run precommit` runs `tsc --checkJs --noEmit` (type-checking the
JSDoc annotations) followed by the full Mocha test suite — the check
this project expects to pass before every commit.

## License

MIT — see [LICENSE](LICENSE).
