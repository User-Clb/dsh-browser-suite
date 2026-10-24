/**
 * Pool of web-DeepSeek pages used as a model source.
 *
 * A DSH session gets its own web conversation page, so ordinary turns continue
 * in the same chat. A fresh page/chat is used for the first turn and after a
 * context compaction. Generation is serialized per browser profile because one
 * DeepSeek web account cannot reliably run two generations at once.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createPage, evalValue, launchBrowser, navigateAndSettle } from './driver.js';
import { GUEST_CHAT_SOURCE } from './web-chat.js';

const CHAT_URL = 'https://chat.deepseek.com/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sessionMapPath(defaultUserDataDir) {
  if (process.env.DSH_WEBDS_SESSION_MAP) return process.env.DSH_WEBDS_SESSION_MAP;
  const home = process.env.DSH_HOME || dirname(defaultUserDataDir || '.');
  return join(home, 'dsh_memory', 'web_sessions.json');
}

function readSessionMap(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionMap(file, map) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(map, null, 2) + '\n', 'utf8');
  } catch {}
}

function isConversationUrl(url) {
  return /^https:\/\/chat\.deepseek\.com\/a\/chat\/s\/[0-9a-f-]{36}$/iu.test(String(url || ''));
}


export function createWebPool({ getConfig, defaultUserDataDir, onBeforeLaunch }) {
  let session;
  let activeKey = '';
  let workers = [];
  let waiters = [];
  let ensureQueue = Promise.resolve();
  const sessionWorkers = new Map();

  function keyOf(config) {
    return JSON.stringify({
      headless: config.headless !== false,
      browserPath: config.browserPath ?? '',
      userDataDir: config.userDataDir ?? '',
    });
  }

  async function closePages() {
    const listed = workers;
    workers = [];
    sessionWorkers.clear();
    for (const worker of listed) {
      try {
        worker.page.close();
      } catch {
        /* ignore */
      }
    }
    if (session) {
      try {
        await session.close();
      } catch {
        /* ignore */
      }
    }
    session = undefined;
    activeKey = '';
    for (const waiter of waiters.splice(0)) waiter.reject(new Error('web DeepSeek pool closed'));
  }

  async function openBrowser(config) {
    await closePages();
    if (onBeforeLaunch) await onBeforeLaunch();
    const userDataDir = config.userDataDir || defaultUserDataDir;
    const started = await launchBrowser({
      executable: config.browserPath || undefined,
      headless: config.headless !== false,
      userDataDir,
    });
    session = started;
    activeKey = keyOf(config);
    workers = [{ page: started.page, busy: false }];
  }

  function ensure() {
    const task = async () => {
      const config = getConfig();
      if (session && keyOf(config) === activeKey) return;
      await openBrowser(config);
    };
    const run = ensureQueue.then(task, task);
    ensureQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function newWorker() {
    const max = Math.max(1, Math.min(10, Number(process.env.DSH_WEBDS_MAX_CONCURRENCY) || Number(getConfig().maxConcurrency) || 3));
    if (workers.length >= max) {
      return await new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    }
    const page = await createPage(session.port);
    const worker = { page, busy: false };
    workers.push(worker);
    return worker;
  }

  async function acquire(sessionId) {
    await ensure();
    const existing = sessionWorkers.get(sessionId);
    if (existing) {
      existing.busy = true;
      return existing;
    }
    const idle = workers.find((worker) => !worker.busy && ![...sessionWorkers.values()].includes(worker));
    if (idle) {
      idle.busy = true;
      sessionWorkers.set(sessionId, idle);
      return idle;
    }
    const worker = await newWorker();
    worker.busy = true;
    sessionWorkers.set(sessionId, worker);
    return worker;
  }

  function release(sessionId, worker) {
    worker.busy = false;
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(worker);
  }

  async function resetToHome(worker) {
    let href = '';
    try {
      href = String(await evalValue(worker.page, 'location.href'));
    } catch {
      /* page may be freshly created */
    }
    if (!/^https:\/\/chat\.deepseek\.com\/?$/u.test(href)) {
      await navigateAndSettle(worker.page, CHAT_URL, 60000);
    }
  }

  let generationLock = Promise.resolve();

  function withGenerationLock(task) {
    const previous = generationLock;
    let releaseLock;
    generationLock = new Promise((resolve) => { releaseLock = resolve; });
    return previous.catch(() => {}).then(task).finally(() => releaseLock());
  }

  /**
   * @param prompt - text to send.
   * @param options - { sessionId, fresh, signal }.
   * @returns guestChat result.
   */
  async function chat(prompt, options = {}) {
    const sessionId = typeof options.sessionId === 'string' && options.sessionId.length > 0 ? options.sessionId : 'default';
    const fresh = options.fresh === true;
    const signal = options.signal;
    return withGenerationLock(async () => {
      const worker = await acquire(sessionId);
      const mapFile = sessionMapPath(defaultUserDataDir);
      let conversationUrl = '';
      try {
        const map = readSessionMap(mapFile);
        const saved = map[sessionId]?.url;
        if (!fresh && isConversationUrl(saved)) {
          let current = '';
          try { current = String(await evalValue(worker.page, 'location.href')); } catch {}
          if (current !== saved) {
            try { await navigateAndSettle(worker.page, saved, 45000); } catch { await resetToHome(worker); }
          }
        } else {
          await resetToHome(worker);
        }
        const expression = `(${GUEST_CHAT_SOURCE})(${JSON.stringify(prompt)})`;
        let result = await evalValue(worker.page, expression, signal);
        for (let attempt = 0; attempt < 2 && result && result.ok !== true && (result.stage === 'send' || result.stage === 'reply'); attempt += 1) {
          await sleep(3000 * (attempt + 1));
          result = await evalValue(worker.page, expression, signal);
        }
        if (result && result.ok === true) {
          try {
            const href = String(await evalValue(worker.page, 'location.href'));
            if (isConversationUrl(href)) {
              const currentMap = readSessionMap(mapFile);
              currentMap[sessionId] = { url: href, updatedAt: Date.now() };
              conversationUrl = href;
              writeSessionMap(mapFile, currentMap);
            }
          } catch {}
        }
        return result ? { ...result, conversationUrl: conversationUrl || result.conversationUrl || '' } : result;
      } finally {
        release(sessionId, worker);
      }
    });
  }

  return {
    chat,
    async status() {
      return {
        open: Boolean(session),
        workers: workers.length,
        sessions: sessionWorkers.size,
        busy: workers.filter((worker) => worker.busy).length,
      };
    },
    async close() {
      await closePages();
    },
  };
}

export { isConversationUrl, readSessionMap, sessionMapPath, writeSessionMap };
