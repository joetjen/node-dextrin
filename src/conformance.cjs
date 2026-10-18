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
 * as base64. Any of them may answer `error` instead: the error's category
 * (`DXN.md` §5), never its message. An error with no category yet is
 * `uncategorised`, which no case expects, so it shows as a disagreement
 * rather than passing by accident.
 */

const parser = require('./text/parser.cjs');
const binaryDecoder = require('./binary/decoder.cjs');
const binaryEncoder = require('./binary/encoder.cjs');
const { canonical } = require('./canonical.cjs');

/**
 * The answer to a decoded JSON request: one result per case, in order.
 * @param {{cases: Array<Record<string, string>>}} request
 * @returns {{results: Array<Record<string, string>>}}
 */
function answer(request) {
  return { results: request.cases.map((c) => ({ id: c.id, ...outcome(c) })) };
}

/** @param {Record<string, string>} c @returns {Record<string, string>} */
function outcome(c) {
  try {
    switch (c.operation) {
      case 'decode':
        return { canonical: canonical(parser.parse(c.text)) };
      case 'decode-binary':
        return { canonical: canonical(binaryDecoder.decode(new Uint8Array(Buffer.from(c.binary, 'base64')))) };
      case 'encode':
        return { binary: Buffer.from(binaryEncoder.encode(parser.parse(c.text))).toString('base64') };
      default:
        return { error: `unsupported operation ${JSON.stringify(c.operation)}` };
    }
  } catch (err) {
    const category = err instanceof Error ? /** @type {any} */ (err).category : undefined;
    return { error: typeof category === 'string' ? category : 'uncategorised' };
  }
}

module.exports = { answer };
