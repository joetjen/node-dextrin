# node-dextrin

[![CI](https://github.com/joetjen/node-dextrin/actions/workflows/ci.yml/badge.svg)](https://github.com/joetjen/node-dextrin/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dextrin.svg)](https://www.npmjs.com/package/dextrin)

A Node.js port of [`dextrin`](https://github.com/joetjen/dextrin), an
Elixir implementation of DXN (Data eXchange Notation): a
human-writable text format (`.dxn`), a compact binary format
(`.dxnb`) built on CBOR, and a schema format (`.dxns`) — all three
sharing one in-memory value representation and one extension
mechanism. A sibling of [`php-dextrin`](https://github.com/joetjen/php-dextrin),
the PHP port of the same library.

**Status: feature-complete port, published to npm.** The value model,
the `.dxn` text codec, the `.dxnb` binary codec, the `.dxns` schema
system, the `dextrin` CLI, and the guides are all implemented. See
`CHANGELOG.md` for exactly what's landed.

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

With no `registry:` option, every `struct` decodes as an opaque
`DXNStruct`, and every tag name other than the built-ins (`@uuid`,
`@duration`, `@ordered`, ...) decodes as `DXNCustomTag` — see
`.dxns` schemas below for schema-backed decoding.

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

## `.dxns` schemas

```js
const { decode, encode, Schema, Registry } = require('dextrin');

const schemaDoc = decode(`
  %{
    Point: %schema{
      fields: @ordered %{ x: :float, y: :float }
    }
  }
`);
const registry = Schema.compile(schemaDoc, new Registry());

decode('%Point{x: 1.0, y: 2.0}', { registry });
// => { x: 1, y: 2 } -- schema-validated, decode-time enforcement

encode({ x: 1.0, y: 2.0 }, { registry, schema: 'Point' });
// => '%Point{x:1.0,y:2.0}'
```

A `struct`/tag with no matching registry entry still falls back to an
opaque `DXNStruct`/`DXNCustomTag` — a registry only ever *adds*
capability, never turns an otherwise-valid document into an error.

`encode`/`encodeBinary` automatically validate every registered
struct anywhere in a value by default (`validate: false` to skip),
and a `schema:` option additionally validates — and, for a nameless
plain value, *names* — the top-level value itself against one named
schema.

**Schema-driven coercion on encode** (`coerce:`, default `true`, no
Elixir `dextrin` equivalent) lets a field whose value doesn't already
match its declared type be coerced toward it first, reusing the same
`DXN*.fromX()` conversion helpers documented above — a plain `number`
becomes a `DXNRational` for a `:rational` field, a native `Date`
becomes a `DXNDate` for a `:date` field, and so on, recursively
through `list-of`/`set-of`/`tuple-of`/`nilable`/`one-of` too. Pass
`coerce: false` for strict validation with no silent conversion (see
`src/schema/coercion.cjs`).

```js
encode({ x: 1, y: 2 }, { registry, schema: 'Point' });
// x/y are plain numbers already matching :float -- no coercion needed here,
// but a :rational/:decimal/:uuid/:date/... field would accept the
// closest native JS shape the same way.
```

Also included, each mirroring its `Dextrin.Schema.*` counterpart:
`Schema.registerProvider` (let a class's own library ship its schema
without depending on `dextrin`, see `src/schema/provider.cjs`),
`Std.registry()`'s standard library of common named types
(`PositiveInteger`, `NonEmptyString`, ...), and
`FileResolver.forPaths([...])`'s `Namespace/Name` → `.dxns`-file
resolver for `Registry#putResolver`:

```js
const { decode, Schema, Registry, Std, FileResolver } = require('dextrin');

const withStd = Std.registry(); // PositiveInteger, NonEmptyString, ...
const registry = Schema.compile(decode('%{ Age: PositiveInteger }'), withStd);

const fileBackedRegistry = new Registry().putResolver(FileResolver.forPaths(['./schemas']));
```

## CLI

```sh
npx dextrin decode data.dxnb                                       # -> pretty-printed .dxn text
npx dextrin encode data.dxn --out data.dxnb                         # -> .dxnb binary
npx dextrin format data.dxn --mode pretty|condense [--in-place]
npx dextrin validate data.dxn [--schema schema.dxns --as Name]
```

## Guides

- [Tutorial](guides/TUTORIAL.md) — a walkthrough of the JS API, every
  snippet verified to actually run.
- [Examples](guides/EXAMPLES.md) — worked scenarios (config files,
  schema-backed API payloads, cross-file schemas, third-party schema
  providers, ...).
- [Cheatsheet](guides/CHEATSHEET.md) — quick API/type/CLI lookups.
- [DXN reference](guides/dxn/DXN.md) — the full, implementation
  -independent format specification, plus its own
  [tutorial](guides/dxn/TUTORIAL.md),
  [examples](guides/dxn/DXN_EXAMPLES.md), and
  [cheatsheet](guides/dxn/DXN_CHEATSHEET.md) for the format itself.

## Installation

```sh
npm install dextrin
```

## Other language implementations

DXN's format spec ([`dxn/DXN.md`](guides/dxn/DXN.md), ported from the
Elixir project's own `guides/dxn/DXN.md`) is implementation-independent
— this library, `dextrin` (Elixir), and `php-dextrin` all satisfy the
same document, and stay close to `dextrin`'s own in-memory
shape-per-type choices wherever their host language allows.

| Language | Package | Source |
| --- | --- | --- |
| Elixir | [`dextrin` on Hex.pm](https://hex.pm/packages/dextrin) | [joetjen/dextrin](https://github.com/joetjen/dextrin) |
| Node.js (this project) | [`dextrin` on npm](https://www.npmjs.com/package/dextrin) | [joetjen/node-dextrin](https://github.com/joetjen/node-dextrin) |
| PHP | [`joetjen/dextrin` on Packagist](https://packagist.org/packages/joetjen/dextrin) | [joetjen/php-dextrin](https://github.com/joetjen/php-dextrin) |

## Development

```sh
npm install
npm run precommit
```

`npm run precommit` runs `tsc --checkJs --noEmit` (type-checking the
JSDoc annotations) followed by the full Mocha test suite — the check
this project expects to pass before every commit.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes, and
[CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT — see [LICENSE](LICENSE).
