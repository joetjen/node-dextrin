import { expect } from 'chai';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// priv/schema/std.dxns is the standard library's source; the module the
// package loads it from is written from it by `npm run std`. One that
// was not regenerated after the file changed would ship last version's
// standard library.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the standard library source', () => {
  it('is the text of priv/schema/std.dxns', () => {
    expect(require('../../src/schema/std-source.cjs')).to.equal(
      fs.readFileSync(path.join(root, 'priv', 'schema', 'std.dxns'), 'utf8')
    );
  });
});
