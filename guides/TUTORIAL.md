# Tutorial

A step-by-step walkthrough of `dextrin`'s features, building up to a
small, complete example: decoding a config file, validating it against
a schema, and re-encoding it to both text and binary. If you want the
DXN *format itself* explained independently of this JS implementation,
see the [DXN tutorial](dxn/TUTORIAL.md) instead — this one assumes you
already roughly know what `.dxn` text looks like and focuses on the JS
API around it.

## 1. Decoding and encoding text

```js
const { decode, encode } = require('dextrin');

const value = decode('%{name: "Ada", active: true, score: 19.99M}');
//=> Map(3) {
//     Symbol(name) => 'Ada',
//     Symbol(active) => true,
//     Symbol(score) => DXNDecimal { sign: 1, unscaledValue: 1999n, exponent: -2 }
//   }

encode(value);
//=> '%{name:"Ada",active:true,score:19.99M}'
```

Notice the map's keys: a plain map's shorthand keys (`name:`) are
themselves DXN `keyword`s, not bare strings — `%{name: "Ada"}` and
`%{:name => "Ada"}` are the exact same value, and `keyword`'s own JS
type (`DXN.md` §1.3) is a real, global `Symbol.for(name)`, which is
what `decode` produces by default (`trusted: true`) — the closest
native analog to a BEAM atom, and like an atom, never garbage
collected. Pass `trusted: false` for input you don't fully control —
untrusted `.dxn`/`.dxnb` must never be able to exhaust the global
symbol registry via an unbounded `Symbol.for` — and `keyword` decodes
as `DXNKeyword` instead:

```js
decode('%{name: "Ada"}', { trusted: false });
//=> Map(1) { DXNKeyword { name: 'name' } => 'Ada' }
```

A schema-backed `struct`'s fields are the one place names *do* come
back as plain strings regardless of `trusted:` (§6 below), since a
schema always knows its field names up front.

Both directions throw `DXNError` rather than returning a result value
— `decode` throws on malformed input, `encode` throws on a value it
can't represent or that fails schema validation. This is a deliberate
API-shape divergence from Elixir's `{:ok, _} | {:error, _}` tuples,
idiomatic JS instead (`JSON.parse` and most YAML/TOML parsers already
throw the same way); it isn't a value-representation choice, so it
doesn't affect anything else in this tutorial.

```js
try {
  decode('%{x: }');
} catch (err) {
  console.log(err.message); //=> 'unexpected token RBRACE'
  console.log(err.offset);  //=> 5
}
```

## 2. What a decoded value looks like

Every DXN type maps to a plain, native JS value where one exists, and
to a small wrapper class only where nothing native fits without losing
information:

```js
decode('some-symbol');
//=> DXNSymbol { name: 'some-symbol' }

decode(':ok');
//=> Symbol(ok)

decode('{1 2 3}');
//=> DXNTuple { items: [ 1n, 2n, 3n ] }

decode('@ordered %{b: 2, a: 1}');
//=> DXNOrderedMap { pairs: [ [ Symbol(b), 2n ], [ Symbol(a), 1n ] ] }
```

Two things worth noticing right away:

- **`integer` always decodes as `BigInt`**, never `number` — `1` is
  `1n`. This mirrors DXN's own arbitrary-precision guarantee instead
  of silently losing precision past `2**53`; it's a deliberate
  fidelity-over-ergonomics deviation, and it means integer literals
  you hand-construct for `encode` (§5 below) need the `n` suffix too.
- `symbol` always wraps a plain JS `string`, never a `Symbol` — the
  same "decoding untrusted data can never exhaust an interning table"
  concern as `keyword`, except `symbol` has no `trusted:`-controlled
  escape hatch at all, since nothing about it should ever need one.

`keyword` is the one type with two faces, controlled by `trusted:`
(default `true`): a real `Symbol.for(name)`, as shown above, or
`DXNKeyword` when decoded untrusted. See the `DXNValue` typedef in
[`src/values/index.cjs`](../src/values/index.cjs) for the complete
type-to-shape mapping, and each wrapper class's own file for
conversion helpers (`toX()`/`DXN*.fromX()`) to and from the closest
native JS equivalent, where one exists.

## 3. Round-tripping through `.dxnb`

```js
const { decodeBinary, encodeBinary } = require('dextrin');

const bytes = encodeBinary(value);
const back = decodeBinary(bytes);
```

`.dxnb` is CBOR underneath, with a 3-byte envelope (`"DX"` + a version
byte) in front for cheap magic-number sniffing. Note one asymmetry:
`decodeBinary` fully understands DXN's value-sharing extension (a
repeated compound value written once and referenced afterward) when
it encounters it on the wire, but `encodeBinary` doesn't yet *produce*
shared references — every value round-trips correctly either way, just
not always at the smallest possible byte count for heavily-repeated
data. There is no Elixir `dextrin` equivalent for this note, since its
own encoder does produce them (`share:` option) — it's called out here
because it's a real gap this port hasn't closed yet.

