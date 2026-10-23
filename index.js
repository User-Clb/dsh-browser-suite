/**
 * dsh-browser-suite
 *
 * One DSH plugin that combines:
 *   - local Edge/Chrome-backed browser_search / browser_fetch with a composer
 *     on/off switch and local-vs-API guard (from dsh-local-web-control);
 *   - the DOM-automated web DeepSeek bridge with memory/execute/continue and
 *     sidebar or standalone-browser operation (from dsh-webds-bridge).
 */
import * as control from './lib/control/index.js';
import * as webds from './lib/webds/index.js';

export const name = 'dsh-browser-suite';

export const inject = [...new Set([
  ...(control.inject ?? []),
  ...(webds.inject ?? []),
])];

export function apply(ctx) {
  control.apply(ctx);
  webds.apply(ctx);
}
