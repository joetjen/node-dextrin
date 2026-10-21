import { expect } from 'chai';
import { buildSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// **The package survives a bundler**, as the DXN VS Code extension
// bundles it: one file, run from a directory that holds nothing else --
// no `priv/`, no `src/`. It read the standard schemas off disk next to
// its own source, and its ES module entry needed `import.meta.url`,
// which a CommonJS bundle does not have; both broke at load.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const bundledRun = (entrySource) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dextrin-bundle-'));
  const entry = path.join(dir, 'entry.mjs');
  fs.writeFileSync(entry, entrySource);
  // Installed as a package is, so that `exports` decides which entry an
  // `import` and a `require` get (an alias to the directory would load
  // `main` for both); the bundle runs from a directory of its own.
  fs.mkdirSync(path.join(dir, 'node_modules', '@joetjen'), { recursive: true });
  fs.symlinkSync(root, path.join(dir, 'node_modules', '@joetjen', 'dextrin'), 'dir');
  const outdir = path.join(dir, 'run');
  fs.mkdirSync(outdir);
  const outfile = path.join(outdir, 'out.cjs');
  buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  return execFileSync(process.execPath, [outfile], { cwd: outdir, encoding: 'utf8' }).trim();
};

// What both entries are asked: a standard schema, which is what read
// `priv/` at load, and value equality, whose ES module wrapper reached
// its CommonJS module through `import.meta.url` too.
const probe = (dextrin) => `
  ${dextrin}.Std.registry();
  console.log(${dextrin}.encode(${dextrin}.decode('%{a: 1}')), ${dextrin}.Std.source().includes('PositiveInteger'),
              ${dextrin}.dxnEquals(${dextrin}.decode('[1]'), ${dextrin}.decode('[1]')));
`;

describe('the package, bundled', () => {
  it('runs from an import, with no files beside the bundle', () => {
    expect(bundledRun(`import * as dextrin from '@joetjen/dextrin';\n${probe('dextrin')}`)).to.equal('%{a:1} true true');
  });

  it('and from a require', () => {
    expect(bundledRun(`const dextrin = require('@joetjen/dextrin');\n${probe('dextrin')}`)).to.equal('%{a:1} true true');
  });
});
