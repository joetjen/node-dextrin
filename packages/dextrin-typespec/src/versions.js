// Versioned namespaces as Way B (dextrin/design/typespec.md, "Way B"):
// each declaration is projected at every TypeSpec version; projections that
// stay the same from one version to the next share a DXNS version, numbered
// by the TypeSpec version where it first appears. A model is a
// `%schema(N)`, a named type `%type(N)[T]` from version 2 on, and a
// reference to a declaration with several versions is pinned (`Color(2)`).
// Each DXNS version is a file of its own, `Name.dxns` or `Name-vN.dxns`,
// carrying the TypeSpec version's name in `meta`.

import { getVersion, getAvailabilityMap } from "@typespec/versioning";
import { decode, encode, DXNStruct, DXNTuple, DXNKeyword, DXNMap } from "@joetjen/dextrin";
import { declarationText, atVersion } from "./types.js";

/** `[version, timeline]` for a versioned namespace, or `undefined`. */
export function timeline(program, ns) {
  const versions = getVersion(program, ns)?.getVersions();
  return versions && versions.length ? versions : undefined;
}

/**
 * The files of a versioned namespace's declarations: `[{name, version, text}]`,
 * `text` the entry's DXN value text, `version` its DXNS version.
 */
export function versionedEntries(program, decls, versions) {
  // decl -> DXNS version at each TypeSpec version (null where absent).
  let numbers = new Map(decls.map((d) => [d, versions.map(() => null)]));
  let texts = new Map();

  for (let round = 0; round < 10; round++) {
    const pinsAt = (i) =>
      new Map(
        [...numbers]
          .filter(([, ns]) => new Set(ns.filter((n) => n !== null)).size > 1)
          .map(([d, ns]) => [d, ns[i]]),
      );

    texts = new Map(
      decls.map((d) => [
        d,
        versions.map((version, index) =>
          atVersion({ program, version, index, versions, pins: pinsAt(index) }, () =>
            present(program, d, version) ? declarationText(program, d) : null,
          ),
        ),
      ]),
    );

    const next = new Map(decls.map((d) => [d, numbered(texts.get(d))]));

    const same = decls.every((d) => numbers.get(d).every((n, i) => n === next.get(d)[i]));
    numbers = next;
    if (same && round > 0) break;
  }

  const out = [];
  for (const d of decls) {
    const ns = numbers.get(d);
    const t = texts.get(d);
    ns.forEach((n, i) => {
      if (n === null || n !== i + 1) return;
      out.push({ name: d.name, version: n, text: versioned(t[i], n, versions[i]) });
    });
  }
  return out;
}

// The DXNS version at each TypeSpec version: a new one, numbered by its
// position, wherever the projection differs from the one before; none
// where the declaration is absent.
function numbered(texts) {
  const out = [];
  texts.forEach((text, i) => {
    if (text === null || text === undefined) out.push(null);
    else if (i > 0 && texts[i - 1] === text) out.push(out[i - 1]);
    else out.push(i + 1);
  });
  return out;
}

// Whether `decl` exists at `version`.
function present(program, decl, version) {
  const map = getAvailabilityMap(program, decl);
  if (!map) return true;
  const here = map.get(version.name);
  return here === "Added" || here === "Available";
}

// The entry's text at DXNS version `n`: a schema's struct gets the version,
// a named type is wrapped in `%type(n)[...]` from 2 on, and `meta` says
// which TypeSpec version it is.
function versioned(text, n, version) {
  let value = decode(text);
  let inner = value;
  let notes = new DXNMap();

  if (value instanceof DXNTuple && value.items[0] instanceof DXNKeyword && value.items[0].name === "doc") {
    inner = value.items[1];
    notes = value.items[2];
  }

  if (inner instanceof DXNStruct && inner.name === "schema") {
    inner.version = n;
  } else if (n > 1) {
    inner = new DXNStruct("type", { type: "positional", values: [inner] }, n);
  }

  let meta = [...notes.entries()].find(([k]) => k instanceof DXNKeyword && k.name === "meta")?.[1];
  if (!meta) {
    meta = new DXNMap();
    notes.set(new DXNKeyword("meta"), meta);
  }
  meta.set("typespec.version", version.value);

  return encode(new DXNTuple([new DXNKeyword("doc"), inner, notes]));
}
