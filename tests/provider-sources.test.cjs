const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { chmodSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');
const { codexBarStub, execStub, jsonResponse, loadServer, plain } = require('./server-loader.cjs');

function makeHome(files = {}) {
  const home = mkdtempSync(join(tmpdir(), 'usage-test-home-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(home, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return home;
}

function group(spend, title) {
  return spend.groups.find((entry) => entry.title === title);
}

/* -------------------------------------------------------------------------- */
/* Antigravity                                                                */
/* -------------------------------------------------------------------------- */

const usageEnvelope = {
  status: 'SUCCESS',
  num_turns: 0,
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 0,
              reset_time: '2026-11-13T23:44:23Z',
              description: 'You have hit your weekly limit, it refreshes in 3 days.',
            },
            {
              id: 'gemini-5h',
              name: 'Five Hour Limit Remaining',
              window: '5h',
              disabled: true,
              remaining_fraction: 1,
              description: 'You have hit your weekly limit, the 5-hour limit does not currently apply.',
            },
          ],
        },
        {
          name: 'Claude and GPT models',
          buckets: [
            { id: '3p-weekly', window: 'weekly', remaining_fraction: 1, reset_time: '2026-11-17T19:33:36Z' },
            { id: '3p-5h', window: '5h', remaining_fraction: 0.25, reset_time: '2026-11-11T00:33:36Z' },
          ],
        },
      ],
    },
  },
};

const creditsEnvelope = {
  status: 'SUCCESS',
  command: { name: 'credits', data: { remaining_credits: 12.5, upgrade_uri: 'https://example.invalid/upgrade' } },
};

test('antigravity separates quota, plan, and credits and drops placeholder buckets', () => {
  const { composeAntigravity } = loadServer({ home: makeHome() });
  const usage = plain(composeAntigravity(usageEnvelope, creditsEnvelope, false, new Date('2026-11-10T20:00:00Z')));

  assert.equal(usage.source, 'cli');
  assert.equal(usage.plan, null);
  assert.deepEqual(
    usage.windows.map((window) => [window.label, window.usedPercent]),
    [
      ['Gemini weekly', 100],
      ['Claude/GPT 5-hour', 75],
      ['Claude/GPT weekly', 0],
    ],
  );
  assert.equal(usage.windows[0].resetsAt, '2026-11-13T23:44:23Z');
  assert.equal(usage.windows[1].resetsAt, '2026-11-11T00:33:36Z');
  // An untouched bucket reports "now plus its window", which moves on every read.
  assert.equal(usage.windows[2].resetsAt, null);
  assert.equal(usage.windows[2].windowMinutes, 10080);

  const plan = group(usage.spend, 'Plan');
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.rows[0].unavailable, true);
  assert.match(plan.note, /status line/);
  assert.match(plan.note, /Five-hour limits exist/);
  const credits = group(usage.spend, 'AI credits');
  assert.equal(credits.kind, 'balance');
  assert.deepEqual(credits.rows, [
    { label: 'Remaining', value: '12.5' },
    { label: 'Used after quota ends', value: 'Off' },
  ]);
  // The switched-off lane sits with the limits, in words, with agy's own explanation.
  const off = group(usage.spend, 'Gemini 5-hour');
  assert.equal(off.kind, 'limits');
  assert.deepEqual(off.rows, [{ label: 'Gemini 5-hour', value: 'Not in effect' }]);
  assert.match(off.note, /the 5-hour limit does not currently apply/);
});

test('antigravity never invents a credit balance or a plan tier', () => {
  const { composeAntigravity } = loadServer({ home: makeHome() });
  const usage = plain(composeAntigravity(usageEnvelope, null, null, new Date('2026-11-10T20:00:00Z')));
  const credits = group(usage.spend, 'AI credits');
  assert.deepEqual(credits.rows, [{ label: 'Remaining', value: 'Not available from the API', unavailable: true }]);
  assert.equal(usage.plan, null);
});

test('antigravity without five-hour buckets does not hint at a paid plan', () => {
  const { composeAntigravity } = loadServer({ home: makeHome() });
  const weeklyOnly = {
    command: {
      name: 'usage',
      data: { groups: [{ name: 'Gemini Models', buckets: [{ id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.5 }] }] },
    },
  };
  const usage = plain(composeAntigravity(weeklyOnly, creditsEnvelope, null, new Date()));
  assert.doesNotMatch(group(usage.spend, 'Plan').note, /Five-hour/);
});

