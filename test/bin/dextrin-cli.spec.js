import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';

const CLI = fileURLToPath(new URL('../../bin/dextrin.js', import.meta.url));

/**
 * @param {string[]} args
 * @param {{cwd?: string}} [opts]
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function run(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd: opts.cwd, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout?.toString() ?? '', stderr: err.stderr?.toString() ?? '' };
  }
}

describe('bin/dextrin.js CLI', () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dextrin-cli-'));
    writeFileSync(join(dir, 'sample.dxn'), '%{x: 1, y: [1 2 3]}');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('with no arguments, prints usage and exits 0', () => {
    const result = run([]);
    expect(result.status).to.equal(0);
    expect(result.stdout).to.include('usage: dextrin');
  });

  it('with an unrecognized command, prints usage and exits 1', () => {
    const result = run(['bogus']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.include('usage: dextrin');
  });

  describe('format', () => {
    it('pretty-prints to stdout by default', () => {
      const result = run(['format', 'sample.dxn'], { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout.trim()).to.equal('%{\n  x: 1\n  y: [\n    1\n    2\n    3\n  ]\n}');
    });

    it('--mode condense produces single-line output', () => {
      const result = run(['format', 'sample.dxn', '--mode', 'condense'], { cwd: dir });
      expect(result.stdout.trim()).to.equal('%{x:1,y:[1 2 3]}');
    });

    it('--in-place rewrites the file instead of printing', () => {
      const result = run(['format', 'sample.dxn', '--mode', 'condense', '--in-place'], { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.equal('');
      expect(readFileSync(join(dir, 'sample.dxn'), 'utf8').trim()).to.equal('%{x:1,y:[1 2 3]}');
    });

    it('--mode pretty keeps every comment beside its entry', () => {
      writeFileSync(join(dir, 'commented.dxn'), '# the config\n%{name: "acme", # the name\n deps: ["a"]}\n');
      const result = run(['format', 'commented.dxn'], { cwd: dir });
      expect(result.stdout).to.equal('# the config\n%{\n  name: "acme"  # the name\n  deps: [\n    "a"\n  ]\n}\n');
    });

    it('--mode condense drops comments: a comment ends its line, and condensed is one', () => {
      writeFileSync(join(dir, 'commented.dxn'), '%{name: "acme"} # the name\n');
      const result = run(['format', 'commented.dxn', '--mode', 'condense'], { cwd: dir });
      expect(result.stdout).to.equal('%{name:"acme"}\n');
    });

    it('rejects an unrecognized --mode', () => {
      const result = run(['format', 'sample.dxn', '--mode', 'bogus'], { cwd: dir });
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('unrecognized --mode');
    });
  });

  describe('validate', () => {
    it('reports success for a well-formed .dxn file', () => {
      const result = run(['validate', 'sample.dxn'], { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.include('OK: sample.dxn is valid .dxn');
    });

    it('reports failure for a malformed file, exit 1, no stack trace', () => {
      writeFileSync(join(dir, 'bad.dxn'), '%{x:');
      const result = run(['validate', 'bad.dxn'], { cwd: dir });
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('bad.dxn:');
      expect(result.stderr.trim().split('\n')).to.have.lengthOf(1);
    });

    it('validates against a --schema/--as pair', () => {
      writeFileSync(join(dir, 'point.dxns'), '%{ Point: %schema{ x: :float, y: :float } }');
      writeFileSync(join(dir, 'point.dxn'), '%Point{x: 1.0, y: 2.0}');
      const result = run(['validate', 'point.dxn', '--schema', 'point.dxns', '--as', 'Point'], { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.include('satisfies schema Point');
    });

    it('reports a schema violation by name', () => {
      writeFileSync(join(dir, 'point.dxns'), '%{ Point: %schema{ x: :float, y: :float } }');
      writeFileSync(join(dir, 'point-bad.dxn'), '%Point{x: 1.0}');
      const result = run(['validate', 'point-bad.dxn', '--schema', 'point.dxns', '--as', 'Point'], { cwd: dir });
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('missing required field "y"');
    });

    it('a nonexistent file fails cleanly, no stack trace', () => {
      const result = run(['validate', 'nonexistent.dxn'], { cwd: dir });
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('nonexistent.dxn');
      expect(result.stderr.trim().split('\n')).to.have.lengthOf(1);
    });
  });

  describe('encode / decode round trip', () => {
    it('encode writes .dxnb, decode reads it back to the same value', () => {
      const encodeResult = run(['encode', 'sample.dxn', '--out', 'sample.dxnb'], { cwd: dir });
      expect(encodeResult.status).to.equal(0);
      expect(existsSync(join(dir, 'sample.dxnb'))).to.equal(true);

      const decodeResult = run(['decode', 'sample.dxnb'], { cwd: dir });
      expect(decodeResult.status).to.equal(0);
      expect(decodeResult.stdout.trim()).to.equal('%{\n  x: 1\n  y: [\n    1\n    2\n    3\n  ]\n}');
    });

    it('encode with no --out writes binary bytes to stdout', () => {
      const result = execFileSync(process.execPath, [CLI, 'encode', 'sample.dxn'], { cwd: dir });
      expect(result.subarray(0, 3)).to.deep.equal(Buffer.from([0x44, 0x58, 0x01]));
    });
  });

  describe('compat', () => {
    /** @param {string} name @param {{[file: string]: string}} files */
    const schemas = (name, files) => {
      const path = join(dir, name);
      mkdirSync(path);
      for (const [file, source] of Object.entries(files)) writeFileSync(join(path, file), source);
      return path;
    };

    it('passes, listing what the materializer has to upgrade', () => {
      const old = schemas('old', { 'user.dxns': '%{User: %schema{name: :string}}' });
      const now = schemas('new', {
        'user.dxns': '%{User: %schema{name: :string}}',
        'user-2.dxns': '%{User: %schema(2){name: :string, email?: :string}}',
      });
      const result = run(['compat', old, now]);
      expect(result.status).to.equal(0);
      expect(result.stdout).to.include('User 1 -> 2: added email');
      expect(result.stdout).to.include('OK: no version discipline problems');
    });

    it('fails on a version whose content changed without a new version', () => {
      const old = schemas('old', { 'user.dxns': '%{User: %schema{name: :string}}' });
      const now = schemas('new', { 'user.dxns': '%{User: %schema{name: :integer}}' });
      const result = run(['compat', old, now]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('User version 1 changed without a new version');
    });

    it('takes a single file as well as a directory', () => {
      writeFileSync(join(dir, 'old.dxns'), '%{User: %schema(2){name: :string}}');
      writeFileSync(join(dir, 'new.dxns'), '%{User: %schema{name: :string}}');
      const result = run(['compat', join(dir, 'old.dxns'), join(dir, 'new.dxns')]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('User went down from version 2 to 1');
    });
  });
});
