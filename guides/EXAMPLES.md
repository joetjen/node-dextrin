# Examples

Worked examples across a range of use cases. See the
[tutorial](TUTORIAL.md) first if you haven't already, and the
[DXN examples](dxn/DXN_EXAMPLES.md) for format-level (not
JS-API-level) examples.

## A config file

```
# config.dxn
@dxn "1.0"
%{
  env:      :production
  debug:    false
  db: %{
    host:     "db.internal"
    port:     5432
    pool:     10
    timeout:  ~T[00:00:30]
  }
  features: @{:billing :notifications}
}
```

```js
const fs = require('node:fs');
const { decode } = require('@joetjen/dextrin');

const config = decode(fs.readFileSync('config.dxn', 'utf8'), { trusted: true });
config.get(Symbol.for('db')).get(Symbol.for('host'));
//=> 'db.internal'
config.get(Symbol.for('features')).has(Symbol.for('billing'));
//=> true
```

Shorthand keys (`db:`, `features:`) are DXN `keyword`s, which decode as
real, global `Symbol.for(name)`s when the input is trusted (`trusted:
true`, for your own config file) — that's what makes the
`.get(Symbol.for(...))` lookups above work directly. A
plain DXN `map` (`%{ ... }`) decodes as a native JS `Map`, and a `set`
(`@{ ... }`) as a native `Set` — both already the closest native fit,
no wrapper class needed. Without `trusted: true` -- the default, and
what any file you don't fully control gets -- keywords decode as
`DXNKeyword`s; match against those instead.

## An API payload with an explicit schema

```js
const { decode, Schema, Std } = require('@joetjen/dextrin');

const schemaSource = `
%{
  User: %schema{
    id:       :uuid
    email:    NonEmptyString
    role:     {:enum :admin :member :guest}
    created:  :timestamp
    note?:    :string
  }
}
`;

const doc = decode(schemaSource);
const registry = Schema.compile(doc, Std.registry());

const payload = `
%User{
  id:      @uuid "550e8400-e29b-41d4-a716-446655440000"
  email:   "ada@example.com"
  role:    :admin
  created: ~U[2024-01-01 00:00:00Z]
}
`;

decode(payload, { registry });
//=> DXNStruct { name: 'User', version: 1, fields: { type: 'keyed', pairs: [
//     ['id', DXNUUID {...}], ['email', 'ada@example.com'], ['role', Symbol(admin)], ['created', DXNTimestamp {...}]
//   ] } }
```

An optional field with no value supplied (`note?:`) materializes as
`null`, not simply omitted from the result — the key is always
present, matching how every other decoded field is looked up.

## An event log, streamed to `.dxnb` for storage

```js
const { decode, encodeBinary, decodeBinary } = require('@joetjen/dextrin');

const events = [
  decode('%{type: :login, user_id: 1, at: ~U[2024-01-01 08:00:00Z]}'),
  decode('%{type: :purchase, user_id: 1, amount: 19.99M, at: ~U[2024-01-01 08:05:00Z]}'),
];

const encoded = events.map((event) => encodeBinary(event));
// ... write each to a file/stream, one .dxnb value per line/frame ...
const decoded = encoded.map((bytes) => decodeBinary(bytes));
```

`.dxnb` is a good fit here specifically because `timestamp` uses tag
1's *integer* microsecond form (never the lossy float form) and
`decimal` maps directly to CBOR tag 4 — money and event timestamps
round-trip exactly, unlike JSON-over-the-wire where both would need
an app-level convention.

## Money: `struct` + `refine`, combined

```js
const { decode, Schema, Registry } = require('@joetjen/dextrin');

const schemaSource = `
%{
  Money: %schema{
    amount:   :decimal
    currency: {:enum :usd :eur :gbp}
  }
}
`;

const doc = decode(schemaSource);
let registry = Schema.compile(doc, new Registry());
registry = registry.putStructMaterializer('Money', (_name, _version, { amount, currency }) => ({
  amount,
  currency,
}));

decode('%Money{amount: 19.99M, currency: :usd}', { registry });
//=> { amount: DXNDecimal { sign: 1, unscaledValue: 1999n, exponent: -2 }, currency: DXNKeyword { name: 'usd' } }
```

What a materializer answers is checked against the latest schema, so it
has to stay a value of the schema's own shape: answering
`currency: currency.name` (the string `'usd'`) would be refused
(`schema/materializer`), because the schema declares
`{:enum :usd :eur :gbp}`, not a string.

`currency` decodes as a `keyword` -- a `DXNKeyword` by default, whose
`.name` is `'usd'`, or `Symbol.for('usd')` when decoded with `trusted:
true`, whose `.description` is.

## A schema, version by version

Each `.dxns` document describes one version of a schema, in its
header; the body is the fields, in order. Without a header it is
version 1:

```js
const { decode, Schema, Registry } = require('@joetjen/dextrin');

let registry = Schema.compile(decode('%{ User: %schema{ name: :string } }'), new Registry());
registry = Schema.compile(decode('%{ User: %schema(2){ name: :string, email?: :string } }'), registry);

registry.fetchStructSchema('User').compiled.version;      //=> 2, the latest
registry.fetchStructSchema('User', 1).compiled.fieldNames(); //=> ['name']

Schema.compile(decode('%{ User: %schema(2){ name: :string } }'), registry);
//=> throws DXNError, category 'schema/duplicate-version'
```

Loading the same version twice is a mistake rather than an update;
`registry.replaceStructSchema(name, compiled)` swaps a loaded version
on purpose. A struct can say which version it was written with, and is
written back with it:

```js
decode('%User(2){name: "Ada"}').version;   //=> 2
encode(decode('%User(2){name: "Ada"}'));   //=> '%User(2){name:"Ada"}'
```

A version must be a positive integer: `%User(0){...}` is a syntax error.

## A third-party class provider, end to end

`DXNSchemaProvider` lets a class's *own* library define its DXN schema
without depending on `dextrin` — see [`src/schema/provider.cjs`](../src/schema/provider.cjs)'s
own doc for the complete rationale. This example shows both sides: the
geo library that owns the class, and the application that uses it.

The library, `geo-lib`, ships a `LatLng` class. It doesn't depend on
`dextrin` itself at all — the provider object below is plain data,
duck-typed, needing nothing from `dextrin` to define:

```js
// geo-lib/lat-lng-dxn.js -- a small companion module, required lazily
// only by an application that also has dextrin installed
class LatLng {
  constructor(lat, lng) {
    this.lat = lat;
    this.lng = lng;
  }
}

// Defines a shared named type (Degrees) alongside the one schema this
// module is actually "for" -- both get compiled into the registry
// together.
const LatLngProvider = {
  dxnSchema: () => `
    %{
      Degrees: {:refine :float %{min: -180.0, max: 180.0}}
      LatLng: %schema{ lat: Degrees, lng: Degrees }
    }
  `,
  dxnSchemaName: () => 'LatLng',
  dxnClass: () => LatLng,
  dxnMaterialize: (_name, _version, { lat, lng }) => new LatLng(lat, lng),
};

module.exports = { LatLng, LatLngProvider };
```

The application depends on both `geo-lib` and `dextrin`. It composes
`geo-lib`'s provider with dextrin's own standard named types in one
registry, exactly like chaining any other base registry:

```js
const { decode, encode, Schema, Std } = require('@joetjen/dextrin');
const { LatLng, LatLngProvider } = require('geo-lib/lat-lng-dxn');

const registry = Schema.registerProvider(Std.registry(), LatLngProvider, Schema.compile);

decode('%LatLng{lat: 51.05, lng: 13.74}', { registry });
//=> LatLng { lat: 51.05, lng: 13.74 }

encode(new LatLng(51.05, 13.74), { registry });
//=> '%LatLng(1){lat:51.05,lng:13.74}'

// Degrees' own refine constraint is enforced automatically, same as
// any other schema -- no special handling needed on either side:
decode('%LatLng{lat: 200.0, lng: 13.74}', { registry });
//=> throws DXNError: struct "LatLng" violates its schema: field "lat" does not match its declared type
```

`geo-lib` never mentions `Registry`, `Schema`, or any other `dextrin`
export outside that one small companion module — an application that
uses `LatLng` without `dextrin` installed runs exactly as if
`lat-lng-dxn.js` was never required.

## Cross-file schemas with `FileResolver`

Given `schemas/Address.dxns` and `schemas/Person.dxns` on disk:

```
# schemas/Address.dxns
%{
  Address: %schema{ street: :string }
}

# schemas/Person.dxns
%{
  Person: %schema{ name: :string, home: Address }
}
```

```js
const { decode, Schema, Registry, FileResolver } = require('@joetjen/dextrin');
const fs = require('node:fs');

const doc = decode(fs.readFileSync('schemas/Person.dxns', 'utf8'));
const resolver = FileResolver.forPaths(['schemas']);
const registry = Schema.compile(doc, new Registry().putResolver(resolver));

decode('%Person{name: "Ada", home: %Address{street: "1 Main St"}}', { registry });
//=> DXNStruct { name: 'Person', version: 1, fields: { type: 'keyed', pairs: [
//     ['name', 'Ada'], ['home', DXNStruct { name: 'Address', version: 1, ... }]
//   ] } }
```

`Address.dxns` is loaded and compiled lazily, on first encounter with
its name, and memoized in the registry for the rest of that decode.
`FileResolver` also understands a namespaced field reference: a field
typed `geo/Address` is found as the entry `Address` in
`<searchPath>/geo.dxns`, or in a versioned file of its own
(`geo/Address-v2.dxns`, `geo/Address/v2.dxns`, `geo.Address-v2.dxns` --
DXN.md §4.6). A struct in that field is written under the same name,
`%geo/Address{...}`: a field takes a struct of exactly the name it
references.
