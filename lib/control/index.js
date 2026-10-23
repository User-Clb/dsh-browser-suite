/**
 * dsh-local-web-control — local-browser web search with an in-composer control.
 *
 * Host half:
 *   - registers `browser_search` / `browser_fetch` backed by the local
 *     Edge/Chrome over the Chrome DevTools Protocol;
 *   - registers a guard that makes the composer's 本地搜索 switch authoritative
 *     (`web_search` is refused while local mode is on, `browser_search` while off);
 *   - exposes `get` / `set` / `reset` over a small plugin RPC route so the
 *     browser half can edit the same configuration.
 *
 * The CDP driver is adapted from `dsh-local-browser-search` (MIT).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { browserFetch, browserSearch, findBrowserPath } from './driver.js';

export const name = 'dsh-local-web-control';
export const inject = ['tools', 'systemPrompt'];

const RPC_PATH = '/api/plugin-rpc/local-web';
const RPC_METHOD = 'plugin-rpc/local-web';
const CONFIG_FILE = path.join(
  process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
  'local-web-control.json',
);

const DEFAULTS = Object.freeze({
  local: false,
  headless: true,
  engine: 'bing',
  maxResults: 8,
  timeoutMs: 30000,
  browserPath: '',
  userDataDir: '',
});

function clampInt(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalize(input = {}) {
  return {
    local: input.local === true,
    headless: input.headless !== false,
    engine: ['bing', 'baidu', 'sogou', 'duckduckgo', 'google'].includes(input.engine) ? input.engine : 'bing',
    maxResults: clampInt(input.maxResults, 1, 20, DEFAULTS.maxResults),
    timeoutMs: clampInt(input.timeoutMs, 5000, 120000, DEFAULTS.timeoutMs),
    browserPath: typeof input.browserPath === 'string' ? input.browserPath.trim() : '',
    userDataDir: typeof input.userDataDir === 'string' ? input.userDataDir.trim() : '',
  };
}

function loadConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
    const raw = readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/u, '');
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

function persistConfig(next) {
  try {
    mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    const temporary = `${CONFIG_FILE}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporary, serialized, 'utf8');
    try {
      renameSync(temporary, CONFIG_FILE);
    } catch {
      // Windows cannot rename over an existing file: remove the old copy first.
      try {
        rmSync(CONFIG_FILE, { force: true });
      } catch {
        /* ignore */
      }
      try {
        renameSync(temporary, CONFIG_FILE);
      } catch {
        writeFileSync(CONFIG_FILE, serialized, 'utf8');
      }
    }
  } catch {
    /* configuration is best-effort; the in-memory value still applies */
  }
}

/** The live configuration read by every tool call and by the guard. */
let config = loadConfig();

/** Serialize browser calls that share one explicit user-data directory. */
let browserQueue = Promise.resolve();

function withBrowserProfile(task) {
  if (!config.userDataDir) return task();
  const run = browserQueue.then(task, task);
  browserQueue = run.then(() => undefined, () => undefined);
  return run;
}

function validatePatch(patch) {
  if (patch.browserPath !== undefined) {
    const value = String(patch.browserPath ?? '').trim();
    if (value.length > 0 && !existsSync(value)) {
      return `浏览器路径不存在：${value}`;
    }
  }
  if (patch.userDataDir !== undefined) {
    const value = String(patch.userDataDir ?? '').trim();
    if (value.length > 0 && !path.isAbsolute(value)) {
      return `user-data 目录必须是绝对路径：${value}`;
    }
  }
  return undefined;
}

const execFileAsync = promisify(execFile);

