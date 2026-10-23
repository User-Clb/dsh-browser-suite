/**
 * Persistent standalone browser session for the webds bridge.
 *
 * The sidebar mode drives the in-app <webview>; this module drives a real
 * Edge/Chrome over CDP so the same DOM automation can run without the sidebar
 * (headless or with a visible window). One session is kept alive across calls.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { evalValue, findBrowserPath, launchBrowser, navigateAndSettle } from './driver.js';

export const CHAT_URL = 'https://chat.deepseek.com';

/**
 * Create a lazy, serialized standalone browser controller.
 * @param options.getConfig - returns the live `{headless,browserPath,userDataDir}` config.
 * @param options.defaultUserDataDir - persistent profile used when no custom dir is set.
 */
export function createStandaloneBrowser({ getConfig, defaultUserDataDir }) {
  let session;
  let activeKey = '';
  let queue = Promise.resolve();

  function keyOf(config) {
    return JSON.stringify({
      headless: config.headless !== false,
      browserPath: config.browserPath ?? '',
      userDataDir: config.userDataDir ?? '',
    });
  }

  function serialized(task) {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function close() {
    const current = session;
    session = undefined;
    activeKey = '';
    if (current) {
      try {
        await current.close();
      } catch {
        /* already gone */
      }
    }
  }

  async function ensure() {
    const config = getConfig();
    const key = keyOf(config);
    if (session && key === activeKey) return session;

    await close();
    const executable = findBrowserPath(config.browserPath || undefined);
    if (!executable) {
      throw new Error('没有找到 Edge/Chrome；请在网页版桥接设置中指定浏览器路径。');
    }
    const userDataDir = config.userDataDir || defaultUserDataDir;
    mkdirSync(userDataDir, { recursive: true });
    const started = await launchBrowser({
      executable,
      headless: config.headless !== false,
      userDataDir,
    });
    try {
      await navigateAndSettle(started.page, CHAT_URL, 60000);
    } catch (error) {
      await started.close();
      throw error;
    }
    session = started;
    activeKey = key;
    return session;
  }

  async function evaluate(expression) {
    const current = await ensure();
    try {
      await current.page.send('Page.bringToFront');
    } catch {
      /* best effort */
    }
    return await evalValue(current.page, expression);
  }

  async function evaluateWithRetry(expression) {
    try {
      return await evaluate(expression);
    } catch (error) {
      if (!/CDP connection closed|WebSocket|Target closed|Browser closed/i.test(String(error?.message ?? error))) throw error;
      await close();
      return await evaluate(expression);
    }
  }

  async function status() {
    if (!session) {
      return { open: false, href: '', title: '', ready: '', hasInput: false };
    }
    try {
      const info = await evalValue(
        session.page,
        `({ href: location.href, title: document.title, ready: document.readyState, hasInput: !!document.querySelector('#chat-input, textarea, [contenteditable="true"]') })`,
      );
      return { open: true, ...info };
    } catch (error) {
      return { open: true, href: '', title: '', ready: '', hasInput: false, error: String(error?.message ?? error) };
    }
  }

  return {
    async open() {
      return await serialized(async () => {
        await ensure();
        return await status();
      });
    },
    async chat(script, prompt) {
      if (typeof script !== 'string' || script.trim().length === 0) {
        throw new Error('browserChat requires a non-empty script');
      }
      return await serialized(async () => {
        const expression = `(${script})(${JSON.stringify(prompt ?? '')})`;
        return await evaluateWithRetry(expression);
      });
    },
    async newChat(script) {
      if (typeof script !== 'string' || script.trim().length === 0) {
        throw new Error('browserNewChat requires a non-empty script');
      }
      return await serialized(async () => {
        const expression = `(${script})()`;
        return await evaluateWithRetry(expression);
      });
    },
    async status() {
      return await serialized(status);
    },
    async close() {
      return await serialized(close);
    },
    async reset() {
      return await serialized(close);
    },
  };
}
