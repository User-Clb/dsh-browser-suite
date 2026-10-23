/**
 * Local-browser driver for the dsh-local-browser-search plugin.
 *
 * Launches the user's installed Edge/Chrome over the Chrome DevTools Protocol
 * using ONLY Node built-ins: `node:child_process` for the process, `node:net`
 * for a free port, the global `fetch` and `WebSocket` for CDP. There is no
 * puppeteer/playwright dependency and no bundled browser download.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Browser discovery
// ---------------------------------------------------------------------------
const CANDIDATE_PATHS = [
  // Microsoft Edge
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/msedge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Google Chrome
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  // Brave / Chromium
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** Resolve a browser executable path: explicit config, env, then auto-detect. */
export function findBrowserPath(preferred) {
  const candidates = [
    typeof preferred === 'string' && preferred.length > 0 ? preferred : undefined,
    typeof process.env.DSH_BROWSER_PATH === 'string' ? process.env.DSH_BROWSER_PATH : undefined,
  ].filter(Boolean);
  for (const c of candidates) if (c) return c;
  for (const p of CANDIDATE_PATHS) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Pick an available TCP port for the DevTools endpoint. */
export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------
// Process / CDP plumbing
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a JSON endpoint until it answers (or the deadline passes). */
async function pollJson(url, deadlineMs) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > deadlineMs) throw new Error(`CDP endpoint never came up: ${url}`);
    await sleep(300);
  }
}

/**
 * A tiny JSON-RPC-over-WebSocket client for CDP.
 * `send(method, params)` resolves with `result`; `once(event)` subscribes.
 */
