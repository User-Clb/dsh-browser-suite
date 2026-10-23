#!/usr/bin/env node
/**
 * Make DSH's sidebar Browser tabs use one persistent Electron partition.
 *
 * DSH currently builds an in-memory partition per workspace:
 *   dsh-sidebar-browser-${randomUUID()}
 * so sidebar cookies/localStorage disappear after the desktop app restarts.
 *
 * This patcher replaces that statement in app.asar with:
 *   partition = "persist:dsh-sidebar-webds";
 *
 * The replacement is byte-length neutral, so the asar table stays valid.
 * Close DSH completely before running this script.
 *
 * Usage:
 *   node tools/patch-sidebar-partition.mjs "F:\path\to\DeepSeek Harness\resources\app.asar"
 *   node tools/patch-sidebar-partition.mjs --check "F:\...\app.asar"
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const PARTITION = 'persist:dsh-sidebar-webds';
const LEGACY = Buffer.from('dsh-sidebar-browser-${randomUUID()}');
const PATCHED = Buffer.from(PARTITION);

const args = process.argv.slice(2);
const check = args.includes('--check');
const target = args.find((arg) => !arg.startsWith('--'));

if (!target || !existsSync(target)) {
  console.error('Usage: node tools/patch-sidebar-partition.mjs [--check] <app.asar>');
  process.exit(2);
}

const buffer = readFileSync(target);

if (buffer.includes(PATCHED)) {
  console.log('already patched:', target, 'partition =', PARTITION);
  process.exit(0);
}

const marker = buffer.indexOf(LEGACY);
if (marker < 0) {
  console.error('partition marker not found; DSH version changed, refusing to patch');
  process.exit(3);
}

const statementStart = buffer.lastIndexOf(Buffer.from('partition = '), marker);
const statementEnd = buffer.indexOf(0x3b, marker) + 1;
if (statementStart < 0 || statementEnd <= statementStart) {
  console.error('cannot locate partition statement');
  process.exit(4);
}

const oldLength = statementEnd - statementStart;
const replacementText = `partition = "${PARTITION}";`;
if (replacementText.length > oldLength) {
  console.error('replacement does not fit; refusing to patch');
  process.exit(5);
}

if (check) {
  console.log('patchable:', target, 'statement bytes =', oldLength);
  process.exit(0);
}

const backup = `${target}.bak-${Date.now()}`;
copyFileSync(target, backup);

const replacement = Buffer.from(replacementText + ' '.repeat(oldLength - replacementText.length), 'ascii');
const output = Buffer.from(buffer);
replacement.copy(output, statementStart);

if (output.length !== buffer.length || statSync(target).size !== output.length) {
  console.error('refusing to write: asar size would change');
  process.exit(6);
}

writeFileSync(target, output);
console.log('patched:', target);
console.log('backup: ', backup);
console.log('partition:', PARTITION);