function fakeSpawn(calls, answer) {
  return (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setTimeout(() => {
      const { stdout, stderr = '', exitCode = 0 } = answer(args[1]);
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      setTimeout(() => child.emit('close', exitCode), 5);
    }, 0);
    return child;
  };
}

function fakeAgy() {
  const dir = mkdtempSync(join(tmpdir(), 'usage-test-agy-'));
  const path = join(dir, 'agy');
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
  return path;
}

test('antigravity runs only the two print-mode reports, with guards, and holds the answer', async () => {
  const calls = [];
  const { fetchAntigravity } = loadServer({
    home: makeHome({ '.gemini/antigravity-cli/settings.json': { useG1Credits: true } }),
    env: { ANTIGRAVITY_CLI_PATH: fakeAgy(), GOOGLE_ACCESS_TOKEN: 'synthetic-google-token' },
    spawn: fakeSpawn(calls, (command) => ({
      stdout: JSON.stringify(command === '/usage' ? usageEnvelope : creditsEnvelope),
    })),
  });

  const first = plain(await fetchAntigravity(false));
  assert.equal(first.error, null);
  assert.equal(group(first.spend, 'AI credits').rows[1].value, 'On');
  assert.deepEqual(calls.map((call) => call.args[1]), ['/usage', '/credits']);
  for (const call of calls) {
    assert.equal(call.args[0], '--print');
    assert.ok(call.args.includes('--output-format') && call.args.includes('json'));
    assert.ok(call.args.includes('--log-file'));
    assert.equal(call.options.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
    assert.ok(call.options.env.PATH.startsWith(`${dirname(call.options.env.BROWSER)}:`));
    assert.notEqual(call.options.cwd, undefined);
  }

  // A second, unforced read inside the hold window must not start agy again.
  const second = plain(await fetchAntigravity(false));
  assert.equal(calls.length, 2);
  assert.equal(second.updatedAt, first.updatedAt);

  // The Refresh button bypasses the hold.
  await fetchAntigravity(true);
  assert.equal(calls.length, 4);
});

test('antigravity signed-out and failure messages never echo process output', async () => {
  const marker = 'synthetic-private-value';
  const signedOut = loadServer({
    home: makeHome(),
    env: { ANTIGRAVITY_CLI_PATH: fakeAgy() },
    spawn: fakeSpawn([], () => ({ stdout: '', stderr: `Error: authentication required. Run 'agy' to log in. ${marker}`, exitCode: 1 })),
  });
  const out = plain(await signedOut.fetchAntigravity(true));
  assert.match(out.error, /signed out/i);
  assert.ok(!JSON.stringify(out).includes(marker));

  const failed = loadServer({
    home: makeHome(),
    env: { ANTIGRAVITY_CLI_PATH: fakeAgy() },
    spawn: fakeSpawn([], () => ({ stdout: `not json ${marker}`, stderr: marker, exitCode: 2 })),
  });
  const bad = plain(await failed.fetchAntigravity(true));
  assert.match(bad.error, /could not report usage/);
  assert.ok(!JSON.stringify(bad).includes(marker));
});

test('antigravity without agy installed explains how to get it and starts nothing', async () => {
  const calls = [];
  const { fetchAntigravity } = loadServer({
    home: makeHome(),
    env: { ANTIGRAVITY_CLI_PATH: join(tmpdir(), 'usage-test-missing-agy') },
    spawn: fakeSpawn(calls, () => ({ stdout: '{}' })),
  });
  const usage = plain(await fetchAntigravity(true));
  assert.match(usage.error, /agy\) was not found/);
  assert.equal(calls.length, 0);
});

function snapshotHome(antigravity) {
  return makeHome({
    '.local/state/paseo-provider-usage/snapshot.json': {
      fetchedAt: new Date().toISOString(),
      stale: false,
      providers: [antigravity],
    },
  });
}

const savedAntigravity = (updatedAt, error = null) => ({
  id: 'antigravity', name: 'Antigravity', source: 'cli', account: null, plan: null, updatedAt,
  windows: [{ id: 'w', label: 'Gemini weekly', usedPercent: 10, resetsAt: null, resetDescription: null, windowMinutes: 10080 }],
  error, spend: null,
});

