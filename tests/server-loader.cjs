const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const { promisify } = require('node:util');
const vm = require('node:vm');
const ts = require('typescript');

const serverPath = require.resolve('../server/usage.ts');
const serverRequire = createRequire(serverPath);
const exported = [
  'normalize',
  'composeAntigravity',
  'fetchAntigravity',
  'fetchOpenRouter',
  'fetchOpenCodeGo',
  'fetchProvider',
  'readOpenCodeGoUsage',
];
const source = ts.transpileModule(
  readFileSync(serverPath, 'utf8') + exported.map((name) => `\nexports.${name} = ${name};`).join(''),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

/** Loads server/usage.ts with the process, network, and home directory replaced. */
function loadServer({ env = {}, home, spawn, execFile = () => {}, fetch } = {}) {
  const exports = {};
  vm.runInNewContext(
    source,
    {
      exports,
      require: (id) => {
        if (id === 'node:child_process') return { execFile, spawn };
        if (id === 'node:os') return { ...os, homedir: () => home };
        if (id === '../shared/usage') return {};
        return serverRequire(id);
      },
      process: { env },
      fetch,
      AbortSignal,
      setTimeout,
      clearTimeout,
    },
    { filename: serverPath },
  );
  return exports;
}

/** A CodexBar stand-in that answers every call with one JSON document. */
function codexBarStub(result) {
  return execStub({ codexbar: result }).execFile;
}

/**
 * Stands in for both CLIs the server runs. `omp` answers `omp token` calls with a string (or
 * throws an Error); everything else is CodexBar and gets one JSON document. Calls are recorded.
 */
function execStub({ codexbar, omp = () => 'synthetic-omp-token' }) {
  const calls = [];
  const execFile = () => {};
  execFile[promisify.custom] = async (binary, args) => {
    calls.push({ binary, args });
    if (binary === 'omp') {
      const token = omp(args);
      if (token instanceof Error) throw token;
      return { stdout: `${token}\n` };
    }
    return { stdout: JSON.stringify(codexbar) };
  };
  return { execFile, calls };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** The server's results hold objects from another realm, so compare plain copies. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { loadServer, codexBarStub, execStub, jsonResponse, plain };
