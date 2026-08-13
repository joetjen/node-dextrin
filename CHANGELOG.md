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

### Notes

- No schema/registry support yet: every `struct` decodes as an opaque
  `DXNStruct`, and every non-built-in tag decodes as `DXNCustomTag`.
  `.dxns` and the coercion-on-encode feature land together in a later
  phase.