test('a reload does not run agy again inside the hold window', async () => {
  const calls = [];
  const saved = savedAntigravity(new Date(Date.now() - 5 * 60_000).toISOString());
  const { restoreSnapshot, fetchAntigravity } = loadServer({
    home: snapshotHome(saved),
    env: { ANTIGRAVITY_CLI_PATH: fakeAgy() },
    spawn: fakeSpawn(calls, (command) => ({ stdout: JSON.stringify(command === '/usage' ? usageEnvelope : creditsEnvelope) })),
  });
  await restoreSnapshot();
  const usage = plain(await fetchAntigravity(false));
  assert.equal(calls.length, 0);
  assert.equal(usage.updatedAt, saved.updatedAt);

  // The Refresh button still asks agy.
  await fetchAntigravity(true);
  assert.equal(calls.length, 2);
});

test('an old or failed saved agy answer does not block a fresh read', async () => {
  for (const saved of [
    savedAntigravity(new Date(Date.now() - 20 * 60_000).toISOString()),
    savedAntigravity(new Date().toISOString(), 'Antigravity CLI could not report usage.'),
  ]) {
    const calls = [];
    const { restoreSnapshot, fetchAntigravity } = loadServer({
      home: snapshotHome(saved),
      env: { ANTIGRAVITY_CLI_PATH: fakeAgy() },
      spawn: fakeSpawn(calls, (command) => ({ stdout: JSON.stringify(command === '/usage' ? usageEnvelope : creditsEnvelope) })),
    });
    await restoreSnapshot();
    await fetchAntigravity(false);
    assert.equal(calls.length, 2);
  }
});

/* -------------------------------------------------------------------------- */
/* OpenRouter                                                                 */
/* -------------------------------------------------------------------------- */

const activityBody = {
  data: [
    { date: '2026-11-01', model: 'vendor-a/model-x', usage: 4.5, byok_usage_inference: 0, requests: 10, prompt_tokens: 1000, completion_tokens: 200, reasoning_tokens: 50, cached_tokens: 0 },
    { date: '2026-11-02', model: 'vendor-a/model-x', usage: 1.5, byok_usage_inference: 0.25, requests: 5, prompt_tokens: 500, completion_tokens: 100, reasoning_tokens: 0, cached_tokens: 0 },
    { date: '2026-11-02', model: 'vendor-b/model-y', usage: 0.004, byok_usage_inference: 0, requests: 2, prompt_tokens: 10, completion_tokens: 5, reasoning_tokens: 0, cached_tokens: 0 },
    { date: '2026-11-02', model: 'vendor-c/free:free', usage: 0, byok_usage_inference: 0, requests: 7, prompt_tokens: 70, completion_tokens: 7, reasoning_tokens: 0, cached_tokens: 0 },
  ],
};
const creditsBody = { data: { total_credits: 20, total_usage: 6.5 } };

function openRouterFetch(calls, managementKey) {
  return async (url, init) => {
    const authorization = init.headers.Authorization;
    calls.push({ url, authorization });
    const allowed = authorization === `Bearer ${managementKey}`;
    if (url.endsWith('/activity')) return allowed ? jsonResponse(200, activityBody) : jsonResponse(403, { error: { code: 403 } });
    if (url.endsWith('/credits')) return jsonResponse(200, creditsBody);
    return jsonResponse(404, {});
  };
}

