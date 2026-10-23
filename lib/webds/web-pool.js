/**
 * Pool of independent web-DeepSeek pages used as a model source.
 *
 * Every request gets a fresh web conversation (full prompt in, stateless from
 * the web app's point of view) and up to `maxConcurrency` pages run at once.
 */
import { createPage, evalValue, launchBrowser, navigateAndSettle } from './driver.js';
import { GUEST_CHAT_SOURCE } from './web-chat.js';

const CHAT_URL = 'https://chat.deepseek.com/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWebPool({ getConfig, defaultUserDataDir, onBeforeLaunch }) {
  let session;
  let activeKey = '';
  let workers = [];
  let waiters = [];
  let ensureQueue = Promise.resolve();

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

  async function acquire() {
    await ensure();
    const idle = workers.find((worker) => !worker.busy);
    if (idle) {
      idle.busy = true;
      return idle;
    }
    const max = Math.max(1, Math.min(10, Number(getConfig().maxConcurrency) || 3));
    if (workers.length < max) {
      const page = await createPage(session.port);
      const worker = { page, busy: true };
      workers.push(worker);
      return worker;
    }
    return await new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }

  function release(worker) {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(worker);
    else worker.busy = false;
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

  async function chat(prompt, signal) {
    const worker = await acquire();
    try {
      await resetToHome(worker);
      const expression = `(${GUEST_CHAT_SOURCE})(${JSON.stringify(prompt)})`;
      let result = await evalValue(worker.page, expression, signal);
      for (let attempt = 0; attempt < 2 && result && result.ok !== true && (result.stage === 'send' || result.stage === 'reply'); attempt += 1) {
        // Transient miss on a fresh/background page: reset and retry once after
        // giving any concurrent generation time to settle.
        await sleep(3000 * (attempt + 1));
        await resetToHome(worker);
        result = await evalValue(worker.page, expression, signal);
      }
      return result;
    } finally {
      release(worker);
    }
  }

  return {
    chat,
    async status() {
      return {
        open: Boolean(session),
        workers: workers.length,
        busy: workers.filter((worker) => worker.busy).length,
      };
    },
    async close() {
      await closePages();
    },
  };
}
