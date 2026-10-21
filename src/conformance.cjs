'use strict';

/**
 * @fileoverview This implementation's answers to the Dextrin Conformance
 * Suite.
 *
 * The suite runs every DXN implementation against the same cases,
 * reaching each through its `conformance` command (`dextrin conformance
 * REQUEST ANSWER` here) with a JSON request, and reading a JSON answer:
 *
 *     {"cases":   [{"id": "scalars: an integer", "operation": "decode", "text": "42"}]}
 *     {"results": [{"id": "scalars: an integer", "canonical": "42"}]}
 *
 * `decode` reads `text` and answers its canonical form (`DXN.md` §1.5);
 * `decode-binary` reads `binary`, a base64 `.dxnb` document, and answers
 * its canonical form; `encode` reads `text` and answers the exact bytes
 * as base64. A case may carry `schemas`, `.dxns` sources compiled in
 * order into the registry it runs with, and `strict: true`, which decodes
 * strictly (`DXN.md` §4.7). `format` reads `text` as a document and
 * answers it laid out, comments kept, as `text`; `edit` reads `text` as a
 * document, makes its `edits` in order -- `replace`, `delete`, `insert`,
 * `update`, their `path`, `value` and `where` written as DXN text -- and
 * answers the document rendered, as `text`; a refused edit answers
 * `document/<reason>`. `media-type` answers the form `media-type` names
 * (DXN.md §6) as `form` -- `text`, `binary`, `schema` or `none`;
 * `identify` whether `text` is worth decoding as its `form`, `text` or
 * `schema`, and `identify-binary` whether `binary`, base64, is a `.dxnb`
 * document, each as `identified`: `true` or `false`. Any of them may
 * answer `error` instead: the error's category
 * (`DXN.md` §5), never its message. An error with no category yet is
 * `uncategorised`, which no case expects, so it shows as a disagreement
 * rather than passing by accident.
 */

const parser = require('./text/parser.cjs');
const binaryDecoder = require('./binary/decoder.cjs');
const binaryEncoder = require('./binary/encoder.cjs');
const { canonical } = require('./canonical.cjs');
const Registry = require('./registry.cjs');
const Schema = require('./schema.cjs');
const Document = require('./document.cjs');
const Format = require('./format.cjs');

/**
 * The answer to a decoded JSON request: one result per case, in order.
 * @param {{cases: Array<Case>}} request
 * @returns {{results: Array<Record<string, string>>}}
 */
function answer(request) {
  return { results: request.cases.map((c) => ({ id: c.id, ...outcome(c) })) };
}

/**
 * @typedef {{id: string, operation: string, text?: string, binary?: string, schemas?: string[], strict?: boolean, edits?: Array<Record<string, string>>, 'media-type'?: string, form?: string}} Case
 */

/** @param {Case} c @returns {Record<string, string>} */
function outcome(c) {
  try {
    const registry = loaded(c.schemas ?? []);
    const opts = { registry, strict: c.strict ?? false };
    switch (c.operation) {
      case 'decode':
        return { canonical: canonical(parser.parse(String(c.text), opts)) };
      case 'decode-binary':
        return { canonical: canonical(binaryDecoder.decode(new Uint8Array(Buffer.from(String(c.binary), 'base64')), opts)) };
      case 'format':
        return { text: Document.format(Document.parse(String(c.text), opts)) };
      case 'edit':
        return { text: Document.render(edited(Document.parse(String(c.text), opts), c.edits ?? [], opts)) };
      case 'encode': {
        const value = Schema.validateEncodeTree(parser.parse(String(c.text), opts), registry);
        return { binary: Buffer.from(binaryEncoder.encode(value, { registry })).toString('base64') };
      }
      case 'media-type':
        return { form: Format.form(String(c['media-type'])) ?? 'none' };
      case 'identify':
        return { identified: String(Format.identifies(String(c.text), c.form === 'schema' ? 'schema' : 'text')) };
      case 'identify-binary':
        return { identified: String(Format.identifies(new Uint8Array(Buffer.from(String(c.binary), 'base64')), 'binary')) };
      default:
        return { error: `unsupported operation ${JSON.stringify(c.operation)}` };
    }
  } catch (err) {
    const category = err instanceof Error ? /** @type {any} */ (err).category : undefined;
    return { error: typeof category === 'string' ? category : 'uncategorised' };
  }
}

/**
 * `doc` after `edits`, made in order; each one's path, value and where
 * are DXN text, read by this implementation's own parser.
 * @param {import('./document.cjs').Doc} doc
 * @param {Array<Record<string, string>>} edits
 * @param {{registry: import('./registry.cjs'), strict: boolean}} opts
 */
function edited(doc, edits, opts) {
  const read = (/** @type {string} */ text) => parser.parse(text, opts);
  const path = (/** @type {string} */ text) => /** @type {import('./values/list.cjs')} */ (read(text)).items;
  let current = doc;
  for (const edit of edits) {
    if (edit.op === 'replace') current = Document.replace(current, path(edit.path), read(edit.value));
    else if (edit.op === 'delete') current = Document.delete(current, path(edit.path));
    else if (edit.op === 'insert') current = Document.insert(current, path(edit.path), read(edit.where), read(edit.value));
    else if (edit.op === 'update') {
      const onAmbiguity = /** @type {'safe' | 'guess' | 'error'} */ (edit.on_ambiguity ?? 'safe');
      if (!['safe', 'guess', 'error'].includes(onAmbiguity)) throw new Error(`unknown on_ambiguity ${JSON.stringify(onAmbiguity)}`);
      current = Document.update(current, read(edit.value), { onAmbiguity }).doc;
    } else throw new Error(`unknown edit ${JSON.stringify(edit.op)}`);
  }
  return current;
}

/**
 * A case's schemas, compiled in order into one registry.
 * @param {string[]} sources
 * @returns {import('./registry.cjs')}
 */
function loaded(sources) {
  return sources.reduce((registry, source) => Schema.compile(parser.parse(source), registry), new Registry());
}

module.exports = { answer };