test('openrouter splits spend by model with the stored Management key and sends no other credential', async () => {
  const calls = [];
  const home = makeHome({
    '.config/codexbar/config.json': { version: 1, providers: [{ id: 'openrouter', enabled: true, apiKey: 'synthetic-management' }] },
  });
  const { fetchOpenRouter } = loadServer({
    home,
    env: { OPENROUTER_API_KEY: 'synthetic-regular', OPENAI_API_KEY: 'synthetic-openai', OPENAI_ADMIN_KEY: 'synthetic-openai-admin' },
    fetch: openRouterFetch(calls, 'synthetic-management'),
  });

  const usage = plain(await fetchOpenRouter());
  assert.equal(usage.error, null);
  assert.deepEqual(group(usage.spend, 'Credits').rows.map((row) => row.value), ['$13.50', '$6.50', '$20.00']);
  assert.deepEqual(usage.spend.headline, { label: 'Credits remaining', value: '$13.50' });
  assert.deepEqual(group(usage.spend, 'Last 30 completed UTC days').rows, [
    { label: 'Spend', value: '$6.00' },
    { label: 'BYOK (billed by the model provider)', value: '$0.25' },
  ]);
  assert.deepEqual(group(usage.spend, 'Activity, last 30 completed UTC days').rows, [
    { label: 'Requests', value: '24' },
    { label: 'Tokens', value: '1.9K' },
    { label: 'Models', value: '3' },
  ]);
  const byModel = group(usage.spend, 'Spend by model');
  assert.equal(byModel.kind, 'breakdown');
  assert.deepEqual(
    byModel.rows.map((row) => [row.label, row.value, row.detail]),
    [
      ['vendor-a/model-x', '$6.00', '15 req'],
      ['vendor-b/model-y', '<$0.01', '2 req'],
    ],
  );
  // Shares are measured against the whole 30-day spend ($6.004), not rescaled to the top model.
  assert.ok(Math.abs(byModel.rows[0].share - (6 / 6.004) * 100) < 1e-9);
  assert.ok(Math.abs(byModel.rows[1].share - (0.004 / 6.004) * 100) < 1e-9);
  assert.match(usage.spend.note, /30 completed UTC days/);

  // Every request went to openrouter.ai with an OpenRouter key, the stored one first.
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.ok(call.url.startsWith('https://openrouter.ai/api/v1/'));
    assert.equal(call.authorization, 'Bearer synthetic-management');
  }
});

test('openrouter folds extra models into one row after the top eight', async () => {
  const rows = Array.from({ length: 11 }, (_, index) => ({
    date: '2026-11-01', model: `vendor/model-${index}`, usage: 11 - index, byok_usage_inference: 0, requests: 1,
    prompt_tokens: 1, completion_tokens: 1, reasoning_tokens: 0, cached_tokens: 0,
  }));
  const { fetchOpenRouter } = loadServer({
    home: makeHome(),
    env: { OPENROUTER_MANAGEMENT_API_KEY: 'synthetic-management' },
    fetch: async (url) => jsonResponse(200, url.endsWith('/activity') ? { data: rows } : creditsBody),
  });
  const usage = plain(await fetchOpenRouter());
  const models = group(usage.spend, 'Spend by model').rows;
  assert.equal(models.length, 9);
  assert.deepEqual([models[8].label, models[8].value], ['Other (3 models)', '$6.00']);
  // The folded row keeps its real share of the $66 total, so every bar together makes 100%.
  assert.ok(Math.abs(models[8].share - (6 / 66) * 100) < 1e-9);
  assert.ok(Math.abs(models.reduce((sum, row) => sum + row.share, 0) - 100) < 1e-9);
});

test('openrouter with only a regular key still shows credits and says per-model spend needs a Management key', async () => {
  const calls = [];
  const { fetchOpenRouter } = loadServer({
    home: makeHome(),
    env: { OPENROUTER_API_KEY: 'synthetic-regular' },
    fetch: openRouterFetch(calls, 'synthetic-management'),
  });
  const usage = plain(await fetchOpenRouter());
  assert.equal(usage.error, null);
  assert.ok(group(usage.spend, 'Credits'));
  assert.equal(group(usage.spend, 'Spend by model'), undefined);
  assert.match(usage.spend.note, /Management key/);
});

test('openrouter falls through to the next key only when a key is rejected', async () => {
  const calls = [];
  const { fetchOpenRouter } = loadServer({
    home: makeHome(),
    env: { OPENROUTER_MANAGEMENT_API_KEY: 'synthetic-wrong', OPENROUTER_API_KEY: 'synthetic-management' },
    fetch: openRouterFetch(calls, 'synthetic-management'),
  });
  const usage = plain(await fetchOpenRouter());
  assert.ok(group(usage.spend, 'Spend by model'));
  assert.deepEqual(
    [...new Set(calls.map((call) => call.authorization))],
    ['Bearer synthetic-wrong', 'Bearer synthetic-management'],
  );

  const outage = loadServer({
    home: makeHome(),
    env: { OPENROUTER_MANAGEMENT_API_KEY: 'synthetic-wrong', OPENROUTER_API_KEY: 'synthetic-management' },
    fetch: async (url, init) => {
      calls.push({ url, authorization: init.headers.Authorization });
      return jsonResponse(503, {});
    },
  });
  calls.length = 0;
  const down = plain(await outage.fetchOpenRouter());
  assert.match(down.error, /HTTP 503/);
  // A 503 says nothing about the key, so the second key is not tried.
  assert.deepEqual([...new Set(calls.map((call) => call.authorization))], ['Bearer synthetic-wrong']);
});

