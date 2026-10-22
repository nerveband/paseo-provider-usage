const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const braces = require('braces');
const { sprintf, vsprintf } = require('sprintf-js');

test('dependency overrides select the security-patched local forks', () => {
  assert.equal(require('braces/package.json').name, '@paseo-provider-usage/braces');
  assert.equal(require('sprintf-js/package.json').name, '@paseo-provider-usage/sprintf-js');
});

test('deep brace and parenthesis patterns complete with a small call stack', () => {
  const script = `
    const assert = require('node:assert/strict');
    const braces = require('braces');
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      const depth = 4000;
      const pattern = open.repeat(depth) + 'a,b' + close.repeat(depth);
      assert.equal(braces.stringify(pattern), pattern);
      const compiled = braces.compile(pattern);
      const expanded = braces.expand(pattern);
      if (open === '{') {
        assert.equal(compiled, '{'.repeat(depth - 1) + '(a|b)' + '}'.repeat(depth - 1));
        assert.deepEqual(expanded, ['a', 'b'].map(value => '{'.repeat(depth - 1) + value + '}'.repeat(depth - 1)));
      } else {
        assert.equal(compiled, pattern);
        assert.deepEqual(expanded, [pattern]);
      }
    }
  `;
  const child = spawnSync(process.execPath, ['--stack_size=256', '-e', script], {
    cwd: require('node:path').resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test('normal brace expansion, regex compilation, escaping and ranges remain compatible', () => {
  assert.deepEqual(braces.expand('src/{client,server}/*.{ts,tsx}'), [
    'src/client/*.ts', 'src/client/*.tsx', 'src/server/*.ts', 'src/server/*.tsx',
  ]);
  assert.equal(braces.compile('src/{client,server}/*.{ts,tsx}'), 'src/(client|server)/*.(ts|tsx)');
  assert.deepEqual(braces.expand('{01..03}'), ['01', '02', '03']);
  assert.deepEqual(braces.expand('{{a,b}}'), ['{a}', '{b}']);
  assert.equal(braces.stringify('{unclosed'), '{unclosed');
  assert.deepEqual(require('micromatch').braceExpand('file-{1..3}.js'), ['file-1.js', 'file-2.js', 'file-3.js']);
  assert.throws(() => braces.expand('{1..100000}'), /range limit/);
});

test('unbounded numeric precision is clamped before calling native number methods', () => {
  for (const [specifier, method] of [['f', 'toFixed'], ['e', 'toExponential'], ['g', 'toPrecision']]) {
    assert.equal(sprintf(`%.999999999${specifier}`, 1.5), (1.5)[method](100));
    assert.equal(sprintf(`%.${'9'.repeat(400)}${specifier}`, 1.5), (1.5)[method](100));
  }
  assert.equal(sprintf('%.0g', 1.5), (1.5).toPrecision(1));
});

test('normal sprintf formatting and string precision remain compatible', () => {
  assert.equal(sprintf('%s: %04d %.2f', 'count', 7, 1.25), 'count: 0007 1.25');
  assert.equal(vsprintf('%(name)s', [{ name: 'example' }]), 'example');
  assert.equal(sprintf('%.200s', 'a'.repeat(250)), 'a'.repeat(200));
  assert.equal(sprintf('%.0f', 1.5), '2');
  assert.equal(sprintf('%.2e', 1.5), '1.50e+0');
});
