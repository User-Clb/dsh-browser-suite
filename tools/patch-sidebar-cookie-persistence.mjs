#!/usr/bin/env node
/**
 * Persist Sidebar browser session cookies.
 *
 * DeepSeek sets auth cookies (notably `ds_session_id`) as session cookies.
 * Chromium does not write session cookies to disk, so a persistent Electron
 * partition alone still logs the user out after a restart.
 *
 * This patcher adds a `cookies.on("changed")` listener to DSH's sidebar
 * browser session. Every new session cookie is rewritten with a 30-day expiry,
 * so the persistent partition can actually restore the login.
 *
 * Byte-neutral: configureSession is compacted and padded to its original
 * asar size. Close DSH completely before patching.
 *
 * Usage:
 *   node tools/patch-sidebar-cookie-persistence.mjs --check <app.asar>
 *   node tools/patch-sidebar-cookie-persistence.mjs <app.asar>
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const target = args.find((arg) => !arg.startsWith('--'));
if (!target || !existsSync(target)) {
  console.error('Usage: node tools/patch-sidebar-cookie-persistence.mjs [--check] <app.asar>');
  process.exit(2);
}

const buffer = readFileSync(target);
if (buffer.includes(Buffer.from('__webdsPersistCookies'))) { console.log('already patched:', target); process.exit(0); }
const startMarker = Buffer.from('configureSession(browserSession) {', 'ascii');
const endMarker = Buffer.from('\n\tallowedNavigation(value) {', 'ascii');
const start = buffer.indexOf(startMarker);
const end = buffer.indexOf(endMarker, start);
if (start < 0 || end <= start) {
  console.error('configureSession markers not found; DSH version changed');
  process.exit(3);
}
const old = buffer.subarray(start, end);
if (!old.includes(Buffer.from('will-download'))) {
  console.error('unexpected configureSession body');
  process.exit(4);
}

const compact =
  'configureSession(b){const __webdsPersistCookies=1;' +
  'b.setPermissionRequestHandler((_c,_p,cb)=>cb(false));' +
  'b.setPermissionCheckHandler(()=>false);' +
  'b.setDevicePermissionHandler(()=>false);' +
  'b.setDisplayMediaRequestHandler((_r,cb)=>cb({}));' +
  'b.on("will-download",e=>e.preventDefault());' +
  'b.webRequest.onBeforeRequest((d,cb)=>{const u=new URL(d.url);' +
  'cb({cancel:["http:","https:","ws:","wss:"].includes(u.protocol)?u.username!==""||u.password!==""||this.isApplicationHost(u):!["about:","data:","blob:"].includes(u.protocol)})});' +
  'b.cookies.on("changed",(e,c,k,r)=>{if(!r&&c.session&&c.domain){' +
  'b.cookies.set({...c,url:"https://"+c.domain.replace(/^\\./u,"")+(c.path||"/"),expirationDate:Date.now()/1e3+2592e3}).catch(()=>{})}});' +
  '}';

const replacement = Buffer.from(compact, 'ascii');
if (replacement.length > old.length) {
  console.error('replacement too large', replacement.length, old.length);
  process.exit(5);
}

if (old.includes(Buffer.from('__webdsPersistCookies'))) {
  console.log('already patched:', target);
  process.exit(0);
}

if (check) {
  console.log('patchable:', target, 'old =', old.length, 'new =', replacement.length);
  process.exit(0);
}

const backup = `${target}.bak-cookies-${Date.now()}`;
copyFileSync(target, backup);
const output = Buffer.from(buffer);
replacement.copy(output, start);
output.fill(0x20, start + replacement.length, start + old.length);
if (output.length !== statSync(target).size) {
  console.error('refusing to write: asar size changed');
  process.exit(6);
}
writeFileSync(target, output);
console.log('patched:', target);
console.log('backup: ', backup);
console.log('configureSession bytes:', old.length, '->', replacement.length);
