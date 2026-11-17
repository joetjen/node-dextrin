// Runs the official JSON-Schema-Test-Suite against the JSON Schema
// converter (T674), as dextrin's test/support/json_schema_suite.ex: each
// case's schema converted to DXNS and compiled, each test's instance read
// as DXN and checked against the root. A reference to the suite's
// `http://localhost:1234/` is the file of that path in `remotes`, given to
// the converter beside the schema; nothing is fetched.
//
// The suite is read from the reference's copy beside this repository,
// `../dextrin/test/fixtures/json-schema-test-suite`, never copied here.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry, Schema, JsonSchema } from '../../src/dextrin.js';

/** The reference's fixtures, beside this repository. */
export const FIXTURES = fileURLToPath(new URL('../../../dextrin/test/fixtures/', import.meta.url));
export const ROOT = join(FIXTURES, 'json-schema-test-suite');

/** The draft directories the suite has, with the draft each is. */
export const DRAFTS = { draft4: '04', draft6: '06', draft7: '07', 'draft2019-09': '2019-09', 'draft2020-12': '2020-12' };

/** Whether the reference's copy of the suite is there to read. */
export function available() {
  return existsSync(join(ROOT, 'tests'));
}

/**
 * Every required test of `dir`: `{id, schema, data, valid}`.
 * @param {string} dir
 */
export function tests(dir) {
  const folder = join(ROOT, 'tests', dir);
  return readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((file) => {
      const cases = /** @type {any[]} */ (JsonSchema.decodeJson(readFileSync(join(folder, file), 'utf8')));
      return cases.flatMap((c) =>
        c.get('tests').map((/** @type {any} */ t) => ({
          id: `${dir}/${basename(file, '.json')}: ${c.get('description')}: ${t.get('description')}`,
          schema: c.get('schema'),
          data: t.get('data'),
          valid: t.get('valid')
        }))
      );
    });
}

/**
 * The ids an exceptions file lists: its lines that begin with a draft.
 * @param {string} path
 */
export function listed(path) {
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('draft'))
  );
}

/**
 * What checking `instance` against `schema` answers: `true` or `false`,
 * or a string saying why the schema did not convert or compile.
 * @param {unknown} schema @param {unknown} instance @param {string} draft
 * @returns {boolean | string}
 */
export function run(schema, instance, draft) {
  const registry = compiled(schema, draft, []);
  if (typeof registry === 'string') return registry;
  try {
    return Schema.check(JsonSchema.jsonValue(instance), registry, 'Root');
  } catch {
    return false;
  }
}

/**
 * @param {unknown} schema @param {string} draft @param {Array<[string, unknown]>} remotes
 * @returns {Registry | string}
 */
function compiled(schema, draft, remotes) {
  /** @type {Array<[string, unknown]>} */
  const sources = [['http://localhost:1234/root.json', schema], ...remotes];
  let document;
  try {
    document = JsonSchema.toDxns(sources, { draft, name: 'Root' }).document;
  } catch (err) {
    const why = /** @type {Error} */ (err).message;
    const m = /resolved: http:\/\/localhost:1234\/([^#\s)]+)/.exec(why);
    if (!m) return why;
    const file = join(ROOT, 'remotes', m[1]);
    if (!existsSync(file) || remotes.some(([where]) => where.includes(m[1]))) return why;
    const remote = JsonSchema.decodeJson(readFileSync(file, 'utf8'));
    return compiled(schema, draft, [...remotes, [`http://localhost:1234/${m[1]}`, remote]]);
  }
  try {
    return Schema.compile(document, new Registry());
  } catch (err) {
    return `compile: ${/** @type {Error} */ (err).message}`;
  }
}
