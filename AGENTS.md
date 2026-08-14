# AGENTS.md

Instructions for AI agents working in this Node.js codebase.

`node-dextrin` is a JavaScript port of [`dextrin`](https://github.com/joetjen/dextrin),
an Elixir implementation of DXN (Data eXchange Notation). `DXN.md`
(vendored under `guides/dxn/DXN.md` once ported) is the normative,
implementation-independent format spec — this codebase only needs to
satisfy that document, not replicate Elixir internals. The one
deliberate exception: the *in-memory decoded representation* mirrors
`dextrin`'s own shape-per-type choices as closely as JS allows, so a
developer who knows one implementation recognizes the other. Where
this codebase's value model deviates from Elixir's on purpose (e.g.
`float` needs no wrapper in JS since `number` natively holds
`NaN`/`Infinity`; `integer` is always `BigInt` for arbitrary-precision
fidelity that Elixir gets for free), the reason is documented in that
type's own module, not left implicit.

## Communication

- Every response starts with the user's first name. Determine it from
  `git config user.name` (take the first name); if that's unavailable
  or ambiguous, ask once. Remember the answer for the rest of the
  session rather than re-deriving or re-asking.

## Before every commit

- Run `npm run precommit` (type-check via `tsc --checkJs --noEmit`,
  then the full test suite) and make sure it passes. No exceptions.

## Language: plain JS + JSDoc, not TypeScript

- Source is plain `.cjs`/`.js` — no `.ts` files, no build step.
  Type safety comes from JSDoc `@typedef`/`@param`/`@returns`
  annotations checked by `tsc --checkJs --noEmit` (`npm run
  typecheck`), the JS analog of what `dialyzer` is for the Elixir
  side: an external check bolted onto code that isn't itself
  type-annotated at runtime.
- Keep JSDoc annotations current with the code they describe —
  `tsc --checkJs` catches drift in signatures, but not in prose.

## Tests

- Tests must stay current with behavior: a change to what code does
  needs its tests updated in the same commit, not "later" — a passing
  suite that no longer exercises real current behavior is worse than
  a failing one.
- Add tests for new behavior as you write it, not as a follow-up.
- Tests live in `test/`, split by concern (`values/`, `text/`,
  `binary/`, `schema/`, mirroring `dextrin`'s own `test/` layout) and
  run via Mocha/Chai (`npm test` / `npm run autotest` to watch).
- Where inputs form a space bigger than a handful of examples usefully
  covers (parsers, encoders/decoders, merge/normalization logic,
  anything with an invariant that should hold for *all* inputs, not
  just the ones you thought of), prefer a property-based test
  (`fast-check`, this project's analog of Elixir's `stream_data`)
  over enumerating more example cases by hand. Use ordinary
  example-based tests for fixed, specific scenarios and regressions.

## Documentation

- Treat every documentation surface touched by a change as part of
  that change, not optional polish — JSDoc comments, README, guides,
  changelog, code comments explaining non-obvious behavior. None of
  it is allowed to go stale.
- Every exported class/function needs a JSDoc block. Update it
  whenever behavior changes — stale docs are worse than none.
- Keep external docs (README, guides) in sync with code changes in
  the same commit/PR.
- Update `CHANGELOG.md` for every user-facing change, following
  [Keep a Changelog](https://keepachangelog.com/):
  - Add entries under `[Unreleased]` as you work.
  - Releases are cut with `npm version <major|minor|patch>`, which
    runs `auto-changelog` to regenerate the file from commit history
    and move `[Unreleased]` under a version heading — don't hand-roll
    that step.

## Dual entry points (ESM/CJS parity)

- `src/*.cjs` is the real implementation, in plain CommonJS so it can
  also be `require()`d directly — **this is the file to change** for
  any behavioral fix or feature.
- `src/*.js` is the ES Module entry point, a thin wrapper. If you add
  or rename an export, update both files so they keep exporting the
  same API, and add/adjust a test against both entry points before
  calling a change done — not just green tests on whichever file you
  touched.

## Naming

- Value wrapper classes are prefixed `DXN` (not `Dxn`), and common
  acronyms stay fully uppercase throughout: `DXNURI`, `DXNUUID`,
  `DXNList`, never `Dxn`/`Uri`/`Uuid`. File names stay lowercase-kebab
  as usual for JS (`uri.cjs` exports `DXNURI`).
- Any wrapper class with a close native JS counterpart gets two-way
  conversion helpers: a `toX()` instance method and a `DXN*.fromX()`
  static — never just internal, undocumented use of that native type.
  Omit conversion helpers where no close native fit exists (document
  why in that class's own JSDoc) rather than forcing a misleading one.

## Dependency boundaries

- Zero runtime dependencies unless truly justified — new packages
  belong in `devDependencies` only by default. If you're tempted to
  add a runtime dependency, stop and flag it instead. The `.dxnb`
  binary codec and decimal/bignum handling are hand-rolled specifically
  to keep this boundary (see `Dextrin.Binary.Encoder`'s own moduledoc
  in the Elixir source for the full rationale — bignum precision,
  timestamp integer-only encoding, and the private CBOR tag block
  aren't things a generic library gets right by default, and the same
  reasoning applies here).

## Generated/checked-in code

- `CHANGELOG.md` is generated by `auto-changelog` (via `npm version`)
  — don't hand-edit released sections; only append to `[Unreleased]`
  by hand while working.

## Git workflow

- Use [git flow](https://nvie.com/posts/a-successful-git-branching-model/):
  `main` (releases), `develop` (integration), `feature/*`,
  `release/*`, `hotfix/*`, `support/*`.
- No direct commits to `main` or `develop`. Branch, then merge/PR back.
- Before starting work, check out onto a git flow branch
  (`feature/*`, `release/*`, `hotfix/*`, `support/*`) — never work
  directly on `develop`, unless explicitly told to.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>[optional scope]: <description>`.
- Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`,
  `test`, `chore`, `build`, `ci`.
- Breaking changes: `!` after type/scope, or a `BREAKING CHANGE:`
  footer.

## Versioning

- Use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
- `MAJOR` — breaking changes. `MINOR` — backward-compatible features.
  `PATCH` — backward-compatible fixes.
- Bump the version with `npm version <major|minor|patch>` (updates
  `package.json` and regenerates `CHANGELOG.md` via `auto-changelog`)
  as part of the release.
