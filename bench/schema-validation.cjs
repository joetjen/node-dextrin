'use strict';
// How long decoding and a schema check take, stage by stage, on a schema
// set more complex than any one would meet in practice
// (bench/schemas/universe.dxns) -- the same benchmark as the Elixir
// reference's bench/schema_validation.exs, on the very same data sets,
// which the reference's generator writes:
//
//     (cd ../dextrin && mix run bench/generate_universes.exs 2026 2>/dev/null) \
//       | node bench/schema-validation.cjs           # for 10 minutes
//     ... | node bench/schema-validation.cjs 60      # for 60 seconds
//
// In a loop until the time is up: read a data set (one Universe as DXN
// text, about 30% of them with exactly one error of 44 kinds), then time
// it, stage by stage:
//
// - lex:    the text into tokens (the lexer's `tokenize`);
// - parse:  the tokens into values (`decode`, less the lexing): this
//           parser builds the values as it parses;
// - decode: text to values, the two together;
// - check:  `Schema.check` against Universe;
// - total:  decode and check.
//
// A stage's time is a difference of two runs, so a short one can come out
// slightly below zero. Reading is not timed. The first 200 data sets warm
// up, untimed, as in the reference.
//
// Every verdict is compared with what the generator meant; a wrong one is
// counted as a mismatch and the run exits 1. Six data sets are written to
// tmp/bench/schema-validation/ as formatted DXN: for the good ones and the
// bad ones, the fastest, the slowest and the one closest to the mean total
// as the run went.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { decode, encode, Registry, Schema } = require('../src/dextrin.cjs');
const { tokenize } = require('../src/text/lexer.cjs');

const SCHEMAS = path.join(__dirname, 'schemas', 'universe.dxns');
const SAMPLES = path.join('tmp', 'bench', 'schema-validation');
const WARM_UP = 200;
const STAGES = ['lex', 'parse', 'decode', 'check', 'total'];

const now = () => process.hrtime.bigint();

async function run(seconds) {
  const registry = Schema.compile(decode(fs.readFileSync(SCHEMAS, 'utf8')), new Registry());
  const measure = (text) => {
    let t0 = now();
    tokenize(text);
    const lex = Number(now() - t0);
    t0 = now();
    const value = decode(text);
    const dec = Number(now() - t0);
    t0 = now();
    let ok = true;
    try { Schema.check(value, registry, 'Universe'); } catch { ok = false; }
    const check = Number(now() - t0);
    return [ok, { lex, parse: dec - lex, decode: dec, check, total: dec + check }];
  };

  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const acc = newReport();
  let seen = 0;
  let deadline = null;

  for await (const line of lines) {
    // A data set is ERROR<tab>TEXT; anything else on the stream -- Mix's
    // own compile messages, if the generator had to compile first -- is
    // skipped.
    const tab = line.indexOf('\t');
    if (tab < 1 || !/^[-a-z_]+$/.test(line.slice(0, tab))) continue;
    const error = line.slice(0, tab) === '-' ? null : line.slice(0, tab);
    const text = line.slice(tab + 1);
    seen++;
    if (seen <= WARM_UP) {
      measure(text);
      if (seen === WARM_UP) {
        console.log(`Timing data sets against Universe for ${seconds} s (after ${WARM_UP} untimed)...`);
        deadline = Date.now() + seconds * 1000;
      }
      continue;
    }
    const [ok, times] = measure(text);
    add(acc, error, ok, times, text);
    if (Date.now() >= deadline) break;
  }
  lines.close();
  process.stdin.destroy();

  print(acc, seconds);
  if (acc.wrong.length > 0) {
    console.log(`\n${acc.wrong.length} verdicts did not match what the data set was meant to be; the first ones:`);
    for (const [i, error, ok] of acc.wrong.slice(0, 10)) console.log(`  #${i}: meant ${error ?? 'good'}, got ${ok ? 'ok' : 'refused'}`);
    process.exit(1);
  }
  console.log('\nEvery verdict matched what the data set was meant to be.');
  writeSamples(acc.samples);
}

// ---- collecting -------------------------------------------------------------------

function newReport() {
  return {
    n: 0,
    stages: Object.fromEntries(STAGES.map((s) => [s, []])),
    good: { check: [], total: [] },
    bad: { check: [], total: [] },
    kinds: new Map(),
    wrong: [],
    samples: { good: null, bad: null },
  };
}

