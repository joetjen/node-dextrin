# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **TypeScript declarations**, written from the JSDoc by `npm run types`
  (and on `prepack`) into `types/` and named by `package.json`'s `types`
  and `exports`, for `import` and `require` alike. A TypeScript program
  using the package is typechecked against them in `npm run precommit`.
  Every class is a type as well as a value there (`err: DXNError`,
  `registry: Registry`, `x: DXNStruct`): the entry and `values/` export
  name by name, which `tsc` declares so.

### Fixed

- **The package survives a bundler.** The standard library's schemas
  were read off disk next to the source at load, and the ES module entry
  reached the implementation through `import.meta.url`; bundled into one
  CommonJS file (as the DXN VS Code extension does), both failed at load.
  The standard library's text is now a module written from
  `priv/schema/std.dxns` (`npm run std`; a test fails when it is out of
  date), and the ES module entry re-exports the CommonJS one instead of
  keeping a second copy of `decode`, `encode`, `decodeBinary` and
  `encodeBinary`; so does `values/equality.js`, the last ES module that
  reached its CommonJS one through `import.meta.url`.
- **A map key that is not allowed, and a schema violation, say where
  they are** when decoding text: `key/not-allowed` at the key, a schema
  error at its struct's `%` (the innermost one), as the reference places
  them. They had no offset. A refused key is named as written --
  `[1] cannot be a map key` -- not as `[object Object]`.
- **A value written well that is not one is a `syntax` error** at the
  token it began with (`DXN.md` §5), as the reference answers: an
  impossible date or time, a uuid or datetime that is not one, an unknown
  string escape. They came back with no category and no offset.
- A rational with a zero denominator is refused at the rational, not at
  offset 0; a struct's refusal is placed at its `%`, not at a token
  index.
- `Document.format` wrote the header without its space (`@dxn"1.0"`);
  it writes the tag, one space and the version, however they were
  spaced.
- `Document.format` dropped a document's final newline; it now ends with
  one exactly when the source did. `dextrin format` still writes a file
  with one final newline.

## [0.2.0] - 2026-10-19

Versioned schemas, extra fields, the conformance suite's adapter and a
document that keeps its comments. Breaking: the package is now
`@joetjen/dextrin`, a 0.1.x `.dxns` file has to be rewritten, and
decoding a checked struct answers a `DXNStruct`.

### Migrating from 0.1.x

- **The package is `@joetjen/dextrin`.** `npm uninstall dextrin && npm
  install @joetjen/dextrin`, and `require('dextrin')` becomes
  `require('@joetjen/dextrin')` (or `import ... from
  '@joetjen/dextrin'`).
- **`.dxns` files.** The body lists the fields directly, in the order
  `fields: @ordered %{...}` gave them, and a schema without a version
  is version 1:

  ```text
  # 0.1.x
  User: %schema{closed: true, fields: @ordered %{name: :string, email?: :string}}
  # 0.2.0
  User: %schema{name: :string, email?: :string}
  ```

  An unconverted file is refused by `Schema.compile` (`schema/compile`:
  `field "fields": unrecognized type expression`), never read as
  something else.
- **`closed:`, `forbidden:` and `refine-fn:` are gone.** A struct may
  carry fields its schema does not declare. Where `closed: true` refused
  them, decode with `{ strict: true }` (or `registry.putStrict(true)`),
  which refuses every undeclared field as `schema/undeclared-field`. A
  `forbidden:` list or a refine predicate becomes a check in the
  schema's materializer (`registry.putStructMaterializer`), which may
  throw.
- **A checked struct decodes to a `DXNStruct`**, not a plain object. A
  materializer that answers its fields keeps the old shape:
  `registry = registry.putStructMaterializer('User', (_name, _version,
  fields) => fields)` -- the registry's methods answer a new registry.
- **`.dxnb` written by 0.1.x still reads**, and so does text: its structs
  carry no version, and a struct without a version is read as the latest
  version loaded. Proven against bytes 0.1.0 wrote, in
  `test/binary/v0_1_0.spec.js`.
- **Rewrite stored 0.1.x data before you load a version 2.** Once a
  version 2 is loaded, an unversioned struct is read as version 2, and a
  `.dxnb` struct with version 1's fields no longer matches it
  (`schema/field-count`). Decoded and encoded again with 0.2.0, the same
  value is written as `User(1)`, and from then on it is read as version 1
  and handed to the materializer to upgrade.

