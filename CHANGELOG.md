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
- `require('dextrin')`/`import 'dextrin'` entry point
  (`src/dextrin.{cjs,js}`) currently re-exporting the value model and
  package version; `decode`/`encode`/`decodeBinary`/`encodeBinary`
  land in later phases.
