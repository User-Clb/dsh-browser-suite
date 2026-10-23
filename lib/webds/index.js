import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { existsSync, promises, readFileSync, statSync } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import { createStandaloneBrowser } from "./standalone.js";
import { createWebPool } from "./web-pool.js";
import { startWebApiServer } from "./local-api.js";

//#region src/host/config.ts
function readRoutingConfig(memoryDir) {
	const envMemory = process.env.DSH_WEBDS_MEMORY_MODEL ?? "";
	const envExecution = process.env.DSH_WEBDS_EXECUTION_MODEL ?? "";
	const file = path.join(memoryDir, "config.json");
	if (existsSync(file)) try {
		const data = JSON.parse(readFileSync(file, "utf8"));
		return {
			memoryInjectionModel: String(data.memoryInjectionModel ?? envMemory),
			executionModel: String(data.executionModel ?? envExecution),
			source: file
		};
	} catch {}
	return {
		memoryInjectionModel: envMemory,
		executionModel: envExecution,
		source: "env/default"
	};
}

const execFileAsync = promisify(execFile);
const BROWSER_MODES = new Set(["sidebar", "standalone"]);

function defaultBrowserProfileDir() {
  return path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "dsh_webds_browser");
}

/** Normalize the persisted browser section. */
function browserConfigOf(config = {}) {
  return {
    enabled: config.enabled !== false,
    mode: BROWSER_MODES.has(config.browserMode) ? config.browserMode : "sidebar",
    headless: config.headless !== false,
    browserPath: typeof config.browserPath === "string" ? config.browserPath.trim() : "",
    userDataDir: typeof config.userDataDir === "string" ? config.userDataDir.trim() : "",
    maxConcurrency: Number.isInteger(config.maxConcurrency) && config.maxConcurrency > 0
      ? Math.min(10, config.maxConcurrency)
      : 3,
  };
}

function validateBrowserConfig(config) {
  if (config.browserPath && !existsSync(config.browserPath)) {
    return `浏览器路径不存在：${config.browserPath}`;
  }
  if (config.userDataDir && !path.isAbsolute(config.userDataDir)) {
    return `user-data 目录必须是绝对路径：${config.userDataDir}`;
  }
  return undefined;
}