test('openrouter without any key asks for one and calls nothing', async () => {
  let called = false;
  const { fetchOpenRouter } = loadServer({
    home: makeHome(),
    env: { OPENAI_API_KEY: 'synthetic-openai' },
    fetch: async () => {
      called = true;
      return jsonResponse(200, {});
    },
  });
  const usage = plain(await fetchOpenRouter());
  assert.match(usage.error, /OPENROUTER_MANAGEMENT_API_KEY/);
  assert.equal(called, false);
});

/* -------------------------------------------------------------------------- */
/* OpenCode Go                                                                */
/* -------------------------------------------------------------------------- */

const goStatusBody = {
  product: 'go',
  cancelAtPeriodEnd: false,
  access: {
    startsAt: '2026-11-08T00:10:30.000Z',
    endsAt: '2026-12-08T00:10:30.000Z',
    cancelAtPeriodEnd: false,
    meters: {
      fiveHour: { startsAt: null, resetsAt: null, limitMicroCents: '1200000000', usedMicroCents: '0' },
      week: { resetsAt: '2026-11-16T00:00:00.000Z', limitMicroCents: '3000000000', usedMicroCents: '190942290' },
      month: { resetsAt: '2026-12-08T00:10:30.000Z', limitMicroCents: '6000000000', usedMicroCents: '339469175' },
    },
  },
};
const goSummaryBody = {
  totalRequests: '3674',
  totalInputTokens: '9052914',
  totalOutputTokens: '2614317',
  totalCacheReadTokens: '550528090',
  totalCostMicroCents: '559019561',
  services: [],
};
const goUsageBody = {
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-11-11T00:36:07.314Z' },
    weekly: { status: 'ok', percent: 6, resetsAt: '2026-11-16T00:00:00.000Z' },
    monthly: { status: 'rate-limited', percent: 80, resetsAt: '2026-12-08T00:10:30.000Z' },
  },
};

const goHome = () => makeHome({ '.local/share/opencode/auth.json': { 'opencode-go': { type: 'api', key: 'synthetic-go-key' } } });

/** Routes by path; anything not listed answers 404. A route may be a [status, body] pair. */
function goFetch(calls, routes) {
  return async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization });
    const route = routes[url.replace('https://opencode.ai', '')];
    if (!route) return jsonResponse(404, {});
    return Array.isArray(route) ? jsonResponse(route[0], route[1]) : jsonResponse(200, route);
  };
}

const consoleRoutes = {
  '/console/api/go/status': goStatusBody,
  '/console/api/usage/summary?range=30d': goSummaryBody,
  '/console/api/billing/status': [403, { _tag: 'Forbidden' }],
};

