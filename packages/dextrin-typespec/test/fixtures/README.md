# Fixtures

One directory per area of the construct table in
dextrin/design/typespec.md, each a `main.tsp` and what the emitter must
write for it: `expected.dxns` for a single namespace file, or an
`expected/` tree when versions or several namespaces make several files.
The test decodes both sides and compares values; the exact text is
pinned by a snapshot, and a second run must write the same bytes.