async function pickNative(kind) {
  if (process.platform !== "win32") {
    throw new Error("原生文件选择器目前只支持 Windows；请手动输入绝对路径。");
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
  const script = kind === "directory" ? folderScript : fileScript;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const powershellPath = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const { stdout } = await execFileAsync(
    existsSync(powershellPath) ? powershellPath : "powershell.exe",
    ["-NoLogo", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script],
    { timeout: 300000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim() || null;
}

//#endregion
//#region src/host/memory-store.ts
const DEFAULT_MEMORY_KEY = "progress";
const CONFIG_FILE = "config.json";
const HISTORY_DIR = "history";
const HISTORY_LIMIT = 20;
/** 别名文件所在的子目录，与默认的 progress.md 分开，避免语义混淆。 */
const ALIAS_DIR = "projects";
/** 默认记忆根目录：$DSH_HOME/dsh_memory（环境变量优先）。 */
function defaultMemoryDir() {
	const explicit = process.env.DSH_WEBDS_MEMORY_DIR;
	if (explicit && explicit.trim().length > 0) return path.resolve(explicit);
	const home = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
	return path.join(home, "dsh_memory");
}
/**

* 规范化记忆别名，同时充当**安全边界**：别名直接参与拼路径，

* 必须挡住 `../`、绝对路径、盘符和保留字符，否则等于任意文件写入。

* @param raw 用户输入。

* @returns 安全的相对路径片段（可含 `/` 形成子目录）。

*/
function normalizeMemoryKey(raw) {
	const text = String(raw ?? "").trim();
	if (text.length === 0) throw new Error("记忆别名不能为空");
	if (/^[\\/]/u.test(text)) throw new Error("记忆别名不能以斜杠开头（请用相对路径）");
	if (/^[a-zA-Z]:/u.test(text)) throw new Error("记忆别名不能是盘符路径");
	const normalized = text.replace(/\\/gu, "/").replace(/\.md$/i, "").replace(/\/{2,}/gu, "/").replace(/^\.\//u, "");
	const segments = normalized.split("/").filter((segment) => segment.length > 0);
	if (segments.length === 0) throw new Error("记忆别名不能为空");
	if (segments.length > 4) throw new Error("记忆别名最多 4 层目录");
	for (const segment of segments) {
		if (segment === "." || segment === "..") throw new Error("记忆别名不能包含 . 或 ..");
		if (!/^[\p{L}\p{N}_\- .]+$/u.test(segment)) throw new Error(`记忆别名含非法字符：${segment}（仅允许中英文、数字、- _ 空格）`);
		if (/[.\s]$/u.test(segment)) throw new Error(`记忆别名不能以点或空格结尾：${segment}`);
	}
	if (normalized.length > 96) throw new Error("记忆别名过长（最多 96 字符）");
	return segments.join("/");
}
function timestamp(date = new Date()) {
	const pad = (value, width = 2) => String(value).padStart(width, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}
async function exists(target) {
	try {
		await promises.access(target);
		return true;
	} catch {
		return false;
	}
}
/** 先写临时文件再替换，避免半截文件；Windows 上 rename 覆盖失败时退回 remove+rename。 */
async function writeAtomic(file, content) {
	const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
	await promises.writeFile(temporary, content, "utf8");
	try {
		await promises.rename(temporary, file);
	} catch {
		await promises.rm(file, { force: true });
		await promises.rename(temporary, file);
	}
}
var MemoryStore = class {
	dir;
	source;
	cache;
	constructor(dir = defaultMemoryDir(), source = "default") {
		this.dir = path.resolve(dir);
		this.source = source;
	}
	get configPath() {
		return path.join(this.dir, CONFIG_FILE);
	}
	get historyPath() {
		return path.join(this.dir, HISTORY_DIR);
	}
	/** 默认记忆（别名 progress）的绝对路径。 */
	get progressPath() {
		return this.fileFor(DEFAULT_MEMORY_KEY);
	}
	/** 别名 → 绝对路径。progress 保持根目录直放，其余进入 projects/。 */
	fileFor(key) {
		const normalized = normalizeMemoryKey(key);
		if (normalized === DEFAULT_MEMORY_KEY) return path.join(this.dir, `${DEFAULT_MEMORY_KEY}.md`);
		const prefix = `${ALIAS_DIR}/`;
		const relative = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
		return path.join(this.dir, ALIAS_DIR, `${relative}.md`);
	}
	/** 读取存储根配置（不存在则返回空对象）。 */
	async readConfig() {
		try {
			const raw = await promises.readFile(this.configPath, "utf8");
			const data = JSON.parse(raw);
			const config = {};
			if (typeof data.memoryDir === "string" && data.memoryDir.trim().length > 0) config.memoryDir = data.memoryDir;
			if (typeof data.lastKey === "string" && data.lastKey.trim().length > 0) config.lastKey = data.lastKey;
			if (typeof data.browserMode === "string" && BROWSER_MODES.has(data.browserMode)) config.browserMode = data.browserMode;
			if (typeof data.enabled === "boolean") config.enabled = data.enabled;
			if (typeof data.headless === "boolean") config.headless = data.headless;
			if (typeof data.browserPath === "string") config.browserPath = data.browserPath;
			if (typeof data.userDataDir === "string") config.userDataDir = data.userDataDir;
			if (Number.isInteger(data.maxConcurrency)) config.maxConcurrency = data.maxConcurrency;
			return config;
		} catch {
			return {};
		}
	}
	async writeConfig(patch) {
		const current = await this.readConfig();
		const next = {
			...current,
			...patch
		};
		if (next.memoryDir !== void 0 && next.memoryDir.trim().length === 0) delete next.memoryDir;
		if (next.lastKey !== void 0 && next.lastKey.trim().length === 0) delete next.lastKey;
		await promises.mkdir(this.dir, { recursive: true });
		await writeAtomic(this.configPath, `${JSON.stringify(next, void 0, 2)}\n`);
		return next;
	}
	/** 列出所有记忆文件（默认 + projects/ 下的别名），用于面板下拉。 */
	async listMemories() {
		const out = [];
		const collect$1 = async (dir, prefix) => {
			let entries = [];
			try {
				entries = await promises.readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					if (prefix === "" && entry.name === HISTORY_DIR) continue;
					await collect$1(full, `${prefix}${entry.name}/`);
					continue;
				}
				if (!entry.name.toLowerCase().endsWith(".md")) continue;
				if (entry.name.includes(".tmp-")) continue;
				try {
					const stat = await promises.stat(full);
					out.push({
						key: prefix + entry.name.replace(/\.md$/iu, ""),
						path: full,
						bytes: stat.size,
						mtimeMs: stat.mtimeMs
					});
				} catch {}
			}
		};
		await collect$1(this.dir, "");
		const seen = new Map();
		for (const item of out) {
			const relative = path.relative(this.dir, item.path).replace(/\\/gu, "/");
			const key = relative.replace(/\.md$/iu, "");
			if (!seen.has(key)) seen.set(key, {
				...item,
				key
			});
		}
		const list = [...seen.values()];
		list.sort((left, right) => right.mtimeMs - left.mtimeMs);
		return list;
	}
	/** 读取指定别名的记忆。命中 mtime+size 缓存时不再读盘。 */
	async read(key = DEFAULT_MEMORY_KEY) {
		const file = this.fileFor(key);
		const normalized = normalizeMemoryKey(key);
		if (!await exists(file)) return {
			path: file,
			key: normalized,
			content: "",
			mtimeMs: 0,
			cached: false
		};
		const stat = await promises.stat(file);
		if (this.cache !== void 0 && this.cache.path === file && this.cache.mtimeMs === stat.mtimeMs && this.cache.size === stat.size) return {
			path: file,
			key: normalized,
			content: this.cache.content,
			mtimeMs: stat.mtimeMs,
			cached: true
		};
		const content = await promises.readFile(file, "utf8");
		this.cache = {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			content,
			path: file
		};
		return {
			path: file,
			key: normalized,
			content,
			mtimeMs: stat.mtimeMs,
			cached: false
		};
	}
	/**
	
	* 归档旧内容并覆盖写新总结。
	
	* @param summary Client 端已截断的总结文本。
	
	* @param key 记忆别名；默认 progress.md。
	
	*/
	async save(summary, key = DEFAULT_MEMORY_KEY) {
		const content = String(summary ?? "");
		if (content.trim().length === 0) throw new Error("memory summary is empty");
		const normalized = normalizeMemoryKey(key);
		const file = this.fileFor(normalized);
		await promises.mkdir(path.dirname(file), { recursive: true });
		await promises.mkdir(this.historyPath, { recursive: true });
		let archivedPath;
		if (await exists(file)) {
			const previous = await promises.readFile(file, "utf8");
			if (previous.trim().length > 0) {
				const stem = normalized.replace(/\//gu, "__");
				archivedPath = path.join(this.historyPath, `${stem}-${timestamp()}.md`);
				await promises.writeFile(archivedPath, previous, "utf8");
			}
		}
		const createdAt = new Date().toISOString();
		const body = content.endsWith("\n") ? content : `${content}\n`;
		await writeAtomic(file, body);
		const pruned = await this.pruneHistory();
		const stat = await promises.stat(file);
		this.cache = {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			content: body,
			path: file
		};
		return {
			path: file,
			key: normalized,
			bytes: Buffer.byteLength(body, "utf8"),
			...archivedPath === void 0 ? {} : { archivedPath },
			pruned,
			mtimeMs: stat.mtimeMs,
			createdAt
		};
	}
	/** 只保留最近 HISTORY_LIMIT 个归档，返回删除数量。 */
	async pruneHistory() {
		let entries = [];
		try {
			entries = (await promises.readdir(this.historyPath)).filter((name$1) => name$1.endsWith(".md"));
		} catch {
			return 0;
		}
		entries.sort();
		const excess = entries.length - HISTORY_LIMIT;
		if (excess <= 0) return 0;
		for (const name$1 of entries.slice(0, excess)) await promises.rm(path.join(this.historyPath, name$1), { force: true });
		return excess;
	}
};
function createMemoryStore(dir, source) {
	return new MemoryStore(dir, source);
}
/** 从根目录配置解析最终使用的目录与来源（env 优先且不可覆盖）。 */
async function resolveMemoryRoot() {
	const envDir = process.env.DSH_WEBDS_MEMORY_DIR?.trim();
	const baseDir = envDir ? path.resolve(envDir) : defaultMemoryDir();
	const pointer = new MemoryStore(baseDir, envDir ? "env" : "default");
	const config = await pointer.readConfig();
	if (envDir) return {
		dir: baseDir,
		source: "env",
		envDir,
		config
	};
	const configured = config.memoryDir?.trim();
	if (configured && configured.length > 0) {
		const target = new MemoryStore(path.resolve(configured), "config");
		const targetConfig = await target.readConfig();
		return {
			dir: target.dir,
			source: "config",
			envDir,
			config: {
				...targetConfig,
				memoryDir: target.dir
			}
		};
	}
	return {
		dir: baseDir,
		source: "default",
		envDir,
		config
	};
}

//#endregion
//#region src/host/migrate.ts
async function sha256(file) {
	const buffer = await promises.readFile(file);
	return createHash("sha256").update(buffer).digest("hex");
}
async function walkMd(dir, prefix = "") {
	const out = [];
	let entries = [];
	try {
		entries = await promises.readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			out.push(...await walkMd(path.join(dir, entry.name), relative));
			continue;
		}
		if (!entry.name.toLowerCase().endsWith(".md")) continue;
		if (entry.name.includes(".tmp-")) continue;
		out.push(relative);
	}
	return out;
}
/** 收集需要迁移的相对路径：根下 .md（不含 config.json）+ projects/** + history/**。 */
async function collect(from) {
	const rels = [];
	let rootEntries = [];
	try {
		rootEntries = await promises.readdir(from, { withFileTypes: true });
	} catch {
		return rels;
	}
	for (const entry of rootEntries) if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !entry.name.includes(".tmp-")) rels.push(entry.name);
	rels.push(...await walkMd(path.join(from, ALIAS_DIR), ALIAS_DIR));
	rels.push(...await walkMd(path.join(from, HISTORY_DIR), HISTORY_DIR));
	return rels;
}
/**

* 复制并校验。

* @param from 旧根目录。

* @param to 新根目录（必须与 from 不同）。

* @param writeConfig 全部成功后把 memoryDir 写入新根的 config.json。

*/
async function migrateMemoryDir(from, to, writeConfig = true) {
	const source = path.resolve(from);
	const target = path.resolve(to);
	if (source === target) throw new Error("新旧目录相同，无需迁移");
	if (!await promises.stat(source).then(() => true).catch(() => false)) throw new Error(`旧目录不存在：${source}`);
	const relative = path.relative(source, target);
	if (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("新目录不能位于旧目录内部");
	const rels = await collect(source);
	const files = [];
	const failed = [];
	let copied = 0;
	let skipped = 0;
	for (const relativePath of rels) {
		const fromFile = path.join(source, relativePath);
		const toFile = path.join(target, relativePath);
		try {
			const fromStat = await promises.stat(fromFile);
			const fromHash = await sha256(fromFile);
			const targetExists = await promises.stat(toFile).then(() => true).catch(() => false);
			if (targetExists) {
				const toHash$1 = await sha256(toFile);
				if (toHash$1 === fromHash) {
					files.push({
						relative: relativePath,
						bytes: fromStat.size,
						copied: false,
						skipped: "same",
						verified: true
					});
					skipped += 1;
				} else {
					files.push({
						relative: relativePath,
						bytes: fromStat.size,
						copied: false,
						skipped: "exists",
						verified: false
					});
					skipped += 1;
				}
				continue;
			}
			await promises.mkdir(path.dirname(toFile), { recursive: true });
			await promises.copyFile(fromFile, toFile);
			const toStat = await promises.stat(toFile);
			const toHash = await sha256(toFile);
			const verified = toStat.size === fromStat.size && toHash === fromHash;
			if (!verified) {
				failed.push(relativePath);
				files.push({
					relative: relativePath,
					bytes: fromStat.size,
					copied: true,
					verified: false
				});
				continue;
			}
			files.push({
				relative: relativePath,
				bytes: fromStat.size,
				copied: true,
				verified: true
			});
			copied += 1;
		} catch (error) {
			failed.push(`${relativePath}: ${String(error?.message ?? error)}`);
		}
	}
	let configWritten = false;
	if (failed.length === 0 && writeConfig) {
		await promises.mkdir(target, { recursive: true });
		const configPath = path.join(target, CONFIG_FILE);
		let existing = {};
		try {
			existing = JSON.parse(await promises.readFile(configPath, "utf8"));
		} catch {
			existing = {};
		}
		const next = {
			...existing,
			memoryDir: target
		};
		const tmp = `${configPath}.tmp-${process.pid}-${Date.now()}`;
		await promises.writeFile(tmp, `${JSON.stringify(next, void 0, 2)}\n`, "utf8");
		await promises.rm(configPath, { force: true }).catch(() => void 0);
		await promises.rename(tmp, configPath);
		configWritten = true;
	}
	return {
		ok: failed.length === 0,
		from: source,
		to: target,
		files,
		copied,
		skipped,
		failed,
		configWritten
	};
}

//#endregion
//#region src/host/prompt-inject.ts
const PROMPT_CONTEXT_NAME = "webds-bridge:progress";
/** 外部 context 可用任意有限 order；900 使其排在大多数运行时上下文之后。 */
const PROMPT_CONTEXT_ORDER = 900;
function installPromptInjection(ctx, store, key = "progress") {
	let progressPath = store.fileFor(key);
	let title = key;
	let cachedMtime = Number.NaN;
	let cachedText = "";
	let hasCache = false;
	const reset = () => {
		hasCache = false;
		cachedMtime = Number.NaN;
		cachedText = "";
	};
	const render = () => {
		try {
			const stat = statSync(progressPath);
			if (hasCache && cachedMtime === stat.mtimeMs) return cachedText;
			const content = readFileSync(progressPath, "utf8");
			cachedMtime = stat.mtimeMs;
			hasCache = true;
			cachedText = content.trim().length === 0 ? "" : `## 当前讨论进度（来自网页版 DeepSeek 对话 · ${title}）\n\n${content}`;
			return cachedText;
		} catch {
			reset();
			return "";
		}
	};
	ctx.inject(["systemPrompt"], (scope) => {
		scope.systemPrompt.context({
			name: PROMPT_CONTEXT_NAME,
			order: PROMPT_CONTEXT_ORDER,
			text: render
		});
		ctx.logger.info(`[webds] system prompt context registered: ${PROMPT_CONTEXT_NAME} (order=${PROMPT_CONTEXT_ORDER})`);
	});
	return {
		readCached: () => cachedText,
		invalidate: reset,
		setTarget: (nextStore, nextKey) => {
			const nextPath = nextStore.fileFor(nextKey);
			if (nextPath === progressPath) {
				reset();
				return;
			}
			progressPath = nextPath;
			title = nextKey;
			reset();
		},
		currentPath: () => progressPath
	};
}

//#endregion
//#region src/index.ts
/** Plugin name, follows Cordis plugin convention */
const name = "dsh-webds-bridge";
/** Injected dependencies */
const inject = [];
const RPC_PATH = "/api/plugin-rpc/webds";
const RPC_METHOD = "plugin-rpc/webds";
const EXECUTION_PREFIX = "以下是当前项目的最新讨论进度，请基于此开始执行：";
function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" }
	});
}
function failure(rpcId, code, message) {
	return jsonResponse({
		type: "server-response",
		rpcId,
		result: {
			ok: false,
			error: {
				code,
				message,
				details: {}
			}
		}
	});
}
function success(rpcId, value) {
	return jsonResponse({
		type: "server-response",
		rpcId,
		result: {
			ok: true,
			value
		}
	});
}
/**

* 读取指定别名的记忆，并作为一条用户消息投递给主会话。

* 使用 Host 的 ctx.sessionController.prompt()（Session Controller 的公开 Host 方法）。

*/
async function executePrompt(ctx, store, routing, sessionId, key) {
	const memory = await store.read(key);
	if (memory.content.trim().length === 0) throw new Error(`记忆文件为空或不存在（${key}），无法执行注入`);
	const sessionController = ctx.get?.("sessionController") ?? ctx.sessionController;
	if (!sessionController || typeof sessionController.prompt !== "function") throw new Error("sessionController 服务不可用，无法向主会话发送消息");
	const text = `${EXECUTION_PREFIX}\n\n${memory.content.trim()}`;
	const requestId = randomUUID();
	const result = await sessionController.prompt({
		sessionId,
		requestId,
		content: [{
			type: "text",
			text
		}]
	}, new AbortController().signal);
	return {
		accepted: result?.accepted !== false,
		sessionId,
		requestId,
		key: memory.key,
		memoryPath: memory.path,
		progressChars: memory.content.length,
		textChars: text.length,
		model: routing.executionModel || null,
		memoryMtimeMs: memory.mtimeMs
	};
}
/**

* 写根目录指针。必须落在**默认位置**（$DSH_HOME/dsh_memory/config.json），

* 因为启动时只会去那儿找 memoryDir；写在新根里等于自说自话，重启后会被忽略。

*/
async function writeRootPointer(targetDir, patch) {
	const pointer = createMemoryStore();
	await pointer.writeConfig({
		...patch,
		memoryDir: path.resolve(targetDir)
	});
}
async function handleRpc(request, ctx, state) {
	if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
	let body;
	try {
		body = await request.json();
	} catch {
		return new Response("invalid JSON body", { status: 400 });
	}
	if (body === null || typeof body !== "object" || body.type !== "client-request" || typeof body.rpcId !== "string" || typeof body.method !== "string") return new Response("invalid client-request envelope", { status: 400 });
	if (body.method !== RPC_METHOD) return new Response("unknown RPC method", { status: 400 });
	const wrapped = body.payload;
	if (wrapped === null || typeof wrapped !== "object" || typeof wrapped.endpoint !== "string") return failure(body.rpcId, "invalid-request", "payload must be { endpoint, payload }");
	await state.ready;
	const requestedKey = wrapped.payload?.key;
	const key = typeof requestedKey === "string" && requestedKey.trim().length > 0 ? normalizeMemoryKey(requestedKey) : state.key;
	try {
		if (wrapped.endpoint === "browserOpen") {
			if (state.browserConfig.mode !== "standalone") return failure(body.rpcId, "browser-mode", "当前是侧边栏模式，请先把运行位置切换为独立浏览器");
			return success(body.rpcId, await state.browser.open());
		}
		if (wrapped.endpoint === "browserStatus") return success(body.rpcId, await state.browser.status());
		if (wrapped.endpoint === "browserClose") return success(body.rpcId, await state.browser.close());
		if (wrapped.endpoint === "browserChat") {
			if (state.browserConfig.mode !== "standalone") return failure(body.rpcId, "browser-mode", "当前是侧边栏模式，browserChat 不可用");
			const script = wrapped.payload?.script;
			const prompt = wrapped.payload?.prompt;
			if (typeof script !== "string" || script.trim().length === 0) return failure(body.rpcId, "invalid-script", "script must be a non-empty string");
			if (script.length > 300000) return failure(body.rpcId, "script-too-large", "script exceeds 300000 characters");
			if (typeof prompt !== "string") return failure(body.rpcId, "invalid-prompt", "prompt must be a string");
			return success(body.rpcId, await state.browser.chat(script, prompt));
		}
		if (wrapped.endpoint === "browserNewChat") {
			if (state.browserConfig.mode !== "standalone") return failure(body.rpcId, "browser-mode", "当前是侧边栏模式，browserNewChat 不可用");
			const script = wrapped.payload?.script;
			if (typeof script !== "string" || script.trim().length === 0) return failure(body.rpcId, "invalid-script", "script must be a non-empty string");
			return success(body.rpcId, await state.browser.newChat(script));
		}
		if (wrapped.endpoint === "setBrowser") {
			const raw = wrapped.payload?.browser ?? wrapped.payload ?? {};
			const patch = { ...raw };
			if (patch.mode !== void 0) patch.browserMode = patch.mode;
			const current = await state.store.readConfig();
			const previous = browserConfigOf(current);
			const next = browserConfigOf({ ...current, ...patch });
			const invalid = validateBrowserConfig(next);
			if (invalid !== void 0) return failure(body.rpcId, "invalid-browser-config", invalid);
			const changed = previous.enabled !== next.enabled || previous.mode !== next.mode || previous.headless !== next.headless || previous.browserPath !== next.browserPath || previous.userDataDir !== next.userDataDir || previous.maxConcurrency !== next.maxConcurrency;
			if (!changed) return success(body.rpcId, next);
			await state.store.writeConfig({
				enabled: next.enabled,
				browserMode: next.mode,
				headless: next.headless,
				browserPath: next.browserPath,
				userDataDir: next.userDataDir,
				maxConcurrency: next.maxConcurrency
			});
			state.browserConfig = next;
			await state.browser.reset();
			await state.webPool?.close();
			state.syncWebSource?.();
			return success(body.rpcId, next);
		}
		if (wrapped.endpoint === "pickFile") return success(body.rpcId, await pickNative("file"));
		if (wrapped.endpoint === "pickDirectory") return success(body.rpcId, await pickNative("directory"));
		if (wrapped.endpoint === "save") {
			const summary = wrapped.payload?.summary;
			if (typeof summary !== "string" || summary.trim().length === 0) return failure(body.rpcId, "invalid-summary", "summary must be a non-empty string");
			const saved = await state.store.save(summary, key);
			state.key = saved.key;
			state.injection.setTarget(state.store, saved.key);
			await state.store.writeConfig({ lastKey: saved.key }).catch(() => void 0);
			return success(body.rpcId, saved);
		}
		if (wrapped.endpoint === "read") return success(body.rpcId, {
			...await state.store.read(key),
			routing: state.routing
		});
		if (wrapped.endpoint === "list") return success(body.rpcId, {
			memories: await state.store.listMemories(),
			activeKey: state.key
		});
		if (wrapped.endpoint === "info") {
			const config = await state.store.readConfig();
			state.browserConfig = browserConfigOf(config);
			return success(body.rpcId, {
				memoryDir: state.store.dir,
				rootSource: state.store.source,
				envDir: state.envDir ?? null,
				progressPath: state.store.fileFor(state.key),
				historyPath: state.store.historyPath,
				configPath: state.store.configPath,
				activeKey: state.key,
				lastKey: config.lastKey ?? null,
				memories: await state.store.listMemories(),
				routing: state.routing,
				browser: state.browserConfig,
				browserProfileDefault: defaultBrowserProfileDir(),
				build: "host"
			});
		}
		if (wrapped.endpoint === "setRoot") {
			const nextDir = wrapped.payload?.memoryDir;
			if (typeof nextDir !== "string" || nextDir.trim().length === 0) return failure(body.rpcId, "invalid-dir", "memoryDir must be a non-empty string");
			if (state.envDir) return failure(body.rpcId, "env-locked", `已由环境变量 DSH_WEBDS_MEMORY_DIR 固定为 ${state.envDir}，面板修改不生效`);
			const resolved = path.resolve(nextDir.trim());
			const nextStore = createMemoryStore(resolved, "config");
			await writeRootPointer(resolved, { memoryDir: resolved });
			await nextStore.writeConfig({ memoryDir: resolved }).catch(() => void 0);
			state.store = nextStore;
			state.injection.setTarget(nextStore, state.key);
			return success(body.rpcId, {
				memoryDir: nextStore.dir,
				activeKey: state.key,
				progressPath: nextStore.fileFor(state.key)
			});
		}
		if (wrapped.endpoint === "migrate") {
			const toDir = wrapped.payload?.to;
			const fromDir = wrapped.payload?.from;
			if (typeof toDir !== "string" || toDir.trim().length === 0) return failure(body.rpcId, "invalid-dir", "to must be a non-empty string");
			if (state.envDir) return failure(body.rpcId, "env-locked", `已由环境变量 DSH_WEBDS_MEMORY_DIR 固定为 ${state.envDir}，无法迁移到其它目录`);
			const source = typeof fromDir === "string" && fromDir.trim().length > 0 ? path.resolve(fromDir.trim()) : state.store.dir;
			const target = path.resolve(toDir.trim());
			const result = await migrateMemoryDir(source, target, true);
			if (result.ok) {
				const nextStore = createMemoryStore(target, "config");
				await nextStore.writeConfig({
					memoryDir: target,
					lastKey: state.key
				}).catch(() => void 0);
				await writeRootPointer(target, { memoryDir: target }).catch(() => void 0);
				state.store = nextStore;
				state.injection.setTarget(nextStore, state.key);
			}
			return success(body.rpcId, result);
		}
		if (wrapped.endpoint === "execute") {
			const sessionId = wrapped.payload?.sessionId;
			if (typeof sessionId !== "string" || sessionId.trim().length === 0) return failure(body.rpcId, "invalid-session", "execute requires a non-empty sessionId");
			return success(body.rpcId, await executePrompt(ctx, state.store, state.routing, sessionId.trim(), key));
		}
		return failure(body.rpcId, "unknown-endpoint", `unknown endpoint ${wrapped.endpoint}`);
	} catch (error) {
		return failure(body.rpcId, "webds-failed", String(error?.message ?? error));
	}
}
/**

* Plugin apply function

* @param ctx - Cordis context

*/
function apply(ctx) {
	ctx.logger.info("Dsh Webds Bridge host plugin loaded");
	const initial = createMemoryStore();
	const routing = readRoutingConfig(initial.dir);
	const injection = installPromptInjection(ctx, initial, DEFAULT_MEMORY_KEY);
	const state = {
		store: initial,
		key: DEFAULT_MEMORY_KEY,
		routing,
		envDir: process.env.DSH_WEBDS_MEMORY_DIR?.trim() || void 0,
		injection,
		browserConfig: browserConfigOf({})
	};
	state.browser = createStandaloneBrowser({
		getConfig: () => state.browserConfig,
		defaultUserDataDir: defaultBrowserProfileDir()
	});
	state.webPool = createWebPool({
		getConfig: () => state.browserConfig,
		defaultUserDataDir: defaultBrowserProfileDir(),
		onBeforeLaunch: () => state.browser.close(),
	});
	state.webApi = startWebApiServer({ getPool: () => state.webPool, port: 34567, logger: ctx.logger });
	state.ready = (async () => {
		try {
			const resolved = await resolveMemoryRoot();
			const store = createMemoryStore(resolved.dir, resolved.source);
			const config = await store.readConfig();
			const key = config.lastKey ? normalizeMemoryKey(config.lastKey) : DEFAULT_MEMORY_KEY;
			state.store = store;
			state.key = key;
			state.envDir = resolved.envDir?.trim() || void 0;
			state.injection.setTarget(store, key);
			state.browserConfig = browserConfigOf(config);
			ctx.logger.info(`[webds] memory dir = ${store.dir} (source=${resolved.source})`);
			ctx.logger.info(`[webds] active memory key = ${key}`);
			ctx.logger.info(`[webds] browser config = ${JSON.stringify(state.browserConfig)}`);
			ctx.logger.info(`[webds] routing config = ${JSON.stringify(routing)}`);
		} catch (error) {
			ctx.logger.warn(`[webds] 解析记忆根目录失败，继续使用默认目录：${String(error)}`);
		}
	})();
	ctx.effect(() => () => {
		void state.browser.close();
		void state.webPool.close();
		void state.webApi.close();
	});
	ctx.inject(["connection"], (scope) => {
		scope.effect(() => {
			const dispose = scope.connection.fetch.register({
				path: RPC_PATH,
				methods: ["POST"],
				requestBody: "buffered",
				fetch: (request) => handleRpc(request, ctx, state)
			});
			ctx.logger.info(`[webds] memory/execute RPC registered: ${RPC_PATH}`);
			return () => {
				dispose();
			};
		}, "webds: memory/execute RPC route");
	});
}

//#endregion
export { apply, inject, name };
//# sourceMappingURL=index.js.map