test('opencode go reads plan, exact limits, and spend from the console API with the stored Go key', async () => {
  const calls = [];
  const { fetchOpenCodeGo } = loadServer({ home: goHome(), fetch: goFetch(calls, consoleRoutes) });
  const usage = plain(await fetchOpenCodeGo());

  assert.equal(usage.source, 'api');
  assert.equal(usage.plan, 'Go');
  assert.ok(calls.every((call) => call.url.startsWith('https://opencode.ai/') && call.authorization === 'Bearer synthetic-go-key'));
  assert.deepEqual(
    usage.windows.map((window) => [window.label, Math.round(window.usedPercent * 100) / 100, window.estimated]),
    [['5-hour', 0, undefined], ['Weekly', 6.36, undefined], ['Monthly', 5.66, undefined]],
  );
  // An unused 5-hour window has no reset: the console reports null, and none is invented.
  assert.equal(usage.windows[0].resetsAt, null);
  assert.equal(usage.windows[0].windowMinutes, 300);
  assert.equal(usage.windows[1].resetsAt, '2026-11-16T00:00:00.000Z');

  const plan = group(usage.spend, 'Plan');
  assert.deepEqual(plan.rows[0], { label: 'Tier', value: 'Go' });
  assert.equal(plan.rows[1].label, 'Renews');
  // The exact dollars sit on each limit row, beside its share.
  assert.deepEqual(usage.windows.map((window) => window.amount), ['$0.00 of $12.00', '$1.91 of $30.00', '$3.39 of $60.00']);
  assert.deepEqual(group(usage.spend, 'Last 30 days').rows, [{ label: 'API-rate cost', value: '$5.59' }]);
  assert.deepEqual(group(usage.spend, 'Activity, last 30 days').rows, [
    { label: 'Requests', value: '3.7K' },
    { label: 'Input tokens', value: '9.1M' },
    { label: 'Output tokens', value: '2.6M' },
    { label: 'Cached input tokens', value: '550.5M' },
  ]);
  const balance = group(usage.spend, 'Pay-as-you-go balance');
  assert.equal(balance.rows[0].unavailable, true);
  assert.match(balance.note, /Billing: Read/);
});

/** The billing/status shape observed live on 2026-11-10 with a Usage: Read + Billing: Read personal key. */
const goBillingBody = (balanceMicroCents, availableMicroCents = balanceMicroCents) => ({
  billingMode: 'prepaid',
  mode: 'pay-as-you-go',
  balanceMicroCents,
  creditLimitMicroCents: null,
  availableMicroCents,
  canPurchaseCredits: true,
  canEnableAutoRecharge: true,
});

test('opencode go shows the balance when the key has billing permission', async () => {
  // availableMicroCents is a separate figure; the balance row must read balanceMicroCents only.
  const { fetchOpenCodeGo } = loadServer({
    home: goHome(),
    fetch: goFetch([], { ...consoleRoutes, '/console/api/billing/status': goBillingBody('1500000000', '99900000000') }),
  });
  const usage = plain(await fetchOpenCodeGo());
  assert.deepEqual(group(usage.spend, 'Pay-as-you-go balance').rows, [{ label: 'Remaining', value: '$15.00' }]);
});

test('opencode go shows an empty balance as $0.00 instead of hiding it', async () => {
  const { fetchOpenCodeGo } = loadServer({
    home: goHome(),
    fetch: goFetch([], { ...consoleRoutes, '/console/api/billing/status': goBillingBody('0') }),
  });
  const usage = plain(await fetchOpenCodeGo());
  const balance = group(usage.spend, 'Pay-as-you-go balance');
  assert.deepEqual(balance.rows, [{ label: 'Remaining', value: '$0.00' }]);
  assert.equal(balance.note, undefined);
});

test('opencode go falls back to the percent-only route when the console routes fail', async () => {
  const calls = [];
  const { fetchOpenCodeGo } = loadServer({
    home: goHome(),
    fetch: goFetch(calls, { '/console/api/go/status': [500, {}], '/zen/go/v1/usage': goUsageBody }),
  });
  const usage = plain(await fetchOpenCodeGo());
  assert.deepEqual(
    usage.windows.map((window) => [window.label, window.usedPercent, window.estimated]),
    [['5-hour', 0, undefined], ['Weekly', 6, undefined], ['Monthly', 100, undefined]],
  );
  // An idle rolling window reports "now plus 5 hours", so it gets no reset time.
  assert.equal(usage.windows[0].resetsAt, null);
  assert.equal(usage.plan, null);
  assert.deepEqual(group(usage.spend, 'Plan').rows, [{ label: 'Tier', value: 'Not available from the API', unavailable: true }]);
  assert.match(usage.spend.note, /not estimated/);
});

test('opencode go reports a missing subscription without echoing the response', async () => {
  const { fetchOpenCodeGo } = loadServer({
    home: goHome(),
    fetch: goFetch([], {
      '/console/api/go/status': [403, { _tag: 'Forbidden' }],
      '/zen/go/v1/usage': [403, { type: 'error', error: { type: 'EntitlementError', message: 'synthetic-private-value' } }],
    }),
  });
  const usage = plain(await fetchOpenCodeGo());
  assert.match(usage.error, /no OpenCode Go subscription/);
  assert.ok(!JSON.stringify(usage).includes('synthetic-private-value'));
});

