const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const { setImmediate: nextTick } = require('node:timers/promises');
const vm = require('node:vm');
const ts = require('typescript');

const serverPath = require.resolve('../server/usage.ts');
const serverRequire = createRequire(serverPath);
const source = ts.transpileModule(
  fs.readFileSync(serverPath, 'utf8') + '\nexports.discoverAllTurns = discoverAllTurns; exports.parseSessionFile = parseSessionFile;\n',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function loadDiscovery() {
  const agentsRoot = path.join('/synthetic-home', '.paseo', 'agents');
  const counts = { active: 0, peak: 0, agents: 0, sessions: 0, restores: 0, writes: 0 };
  const files = Array.from({ length: 32 }, (_, i) => `${i}.json`);
  const fakeFs = {
    async readdir(target) {
      if (target === agentsRoot) return [{ name: 'workspace', isDirectory: () => true }];
      return files;
    },
    async readFile(target) {
      if (target.endsWith('analytics-index.json')) {
        counts.restores++;
        await nextTick();
        throw new Error('No saved index');
      }
      counts.active++;
      counts.peak = Math.max(counts.peak, counts.active);
      await nextTick();
      counts.active--;
      if (target.endsWith('.jsonl')) {
        counts.sessions++;
        return JSON.stringify({ timestamp: '2026-10-21T12:00:00Z', usage: { input: 2, output: 3 } });
      }
      counts.agents++;
      const id = path.basename(target, '.json');
      if (id === '0') return '{invalid';
      if (id === '1') return JSON.stringify({ id, lastUsage: { inputTokens: 7 } });
      return JSON.stringify({ id, persistence: { nativeHandle: `/sessions/${id}.jsonl` } });
    },
    async stat() { return { mtimeMs: 1, size: 100 }; },
    async mkdir() {},
    async writeFile(_target, _data, options) { counts.writes++; assert.equal(options.mode, 0o600); },
    async rename() {},
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    Buffer,
    require(id) {
      if (id === 'node:fs') return {
        createReadStream(target) {
          return (async function* () { yield await fakeFs.readFile(target); })();
        },
      };
      if (id === 'node:fs/promises') return fakeFs;
      if (id === 'node:os') return { homedir: () => '/synthetic-home', tmpdir: () => '/tmp' };
      if (id === '../shared/usage') return {};
      return serverRequire(id);
    },
    process: { env: {} },
  }, { filename: serverPath });
  return { discover: exports.discoverAllTurns, counts };
}

test('concurrent activity requests share one scan with bounded parallel file reads', async () => {
  const { discover, counts } = loadDiscovery();
  const [first, second] = await Promise.all([discover(), discover()]);
  assert.equal(first, second);
  assert.equal(counts.restores, 1);
  assert.equal(counts.agents, 32);
  assert.equal(counts.sessions, 30);
  assert.ok(counts.peak > 1 && counts.peak <= 8, `peak file reads: ${counts.peak}`);
  assert.equal(first.agentsDiscovered, 32);
  assert.equal(first.sessionsParsed, 30);
  assert.equal(first.turns.length, 31);
  assert.equal(first.turns.reduce((total, turn) => total + turn.totalTokens, 0), 157);
});

test('later activity requests check for changes without rereading or rewriting unchanged sessions', async () => {
  const { discover, counts } = loadDiscovery();
  await discover();
  await nextTick();
  assert.equal(counts.writes, 1);
  const later = await discover();
  await nextTick();
  assert.equal(counts.agents, 64);
  assert.equal(counts.sessions, 30);
  assert.equal(counts.restores, 1);
  assert.equal(counts.writes, 1);
  assert.equal(later.turns.length, 31);
});

function loadSessionParser(directory, reads) {
  const exports = {};
  vm.runInNewContext(source, {
    exports, Buffer,
    require(id) {
      if (id === '../shared/usage') return {};
      if (id === 'node:fs') return {
        createReadStream(target, options) {
          reads.push(options.start);
          return fs.createReadStream(target, options);
        },
      };
      return serverRequire(id);
    },
    process: { env: { XDG_STATE_HOME: directory } },
  }, { filename: serverPath });
  return file => exports.parseSessionFile(file, 'default', 'omp', 'synthetic-session');
}

const usageLine = (input, model) => JSON.stringify({
  timestamp: '2026-10-21T12:00:00Z', usage: { input, output: 1 }, ...(model ? { model } : {}),
});

test('appended session records preserve models, line IDs and incomplete UTF-8 tails', async () => {
  const files = require('node:fs/promises');
  const directory = await files.mkdtemp(path.join(require('node:os').tmpdir(), 'usage-parser-test-'));
  try {
    const file = path.join(directory, 'session.jsonl');
    const reads = [];
    const parse = loadSessionParser(directory, reads);
    const first = usageLine(2);
    const model = JSON.stringify({ type: 'model_change', model: 'synthetic-model' });
    const tail = usageLine(3).replace('"usage"', '"label":"例","usage"');
    await files.writeFile(file, first + '\n' + model + '\n' + tail.slice(0, -2), { mode: 0o600 });
    assert.equal((await parse(file)).length, 1);
    await files.appendFile(file, tail.slice(-2) + '\n' + usageLine(4));
    const appended = await parse(file);
    assert.equal(appended.length, 3);
    assert.equal(appended[1].modelId, 'synthetic-model');
    assert.equal(appended[2].id, 'synthetic-session_turn_3');
    assert.ok(reads[1] > 0);
    const fresh = await loadSessionParser(directory, [])(file);
    assert.deepEqual(JSON.parse(JSON.stringify(appended)), JSON.parse(JSON.stringify(fresh)));
    await files.appendFile(file, '\n' + usageLine(5));
    const next = await parse(file);
    assert.equal(next.length, 4);
    assert.equal(next.reduce((sum, turn) => sum + turn.totalTokens, 0), 18);
  } finally {
    await files.rm(directory, { recursive: true, force: true });
  }
});

test('truncated or replaced session logs are rebuilt instead of appended', async () => {
  const files = require('node:fs/promises');
  const directory = await files.mkdtemp(path.join(require('node:os').tmpdir(), 'usage-parser-test-'));
  try {
    const file = path.join(directory, 'session.jsonl');
    const reads = [];
    const parse = loadSessionParser(directory, reads);
    await files.writeFile(file, usageLine(2) + '\n' + usageLine(3) + '\n', { mode: 0o600 });
    await parse(file);
    await files.writeFile(file, usageLine(5));
    const truncated = await parse(file);
    assert.equal(truncated.length, 1);
    assert.equal(truncated[0].totalTokens, 6);
    const replacement = path.join(directory, 'replacement.jsonl');
    await files.writeFile(replacement, usageLine(7) + '\n' + usageLine(8) + '\n', { mode: 0o600 });
    await files.rename(replacement, file);
    const replaced = await parse(file);
    assert.equal(replaced.length, 2);
    assert.equal(replaced.reduce((sum, turn) => sum + turn.totalTokens, 0), 17);
    assert.deepEqual(reads, [0, 0, 0]);
  } finally {
    await files.rm(directory, { recursive: true, force: true });
  }
});
