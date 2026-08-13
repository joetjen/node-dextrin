# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Notes

- No schema/registry support yet: every `struct` decodes as an opaque
  `DXNStruct`, and every non-built-in tag decodes as `DXNCustomTag`.
  `.dxns` and the coercion-on-encode feature land together in a later
  phase.