async function pickNative(kind) {
  if (process.platform !== 'win32') {
    throw new Error('原生文件选择器目前只支持 Windows；请手动输入绝对路径。');
  }
  const fileScript = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择浏览器可执行文件'
$dialog.Filter = '可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*'
$dialog.CheckFileExists = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }`;
  const folderScript = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择浏览器 user-data 目录'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }`;
  const script = kind === 'directory' ? folderScript : fileScript;
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await execFileAsync(
    existsSync(powershellPath) ? powershellPath : 'powershell.exe',
    ['-NoLogo', '-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-Command', script],
    { timeout: 300000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim() || null;
}

function formatSources(sources, engine, truncated) {
  const parts = [];
  if (!sources || sources.length === 0) {
    parts.push('No results found.');
  } else {
    const lines = sources.map((source, index) => {
      const label = source.title && source.title.length > 0 ? source.title : source.url;
      const snippet = source.snippet && source.snippet.length > 0 ? ` — ${source.snippet}` : '';
      return `${index + 1}. [${label}](${source.url})${snippet}`;
    });
    parts.push(`Sources (${engine}):\n${lines.join('\n')}`);
  }
  if (truncated) parts.push('(Results truncated. Refine the query for more.)');
  parts.push('Cite the relevant URLs above as markdown links in your answer.');
  return parts.join('\n\n');
}

function registerSearchTool(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:browser_search',
    order: 112,
    text: 'Use browser_search to search the web through the LOCAL browser (Edge/Chrome). It needs no API key and works where server search APIs are unavailable. The composer\'s 本地搜索 switch decides whether local search or web_search is active. Cite the relevant URLs as markdown links in your answer.',
  });
  ctx.tools.register({
    name: 'browser_search',
    description: 'Search the web using the local browser. Returns organic result titles, URLs and snippets for a query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        engine: {
          type: 'string',
          description: 'Search engine to use: bing, baidu, sogou, duckduckgo or google. Defaults to the configured engine.',
        },
        maxResults: { type: 'integer', description: 'Maximum number of results to return (defaults to the configured value).' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['query', 'engine', 'examinedUrl', 'sources', 'truncated'],
        properties: {
          query: { type: 'string' },
          engine: { type: 'string' },
          examinedUrl: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'url'],
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                snippet: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: formatSources(value.sources, value.engine, value.truncated) },
      ],
      presentationMeta: (_args, value) => ({
        sources: value.sources,
        truncated: value.truncated,
      }),
    },
    timeoutMs: 130000,
    async execute(args, exec) {
      const query = String(args?.query ?? '').trim();
      if (query.length === 0) throw new Error('query must be a non-empty string');
      const engine = typeof args?.engine === 'string' && ['bing', 'baidu', 'sogou', 'duckduckgo', 'google'].includes(args.engine)
        ? args.engine
        : config.engine;
      const maxResults = Number.isInteger(args?.maxResults) && args.maxResults > 0
        ? Math.min(args.maxResults, 20)
        : config.maxResults;
      const out = await withBrowserProfile(() => browserSearch({
        query,
        engine,
        maxResults,
        headless: config.headless,
        executable: findBrowserPath(config.browserPath || undefined),
        userDataDir: config.userDataDir || undefined,
        timeoutMs: config.timeoutMs,
        signal: exec?.signal,
      }));
      return {
        query,
        engine: out.engine,
        examinedUrl: out.examinedUrl,
        sources: out.sources.map((source) => ({
          title: source.title,
          url: source.url,
          snippet: source.snippet ?? '',
        })),
        truncated: out.total > maxResults,
      };
    },
  });
}

function registerFetchTool(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:browser_fetch',
    order: 113,
    text: 'Use browser_fetch to open a specific HTTP(S) URL in the local browser and return the rendered page text. Cite the URL as a markdown link when you use its content.',
  });
  ctx.tools.register({
    name: 'browser_fetch',
    description: 'Open a specific HTTP(S) URL in the local browser and return the rendered page text.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The HTTP(S) URL to open.' },
        maxChars: { type: 'integer', description: 'Maximum characters of text to return (default 120000).' },
      },
      required: ['url'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'finalUrl', 'text', 'truncated'],
        properties: {
          url: { type: 'string' },
          finalUrl: { type: 'string' },
          title: { type: 'string' },
          text: { type: 'string' },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.title && value.title.length > 0
            ? `Title: ${value.title}\nFetched ${value.finalUrl}\n\n${value.text}${value.truncated ? '\n\n(Content truncated.)' : ''}`
            : `Fetched ${value.finalUrl}\n\n${value.text}${value.truncated ? '\n\n(Content truncated.)' : ''}`,
        },
      ],
      presentationMeta: (_args, value) => ({
        url: value.finalUrl,
        truncated: value.truncated,
      }),
    },
    timeoutMs: 130000,
    async execute(args, exec) {
      const url = String(args?.url ?? '').trim();
      if (!/^https?:/i.test(url)) throw new Error('url must be a valid http(s) URL');
      const maxChars = Number.isInteger(args?.maxChars) && args.maxChars > 0 ? args.maxChars : 120000;
      const out = await withBrowserProfile(() => browserFetch({
        url,
        maxChars,
        headless: config.headless,
        executable: findBrowserPath(config.browserPath || undefined),
        userDataDir: config.userDataDir || undefined,
        timeoutMs: config.timeoutMs,
        signal: exec?.signal,
      }));
      return {
        url,
        finalUrl: out.finalUrl,
        title: out.title,
        text: out.text,
        truncated: out.truncated,
      };
    },
  });
}

