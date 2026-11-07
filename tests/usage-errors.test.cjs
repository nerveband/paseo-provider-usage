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
  readFileSync(serverPath, 'utf8') + '\nexports.runCodexBar = runCodexBar;\nexports.normalize = normalize;\n',
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

async function normalizePayload(providerId, payload) {
  const execFile = () => {};
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: (id) => {
      if (id === 'node:child_process') return { execFile };
      if (id === '../shared/usage') return {};
      return serverRequire(id);
    },
    process: { env: {} },
  }, { filename: serverPath });
  return exports.normalize(providerId, payload);
}

test('antigravity keeps the labelled extra rate windows without duplicates', async () => {
  const usage = await normalizePayload('antigravity', {
    usage: {
      primary: { usedPercent: 100 },
      secondary: { usedPercent: 0 },
      extraRateWindows: [
        { id: 'gemini-5h', title: 'Gemini 5-hour', window: { usedPercent: 100 } },
        { id: 'gemini-weekly', title: 'Gemini weekly', window: { usedPercent: 53.5546 } },
        { id: 'claude-5h', title: 'Claude/GPT 5-hour', window: { usedPercent: 0 } },
        { id: 'claude-weekly', title: 'Claude/GPT weekly', window: { usedPercent: 0 } },
      ],
    },
    rateWindowLabels: { primary: 'Gemini Models', secondary: 'Claude and GPT' },
  });

  assert.equal(
    usage.windows.map((window) => window.label).join('|'),
    'Gemini 5-hour|Gemini weekly|Claude/GPT 5-hour|Claude/GPT weekly',
  );
  assert.equal(Math.round(usage.windows[1].usedPercent), 54);
});

test('codex exposes its credit balance and reset credits', async () => {
  const usage = await normalizePayload('codex', {
    usage: {
      providerCost: {
        balance: 56641.55847,
        currencyCode: 'Credits',
        period: 'Extra usage',
        used: 0,
        limit: 0,
      },
      credits: { remaining: 56641.55847, creditsAvailable: true },
      codexResetCredits: {
        availableCount: 2,
        credits: [
          { expires_at: '2026-12-01T22:46:09Z' },
          { expires_at: '2026-11-30T20:15:52Z' },
        ],
      },
    },
  });

  const credits = usage.spend.groups.find((group) => group.title === 'Credits');
  assert.equal(credits.rows[0].value, '56,641.56');
  const resets = usage.spend.groups.find((group) => group.title === 'Rate limit resets');
  assert.equal(resets.rows[0].value, '2');
  assert.equal(resets.rows[1].value, 'Nov 30, 2026');
});

test('opencode go uses provider window labels and marks estimated limits', async () => {
  const usage = await normalizePayload('opencodego', {
    usage: {
      primary: { usedPercent: 0, windowMinutes: 300 },
      secondary: { usedPercent: 0, windowMinutes: 10080 },
      tertiary: { usedPercent: 0, windowMinutes: 43200 },
      dataConfidence: 'estimated',
    },
    rateWindowLabels: { primary: '5-hour', secondary: 'Weekly', tertiary: 'Monthly' },
  });

  assert.equal(
    usage.windows.map((window) => window.label).join('|'),
    '5-hour|Weekly|Monthly',
  );
  assert.match(usage.spend.note, /estimated/i);
});
