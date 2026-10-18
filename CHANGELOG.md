# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Licensed under the Apache License 2.0 (`Apache-2.0`); it was MIT.

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
