#!/usr/bin/env node
/**
 * Enable pi-ai session-affinity headers for OpenAI-compatible providers.
 *
 * DSH's bundled pi-ai marks `sendSessionAffinityHeaders` and
 * `sessionAffinityFormat` as "withhold", so a local OpenAI-compatible provider
 * never receives the real DSH session id.
 *
 * This patcher flips those two gate fields to "offer" in app.asar without
 * changing the asar size. After patching, add this to the provider config:
 *
 *   compat:
 *     sendSessionAffinityHeaders: true
 *     sessionAffinityFormat: openai
 *
 * Requests then carry:
 *   session_id
 *   x-client-request-id
 *   x-session-affinity
 *
 * Close DSH completely before patching.
 *
 * Usage:
 *   node tools/patch-session-affinity.mjs --check <app.asar>
 *   node tools/patch-session-affinity.mjs <app.asar>
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const target = args.find((arg) => !arg.startsWith('--'));
if (!target || !existsSync(target)) {
  console.error('Usage: node tools/patch-session-affinity.mjs [--check] <app.asar>');
  process.exit(2);
}

const fields = ['sendSessionAffinityHeaders', 'sessionAffinityFormat'];
let buffer = readFileSync(target);
let changes = 0;

for (const field of fields) {
  const old = Buffer.from(`${field}: "withhold"`, 'ascii');
  const replacementText = `${field}: "offer"   `;
  if (replacementText.length !== old.length) {
    console.error('internal length mismatch');
    process.exit(3);
  }
  const replacement = Buffer.from(replacementText, 'ascii');
  let index = 0;
  while ((index = buffer.indexOf(old, index)) >= 0) {
    const output = Buffer.from(buffer);
    replacement.copy(output, index);
    buffer = output;
    index += old.length;
    changes += 1;
  }
}

if (changes === 0) {
  console.log('already patched or unsupported:', target);
  process.exit(0);
}

if (check) {
  console.log('patchable:', target, 'fields =', changes);
  process.exit(0);
}

const backup = `${target}.bak-affinity-${Date.now()}`;
copyFileSync(target, backup);
if (buffer.length !== statSync(target).size) {
  console.error('refusing to write: asar size changed');
  process.exit(4);
}
writeFileSync(target, buffer);
console.log('patched:', target);
console.log('backup: ', backup);
console.log('fields: ', changes);
