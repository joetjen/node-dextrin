# Cheatsheet

Quick reference for common `dextrin` tasks. See the
[tutorial](TUTORIAL.md) if anything here doesn't make sense yet, or
the [DXN cheatsheet](dxn/DXN_CHEATSHEET.md) for format-syntax-level
lookups.

## Decode / encode

```js
decode(text, opts = {})            //=> value, throws DXNError
encode(value, opts = {})           //=> text,  throws DXNError
decodeBinary(bytes, opts = {})     //=> value, throws DXNError
encodeBinary(value, opts = {})     //=> Buffer, throws DXNError
```

`opts`: `registry:` (a `Registry`, both directions), `schema:` (encode
only — validate the top-level value against one named schema),
`validate:` (encode only, default `true` — set `false` to skip the
automatic whole-tree schema check; nothing is ever converted to match
a field's type, `DXN.md` §4.7), `strict:` (decode only — refuse extra
fields on schema-backed structs), `pretty:` (`encode` only,
default `false` — multi-line, indented output instead of
single-line/compact), `indent:` (`encode` only, meaningful with
`pretty: true` — spaces per nesting level, default 2), `trusted:`
(decode only, default `false` — `keyword` decodes as `DXNKeyword`, so
`Symbol.for` is never reachable from the input; `true`, for a source
you control, decodes it as a real, global `Symbol.for(name)`).

## Render an error

```js
try {
  decode(badText);
} catch (err) {
  console.log(err.message);
  console.log(err.offset); // byte/char offset, when available
}
```

`err` is a `DXNError` (extends `Error`) for every failure mode —
text-parse, printing, binary, and schema alike — so one `catch` covers
all of `decode`/`encode`/`decodeBinary`/`encodeBinary`.

## Pretty-print / reformat

```js
encode(value, { pretty: true });              // multi-line, indented
encode(value, { pretty: true, indent: 4 });    // 4 spaces per level instead of the default 2
```

Compact is `encode`'s default — the smallest text a value can
round-trip through, no line-wrapping or indentation at all. `pretty:`
only changes rendering, never what the value decodes back to.

```sh
dextrin format data.dxn --mode pretty|condense [--in-place]
```

## Documents: keeping comments

```js
let doc = Document.parse(source, opts);                 // decode's opts and errors
Document.toValue(doc);                                  // what decode gives
Document.render(doc);                                   // the source, byte for byte
Document.format(doc);                                   // laid out, comments kept
doc = Document.replace(doc, [Symbol.for('version')], '2.0.0');
doc = Document.delete(doc, [Symbol.for('deps'), 0]);    // with its own comments
doc = Document.insert(doc, [Symbol.for('deps')], -1, 'new');  // index, or a map's new key
const { doc: updated, changes } = Document.update(doc, newValue, { onAmbiguity: 'safe' });
```

## Value-type cheatsheet

```text
symbol      DXNSymbol{name}                        bare identifier, e.g. `foo`
keyword     DXNKeyword (default) / Symbol.for(name) `:foo` / `foo:` (key position) — trusted: true for the latter
list        DXNList{items}                         `[1 2 3]` — distinct from array
tuple       DXNTuple{items}                        `{1 2 3}` — arbitrary length
array       Array (native)                         `@array[1 2 3]` — the obvious native-type pairing
ordered-map DXNOrderedMap{pairs}                    `@ordered %{...}` — order is part of identity
sorted-set  DXNSortedSet{items}                     `@sorted-set @{...}` — always sorted, deduped
struct      DXNStruct{name, fields}                 `%Name{...}` / `%Name[...]`, opaque w/o schema
duration    DXNDuration{years, months, ...}         `@duration "P1Y2M"` — 7 independent fields
rational    DXNRational{numerator, denominator}     `22/7` — stored exactly, never auto-reduced
uuid        DXNUUID{bytes: Uint8Array(16)}          `@uuid "..."` — 16 raw bytes, not the text form
objectid    DXNObjectId{bytes: Uint8Array(12)}      `@objectid "..."` — 12 raw bytes, BSON's ObjectId
ip          DXNIp{address, prefix}                  `@ip "10.0.0.0/8"` — an address or a prefix, raw bytes
uri         DXNURI{value}                           `@uri "..."` — raw string, not parsed
bytes       DXNBytes{data: Uint8Array}               `@bytes "..."` (base64 in text)
char        DXNChar{codepoint}                       `?a` — distinct from a 1-codepoint string
custom-tag  DXNCustomTag{name, value}                `@tag value`, no decoder registered
```