### Added

- `Document` -- a `.dxn` document with everything it holds, its comments,
  blank lines and commas as well as its value, mirroring
  `Dextrin.Document`: `parse` (`decode`'s options and errors), `toValue`,
  `render` (the source, byte for byte, when nothing was edited), `format`
  (laid out, every comment kept), the edits `replace`, `delete` and
  `insert` by path, and `update`, which makes a new value by the fewest
  edits and refuses where guessing would lose a comment. The parser
  records the tree as it parses, so it is the same parser as `decode`'s.
- **`dextrin format` keeps comments** (`--mode pretty`, the default);
  `--mode condense` still drops them, a comment ending its line.
- `dextrin conformance` answers `format` and `edit` cases.
- The tutorial's §8, "Evolving a schema": a worked example of versions,
  reading across them, the materializer, the positional risk and
  `dextrin compat`. The cheatsheet gains versions and extra fields.
- `Schema.compat(oldRegistry, newRegistry)` and `dextrin compat OLD NEW`
  -- the version discipline check (`DXN.md` §4.8), for CI against the
  previous release's schema files: a version whose content changed
  without a new version, or a version that went down, fails; what the
  latest version's materializer has to upgrade is listed either way.
- `canonical(value)` -- the canonical form of a value (`DXN.md` §1.5):
  one rendering fixed down to the byte, with maps and sets in canonical
  order (by code point, not UTF-16 order), floats by one exact algorithm
  and one fixed set of string escapes, so values from different
  implementations compare as text.
- `DXNError#category` -- the error's kind as `DXN.md` §5 names it
  (`'syntax'`, `'binary'`, `'encode/unsupported'`, ...), so errors
  compare across implementations without comparing messages.
- `answer(request)` and `dextrin conformance REQUEST ANSWER` -- this
  implementation's adapter for the Dextrin Conformance Suite.
- `DXNMap` -- a `Map` whose keys are compared by value: two keys are the
  same key exactly when their canonical forms are (`DXN.md` §1.6). Every
  decoded map is one.

- **Versioned schemas** (`DXN.md` §4.8). `%schema(3){...}` is version 3
  of its name, and one with no header is version 1. A registry keeps every
  loaded version side by side: `addStructSchema` refuses a version that is
  already loaded (`schema/duplicate-version`), `replaceStructSchema`
  hot-swaps one that is loaded and refuses one that is not
  (`schema/not-loaded`), and `fetchStructSchema(name)` answers the latest,
  `fetchStructSchema(name, version)` exactly that one.
- **A struct literal carries its version**: `%User(3){...}` and
  `%User(3)[...]` decode to a `DXNStruct` whose `version` is 3, and are
  written back with it. A version of zero or less is refused.
- `DXNStruct.head` and `DXNStruct#withFields`.
- **Every struct written against a schema carries the latest loaded
  version of it**, in text (`%User(3){...}`, and `%User(1){...}` when
  version 1 is the only one) and in `.dxnb`, where the type name becomes
  `"User(3)"`. A struct with no schema keeps its own version, or none.
  `Registry#asWritten` decides; `DXNStruct.typeName` and
  `DXNStruct.parseTypeName` spell it. A `.dxnb` type name whose version
  is not a positive integer is a `binary` error.
- **A struct is read according to the version it was written with**
  (`DXN.md` §4.8, `src/schema/reader.cjs`), in text and binary alike. The
  latest version, or none, is read exactly. A newer version is read
  against the latest: text by name, binary by position, dropping items
  beyond the reader's fields and leaving missing optional fields absent.
  An older version that is loaded is read with its own schema and handed
  to the materializer, and refused as `schema/no-materializer` without
  one; an older version that is not loaded is refused as
  `schema/unknown-version`.
- **One materializer per schema, for every version** (`DXN.md` §4.8).
  `Registry#putStructMaterializer` takes a function of
  `(schemaName, version, fields)`; it is called for every decoded struct
  of its schema, upgrades older versions, and its result is checked
  against the latest schema — a throw or a rejected result is
  `schema/materializer`. A provider's `dxnMaterialize` takes the same
  arguments.
- **Without a materializer, a checked struct decodes to a `DXNStruct`**
  at its schema's latest version, fields in the schema's order, instead
  of a plain object — so it encodes back to the text it came from. An
  optional field that was absent stays absent instead of becoming `null`.
- `schema/validator.cjs`'s `materialize` is replaced by `resolve`;
  building the value is `schema/reader.cjs`'s job.
- **A struct may carry extra fields** (`DXN.md` §4.7), kept in
  `DXNStruct`'s new `extra` list and written back with it: in text as
  entries — after a positional struct's items,
  `%User(3)["a" "a@x" nick: "b"]` — and in `.dxnb` as one trailing map
  under the new private tag 215. A keyed struct's undeclared names, and
  any entry keyed by something other than a name, are extras. An extra
  never shadows a declared field (`schema/shadowed-field`); the
  materializer receives extras with the declared fields (a non-name key
  by its canonical text); `strict: true` refuses them
  (`schema/undeclared-field`, `Registry#putStrict`).
- A keyed struct entry whose key is not a name — `%Point{1 => 2}` — is an
  extra field instead of an error.
- **A struct is matched only by a struct** (`DXN.md` §4.7). A field
  typed `User` accepts a `DXNStruct` named `User`, or the class
  registered for `User`; a `Map`, a plain object, any other value, and a
  class registered for no schema or another are type errors. Until now
  every non-struct value was accepted.
- **Nothing is converted to make a value match its type.** The
  schema-driven coercion and the `coerce:` option are removed
  (`src/schema/coercion.cjs` is gone): a `number` for a `:rational` or
  `:decimal` field, a string for `:uuid`, `:uri` or `:char`, a `Date` for
  `:date` or `:datetime` and an array for `:list` or `:tuple` are now
  refused. A host value always means the same DXN type, schema or not.
- A native `Date` always means a `timestamp`: `encode`, `encodeBinary`
  and `canonical` write it as one, and a `:timestamp` field accepts it.

### Changed

- **Published as `@joetjen/dextrin`** (the unscoped npm `dextrin` is
  deprecated in its favour): `npm install @joetjen/dextrin`,
  `require('@joetjen/dextrin')`. The `dextrin` command keeps its name.
- Licensed under the Apache License 2.0 (`Apache-2.0`); it was MIT.
- **A registered class instance carries extra fields**: an own property
  its schema does not declare is written as an extra field (text entries,
  the trailing tag-215 map in `.dxnb`), as an Elixir struct's undeclared
  keys are. It was dropped.
- **An absent field is never written as `nil`** (`DXN.md` §4.3): a field
  an instance does not have, or holds as `undefined`, is left out of
  text, and in `.dxnb`, which fills every position, written as its
  default or refused (`schema/missing-field`). Both writers wrote `nil`,
  which the same schema then refused to read back.
- **Every schema violation carries its `DXN.md` §5 category**:
  `schema/field-count`, `schema/missing-field`, `schema/type-mismatch`
  and `schema/shadowed-field`, decoding text or binary and encoding
  alike. They came back as `syntax` from text, `binary` from binary,
  and with no category from an encode. `SchemaValidationError` gains a
  `category`.
- `dextrin conformance` loads a case's `schemas` and honours `strict`.

- **A map key must be one of the eight types of `DXN.md` §1.6**
  (`string`, keyword, integer, uuid, date, bytes, symbol, char). Any other
  key -- a float, `null`, a boolean, a time, a collection, ... -- is
  refused as `key/not-allowed` when decoding text or binary and when
  encoding, in maps and ordered maps alike.
- A repeated key such as `?c` merges into one entry, the last one, and a
  lookup with an equal key finds it: a plain `Map` compared object keys
  by identity, so `%{?c => 1, ?c => 2}` had two entries.
- **A schema's body is its fields, in order**:
  `User: %schema(3){name: :string, email: :string, id?: :uuid}`. The
  `fields: @ordered %{...}` wrapper is gone, and so are `closed:`,
  `forbidden:` and `refine-fn:`; `Schema.compile` and
  `FileResolver.forPaths` lose their `predicates` argument. A failed
  compile throws an error of category `schema/compile`.

### Fixed

- A symbol whose name is not an identifier is refused by the text
  writers (`encode/unsupported`): `encode`, the pretty printer and
  `canonical` wrote its name verbatim, which read back as something else,
  or as nothing (`''`). `.dxnb` keeps any name.

- A keyed struct written to `.dxnb` went on the wire in the order of its
  keys rather than its schema's field order, so it came back with its
  fields swapped.
- A negative-zero decimal keeps its sign: `-0.0M` decoded as `0.0M`.
  Nothing is normalised (`DXN.md` §1.5); a value is written as it was
  given.
- A walk over a struct's fields — stripping the schema marker, the
  check on the way out, and the schema compiler's own normalising —
  rebuilt the struct from its name and fields; it now changes only the
  fields, so nothing else the struct carries is lost.

## [0.1.0] - 2026-08-14

### Added

- Generated API documentation ([TypeDoc](https://typedoc.org/), driven
  by the existing `tsconfig.json`'s `allowJs`/`checkJs` JSDoc setup —
  no source changes needed), published to GitHub Pages via
  `.github/workflows/docs.yml` on every push to `main`, mirroring
  `dextrin`'s own ExDoc/Hex Docs setup. `npm run docs` builds it
  locally into `doc/` (gitignored).
- `src/dextrin.cjs`'s own `@fileoverview` now names its reference
  implementation and sibling port (`dextrin` on Hex.pm, `php-dextrin`
  on Packagist), alongside the existing README "Other language
  implementations" section.
- Project scaffold: `package.json`, dual CJS/ESM entry-point
  convention, Mocha/Chai test setup, `tsc --checkJs` type-checking.
- Core DXN value model (`src/values/`): wrapper classes for every DXN
  type without a lossless native JS equivalent (`DXNSymbol`,
  `DXNKeyword`, `DXNList`, `DXNTuple`, `DXNOrderedMap`,
  `DXNSortedSet`, `DXNStruct`, `DXNDecimal`, `DXNRational`, `DXNChar`,
  `DXNDate`, `DXNTime`, `DXNTimestamp`, `DXNDateTime`, `DXNDuration`,
  `DXNUUID`, `DXNURI`, `DXNBytes`, `DXNRegex`, `DXNCustomTag`), each
  with documented two-way conversion helpers to/from its closest
  native JS counterpart where one genuinely exists.
- Shared structural equality/ordering kernel (`src/values/equality.js`,
  `dxnEquals`/`dxnCompare`/`canonicalKey`/`kindOf`) backing every
  value shape, native and wrapped alike.
- `.dxn` text codec: `decode`/`encode` (`src/text/`), a hand-written
  recursive-descent lexer/parser directly off `DXN.md` §1's EBNF (no
  parser-generator dependency), a single-line printer, and a
  multi-line pretty formatter (`encode(value, { pretty: true })`).
  Full round-trip fidelity verified against `DXN.md` §3's own worked
  example and `fast-check` property tests.
- `DXNError` (`src/error.cjs`) — one error type for every `dextrin`
  failure mode. `decode`/`encode` throw it on failure, a deliberate
  divergence from `Dextrin`'s `{:ok, _} | {:error, _}` tuples (an
  API-shape choice, not a value-representation one — see that
  module's own doc).
- `require('dextrin')`/`import 'dextrin'` entry point
  (`src/dextrin.{cjs,js}`) now exports the value model, package
  version, `decode`/`encode`, and `DXNError`; `decodeBinary`/
  `encodeBinary` (`.dxnb`) land in a later phase.

- `.dxnb` binary codec: `decodeBinary`/`encodeBinary` (`src/binary/`),
  a hand-rolled CBOR encoder/decoder over `Buffer` — major types 0–7,
  the registered tags (1 timestamp, 2/3 bignum, 4 decimal, 30
  rational, 32 uri, 37 uuid), and the private tag block (200–214,
  `src/binary/tags.cjs`). Verified against `DXN.md` §3's own worked
  example, a by-type round-trip suite, and `fast-check` property
  tests. A 500-iteration fuzz test (random bytes after a valid
  envelope) confirms malformed input always fails as a clean
  `BinaryError`, never an uncaught crash.
- Value sharing (`DXN.md` §2.5, tags 28/29) and string-reference
  sharing (§2.4, tags 256/25) are decode-side only for now — spec-
  mandatory to *accept*, optional to *produce* ("not required for a
  conforming encoder to produce"). A tag-29 reference resolves to a
  deep-cloned independent copy, not a shared object reference, per
  §2.5's "no decoder-visible aliasing" requirement — genuinely needed
  in JS, where (unlike Erlang terms) compound values are mutable.
  Producing shared references on encode is deferred, not forgotten.

- `.dxns` schema system: `Registry` (`src/registry.cjs`, plain
  immutable-update-style data, mirroring `Dextrin.Registry`), the
  `schema/` compiler/validator/type-expr matcher (all 12 `type_expr`
  forms, all 26 primitives), `Schema.compile`/`validate`/
  `validateEncode`/`validateEncodeTree`/`registerProvider`
  (`schema.cjs`, mirroring `Dextrin.Schema`), `Std.registry()` (ported
  `priv/schema/std.dxns` standard named-type library), and
  `FileResolver.forPaths()` (`Namespace/Name` → `.dxns`-file
  resolution for `Registry#putResolver`). Wired into `decode`/
  `encode`/`decodeBinary`/`encodeBinary` as `registry:`/`validate:`/
  `schema:` options — a `struct`/tag with no matching registry entry
  still falls back to an opaque `DXNStruct`/`DXNCustomTag`, never a
  hard failure.
- **Schema-driven type coercion on encode** (`coerce:`, default
  `true`) — no Elixir `dextrin` equivalent: when a field's value
  doesn't already match its declared type, `schema/coercion.cjs`
  tries every `DXN*` class's own `fromX()` conversion helper before
  treating it as a genuine mismatch (a plain `number` becomes a
  `DXNRational` for a `:rational` field, a native `Date` becomes a
  `DXNDate` for a `:date` field, recursively through `list-of`/
  `set-of`/`tuple-of`/`nilable`/`one-of` too). `coerce: false` for
  strict validation with no silent conversion.
- `schema/provider.cjs`'s `DXNSchemaProvider`: lets a class's own
  library ship its DXN schema without depending on `dextrin` at all —
  a plain, duck-typed object shape (no Elixir-style `@behaviour`/
  `Code.ensure_loaded?` ceremony needed; see that module's own doc for
  why those don't translate to Node the same way).
- `dextrin` CLI (`bin/dextrin.js`, wired via `package.json`'s `bin`
  field): `decode`/`encode`/`format`/`validate` subcommands, the
  Node-idiomatic analog of `dextrin`'s per-`mix dextrin.*`-task
  layout. No analog of `mix dextrin.gen.schema`/`mix dextrin.gen.
  unicode` (see the CLI's own file-level doc for why), and `encode`
  has no `--share` flag yet (`.dxnb` encoding doesn't produce
  value-sharing output, see the binary codec notes above).
- Guides: `guides/dxn/{DXN.md,TUTORIAL.md,DXN_EXAMPLES.md,
  DXN_CHEATSHEET.md}` (the implementation-independent format spec,
  ported with light JS-facing link/reference edits) and this
  project's own `guides/{TUTORIAL.md,EXAMPLES.md,CHEATSHEET.md}`
  (JS-API-level, every code sample verified to actually run).

### Fixed

- `src/text/formatter.cjs`'s `renderEntry()` used to treat *any*
  plain string map key as keyword-shaped (`typeof key === 'string' ?
  key : Printer.keywordEntryName(key)`) — correct only for a
  `DXNStruct`'s own field-name pairs (always keyword-shaped by
  construction), but wrong for a `Map`/`DXNOrderedMap` entry whose key
  is a genuine `string`: it silently rendered `id: 1` instead of the
  correct `"id" => 1`, disagreeing with `src/text/printer.cjs`'s own
  (correct) single-line rendering of the identical value, and with
  `src/binary/encoder.cjs`'s own map-key encoding — the same class of
  keyword/string map-key inconsistency independently found and fixed
  in this project's `dextrin`/`php-dextrin` sibling ports, here
  surfacing specifically in the pretty-printer. Fixed by giving struct
  field names their own dedicated `renderKeywordEntry()`/
  `bracketedKeywordEntries()` path (mirroring `printer.cjs`'s existing
  `printKeywordEntry()`/`printStruct()` split), so the shared `Map`/
  `DXNOrderedMap` entry path only ever treats an actual `symbol`/
  `DXNKeyword` key as keyword-shaped. Found via a cross-language
  round-trip check against `dextrin`/`php-dextrin`.

### Notes

- Encode-time schema checking can *return a transformed value*, not
  just validate — a deliberate divergence from `Dextrin.Schema.
  Validator`'s own check-only contract, required for coercion's
  result to actually reach the printer/binary encoder (see
  `schema/validator.cjs`'s own doc).
