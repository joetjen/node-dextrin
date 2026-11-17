import { expect } from 'chai';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { available, tests, run, listed, DRAFTS, FIXTURES } from '../support/json-schema-suite.js';

// The parity test of the JSON Schema converter (T674, dextrin's
// design/json-schema.md Q7, as its test/convert/json_schema_suite_test.exs):
// every required test of the official JSON-Schema-Test-Suite, for drafts
// 4, 6, 7, 2019-09 and 2020-12, passes once converted to DXNS -- except
// those the reference lists, by reason, in
// test/fixtures/json-schema-exceptions.txt, and those node's own addendum
// lists, test/fixtures/json-schema-exceptions-node.txt. A listed test that
// passes fails this too, so the lists stay true.
//
// The suite and the reference's list are read from ../dextrin; without it
// -- CI checks out this repository alone -- the test is skipped, saying so.
const ADDENDUM = fileURLToPath(new URL('../fixtures/json-schema-exceptions-node.txt', import.meta.url));

describe('the JSON-Schema-Test-Suite, converted', function () {
  this.timeout(600_000);

  if (!available()) {
    it(`is skipped: the reference's suite is not at ${join(FIXTURES, 'json-schema-test-suite')}`);
    return;
  }

  const exceptions = new Set([...listed(join(FIXTURES, 'json-schema-exceptions.txt')), ...listed(ADDENDUM)]);

  for (const [dir, draft] of Object.entries(DRAFTS)) {
    it(`the ${dir} suite passes, but for the listed exceptions`, () => {
      const failing = [];
      const fixed = [];
      for (const t of tests(dir)) {
        const passed = run(t.schema, t.data, draft) === t.valid;
        if (!passed && !exceptions.has(t.id)) failing.push(t.id);
        if (passed && exceptions.has(t.id)) fixed.push(t.id);
      }
      expect(failing, `failing, not listed:\n${failing.join('\n')}`).to.deep.equal([]);
      expect(fixed, `listed, but passing now:\n${fixed.join('\n')}`).to.deep.equal([]);
    });
  }
});
