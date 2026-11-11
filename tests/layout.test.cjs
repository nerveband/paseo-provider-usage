const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = resolve(__dirname, '..');

/** Loads a TypeScript module from this repo; relative imports load their .ts files the same way. */
function loadTs(file, stubs = {}, cache = new Map()) {
  const full = resolve(root, file);
  if (cache.has(full)) return cache.get(full);
  const module = { exports: {} };
  cache.set(full, module.exports);
  const output = ts.transpileModule(readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const nodeRequire = createRequire(full);
  const load = (id) => {
    if (id in stubs) return stubs[id];
    if (id.startsWith('.')) return loadTs(resolve(dirname(full), `${id}.ts`), stubs, cache);
    return nodeRequire(id);
  };
  new Function('exports', 'require', 'module', output)(module.exports, load, module);
  cache.set(full, module.exports);
  return module.exports;
}

const layout = loadTs('shared/layout.ts');
const usage = loadTs('shared/usage.ts');

const ALL = ['claude', 'codex', 'antigravity', 'openrouter', 'opencodego', 'baseten'];

/** A synthetic provider: no real account, key, or number. */
function provider(id, overrides = {}) {
  return {
    id,
    name: { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity', openrouter: 'OpenRouter', opencodego: 'OpenCode Go', baseten: 'Baseten' }[id],
    source: 'api',
    account: null,
    plan: null,
    updatedAt: null,
    windows: [],
    error: null,
    spend: null,
    ...overrides,
  };
}

function usageWindow(label, usedPercent, extra = {}) {
  return { id: label.toLowerCase(), label, usedPercent, resetsAt: null, resetDescription: null, windowMinutes: null, ...extra };
}

function spend(groups, extra = {}) {
  return { groups, note: null, headline: null, ...extra };
}

/* -------------------------------------------------------------------------- */
/* Stored preferences                                                         */
/* -------------------------------------------------------------------------- */

test('unreadable stored preferences fall back to the defaults without throwing', () => {
  const defaults = { order: [], collapsed: [], view: 'grid' };
  for (const raw of [undefined, null, 'garbage', 42, true, [], ['claude'], { order: 'claude' }, { view: 7 }, { collapsed: {} }]) {
    assert.deepEqual(layout.sanitizePreferences(raw), defaults, `input ${JSON.stringify(raw)}`);
  }
});

test('stored preferences keep known ids once, drop unknown ones, and hold nothing else', () => {
  const parsed = layout.sanitizePreferences({
    order: ['baseten', 'nope', 'claude', 'baseten', 7, null, 'activity'],
    collapsed: ['activity', 'codex', 'codex', 'sk-not-an-id'],
    view: 'list',
    account: 'someone@example.invalid',
    token: 'synthetic-token',
  });
  // The activity block is always last, so it is collapsible but never part of the order.
  assert.deepEqual(parsed, { order: ['baseten', 'claude'], collapsed: ['activity', 'codex'], view: 'list' });
  assert.deepEqual(Object.keys(parsed).sort(), ['collapsed', 'order', 'view']);
  assert.equal(layout.sanitizePreferences({ view: 'masonry' }).view, 'grid');
});

test('a corrupt, missing, or unreadable preferences file reads as the defaults', () => {
  const defaults = { order: [], collapsed: [], view: 'grid' };
  // What the host's settings hook reports for each case.
  assert.deepEqual(layout.preferencesFromState({ status: 'loading' }), defaults);
  assert.deepEqual(layout.preferencesFromState({ status: 'invalid', revision: 'r', error: 'Unexpected token' }), defaults);
  assert.deepEqual(layout.preferencesFromState({ status: 'error', error: 'RPC failed' }), defaults);
  assert.deepEqual(layout.preferencesFromState({ status: 'ready', revision: 'r', values: {} }), defaults);
  assert.deepEqual(
    layout.preferencesFromState({ status: 'ready', revision: 'r', values: { order: ['codex'], view: 'list' } }),
    { order: ['codex'], collapsed: [], view: 'list' },
  );
});

test('the layout settings definition is host-scoped and its schema turns any stored value into clean preferences', () => {
  const { layoutSettings } = usage;
  assert.equal(layoutSettings.id, 'layout');
  assert.equal(layoutSettings.scope, 'host');
  assert.equal(layoutSettings.version, 1);
  const schema = layoutSettings.schema;
  // The host parses what it read (an empty object when no file exists) and what a client saves.
  assert.deepEqual(schema.parse({}), { order: [], collapsed: [], view: 'grid' });
  assert.deepEqual(schema.parse('not json at all'), { order: [], collapsed: [], view: 'grid' });
  const saved = schema.parse({ order: ['codex', 'claude', 'ghost'], collapsed: ['baseten'], view: 'list', extra: 1 });
  assert.deepEqual(saved, { order: ['codex', 'claude'], collapsed: ['baseten'], view: 'list' });
  // The client re-parses its values before saving, so parsing must be stable and JSON-safe.
  assert.deepEqual(schema.parse(saved), saved);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved);
});

test('the server registers the layout settings with the host store', () => {
  const calls = [];
  const stubs = {
    './server/usage': { handleProviderUsage() {}, handleTokenAnalytics() {} },
  };
  const { default: contribute } = loadTs('index.server.ts', stubs);
  const cleanup = contribute({
    handle: (contract) => calls.push(['handle', contract.name]),
    registerSettings: (definition) => calls.push(['settings', definition.id, definition.scope]),
  });
  assert.equal(typeof cleanup, 'function');
  assert.deepEqual(calls, [
    ['handle', 'provider-usage.get'],
    ['handle', 'provider-usage.analytics'],
    ['settings', 'layout', 'host'],
  ]);
});

/* -------------------------------------------------------------------------- */
/* Order                                                                      */
/* -------------------------------------------------------------------------- */

test('merging the stored order drops removed providers and appends new ones in default order', () => {
  assert.deepEqual(layout.mergeOrder([], ALL), ALL);
  assert.deepEqual(layout.mergeOrder(['baseten', 'codex'], ALL), ['baseten', 'codex', 'claude', 'antigravity', 'openrouter', 'opencodego']);
  // A provider that no longer exists drops out; duplicates count once.
  assert.deepEqual(layout.mergeOrder(['gone', 'codex', 'codex', 'claude'], ['claude', 'codex']), ['codex', 'claude']);
  // A provider added after the order was saved appears at the end.
  assert.deepEqual(layout.mergeOrder(['codex', 'claude'], ['claude', 'codex', 'newcomer']), ['codex', 'claude', 'newcomer']);
});

test('moving a block handles the first, the last, the same slot, and out-of-range indexes', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(layout.moveItem(ids, 0, 3), ['b', 'c', 'd', 'a']);
  assert.deepEqual(layout.moveItem(ids, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(layout.moveItem(ids, 1, 2), ['a', 'c', 'b', 'd']);
  assert.deepEqual(layout.moveItem(ids, 2, 2), ids);
  assert.deepEqual(layout.moveItem(ids, -1, 2), ids);
  assert.deepEqual(layout.moveItem(ids, 1, 9), ids);
  assert.notEqual(layout.moveItem(ids, 2, 2), ids, 'returns a copy');
});

test('moving within a filtered view keeps hidden blocks in place', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f'];
  // Nothing hidden: the same as a plain move.
  assert.deepEqual(layout.reorderVisible(order, order, 0, 3), layout.moveItem(order, 0, 3));
  assert.deepEqual(layout.reorderVisible(order, order, 5, 1), layout.moveItem(order, 5, 1));
  // b, d, and f are hidden. Moving e to the top lands it before a.
  assert.deepEqual(layout.reorderVisible(order, ['a', 'c', 'e'], 2, 0), ['e', 'a', 'b', 'c', 'd', 'f']);
  // Moving a down one visible slot lands it just after c.
  assert.deepEqual(layout.reorderVisible(order, ['a', 'c', 'e'], 0, 1), ['b', 'c', 'a', 'd', 'e', 'f']);
  // Same slot, out of range, or ids the order does not know: unchanged.
  assert.deepEqual(layout.reorderVisible(order, ['a', 'c'], 1, 1), order);
  assert.deepEqual(layout.reorderVisible(order, ['a', 'c'], 0, 5), order);
  assert.deepEqual(layout.reorderVisible(order, ['a', 'zz'], 0, 1), order);
});

test('slot targeting picks the frame under the point, else the nearest frame, in a grid and in a list', () => {
  // Two columns, two rows: a tall first row and a short second row, 16 apart.
  const grid = [
    { x: 0, y: 0, width: 300, height: 400 },
    { x: 316, y: 0, width: 300, height: 400 },
    { x: 0, y: 416, width: 300, height: 200 },
    { x: 316, y: 416, width: 300, height: 200 },
  ];
  assert.equal(layout.slotAt({ x: 150, y: 380 }, grid), 0, 'near the bottom of a tall cell stays in it');
  assert.equal(layout.slotAt({ x: 450, y: 50 }, grid), 1);
  assert.equal(layout.slotAt({ x: 100, y: 500 }, grid), 2);
  assert.equal(layout.slotAt({ x: 600, y: 900 }, grid), 3, 'below the grid picks the nearest slot');
  assert.equal(layout.slotAt({ x: 305, y: 200 }, grid), 0, 'the gap between columns resolves to the nearer column');
  assert.equal(layout.slotAt({ x: 450, y: 410 }, grid), 3, 'the gap between rows resolves to the nearer row');
  const list = [
    { x: 0, y: 0, width: 600, height: 60 },
    { x: 0, y: 68, width: 600, height: 300 },
    { x: 0, y: 376, width: 600, height: 60 },
  ];
  assert.equal(layout.slotAt({ x: 300, y: -40 }, list), 0);
  assert.equal(layout.slotAt({ x: 300, y: 200 }, list), 1);
  assert.equal(layout.slotAt({ x: 300, y: 1000 }, list), 2);
  assert.equal(layout.slotAt({ x: 0, y: 0 }, []), -1);
});

test('toggling a collapsed block adds and removes it', () => {
  assert.deepEqual(layout.toggleId([], 'codex'), ['codex']);
  assert.deepEqual(layout.toggleId(['codex', 'activity'], 'codex'), ['activity']);
});

/* -------------------------------------------------------------------------- */
/* Search and filters                                                         */
/* -------------------------------------------------------------------------- */

const claude = provider('claude', {
  source: 'oauth',
  plan: 'Ultra',
  account: 'owner@example.invalid',
  windows: [usageWindow('Session', 40), usageWindow('Weekly', 55, { resetDescription: 'in 3 days' })],
  spend: spend([
    { kind: 'balance', title: 'Prepaid credits', rows: [{ label: 'Remaining', value: '$0.00' }], note: null },
    { kind: 'spend', title: 'Extra usage', rows: [{ label: 'Status', value: 'Off' }], note: null },
  ]),
});
const goEstimate = provider('opencodego', {
  plan: 'Go',
  windows: [usageWindow('Weekly', 89.4, { estimated: true }), usageWindow('Monthly', 12, { estimated: true })],
  spend: spend([{ kind: 'balance', title: 'Pay-as-you-go balance', rows: [{ label: 'Remaining', value: 'Not available from the API', unavailable: true }], note: null }]),
});
const antigravity = provider('antigravity', {
  source: 'cli',
  windows: [usageWindow('Gemini weekly', 100)],
  spend: spend([
    { kind: 'plan', title: 'Plan', rows: [{ label: 'Tier', value: 'Not available from the API', unavailable: true }], note: null },
    { kind: 'balance', title: 'AI credits', rows: [{ label: 'Remaining', value: '0' }], note: null },
  ]),
});
const openrouter = provider('openrouter', {
  spend: spend(
    [
      { kind: 'balance', title: 'Credits', rows: [{ label: 'Remaining', value: '$3.00' }], note: null },
      { kind: 'breakdown', title: 'Spend by model', rows: [{ label: 'vendor/model-x', value: '$1.00', detail: '10 req', share: 100 }], note: null },
    ],
    { headline: { label: 'Credits remaining', value: '$3.00' } },
  ),
});
const codexError = provider('codex', { source: 'oauth', error: 'CodexBar timed out.' });
const baseten = provider('baseten', {
  spend: spend([{ kind: 'spend', title: 'Last 30 days', rows: [{ label: 'Model APIs', value: '$4.00' }], note: null }], {
    headline: { label: 'Spent, last 30 days', value: '$4.00' },
  }),
});
const everyone = [claude, codexError, antigravity, openrouter, goEstimate, baseten];

function names(result) {
  return result.visible.map((entry) => entry.id);
}

test('search finds the words and values a card shows', () => {
  const find = (query) => names(layout.filterProviders(everyone, query, 'all'));
  assert.deepEqual(find('balance'), ['claude', 'antigravity', 'openrouter', 'opencodego']);
  assert.deepEqual(find('weekly'), ['claude', 'antigravity', 'opencodego']);
  assert.deepEqual(find('$0'), ['claude']);
  assert.deepEqual(find('estimate'), ['opencodego']);
  assert.deepEqual(find('ULTRA'), ['claude'], 'case does not matter');
  assert.deepEqual(find('omp token'), ['claude'], 'the source label as shown');
  assert.deepEqual(find('example.invalid'), ['claude'], 'the account line');
  assert.deepEqual(find('model-x'), ['openrouter'], 'rows under Details');
  assert.deepEqual(find('not available'), ['antigravity', 'opencodego']);
  assert.deepEqual(find('limit reached'), ['antigravity']);
  assert.deepEqual(find('timed out'), ['codex'], 'the error message');
  assert.deepEqual(find('weekly ultra'), ['claude'], 'every word must match');
  assert.deepEqual(find('   '), names({ visible: everyone }), 'blank shows everything');
  assert.deepEqual(find('zzz-no-such-thing'), []);
});

test('near limit uses the shared threshold on the provider\u2019s own percentages', () => {
  const threshold = layout.CRITICAL_USED_PERCENT;
  assert.equal(threshold, 90);
  const at = (percent) => layout.isNearLimit(provider('claude', { windows: [usageWindow('Weekly', percent)] }));
  assert.equal(at(threshold - 1), false);
  assert.equal(at(threshold), true);
  assert.equal(at(100), true);
  // Displayed as 89%, so not near the limit; displayed as 90%, so it is (the card turns red at the same value).
  assert.equal(at(89.4), false);
  assert.equal(at(89.5), true);
  assert.equal(layout.isNearLimit(openrouter), false, 'no windows, no limit');
  assert.deepEqual(names(layout.filterProviders(everyone, '', 'near-limit')), ['antigravity']);
});

test('has balance needs a reported value, not an unavailable row', () => {
  assert.deepEqual(names(layout.filterProviders(everyone, '', 'has-balance')), ['claude', 'antigravity', 'openrouter']);
  assert.deepEqual(layout.keyBalance(claude), { label: 'Prepaid credits', value: '$0.00' });
  assert.equal(layout.keyBalance(goEstimate), null);
  assert.equal(layout.keyBalance(baseten), null);
});

test('needs attention covers errors, estimates, and fields the API does not expose', () => {
  assert.equal(layout.needsAttention(codexError), true);
  assert.equal(layout.needsAttention(goEstimate), true);
  assert.equal(layout.needsAttention(antigravity), true);
  assert.equal(layout.needsAttention(claude), false);
  assert.deepEqual(names(layout.filterProviders(everyone, '', 'needs-attention')), ['codex', 'antigravity', 'opencodego']);
});

test('a filter never hides a provider error silently', () => {
  const nearLimit = layout.filterProviders(everyone, '', 'near-limit');
  assert.equal(nearLimit.hiddenErrors, 1, 'Codex failed and is hidden, so the count says so');
  const search = layout.filterProviders(everyone, 'claude', 'all');
  assert.equal(search.hiddenErrors, 1);
  assert.equal(layout.filterProviders(everyone, '', 'needs-attention').hiddenErrors, 0, 'errors always match Needs attention');
  assert.equal(layout.filterProviders(everyone, '', 'all').hiddenErrors, 0);
});

test('the list row figures come from the provider\u2019s own windows and balances', () => {
  assert.equal(layout.tightestWindow(claude).label, 'Weekly');
  assert.equal(layout.tightestWindow(openrouter), null);
  assert.equal(layout.limitFlag(100), 'Limit reached');
  assert.equal(layout.limitFlag(90), 'Near limit');
  assert.equal(layout.limitFlag(89), null);
  assert.equal(layout.displayPercent(usageWindow('x', 101)), 100);
  assert.equal(layout.displayPercent(usageWindow('x', -3)), 0);
});

test('the activity model list filters by model name, and activity words find the activity card', () => {
  const model = { modelId: 'anthropic/claude-x', modelLabel: 'Claude X' };
  assert.equal(layout.modelMatches(model, layout.searchTerms('claude')), true);
  assert.equal(layout.modelMatches(model, layout.searchTerms('anthropic')), true);
  assert.equal(layout.modelMatches(model, layout.searchTerms('gemini')), false);
  assert.equal(layout.matchesTerms(layout.ACTIVITY_SEARCH_TEXT, layout.searchTerms('estimate')), true);
  assert.equal(layout.matchesTerms(layout.ACTIVITY_SEARCH_TEXT, layout.searchTerms('sessions')), true);
  assert.equal(layout.matchesTerms(layout.ACTIVITY_SEARCH_TEXT, layout.searchTerms('balance')), false);
});