Every wrapper class with a close native counterpart also has
`toX()`/`DXN*.fromX()` conversion helpers (`DXNDate.toDate()`,
`DXNUUID.fromString()`, ...) — see each class's own file under
[`src/values/`](../src/values/).

Everything else (`nil`→`null`, `boolean`, `integer`→`BigInt`, `float`
→`number`, `DXNDecimal`, `string`, `map`→native `Map`, `set`→native
`Set`, `date`→`DXNDate`, `time`→`DXNTime`, `datetime`→`DXNDateTime`
(a native `Date` encodes as one, in UTC), `local-datetime`→
`DXNLocalDateTime`, `regex`→`DXNRegex`) is the closest native or
wrapper JS shape — see the `DXNValue` typedef in
[`src/values/index.cjs`](../src/values/index.cjs) for the full union.
**`integer` always decodes as `BigInt`**, never `number` — the one
deliberate fidelity-over-ergonomics deviation worth remembering, since
it means hand-built values passed to `encode` need the `n` suffix too.

## Registry: custom tags

```js
registry
  .putTag(name, (value) => term)              // throws on invalid value
  .putTagEncoder(klass, name, (instance) => value);  // throws if unencodable
```

## Registry: schemas

```js
const registry = Schema.compile(schemaDoc, baseRegistry = new Registry());

registry
  .addStructSchema(name, compiled)      // a new version; throws schema/duplicate-version if loaded
  .replaceStructSchema(name, compiled)  // hot-swap a loaded version; throws schema/not-loaded otherwise
  .putStructMaterializer(name, (name, version, fields) => term)   // every version; result checked against the latest
  .putStructModule(name, klass)          // for {form: 'reference', name} checks on hand-built instances
  .putResolver((name) => compiled | undefined);   // lazy/on-demand schema loading
```

`registry.fetchStructSchema(name)` answers the latest version, and
`fetchStructSchema(name, version)` exactly that one.

`FileResolver.forPaths(paths)` builds a ready-made resolver following
DXN.md §4.6: `Foo.Bar/Baz` version N in `Foo/Bar/Baz-vN.dxns`,
`Foo/Bar/Baz/vN.dxns` or `Foo.Bar.Baz-vN.dxns` (`-v1` optional), or the
entry `Baz` in `Foo.Bar.dxns`; every version found is loaded.

## Registry: third-party classes (`DXNSchemaProvider`)

For a class defined by a library that doesn't (and shouldn't have to)
depend on `dextrin` itself — see [`src/schema/provider.cjs`](../src/schema/provider.cjs)'s
own doc for the full pattern:

```js
const registry = Schema.registerProvider(registry, someLibMoneyProvider, Schema.compile);
```

`someLibMoneyProvider` implements the `DXNSchemaProvider` shape
(`dxnSchema()`, `dxnSchemaName()`, `dxnClass()`, and optionally
`dxnMaterialize(name, version, fields)`) — a plain, duck-typed object, not a formal
interface, since Node has no ahead-of-time-compilation concern to
guard against the way Mix does.

## Schema validation, outside of decode

```js
Schema.validate(value, registry, schemaName);              //=> true, throws on failure
Schema.validateEncode(value, registry, schemaName);   // one named schema, encode-side — checks, never converts
Schema.validateEncodeTree(value, registry);           // automatic whole-tree walk, encode-side — checks, never converts
```

## `.dxns` type_expr forms, at a glance