function registerGuard(ctx) {
  ctx.tools.guard((exec) => {
    if (config.local && exec.name === 'web_search') {
      return '本地搜索已开启：web_search 已被禁用，请改用 browser_search（本地浏览器）。';
    }
    if (!config.local && exec.name === 'browser_search') {
      return '本地搜索已关闭：browser_search 已被禁用，请改用 web_search，或在输入框打开「本地搜索」。';
    }
    return undefined;
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function success(rpcId, value) {
  return jsonResponse({
    type: 'server-response',
    rpcId,
    result: { ok: true, value },
  });
}

function failure(rpcId, code, message) {
  return jsonResponse({
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code, message, details: {} } },
  });
}

function publicConfig() {
  const detected = findBrowserPath() ?? null;
  return {
    ...config,
    detectedBrowserPath: detected,
    effectiveBrowserPath: config.browserPath || detected,
  };
}

async function handleRpc(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid JSON request body', { status: 400 });
  }
  if (
    body === null
    || typeof body !== 'object'
    || body.type !== 'client-request'
    || typeof body.rpcId !== 'string'
    || typeof body.method !== 'string'
  ) {
    return new Response('invalid client-request envelope', { status: 400 });
  }
  if (body.method !== RPC_METHOD) return new Response('unknown RPC method', { status: 400 });
  const wrapped = body.payload;
  if (wrapped === null || typeof wrapped !== 'object' || typeof wrapped.endpoint !== 'string') {
    return failure(body.rpcId, 'invalid-request', 'payload must be { endpoint, payload }');
  }
  try {
    if (wrapped.endpoint === 'get') {
      return success(body.rpcId, publicConfig());
    }
    if (wrapped.endpoint === 'set') {
      const patch = wrapped.payload ?? {};
      const invalid = validatePatch(patch);
      if (invalid !== undefined) return failure(body.rpcId, 'invalid-config', invalid);
      config = normalize({ ...config, ...patch });
      persistConfig(config);
      return success(body.rpcId, publicConfig());
    }
    if (wrapped.endpoint === 'reset') {
      config = { ...DEFAULTS };
      persistConfig(config);
      return success(body.rpcId, publicConfig());
    }
    if (wrapped.endpoint === 'pickFile') {
      return success(body.rpcId, await pickNative('file'));
    }
    if (wrapped.endpoint === 'pickDirectory') {
      return success(body.rpcId, await pickNative('directory'));
    }
    return failure(body.rpcId, 'unknown-endpoint', `unknown endpoint ${wrapped.endpoint}`);
  } catch (error) {
    return failure(body.rpcId, 'local-web-control-failed', String(error?.message ?? error));
  }
}

export function apply(ctx) {
  persistConfig(config);
  ctx.logger?.info?.(`[local-web-control] config: ${JSON.stringify(config)}`);
  registerSearchTool(ctx);
  registerFetchTool(ctx);
  registerGuard(ctx);

  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const dispose = scope.connection.fetch.register({
        path: RPC_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleRpc(request),
      });
      ctx.logger?.info?.(`[local-web-control] RPC registered: ${RPC_PATH}`);
      return () => dispose();
    }, 'local-web-control: RPC route');
  });
}