## 4. Formatting

`encode` defaults to the smallest text a value can round-trip through:
single-line, minimal whitespace, no line-wrapping or indentation at
all. Pass `pretty: true` for human-readable, multi-line output instead
— e.g. for a CLI or a config file you're about to commit:

```js
const value = decode('%{name: "Ada", tags: @{:admin :staff}}');

encode(value, { pretty: true });
//=> '%{\n  name: "Ada"\n  tags: @{\n    :admin\n    :staff\n  }\n}'
```

`indent:` sets the number of spaces per nesting level (default 2):

```js
encode(value, { pretty: true, indent: 4 });
//=> '%{\n    name: "Ada"\n    tags: @{\n        :admin\n        :staff\n    }\n}'
```

`pretty`/`indent` only change *rendering* — the value `decode` gets
back is identical either way. Schema validation (§6 below) runs the
same regardless too; it's an independent concern from formatting.
`pretty: true` calls `src/text/formatter.cjs`'s `pretty` under the
hood, which is also directly callable on its own (the CLI's `dextrin
format --mode pretty` uses it that way, without going through
`encode`'s own validation).

Comments are never preserved by either path — `.dxn`'s lexer discards
`#`-comments as trivia before the parser ever sees them, so there's no
comment text left by the time a value exists to reprint.

## 5. Extending: custom tags

`@tag value` is DXN's open extension point for a scalar-wrapping type
with no field structure. Register a decoder and (optionally) an
encoder on a `Registry`:

```js
const { Registry } = require('dextrin');

class Money {
  constructor(cents) {
    this.cents = cents;
  }
}

const registry = new Registry()
  .putTag('my-app/money', (cents) => new Money(cents))
  .putTagEncoder(Money, 'my-app/money', (money) => money.cents);

decode('@my-app/money 500', { registry });
//=> Money { cents: 500n }

encode(new Money(500n), { registry });
//=> '@my-app/money 500'
```

With no registration at all, `@my-app/money 500` decodes to an opaque
`DXNCustomTag { name: 'my-app/money', value: 500n }` instead of
failing — the same "opaque tagged value, not an error" contract DXN
gives every unrecognized tag.

## 6. Extending: schemas for `struct`

`struct` is DXN's field-structured extension point, and it's
schema-dependent by design: without a compiled schema, `%Point{x: 1,
y: 2}` decodes to an opaque `DXNStruct`. A `.dxns` schema document is
itself just DXN data — no new grammar, no new parser:

```js
const { Schema } = require('dextrin');

const schemaDoc = decode(`
%{
  Point: %schema{ x: :integer, y: :integer }
}
`);

const registry = Schema.compile(schemaDoc, new Registry());

decode('%Point{x: 1, y: 2}', { registry });
//=> DXNStruct { name: 'Point', version: 1, fields: { type: 'keyed', pairs: [['x', 1n], ['y', 2n]] } }
```

With no materializer registered, a checked struct comes back as a
generic `DXNStruct` at its schema's latest version, its fields in the
schema's order — which encodes back to exactly the text it came from.

Field enforcement (required/optional fields, refinements) happens
automatically at decode time, in both `decode`
and `decodeBinary` — a violation comes back as an ordinary thrown
`DXNError`, indistinguishable by shape from a syntax error:

```js
try {
  decode('%Point{x: 1}', { registry });
} catch (err) {
  console.log(err.message);
  //=> 'struct "Point" violates its schema: missing required field "y"'
}
```

Encoding checks the same thing, automatically, in the other direction
— every `DXNStruct` (or registered application class instance)
anywhere in the value you're encoding gets checked against its own
schema before anything is written:

```js
const { DXNStruct } = require('dextrin');

const bad = DXNStruct.keyed('Point', [['x', 1n]]);
encode(bad, { registry });
//=> throws DXNError: struct "Point" violates its schema: missing required field "y"
```

Pass `validate: false` to skip this (test fixtures, deliberately
building non-conforming data, a pass-through that shouldn't
second-guess data it isn't the origin of).

## 7. Materializing real JS classes

By default a checked struct comes back as a generic `DXNStruct`.
Register a materializer to produce your own class instance instead:

```js
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

// One materializer per schema, called for every decoded struct of it,
// with the schema's name, the version the struct was written with and
// its fields; what it answers is checked against the latest schema.
const registry2 = registry.putStructMaterializer('Point', (_name, _version, { x, y }) => new Point(x, y));

decode('%Point{x: 1, y: 2}', { registry: registry2 });
//=> Point { x: 1n, y: 2n }
```

To let `{form: 'reference', name: 'Point'}` type-checks and automatic
encode-time validation recognize `Point` instances you build yourself
(never decoded), also declare the class:

```js
const registry3 = registry2.putStructModule('Point', Point);
```

This also lets you encode a `Point` instance directly — no need to
hand-build a `DXNStruct` first:

```js
encode(new Point(1n, 2n), { registry: registry3 });
//=> '%Point(1){x:1,y:2}'
```

The `(1)` is the schema's version; §8 is about what it is for.

`Registry` is updated immutable-style — every `put*` method returns a
*new* `Registry`, never mutates the one it's called on — so build up
the registry you need through a chain of these calls (as above) or by
reassigning, not by expecting an earlier reference to change under
you.


### Fields a schema does not declare

A struct guarantees the fields its schema declares and may carry more.
A field the schema does not know is kept as an **extra field**, in the
struct's `extra` list, and written back with it — so a newer producer's
fields pass through an older reader instead of being lost:

```js
decode('%Point{x: 1, y: 2, label: "origin"}', { registry });
//=> DXNStruct { name: 'Point', version: 1, fields: { type: 'keyed', pairs: [['x', 1n], ['y', 2n]] }, extra: [['label', 'origin']] }
```

A positional struct writes its extras as entries after its items,
`%Point[1 2 label: "origin"]`, and `.dxnb` as one trailing map. An extra
never shadows a declared field — `%Point{x: 1, "x" => 2}` is refused —
and a materializer receives the extras with the declared fields. Pass
`strict: true` to refuse every extra field instead
(`schema/undeclared-field`): right for a config file written by hand,
where an unknown field is a typo.

## 8. Evolving a schema

A schema changes; data written with the old one does not. Each `.dxns`
document describes one **version** of each schema in it — no header
is version 1, `%schema(2){...}` is version 2 — and a registry holds as
many versions of `Point` side by side as you load:

```js
const load = (sources) => sources.reduce((registry, source) => Schema.compile(decode(source), registry), new Registry());

const v1 = '%{Point: %schema{x: :integer, y: :integer}}';
const v2 = '%{Point: %schema(2){x: :integer, y: :integer, label?: :string}}';
```

**Every struct is written with the latest version loaded**, so a
reader always knows which shape it is looking at:

```js
const point = decode('%Point{x: 1, y: 2, label: "origin"}', { registry: load([v2]) });
encode(point, { registry: load([v2]) });
//=> '%Point(2){x:1,y:2,label:"origin"}'
```

A struct written without a version, `%Point{...}` — mostly text written
by hand — is read as the latest.

### A newer writer, an older reader

A reader that has only version 1 reads version 2 against what it has.
Text matches fields by name, and a field it does not know is kept as an
extra field (§7), so it travels on:

```js
decode('%Point(2){x: 1, y: 2, label: "origin"}', { registry: load([v1]) });
//=> DXNStruct { name: 'Point', version: 1, fields: { type: 'keyed', pairs: [['x', 1n], ['y', 2n]] }, extra: [['label', 'origin']] }
```

`.dxnb` has no names, only positions: the reader takes as many items
as it has fields and drops the rest, so the same point read from binary
comes back without its `label`. Every field the reader requires must be
there, with the right type, either way.

### An older writer, a newer reader

A reader whose latest is version 2 cannot read version 1 as though it
were version 2 — that would be a guess — so it refuses, unless the
schema has a materializer to upgrade it:

```js
decode('%Point(1){x: 1, y: 2}', { registry: load([v1, v2]) });
// throws DXNError, category 'schema/no-materializer'

const registry = load([v1, v2]).putStructMaterializer('Point', (_name, version, fields) =>
  version === 1
    ? DXNStruct.keyed('Point', [['x', fields.x], ['y', fields.y], ['label', 'unnamed']], 2)
    : DXNStruct.keyed('Point', [['x', fields.x], ['y', fields.y], ['label', fields.label]], 2));

decode('%Point(1){x: 1, y: 2}', { registry });
//=> DXNStruct { name: 'Point', version: 2, fields: { type: 'keyed', pairs: [['x', 1n], ['y', 2n], ['label', 'unnamed']] } }
```

The materializer is called for every `Point`, whatever its version, and
what it answers is checked against the latest. That is why the version
needs loading: an older version that is not loaded is refused
(`schema/unknown-version`), because without its schema there are no
field names to hand the materializer.

### The one thing that goes wrong silently

**Reading forward in `.dxnb` trusts the positions.** Suppose version 3
only swaps two fields:

```js
const v3 = '%{Point: %schema(3){y: :integer, x: :integer, label?: :string}}';

const p3 = decode('%Point{x: 1, y: 2, label: "a"}', { registry: load([v3]) });
decodeBinary(encodeBinary(p3, { registry: load([v3]) }), { registry: load([v2]) });
//=> DXNStruct { name: 'Point', version: 2, fields: { type: 'keyed', pairs: [['x', 2n], ['y', 1n], ['label', 'a']] } }
```

The version 2 reader has `x` and `y` the wrong way round, and nothing
said so: both are integers. Text, read by name, gets it right. So a
schema whose older readers must keep working **only ever appends**
fields; reordering, inserting or removing one is for when every reader
has the new version — deploy readers first (`DXN.md` §4.8).

### Checking a change before it ships

`dextrin compat` compares the previous release's schema files with the
current ones, for CI. It fails when a version's content changed without
a new version, or when a version went down, and lists what the latest
version's materializer has to upgrade from each older one:

```sh
$ npx dextrin compat schemas-v1.4.0/ schemas/
Point 1 -> 3: added label
Point 2 -> 3: no field changes
OK: no version discipline problems
```

`Schema.compat(oldRegistry, newRegistry)` answers the same as data.

## 9. Named types and the standard library

Any `.dxns` entry that *isn't* a `%schema{}` defines a reusable named
type instead — purely data, composing the fixed type_expr vocabulary:

```js
const doc = decode(`
%{
  PositiveInt: {:refine :integer %{min: 1}}
  Point: %schema{ x: PositiveInt, y: :integer }
}
`);
```

`Std` ships a small library of common named types
(`PositiveInteger`, `NonEmptyString`, `Percentage`, ...) — pass its
registry as `compile`'s base registry to use them:

```js
const { Std } = require('dextrin');

const registry4 = Schema.compile(doc, Std.registry());
```

## 10. Letting a third-party class provide its own schema

Everything so far assumed you write the `.dxns` schema yourself. If
`Point` instead came from a library that doesn't want to (and
shouldn't have to) depend on `dextrin`, that library can ship a small,
separately-required companion module implementing the
`DXNSchemaProvider` shape — a plain object, duck-typed and structurally
checked by `tsc --checkJs` for anyone implementing it, not a formal
interface/class hierarchy (Node has no compile-time-dependency concern
the way Mix does, so there's no ceremony to guard here):

```js
// the library's own point-dxn.js companion module
class LibPoint {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const PointProvider = {
  dxnSchema: () => '%{ Point: %schema{ x: :integer, y: :integer } }',
  dxnSchemaName: () => 'Point',
  dxnClass: () => LibPoint,
  dxnMaterialize: (_name, _version, { x, y }) => new LibPoint(x, y),
};
```

An application depending on both the library and `dextrin` registers
it in one call, wherever it's already building its registry:

```js
const registry5 = Schema.registerProvider(new Registry(), PointProvider, Schema.compile);

decode('%Point{x: 1, y: 2}', { registry: registry5 });
//=> LibPoint { x: 1n, y: 2n }
encode(new LibPoint(1n, 2n), { registry: registry5 });
//=> '%Point(1){x:1,y:2}'
```

`dxnMaterialize` is optional — without it, decoding falls back to the
same generic `DXNStruct` any other schema with no materializer
produces.

## 11. Putting it together: a small config loader

```js
const fs = require('node:fs');

const schemaSource = `
%{
  Server: %schema{
    host:  NonEmptyString
    port:  {:refine :integer %{min: 1, max: 65535}}
    tags?: {:list-of :symbol}
  }
}
`;

function buildRegistry() {
  const doc = decode(schemaSource);
  return Schema.compile(doc, Std.registry());
}

function load(path) {
  const source = fs.readFileSync(path, 'utf8');
  return decode(source, { registry: buildRegistry() });
}
```

No separate validation step is needed here — the registry `load`
builds already has `Server`'s schema compiled into it, so `decode`
itself enforces every field, automatically, as part of decoding (§6).
A malformed config file throws an ordinary `DXNError` from `load`
directly, not something the caller has to separately check for.

```
# config.dxn
%Server{
  host: "localhost"
  port: 4000
  tags: [dev local]
}
```

```js
load('config.dxn');
//=> DXNStruct { name: 'Server', version: 1, fields: { type: 'keyed', pairs: [
//     ['host', 'localhost'],
//     ['port', 4000n],
//     ['tags', DXNList { items: [ DXNSymbol { name: 'dev' }, DXNSymbol { name: 'local' } ] }]
//   ] } }
```

`tags` decodes as a `DXNList`, not a native `Array` — DXN's `list`
(`[ ... ]`) and `array` (`@array[ ... ]`) are distinct types, and this
port keeps them distinct in JS too: `array` claims native `Array`
(the obvious name pairing), so `list` gets this thin wrapper instead.
Call `.toArray()` on it to get a plain `Array` back.

From here: [Examples](EXAMPLES.md) for more worked scenarios, the
[Cheatsheet](CHEATSHEET.md) for quick lookups, and the
[DXN reference](dxn/DXN.md) for the full format specification.