const estimatePayload = [{
  source: 'local',
  usage: {
    primary: { usedPercent: 0, windowMinutes: 300 },
    secondary: { usedPercent: 0, windowMinutes: 10080 },
    tertiary: { usedPercent: 0, windowMinutes: 43200 },
  },
  rateWindowLabels: { primary: '5-hour', secondary: 'Weekly', tertiary: 'Monthly' },
}];

test('opencode go labels the CodexBar fallback as an estimate and says why', async () => {
  const outage = loadServer({
    home: goHome(),
    env: { CODEXBAR_BIN: '/synthetic/codexbar' },
    execFile: codexBarStub(estimatePayload),
    fetch: async () => jsonResponse(503, {}),
  });
  const usage = plain(await outage.fetchOpenCodeGo());
  assert.ok(usage.windows.length === 3 && usage.windows.every((window) => window.estimated === true));
  assert.match(usage.spend.note, /HTTP 503.*estimated from local OpenCode Go activity/);

  const noKey = loadServer({
    home: makeHome(),
    env: { CODEXBAR_BIN: '/synthetic/codexbar' },
    execFile: codexBarStub(estimatePayload),
    fetch: async () => {
      throw new Error('no key means no request');
    },
  });
  const unkeyed = plain(await noKey.fetchOpenCodeGo());
  assert.ok(unkeyed.windows.every((window) => window.estimated === true));
  assert.match(unkeyed.spend.note, /No OpenCode Go API key was found/);
});

test('opencode go ignores windows without a numeric percent', () => {
  const { readOpenCodeGoUsage } = loadServer({ home: makeHome() });
  assert.equal(readOpenCodeGoUsage({ usage: { rolling: { status: 'ok' } } }), null);
  assert.equal(readOpenCodeGoUsage({}), null);
});

/* -------------------------------------------------------------------------- */
/* Claude account                                                             */
/* -------------------------------------------------------------------------- */

const claudeCodexBar = [{ source: 'oauth', usage: { primary: { usedPercent: 10 }, secondary: { usedPercent: 20 } } }];
const profileBody = {
  organization: {
    uuid: 'org-synthetic',
    organization_type: 'claude_max',
    rate_limit_tier: 'default_claude_max_20x',
    subscription_status: 'active',
    plan_display_name: 'Ultra',
  },
};
const prepaidBody = {
  currency: 'USD',
  balance: { money: null, credits: { amount_minor: 5597, exponent: 2 } },
  next_expires_at: '2026-12-31T12:00:00Z',
};
const claudeUsageBody = {
  spend: {
    enabled: false,
    disabled_reason: 'out_of_credits',
    used: { amount_minor: 0, currency: 'USD', exponent: 2 },
    limit: { amount_minor: 10000, currency: 'USD', exponent: 2 },
  },
};

function claudeFetch(calls, { accepted = 'synthetic-omp-token', prepaid = prepaidBody } = {}) {
  return async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization, beta: init.headers['anthropic-beta'] });
    if (init.headers.Authorization !== `Bearer ${accepted}`) return jsonResponse(401, {});
    const path = url.replace('https://api.anthropic.com', '');
    if (path === '/api/oauth/profile') return jsonResponse(200, profileBody);
    if (path === '/api/oauth/organizations/org-synthetic/prepaid/credits') {
      return Array.isArray(prepaid) ? jsonResponse(prepaid[0], prepaid[1]) : jsonResponse(200, prepaid);
    }
    if (path === '/api/oauth/usage') return jsonResponse(200, claudeUsageBody);
    return jsonResponse(404, {});
  };
}

function loadClaude({ fetch, omp }) {
  const exec = execStub({ codexbar: claudeCodexBar, omp });
  const server = loadServer({ home: makeHome(), env: { CODEXBAR_BIN: '/synthetic/codexbar' }, execFile: exec.execFile, fetch });
  return { ...server, ompCalls: () => exec.calls.filter((call) => call.binary === 'omp') };
}