function add(acc, error, ok, times, text) {
  const n = ++acc.n;
  for (const s of STAGES) acc.stages[s].push(times[s]);
  const side = error ? acc.bad : acc.good;
  side.check.push(times.check);
  side.total.push(times.total);
  if (error) {
    if (!acc.kinds.has(error)) acc.kinds.set(error, []);
    acc.kinds.get(error).push(times.check);
  }
  if (ok !== (error === null)) acc.wrong.push([n, error, ok]);
  see(acc.samples, error ? 'bad' : 'good', times.total, [n, error, text]);
}

/** The fastest, the slowest and the one closest to the running mean total. */
function see(samples, label, ns, data) {
  const s = samples[label];
  if (!s) { samples[label] = { n: 1, sum: ns, fastest: [ns, data], slowest: [ns, data], average: [ns, data] }; return; }
  s.n++; s.sum += ns;
  const mean = s.sum / s.n;
  if (ns < s.fastest[0]) s.fastest = [ns, data];
  if (ns > s.slowest[0]) s.slowest = [ns, data];
  if (Math.abs(ns - mean) < Math.abs(s.average[0] - mean)) s.average = [ns, data];
}

function writeSamples(samples) {
  fs.mkdirSync(SAMPLES, { recursive: true });
  for (const label of ['good', 'bad']) {
    const s = samples[label];
    if (!s) continue;
    for (const which of ['fastest', 'average', 'slowest']) {
      const [ns, [i, error, text]] = s[which];
      const what = error ? `error ${error}` : 'no error';
      const body = encode(decode(text), { pretty: true });
      fs.writeFileSync(path.join(SAMPLES, `${which}-${label}.dxn`), `# Data set #${i}, ${what}: decoded and checked in ${us(ns)} µs.\n${body}\n`);
    }
  }
  console.log(`\nSix data sets written to ${SAMPLES}/: the fastest, the slowest and the one`);
  console.log('closest to the mean, of the good ones and of the bad ones.');
}

// ---- report ---------------------------------------------------------------------

const HEAD = ['', 'count', 'total ms', 'mean µs', 'stddev µs', 'min µs', 'median µs', 'p90 µs', 'p99 µs', 'p99.9 µs', 'max µs'];

function print(acc, seconds) {
  const fmt = (n) => n.toLocaleString('en-US');
  console.log(`\n${fmt(acc.n)} data sets in ${seconds} s: ${fmt(Math.floor(acc.n / Math.max(seconds, 1)))} a second, reading included.\n`);
  console.log('Each stage, all data sets:\n');
  console.log(row(HEAD));
  for (const s of STAGES) console.log(row(stats(s, acc.stages[s])));
  console.log('\nThe check and the total, good and bad:\n');
  console.log(row(HEAD));
  for (const label of ['good', 'bad']) for (const what of ['check', 'total']) console.log(row(stats(`${what}, ${label}`, acc[label][what])));
  console.log('\nThe check of the bad ones, by error:\n');
  console.log(row(HEAD));
  for (const kind of [...acc.kinds.keys()].sort()) console.log(row(stats(kind, acc.kinds.get(kind))));
}

function stats(name, times) {
  const n = times.length;
  if (n === 0) return [name, '0', ...Array(9).fill('-')];
  const sorted = Float64Array.from(times).sort();
  const total = sorted.reduce((a, t) => a + t, 0);
  const mean = total / n;
  const variance = sorted.reduce((a, t) => a + (t - mean) * (t - mean), 0) / n;
  const at = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
  return [name, n.toLocaleString('en-US'), us(total / 1000), us(mean), us(Math.sqrt(variance)), us(sorted[0]),
    us(at(0.5)), us(at(0.9)), us(at(0.99)), us(at(0.999)), us(sorted[n - 1])];
}

/** Nanoseconds as microseconds, one decimal; a total given in µs comes out in ms. */
function us(ns) { return (ns / 1000).toFixed(1); }

function row([first, ...rest]) { return first.padEnd(22) + rest.map((c) => c.padStart(11)).join(''); }

run(process.argv[2] ? Number(process.argv[2]) : 600);
