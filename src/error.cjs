'use strict';

/**
 * @fileoverview One error type for every `dextrin` failure mode —
 * text-parse, printing, and (in later phases) binary/schema failures
 * alike — mirroring `Dextrin.Error`'s "a caller never has to
 * special-case which pipeline produced it" role.
 *
 * **API-shape divergence from Elixir, deliberate**: `Dextrin`'s own
 * functions return `{:ok, _} | {:error, %Dextrin.Error{}}` tuples,
 * idiomatic in an Elixir/`with`-based codebase. `node-dextrin` throws
 * `DXNError` instead — idiomatic JS/Node (same convention
 * `JSON.parse`, most YAML/TOML parsers, etc. already use), not a
 * value-representation choice the "mirror Elixir's shape" goal this
 * project otherwise follows was ever about. A non-throwing variant can
 * be layered on top later if needed; throwing is the default.
 */

class DXNError extends Error {
  /**
   * @param {string} message
   * @param {{stage?: string, offset?: number, cause?: unknown}} [details]
   */
  constructor(message, details = {}) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = 'DXNError';
    /** @type {string} */
    this.stage = details.stage ?? 'unknown';
    /** @type {number | undefined} */
    this.offset = details.offset;
  }

  /**
   * Wraps any thrown error from the text/binary pipelines into a
   * `DXNError`, preserving a lexer/parser's own `offset` when present
   * and passing everything else through as `cause` — so callers only
   * ever need to catch one error type from `decode`/`encode`.
   * @param {unknown} err
   * @param {string} stage
   * @returns {DXNError}
   */
  static wrap(err, stage) {
    if (err instanceof DXNError) return err;
    const message = err instanceof Error ? err.message : String(err);
    const offset = err instanceof Error && typeof (/** @type {any} */ (err).offset) === 'number' ? (/** @type {any} */ (err).offset) : undefined;
    return new DXNError(message, { stage, offset, cause: err });
  }
}

module.exports = DXNError;