test('claude shows plan tier, prepaid balance, and extra usage from the OAuth account endpoints', async () => {
  const calls = [];
  const { fetchProvider } = loadClaude({ fetch: claudeFetch(calls) });
  const usage = plain(await fetchProvider('claude', false));

  assert.equal(usage.plan, 'Ultra');
  assert.deepEqual(usage.windows.map((window) => window.usedPercent), [10, 20]);
  assert.deepEqual(usage.spend.groups.map((entry) => entry.title), ['Plan', 'Prepaid credits', 'Extra usage']);
  assert.deepEqual(group(usage.spend, 'Plan').rows, [
    { label: 'Tier', value: 'Ultra' },
    { label: 'Rate limit tier', value: 'Max 20x' },
    { label: 'Subscription', value: 'Active' },
  ]);
  const prepaid = group(usage.spend, 'Prepaid credits').rows;
  assert.deepEqual(prepaid[0], { label: 'Remaining', value: '$55.97' });
  assert.equal(prepaid[1].label, 'Next expiry');
  assert.deepEqual(group(usage.spend, 'Extra usage').rows, [
    { label: 'Status', value: 'Off (out of credits)' },
    { label: 'Used this month', value: '$0.00' },
    { label: 'Monthly limit', value: '$100.00' },
  ]);
  assert.match(usage.spend.note, /do(es)? not document/);

  // Only Anthropic's host sees the token, always with the OAuth beta header.
  assert.deepEqual(calls.map((call) => call.url.replace('https://api.anthropic.com', '')).sort(), [
    '/api/oauth/organizations/org-synthetic/prepaid/credits',
    '/api/oauth/profile',
    '/api/oauth/usage',
  ]);
  assert.ok(calls.every((call) => call.authorization === 'Bearer synthetic-omp-token' && call.beta === 'oauth-2025-04-20'));
  assert.ok(!JSON.stringify(usage).includes('synthetic-omp-token'));
});

test('claude refreshes the OMP token once, and only after Anthropic rejects the cached one', async () => {
  const calls = [];
  const { fetchProvider, ompCalls } = loadClaude({
    fetch: claudeFetch(calls, { accepted: 'synthetic-refreshed-token' }),
    omp: (args) => (args.includes('--force-refresh') ? 'synthetic-refreshed-token' : 'synthetic-omp-token'),
  });
  const usage = plain(await fetchProvider('claude', false));

  assert.equal(usage.plan, 'Ultra');
  const forced = ompCalls().filter((call) => call.args.includes('--force-refresh'));
  assert.equal(forced.length, 1);
  // The 401 came first, on the cached token; every later call used the refreshed one.
  assert.equal(calls[0].authorization, 'Bearer synthetic-omp-token');
  assert.ok(calls.slice(1).every((call) => call.authorization === 'Bearer synthetic-refreshed-token'));
});

test('claude keeps what loaded when one account endpoint fails and says which', async () => {
  const { fetchProvider } = loadClaude({ fetch: claudeFetch([], { prepaid: [404, {}] }) });
  const usage = plain(await fetchProvider('claude', false));
  assert.equal(usage.plan, 'Ultra');
  assert.deepEqual(group(usage.spend, 'Prepaid credits').rows, [
    { label: 'Remaining', value: 'Not available from the API', unavailable: true },
  ]);
  assert.ok(group(usage.spend, 'Extra usage'));
  assert.match(usage.spend.note, /prepaid balance could not be loaded \(HTTP 404\)/);
});

test('claude asks Anthropic at most once per hold and again on Refresh', async () => {
  const calls = [];
  const { fetchProvider } = loadClaude({ fetch: claudeFetch(calls) });
  await fetchProvider('claude', false);
  assert.equal(calls.length, 3);
  const second = plain(await fetchProvider('claude', false));
  assert.equal(calls.length, 3);
  assert.equal(second.plan, 'Ultra');
  await fetchProvider('claude', true);
  assert.equal(calls.length, 6);
});

test('claude without an OMP login still shows its windows and says the account details are missing', async () => {
  const { fetchProvider } = loadClaude({
    fetch: async () => {
      throw new Error('no token means no request');
    },
    omp: () => new Error('not signed in'),
  });
  const usage = plain(await fetchProvider('claude', false));
  assert.equal(usage.windows.length, 2);
  assert.equal(usage.plan, null);
  assert.ok(usage.spend.groups.every((entry) => entry.rows.every((row) => row.unavailable === true)));
  assert.match(usage.spend.note, /No OMP Anthropic login/);
});