```text
:any                           any value at all
:integer / :string / ...       one keyword per DXN.md §1.3 type name
Address                        bare symbol — a struct name or a named type
{:list-of T}                   list whose every element matches T
{:list-items A {:repeat B 0 nil}}  a list's items in order; {:repeat {:group A B} 1 nil}
{:set-of T}                    set whose every element matches T
{:tuple-of A B C}              fixed-arity positional tuple
{:tuple-of-all T}              tuple of any length, every element a T
{:map-of K V}                  every key matches K, every value matches V
{:array-of T}                  array whose every element matches T
{:ordered-map-of K V}          ordered map: keys match K, values match V
{:sorted-set-of T}             sorted set whose every element matches T
{:enum :a :b :c}                value must equal one of the given literals
{:one-of A B}                  exactly one matches (JSON Schema's oneOf)
{:any-of A B}                  union — matches one or more (anyOf)
{:all-of A B}                  intersection — matches all
{:not T}                       matches what T refuses
:never                         matches nothing
{:nilable T}                   sugar for {:any-of :nil T}
{:refine T %{constraints}}     base type + refine constraints (below)
%schema(N){field: T, ...}      struct/record shape, version N (1 without a header)
```

## `refine` constraints

```text
min / max / exclusive-min / exclusive-max / multiple-of   -- integer/float/decimal/rational
min / max / exclusive-*  on temporals                     -- date/time/datetime/local-datetime/duration, same kind
min-bytes / max-bytes                                     -- string: UTF-8 bytes
float32                                                   -- float: single precision holds it
min-precision / max-precision                             -- decimal: coefficient digits
min-exponent / max-exponent                               -- decimal: exponent
bits                                                      -- integer/bytes: only these bit numbers set
before-now / after-now / within                           -- datetime against the clock
resolution                                                -- time/datetime/duration: :second :millisecond ...
min-length / max-length / pattern                          -- string/keyword/symbol/bytes (bits: length only)
min-count / max-count                                      -- list/set/tuple/sorted-set/array
contains / min-contains / max-contains                     -- how many elements are a given type
unique / unique-by                                         -- no two elements, or their field, the same
finite                                                     -- float: true refuses NaN and the infinities
offsets                                                    -- datetime: ["Z" "+02:00" ...]
version / prefix                                           -- ip: 4 or 6; true a prefix, false an address
```

## Struct schemas

```
%schema(2){
  required_field:  :integer
  optional_field?: :string             # trailing `?` = optional
  with_default:    %field{type: :integer, default: 0, description: "..."}
}
```

The body is the fields, in order — that order is the positional order.
`(2)` is the version; a schema without one is version 1. A struct can
say which version it was written with: `%Name(2){...}`.

## Versions and extra fields

```text
%Point(2){x: 1, y: 2}            written with version 2; encoding always writes the latest
%Point{x: 1, y: 2}               no version: read as the latest
%Point[1 2 label: "a"]           extra fields after a positional struct's items
%Point{x: 1, y: 2, label: "a"}   an undeclared name is an extra field
```

Newer than loaded: read against the latest (text by name, `.dxnb` by
position). Older and loaded: the materializer upgrades it, else
`schema/no-materializer`. Older and not loaded: `schema/unknown-version`.
Reordering fields misreads silently in older `.dxnb` readers: append only.

## Standard named types (`Std`)

```js
const registry = Schema.compile(doc, Std.registry());
```

```text
PositiveInteger, NonNegativeInteger, NegativeInteger, NonPositiveInteger
PositiveFloat, NonNegativeFloat, Percentage
NonEmptyString
NonEmptyList, NonEmptySet
```

## CLI

```sh
dextrin validate data.dxn [--format text|binary] [--schema s.dxns --as Name]
dextrin encode data.dxn [--out data.dxnb]
dextrin decode data.dxnb [--out data.dxn]
dextrin format data.dxn [--mode pretty|condense] [--in-place]   # pretty keeps comments
dextrin compat old-schemas/ schemas/     # changed schemas need new versions
```

No analog of `mix dextrin.gen.schema`/`mix dextrin.gen.unicode`: the
former reflects an existing Elixir struct's fields via
`Map.from_struct/1`, which JS classes have no equivalent mechanism
for; the latter regenerates `dextrin`'s own generated Unicode
identifier ranges, which this port doesn't need at all — the lexer
uses JS's native `\p{ID_Start}`/`\p{ID_Continue}` regex properties
directly instead. `encode`'s Elixir `--share` flag also has no analog
yet: `.dxnb` encoding here doesn't produce value-sharing output (see
the tutorial §3).
