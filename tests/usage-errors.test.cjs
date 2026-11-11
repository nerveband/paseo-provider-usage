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
  readFileSync(serverPath, 'utf8') + '\nexports.runCodexBar = runCodexBar;\nexports.normalize = normalize;\nexports.readBasetenSpend = readBasetenSpend;\n',
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

function loadBasetenSpend(summary) {
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: (id) => (id === 'node:child_process' ? { execFile: () => {} } : id === '../shared/usage' ? {} : serverRequire(id)),
    process: { env: {} },
  }, { filename: serverPath });
  return exports.readBasetenSpend(summary);
}

test('baseten reports spend, credits applied, and what is still due', () => {
  const spend = loadBasetenSpend({
    model_apis_usage: {
      subtotal: '2.29',
      credits_used: '2.24',
      total: '0.05',
      breakdown: [
        {
          model_name: 'DeepSeek V4.1 Flash',
          subtotal: '2.29',
          input_tokens: 1000,
          output_tokens: 20,
          cached_input_tokens: 800,
        },
      ],
    },
    dedicated_usage: { subtotal: '0.00', credits_used: '0.00', total: '0.00', breakdown: [] },
  });

  const window = spend.groups.find((group) => group.title === 'Last 30 days');
  assert.deepEqual(JSON.parse(JSON.stringify(window.rows)), [
    { label: 'Model APIs', value: '$2.29' },
    { label: 'Credits applied', value: '$2.24' },
    { label: 'Due after credits', value: '$0.05' },
  ]);
  const models = spend.groups.find((group) => group.title === 'Model APIs by model');
  assert.deepEqual(JSON.parse(JSON.stringify(models.rows)), [
    { label: 'DeepSeek V4.1 Flash', value: '$2.29', share: 100 },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(spend.headline)), { label: 'Spent, last 30 days', value: '$2.29' });
  const balance = spend.groups.find((group) => group.title === 'Credit balance');
  assert.equal(balance.kind, 'balance');
  assert.deepEqual(JSON.parse(JSON.stringify(balance.rows)), [
    { label: 'Remaining', value: 'Not available from the API', unavailable: true },
  ]);
  // The evidence for the missing balance travels with that field.
  assert.match(balance.note, /remaining credit balance only on its billing dashboard/i);
});

test('baseten leads with the total across categories and measures model shares against it', () => {
  const spend = loadBasetenSpend({
    model_apis_usage: {
      subtotal: '1200.50',
      credits_used: '0.00',
      total: '1200.50',
      breakdown: [
        { model_name: 'Model A', subtotal: '900.50' },
        { model_name: 'Model B', subtotal: '300.00' },
      ],
    },
    dedicated_usage: { subtotal: '99.50', credits_used: '0.00', total: '99.50', breakdown: [{ model_name: 'Model C', subtotal: '99.50' }] },
  });

  const window = spend.groups.find((group) => group.title === 'Last 30 days');
  assert.equal(window.kind, 'spend');
  // The first row is the key figure, so the total comes before the categories.
  assert.deepEqual(JSON.parse(JSON.stringify(window.rows.slice(0, 3))), [
    { label: 'Total before credits', value: '$1,300.00' },
    { label: 'Model APIs', value: '$1,200.50' },
    { label: 'Dedicated inference', value: '$99.50' },
  ]);
  assert.equal(spend.headline.value, '$1,300.00');
  const shares = spend.groups.find((group) => group.title === 'Model APIs by model').rows.map((row) => row.share);
  assert.ok(Math.abs(shares[0] - (900.5 / 1300) * 100) < 1e-9);
  assert.ok(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 100) < 1e-9);
});

test('baseten never invents a balance or a spend figure', () => {
  const spend = loadBasetenSpend({
    model_apis_usage: { subtotal: '0.00', credits_used: '0.00', total: '0.00', breakdown: [] },
    training_usage: { subtotal: null, credits_used: null, total: null },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(spend.groups.map((group) => group.title))),
    ['Credit balance'],
  );
  assert.equal(spend.groups[0].rows[0].unavailable, true);
  assert.match(spend.note, /no usage in the last 30 days/i);
});
