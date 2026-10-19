// A TypeScript program using the package as the DXN VS Code extension
// does, typechecked against the declarations `npm run types` writes
// (`npm run typecheck:consumer`). It is never run; that it compiles is
// the test.
import { decode, encode, Document, DXNError, Registry, Schema, Std } from '@joetjen/dextrin';
import dextrin = require('@joetjen/dextrin');

const value: unknown = decode('%{a: 1}');
const text: string = encode(value, { pretty: true });
const doc = Document.parse('%{a: 1} # one\n');
const laidOut: string = Document.format(doc);
const registry: Registry = Schema.compile(decode('%{U: %schema{a: :string}}'), Std.registry());

try {
  decode('%{1.5 => 1}', { registry });
} catch (err) {
  if (err instanceof DXNError) {
    const refusal: DXNError = err;
    void refusal;
    const where: number | undefined = err.offset;
    const category: string | null = err.category;
    void where;
    void category;
  }
}

const same: string = dextrin.encode(dextrin.decode('[1]'));
void text;
void laidOut;
void same;
