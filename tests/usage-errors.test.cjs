const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { promisify } = require('node:util');
const vm = require('node:vm');
const ts = require('typescript');

const serverPath = require.resolve('../server/usage.ts');
const serverRequire = createRequire(serverPath);
const source = ts.transpileModule(
  readFileSync(serverPath, 'utf8') + '\nexports.runCodexBar = runCodexBar;\n',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

async function fetchWithResult(result) {
  const execFile = () => {};
  execFile[promisify.custom] = async () => {
    if (result instanceof Error) throw result;
    return { stdout: JSON.stringify(result) };
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: (id) => {
      if (id === 'node:child_process') return { execFile };
      if (id === '../shared/usage') return {};
      return serverRequire(id);
    },
    process: { env: { CODEXBAR_BIN: '/synthetic/codexbar' } },
  }, { filename: serverPath });
  return exports.runCodexBar('codex', false);
}

test('process diagnostics never escape into usage snapshots', async () => {
  const marker = 'synthetic-private-value';
  const error = Object.assign(new Error(`Command failed: ${marker}`), {
    stdout: `invalid JSON ${marker}`,
    stderr: marker,
  });
  const usage = await fetchWithResult(error);
  assert.equal(usage.error, 'CodexBar could not load usage. Check its configuration and try again.');
  assert.ok(!JSON.stringify(usage).includes(marker));
});

test('timeouts return safe, actionable messages', async () => {
  const usage = await fetchWithResult(Object.assign(new Error('private diagnostics'), { killed: true }));
  assert.equal(usage.error, 'CodexBar usage request timed out. Try refreshing later.');
});

test('missing CLI retains installation guidance', async () => {
  const usage = await fetchWithResult(Object.assign(new Error('private diagnostics'), { code: 'ENOENT' }));
  assert.match(usage.error, /^CodexBar CLI not found\./);
  assert.ok(!usage.error.includes('private diagnostics'));
});

test('structured provider failures survive nonzero CLI exits', async () => {
  const error = Object.assign(new Error('private diagnostics'), {
    stdout: JSON.stringify([{ error: { message: 'Rate limited. Try later.' } }]),
  });
  const usage = await fetchWithResult(error);
  assert.equal(usage.error, 'Rate limited. Try later.');
});

test('successful usage still clamps provider percentages', async () => {
  const usage = await fetchWithResult([{ usage: { primary: { usedPercent: 120 } } }]);
  assert.equal(usage.error, null);
  assert.equal(usage.windows[0].usedPercent, 100);
});
