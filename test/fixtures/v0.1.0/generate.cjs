// Writes the `.dxnb` fixtures beside it with node-dextrin 0.1.0, for the
// releases after it to read back (`test/binary/v0_1_0.spec.js`). Run it against
// a checkout of `v0.1.0`, never against the current code:
//
//     git worktree add ../node-dextrin-010 v0.1.0
//     node test/fixtures/v0.1.0/generate.cjs ../node-dextrin-010 OUT_DIR
//
// The value document and the schema are the Elixir fixtures' own
// (`dextrin`'s `test/fixtures/v0.1.3`), so the two can be compared.
const fs = require('node:fs');
const path = require('node:path');

const [checkout, out] = process.argv.slice(2);
const { decode, encodeBinary, Schema, Registry, DXNStruct } = require(path.resolve(checkout, 'src/dextrin.cjs'));
const here = __dirname;
fs.mkdirSync(out, { recursive: true });

const values = fs.readFileSync(path.join(here, 'values.dxn'), 'utf8');
fs.writeFileSync(path.join(out, 'values.dxnb'), encodeBinary(decode(values)));

const registry = Schema.compile(decode(fs.readFileSync(path.join(here, 'user.dxns'), 'utf8')), new Registry());
// 0.1.0 decodes a schema struct to a plain object, so a struct is built
// directly, the way an application hands one to the encoder.
const user = DXNStruct.positional('User', ['Ann', 'ann@example.com', decode(':admin')]);
const bytes = encodeBinary(user, { registry });
fs.writeFileSync(path.join(out, 'user_full.dxnb'), bytes);
console.log(`user_full: ${Buffer.from(bytes).toString('hex')}`);
