'use strict';

/**
 * @fileoverview The three forms' names on the wire and on disk, and a
 * cheap test of whether a body is worth decoding as one -- DXN.md §6,
 * mirroring `Dextrin.Format`, so every implementation answers the same.
 *
 * A form is `'text'` (`.dxn`), `'binary'` (`.dxnb`) or `'schema'`
 * (`.dxns`).
 *
 * `identifies` is a prefix test, not a parse: `true` means "worth
 * attempting", never "valid". Its text rule mainly tells DXN from JSON in
 * a body that comes without a type, so it accepts only what JSON cannot
 * start with: after whitespace, comments and an optional header, a `%` --
 * a map, a struct or a schema document. A list or a scalar is DXN too,
 * but it overlaps with JSON, and stays unrecognised on purpose (Jan,
 * 2026-10-20).
 */

/** @typedef {'text' | 'binary' | 'schema'} Form */

/** @type {Record<Form, string>} */
const MEDIA_TYPES = {
  text: 'application/vnd.dxn',
  binary: 'application/vnd.dxnb',
  schema: 'application/vnd.dxns',
};

/** @type {Record<Form, string>} */
const EXTENSIONS = { text: '.dxn', binary: '.dxnb', schema: '.dxns' };

/**
 * The media type of `form`.
 * @param {Form} form
 * @returns {string}
 */
function mediaType(form) {
  return MEDIA_TYPES[form];
}

/**
 * The file extension of `form`, with its dot.
 * @param {Form} form
 * @returns {string}
 */
function extension(form) {
  return EXTENSIONS[form];
}

/**
 * The form `type` names: one of the three, or text for any type with a
 * structured `+dxn` suffix (`application/vnd.acme.event+dxn`); `null` for
 * anything else. There is no `+dxnb` suffix. Media types compare without
 * regard to case; the caller strips any parameters (`; charset=...`).
 * @param {string} type
 * @returns {Form | null}
 */
function form(type) {
  const lower = type.toLowerCase();
  for (const [name, known] of Object.entries(MEDIA_TYPES)) {
    if (known === lower) return /** @type {Form} */ (name);
  }
  return /^[^/\s;]+\/[^/\s;+]+[^/\s;]*\+dxn$/.test(lower) ? 'text' : null;
}

/**
 * Whether `body` is worth decoding as `as`. Binary: the envelope's magic,
 * `DX`, and a version byte (DXN.md §2.1). Text and schemas: after
 * whitespace (commas included), `#` comments and an optional `@dxn "..."`
 * header, the first character is `%`.
 * @param {string | Uint8Array} body
 * @param {Form} as
 * @returns {boolean}
 */
function identifies(body, as) {
  if (as === 'binary') {
    return typeof body !== 'string' && body.length >= 3 && body[0] === 0x44 && body[1] === 0x58;
  }
  if (typeof body !== 'string') return false;
  const rest = skipTrivia(skipHeader(skipTrivia(body)));
  return rest.startsWith('%');
}

/**
 * `text` without its leading whitespace and comments.
 * @param {string} text
 */
function skipTrivia(text) {
  return text.replace(/^(?:[ \t\n\r,]|#[^\n]*)*/, '');
}

/**
 * `text` without a leading header, `@dxn "..."`.
 * @param {string} text
 */
function skipHeader(text) {
  return text.replace(/^@dxn[ \t\n\r,]*"[^"\n]*"/, '');
}

module.exports = { mediaType, extension, form, identifies };
