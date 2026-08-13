# dextrin_js

A Node.js port of [`dextrin`](https://github.com/joetjen/dextrin), an
Elixir implementation of DXN (Data eXchange Notation): a
human-writable text format (`.dxn`), a compact binary format
(`.dxnb`) built on CBOR, and a schema format (`.dxns`) — all three
sharing one in-memory value representation and one extension
mechanism.

**Status: early port, in progress.** The `.dxn`/`.dxnb`/`.dxns`
pipelines aren't implemented yet — this repo currently has the core
value model only (see below). Follow-on work adds the text codec,
binary codec, and schema system in that order; see `CHANGELOG.md` for
what's landed.

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