function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  let closed = false;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    const set = listeners.get(msg.method);
    if (set) for (const fn of set) fn(msg.params);
  });
  ws.addEventListener('close', () => {
    closed = true;
    for (const [, p] of pending) p.reject(new Error('CDP connection closed'));
    pending.clear();
  });
  ws.addEventListener('error', () => ws.close());

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('WebSocket error')));
  });

  return {
    get closed() {
      return closed;
    },
    async open() {
      await Promise.race([
        ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('CDP WebSocket connect timeout')), 10000)),
      ]);
    },
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        try {
          ws.send(JSON.stringify({ id, method, params }));
        } catch (e) {
          pending.delete(id);
          reject(e);
        }
      });
    },
    once(event) {
      return new Promise((resolve) => {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        const fn = (params) => {
          set.delete(fn);
          listeners.delete(event);
          resolve(params);
        };
        set.add(fn);
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Kill a process tree (Windows uses taskkill /T /F; POSIX kills the group). */
function sanitizeProfilePreferences(dataDir) {
  const targets = [join(dataDir, 'Default', 'Preferences'), join(dataDir, 'Preferences')];
  for (const file of targets) {
    try {
      if (!existsSync(file)) continue;
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (!data.profile || typeof data.profile !== 'object') data.profile = {};
      data.profile.exit_type = 'Normal';
      data.profile.exited_cleanly = true;
      writeFileSync(file, JSON.stringify(data), 'utf8');
    } catch {}
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Browser session
// ---------------------------------------------------------------------------
/** Enable the domains and UA every automation page needs. */
async function preparePage(page) {
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  try {
    await page.send('Network.enable');
    await page.send('Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
    });
  } catch {
    /* UA override is best-effort */
  }
}

/** Open an additional page/tab in an already-running CDP browser. */
export async function createPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`cannot create browser page: HTTP ${response.status}`);
  const target = await response.json();
  const page = connectCdp(target.webSocketDebuggerUrl);
  await page.open();
  await preparePage(page);
  return page;
}

/**
 * Launch the local browser and hand back a bound page client.
 * @returns {Promise<{page: object, port: number, close: () => void}>}
 */
export async function launchBrowser({ executable, headless = true, userDataDir, signal } = {}) {
  const path = executable ?? findBrowserPath();
  if (!path) throw new Error('No local Chromium-based browser found. Install Edge/Chrome or set DSH_BROWSER_PATH.');
  const port = await pickFreePort();
  const temporaryProfile = !userDataDir;
  const dataDir = temporaryProfile ? mkdtempSync(join(tmpdir(), 'dsh-browser-')) : userDataDir;
  if (!temporaryProfile) { mkdirSync(dataDir, { recursive: true }); sanitizeProfilePreferences(dataDir); }

  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=msEdgeFirstRunExperience,msEdgeNotFirstRunWaypoint,msEdgeWelcomePage',
    '--remote-allow-origins=*',
    '--window-size=1280,900',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`,
  ];
  if (headless) args.push('--headless=new', '--disable-gpu', '--hide-scrollbars');
  args.push('about:blank');

  const proc = spawn(path, args, { stdio: 'ignore', windowsHide: true, detached: false });
  let exitedCode = null;
  proc.on('error', () => {});
  proc.on('exit', (code) => {
    exitedCode = code;
  });

  const abortClose = () => {
    killTree(proc.pid);
  };
  if (signal && typeof signal.addEventListener === 'function') {
    if (signal.aborted) abortClose();
    else signal.addEventListener('abort', abortClose, { once: true });
  }

  try {
    const version = await pollJson(`http://127.0.0.1:${port}/json/version`, 20000);
    if (exitedCode !== null) throw new Error(`Browser exited early (code ${exitedCode})`);
    const list = await pollJson(`http://127.0.0.1:${port}/json/list`, 10000);
    const target = (list || []).find((t) => t.type === 'page');
    if (!target) throw new Error('No page target available from the browser');
    const page = connectCdp(target.webSocketDebuggerUrl);
    await page.open();
    await preparePage(page);
    return {
      page,
      port,
      browserPath: path,
      async close() {
        try {
          try { await page.send('Browser.close'); } catch {}
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (proc.exitCode === null) killTree(proc.pid);
        } finally {
          sanitizeProfilePreferences(dataDir);
          page.close();
          if (temporaryProfile) {
            setTimeout(() => {
              try {
                rmSync(dataDir, { recursive: true, force: true });
              } catch {
                /* ignore */
              }
            }, 500);
          }
        }
      },
    };
  } catch (e) {
    if (e.message === 'CDP endpoint never came up: ' + `http://127.0.0.1:${port}/json/version`) {
      killTree(proc.pid);
      throw new Error(`Local browser failed to start (${path}). Is a browser policy blocking remote debugging?${temporaryProfile ? '' : ` The user-data directory ${dataDir} may already be in use; close other browser windows using it.`}`);
    }
    killTree(proc.pid);
    throw e;
  }
}

/** Navigate the page to `url` and wait until it settles with real content. */
export async function navigateAndSettle(page, url, timeoutMs = 30000, signal, opts = {}) {
  const minText = opts.minText ?? 0; // minimum innerText length before we consider the page "settled"
  const deadline = Date.now() + timeoutMs;
  const loadFired = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url }).catch(() => {});
  let href = '';
  for (;;) {
    if (Date.now() > deadline) break;
    if (signal && signal.aborted) throw aborted();
    await sleep(150);
    try {
      const r = await page.send('Runtime.evaluate', {
        expression: `({ ready: document.readyState, href: location.href, len: (document.body && document.body.innerText ? document.body.innerText.trim().length : 0) })`,
        returnByValue: true,
      });
      const v = r?.result?.value ?? {};
      href = v.href ?? '';
      const ready = v.ready ?? 'loading';
      const len = v.len ?? 0;
      // Never accept the pre-navigation about:blank document as "settled".
      if (ready === 'complete' && href && href !== 'about:blank' && len >= minText) break;
    } catch {
      continue; // page mid-navigation
    }
  }
  // Give JS-rendered content a final beat after the first passing snapshot.
  if (minText > 0) await sleep(400);
  void loadFired;
  return href;
}

