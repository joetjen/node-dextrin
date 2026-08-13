'use strict';

/**
 * @fileoverview Public entry point. Currently exports the DXN value
 * model only (`src/values/`) — `decode`/`encode`/`decodeBinary`/
 * `encodeBinary` land here in later phases (`.dxn` text codec, then
 * `.dxnb` binary codec), mirroring `Dextrin`'s own four-function API.
 */

const version = require('./version.cjs');
const values = require('./values/index.cjs');

module.exports = { version, ...values };
