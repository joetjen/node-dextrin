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
const { decode } = require('dextrin');

const config = decode(fs.readFileSync('config.dxn', 'utf8'));
config.get(Symbol.for('db')).get(Symbol.for('host'));
//=> 'db.internal'
config.get(Symbol.for('features')).has(Symbol.for('billing'));
//=> true
```

Shorthand keys (`db:`, `features:`) are DXN `keyword`s, which decode as
real, global `Symbol.for(name)`s by default (`trusted: true`) — that's
what makes the `.get(Symbol.for(...))` lookups above work directly. A
plain DXN `map` (`%{ ... }`) decodes as a native JS `Map`, and a `set`
(`@{ ... }`) as a native `Set` — both already the closest native fit,
no wrapper class needed. Pass `trusted: false` for a config file you
don't fully trust the contents of, and match against `DXNKeyword`
instances instead.

## An API payload with an explicit schema

```js
const { decode, Schema, Std } = require('dextrin');

const schemaSource = `
%{
  User: %schema{
    closed: true
    fields: @ordered %{
      id:       :uuid
      email:    NonEmptyString
      role:     {:enum :admin :member :guest}
      created:  :timestamp
      note?:    :string
    }
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
//=> { id: DXNUUID {...}, email: 'ada@example.com', role: Symbol(admin), created: DXNTimestamp {...}, note: null }
```

A response body accidentally including a legacy field is rejected
loudly, not silently dropped:

```js
decode(
  '%User{id: @uuid "550e8400-e29b-41d4-a716-446655440000", email: "a@b.co", role: :admin, created: ~U[2024-01-01 00:00:00Z], legacy_id: 1}',
  { registry },
);
//=> throws DXNError: struct "User" violates its schema: unknown field "legacy_id" (schema is closed)
```

An optional field with no value supplied (`note?:`) materializes as
`null`, not simply omitted from the result — the key is always
present, matching how every other decoded field is looked up.

## An event log, streamed to `.dxnb` for storage

```js
const { decode, encodeBinary, decodeBinary } = require('dextrin');

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
const { decode, Schema, Registry } = require('dextrin');

const schemaSource = `
%{
  Money: %schema{
    fields: @ordered %{
      amount:   :decimal
      currency: {:enum :usd :eur :gbp}
    }
  }
}
`;

const doc = decode(schemaSource);
let registry = Schema.compile(doc, new Registry());
registry = registry.putStructMaterializer('Money', ({ amount, currency }) => ({
  amount,
  currency: currency.description,
}));

decode('%Money{amount: 19.99M, currency: :usd}', { registry });
//=> { amount: DXNDecimal { sign: 1, unscaledValue: 1999n, exponent: -2 }, currency: 'usd' }
```

`currency` decodes as a trusted `keyword` (`Symbol.for('usd')`) —
`.description` reads the interned name back out, the native-`Symbol`
equivalent of Elixir's `Atom.to_string/1`.

## Cross-field validation with `refine-fn`

A `type_expr` can only describe shape, not "field A implies field B" —
`refine-fn:` names a predicate resolved from a `predicates` object
passed to `compile`. A predicate returns `true` on success or a
`string` error message on failure — JS's analog of Elixir's `:ok |
{:error, reason}`:

```js
const { decode, Schema, Registry } = require('dextrin');

const schemaSource = `
%{
  DateRange: %schema{
    refine-fn: date-range/valid
    fields: @ordered %{ starts: :date, ends: :date }
  }
}
`;

const predicates = {
  'date-range/valid': ({ starts, ends }) =>
    starts.compare(ends) <= 0 ? true : 'starts must not be after ends',
};

const doc = decode(schemaSource);
const registry = Schema.compile(doc, new Registry(), predicates);

decode('%DateRange{starts: ~D[2024-06-01], ends: ~D[2024-01-01]}', { registry });
//=> throws DXNError: struct "DateRange" violates its schema: starts must not be after ends
```

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
      LatLng: %schema{
        fields: @ordered %{ lat: Degrees, lng: Degrees }
      }
    }
  `,
  dxnSchemaName: () => 'LatLng',
  dxnClass: () => LatLng,
  dxnMaterialize: ({ lat, lng }) => new LatLng(lat, lng),
};

module.exports = { LatLng, LatLngProvider };
```

The application depends on both `geo-lib` and `dextrin`. It composes
`geo-lib`'s provider with dextrin's own standard named types in one
registry, exactly like chaining any other base registry:

```js
const { decode, encode, Schema, Std } = require('dextrin');
const { LatLng, LatLngProvider } = require('geo-lib/lat-lng-dxn');

const registry = Schema.registerProvider(Std.registry(), LatLngProvider, Schema.compile);

decode('%LatLng{lat: 51.05, lng: 13.74}', { registry });
//=> LatLng { lat: 51.05, lng: 13.74 }

encode(new LatLng(51.05, 13.74), { registry });
//=> '%LatLng{lat:51.05,lng:13.74}'

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
  Address: %schema{
    fields: @ordered %{ street: :string }
  }
}

# schemas/Person.dxns
%{
  Person: %schema{
    fields: @ordered %{ name: :string, home: Address }
  }
}
```

```js
const { decode, Schema, Registry, FileResolver } = require('dextrin');
const fs = require('node:fs');

const doc = decode(fs.readFileSync('schemas/Person.dxns', 'utf8'));
const resolver = FileResolver.forPaths(['schemas']);
const registry = Schema.compile(doc, new Registry().putResolver(resolver));

decode('%Person{name: "Ada", home: %Address{street: "1 Main St"}}', { registry });
//=> { name: 'Ada', home: { street: '1 Main St' } }
```

`Address.dxns` is loaded and compiled lazily, on first encounter with
its name, and memoized in the registry for the rest of that decode.
`FileResolver` also understands a namespaced `Namespace/Name` field
reference (resolving to `<searchPath>/Namespace.dxns`'s `Name` entry,
for a file that defines a differently-named schema than its own file
stem) — but keep the *struct literal itself* written under its own
bare schema name (`%Address{...}`, never `%Namespace/Name{...}`),
since a reference's declared name is checked against the referenced
value's own compiled schema name exactly, and that name is always the
bare entry name a `.dxns` file defines it under.