function aborted() {
  const e = new Error('Browser call aborted');
  e.name = 'AbortError';
  return e;
}

/** Evaluate an expression returning a JSON value, observing the abort signal. */
export async function evalValue(page, expression, signal) {
  if (signal && signal.aborted) throw aborted();
  const r = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r?.exceptionDetails) {
    throw new Error(`Page evaluation failed: ${r.exceptionDetails.text ?? 'unknown'}`);
  }
  return r?.result?.value;
}

// ---------------------------------------------------------------------------
// Search-engine result extraction (runs inside the page)
// ---------------------------------------------------------------------------
/** Bing organic results: `#b_results li.b_algo` → title, href, snippet. */
const EXTRACT_BING = `(() => {
  const out = [];
  for (const li of document.querySelectorAll('#b_results > li.b_algo')) {
    const a = li.querySelector('h2 a');
    const p = li.querySelector('p, .b_caption p');
    if (a) out.push({ title: (a.textContent || '').trim(), url: a.href, snippet: p ? (p.textContent || '').trim() : '' });
  }
  return out;
})()`;

/** DuckDuckGo HTML endpoint results. */
const EXTRACT_DDG = `(() => {
  const out = [];
  for (const r of document.querySelectorAll('.result, .web-result')) {
    const a = r.querySelector('a.result__a, a.result__a[href]');
    const sn = r.querySelector('.result__snippet');
    if (a) out.push({ title: (a.textContent || '').trim(), url: a.href, snippet: sn ? (sn.textContent || '').trim() : '' });
  }
  return out;
})()`;

/** Google organic results. */
const EXTRACT_GOOGLE = `(() => {
  const out = [];
  for (const g of document.querySelectorAll('div.g, div[data-sokoban-container] div.g, div.MjjYud')) {
    const a = g.querySelector('a');
    if (!a || !a.href || a.href === '#') continue;
    const h = a.querySelector('h3');
    const sn = g.querySelector('[data-sncf], .VwiC3b, [data-content-feature="1"]');
    if (h) out.push({ title: (h.textContent || '').trim(), url: a.href, snippet: sn ? (sn.textContent || '').trim() : '' });
  }
  return out;
})()`;

/** Baidu organic results: `#content_left` result containers → title, href, snippet. */
const EXTRACT_BAIDU = `(() => {
  const out = [];
  const seen = new Set();
  const nodes = document.querySelectorAll('#content_left .result, #content_left .c-container, #content_left [tpl], #content_left .result-op');
  for (const el of nodes) {
    const h = el.querySelector('h3');
    const a = h ? h.querySelector('a') : el.querySelector('a[href]');
    if (!a) continue;
    const sn = el.querySelector('.c-abstract, [class*="content-right"], .c-span-last, .c-color-text');
    const real = el.getAttribute('mu') || a.getAttribute('data-landurl') || a.getAttribute('data-url') || a.href;
    if (!real || !/^https?:/i.test(real) || seen.has(real)) continue;
    seen.add(real);
    let snippet = sn ? (sn.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (!snippet) {
      const titleText = h ? (h.textContent || '').trim() : '';
      const full = (el.textContent || '').replace(/\s+/g, ' ').trim();
      snippet = (full.startsWith(titleText) ? full.slice(titleText.length) : full).trim().slice(0, 240);
    }
    out.push({ title: (h ? h.textContent : a.textContent || '').trim(), url: real, snippet });
  }
  return out;
})()`;

/** Sogou organic results: `vrwrap` / `rb` cards → title, href, snippet. */
const EXTRACT_SOGOU = `(() => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('.vrwrap, .rb, .result')) {
    const h = el.querySelector('h3');
    const a = h ? h.querySelector('a') : el.querySelector('a[href]');
    if (!a) continue;
    const sn = el.querySelector('.str_info, .text-layout, .space-txt, .fz-mid');
    const real = a.getAttribute('data-url') || a.href;
    if (!real || !/^https?:/i.test(real) || seen.has(real)) continue;
    seen.add(real);
    out.push({ title: (h ? h.textContent : a.textContent || '').trim(), url: real, snippet: sn ? (sn.textContent || '').replace(/\s+/g, ' ').trim() : '' });
  }
  return out;
})()`;

const ENGINES = {
  bing: { url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`, extract: EXTRACT_BING },
  baidu: { url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`, extract: EXTRACT_BAIDU },
  sogou: { url: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}`, extract: EXTRACT_SOGOU },
  duckduckgo: { url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, extract: EXTRACT_DDG },
  google: { url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`, extract: EXTRACT_GOOGLE },
};

/**
 * Perform a web search in the local browser.
 * @returns {Promise<{sources: Array<{title,url,snippet}>, total: number, examinedUrl: string, engine: string}>}
 */
export async function browserSearch({ query, engine = 'bing', maxResults = 8, headless = true, executable, userDataDir, timeoutMs = 30000, signal } = {}) {
  const impl = ENGINES[engine] ?? ENGINES.bing;
  if (!query || query.trim().length === 0) throw new Error('query must be a non-empty string');
  const session = await launchBrowser({ executable, headless, userDataDir, signal });
  try {
    const href = await navigateAndSettle(session.page, impl.url(query.trim()), timeoutMs, signal, { minText: 0 });
    let raw = await evalValue(session.page, impl.extract, signal);
    if (!Array.isArray(raw)) raw = [];
    const cleaned = engine === 'google'
      ? raw.map((r) => ({ ...r, url: cleanGoogleUrl(r.url) })).filter((r) => /^https?:/.test(r.url))
      : raw.filter((r) => r.title && r.url && /^(https?:\/\/)/i.test(r.url));
    const external = cleaned.filter((r) => {
      if (engine === 'baidu' && /^https?:\/\/(?:www\.)?baidu\.com\/s\b/i.test(r.url)) return false;
      if (engine === 'sogou' && /^https?:\/\/(?:www\.)?sogou\.com\/web\b/i.test(r.url)) return false;
      return true;
    });
    if (external.length === 0 && /(wappass|captcha|antispider|verify)/i.test(href)) {
      throw new Error(`${engine} 返回了验证码/反爬页面（${href}）；请改用 Bing，或在可见窗口中打开该引擎完成一次验证后重试。`);
    }
    return { sources: external.slice(0, maxResults), total: external.length, examinedUrl: href, engine };
  } finally {
    await session.close();
  }
}

/** Strip Google's redirect-wrapped hrefs back to the target URL. */
function cleanGoogleUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/url') {
      const q = u.searchParams.get('q');
      if (q && /^https?:/.test(q)) return q;
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Fetch the text content of a URL using the local browser.
 * @returns {Promise<{url, finalUrl, title, text, truncated}>}
 */
export async function browserFetch({ url, maxChars = 120000, headless = true, executable, userDataDir, timeoutMs = 30000, signal } = {}) {
  if (!url || !/^https?:/i.test(url.trim())) throw new Error('url must be a valid http(s) URL');
  const session = await launchBrowser({ executable, headless, userDataDir, signal });
  try {
    const finalUrl = await navigateAndSettle(session.page, url.trim(), timeoutMs, signal, { minText: 80 });
    const title = await evalValue(session.page, 'document.title', signal) ?? '';
    const text = await evalValue(
      session.page,
      `(() => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script,style,noscript,svg,nav,header,footer,form,.ad,iframe').forEach(n => n.remove());
        return (clone.innerText || '').replace(/[ \\t\\r\\n]{2,}/g,' ').trim();
      })()`,
      signal,
    ) ?? '';
    return { url: url.trim(), finalUrl, title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
  } finally {
    await session.close();
  }
}
