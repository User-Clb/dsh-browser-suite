// dsh-browser-suite client bundle: local web control + web DeepSeek bridge.
window.__ModuleLoader__.load({
  id: "dsh-browser-suite",
  factory: (require) => {
    const control = (function() {

    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;

    const NAME = "dsh-local-web-control";

    function connectionRpc(ctx) {
      const connection = ctx?.get?.("connection", false) ?? ctx?.connection;
      const rpc = connection?.rpc;
      if (!rpc || typeof rpc.call !== "function") {
        throw new Error("connection.rpc 不可用：Client 与 Host 的 RPC 通道未挂载");
      }
      return rpc;
    }

    function timeoutSignal(ms = 30000) {
      return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(ms)
        : undefined;
    }

    async function callRpc(ctx, endpoint, payload = {}, timeoutMs = 30000) {
      const rpc = connectionRpc(ctx);
      const response = await rpc.call("/api", "plugin-rpc/local-web", { endpoint, payload }, timeoutSignal(timeoutMs));
      if (!response || response.ok !== true) {
        const error = response?.error;
        throw new Error(`Host ${endpoint} 失败：${String(error?.code ?? "unknown")} ${String(error?.message ?? "")}`.trim());
      }
      return response.value;
    }

    const styles = {
      root: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        minWidth: 0,
        fontSize: "12px",
        color: "var(--dsw-alias-label-primary, #111)",
      },
      trigger: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        height: "28px",
        padding: "0 10px",
        borderRadius: "999px",
        border: "1px solid var(--dsw-alias-border-l2, #d9d9d9)",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        fontSize: "12px",
        whiteSpace: "nowrap",
      },
      dot: {
        width: "7px",
        height: "7px",
        borderRadius: "50%",
        background: "var(--dsw-alias-label-tertiary, #999)",
        flex: "none",
      },
      dotOn: {
        background: "#22c55e",
        boxShadow: "0 0 0 2px rgba(34,197,94,.18)",
      },
      panel: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "8px 14px",
        padding: "6px 10px",
        border: "1px solid var(--dsw-alias-border-l2, #d9d9d9)",
        borderRadius: "10px",
        background: "var(--dsw-alias-bg-layer-2, #fff)",
        boxShadow: "0 6px 20px rgba(0,0,0,.08)",
      },
      row: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        whiteSpace: "nowrap",
      },
      label: {
        color: "var(--dsw-alias-label-secondary, #666)",
      },
      input: {
        width: "58px",
        height: "24px",
        padding: "0 6px",
        borderRadius: "6px",
        border: "1px solid var(--dsw-alias-border-l2, #d9d9d9)",
        background: "var(--dsw-alias-bg-layer-1, #fff)",
        color: "inherit",
        fontSize: "12px",
      },
      select: {
        height: "24px",
        padding: "0 6px",
        borderRadius: "6px",
        border: "1px solid var(--dsw-alias-border-l2, #d9d9d9)",
        background: "var(--dsw-alias-bg-layer-1, #fff)",
        color: "inherit",
        fontSize: "12px",
      },
      close: {
        height: "24px",
        padding: "0 8px",
        borderRadius: "6px",
        border: "1px solid var(--dsw-alias-border-l2, #d9d9d9)",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        fontSize: "12px",
      },
      error: {
        color: "var(--dsw-alias-state-error-primary, #d33)",
        maxWidth: "420px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      hint: {
        color: "var(--dsw-alias-label-tertiary, #999)",
      },
    };

    function Row(label, control) {
      return h("label", { style: styles.row }, h("span", { style: styles.label }, label), control);
    }

    let Boundary;
    if (React.Component) {
      Boundary = class Boundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { failed: false };
        }

        static getDerivedStateFromError() {
          return { failed: true };
        }

        componentDidCatch(error) {
          try {
            console.warn("[local-web-control] composer control failed:", error);
          } catch {
            /* ignore */
          }
        }

        render() {
          return this.state.failed ? null : this.props.children;
        }
      };
    } else {
      Boundary = (props) => props.children;
    }

    function Control(props) {
      const [open, setOpen] = React.useState(false);
      const [config, setConfig] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");
      const [saved, setSaved] = React.useState("");
      const saveTimer = React.useRef(null);
      const savedTimer = React.useRef(null);
      const requestSeq = React.useRef(0);

      React.useEffect(() => {
        let alive = true;
        callRpc(props.ctx, "get")
          .then((value) => {
            if (alive) setConfig(value);
          })
          .catch((reason) => {
            if (alive) setError(String(reason?.message ?? reason));
          });
        return () => {
          alive = false;
        };
      }, []);

      const activeRef = React.useRef(false);

      function refresh() {
        callRpc(props.ctx, "get")
          .then((value) => setConfig(value))
          .catch((reason) => setError(String(reason?.message ?? reason)));
      }

      function setActive(next) {
        if (next) refresh();
        setOpen(next);
        if (activeRef.current !== next) {
          activeRef.current = next;
          props.onActiveChange?.(next);
        }
      }

      React.useEffect(() => () => {
        if (activeRef.current) {
          activeRef.current = false;
          props.onActiveChange?.(false);
        }
      }, []);

      React.useEffect(() => () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        if (savedTimer.current) clearTimeout(savedTimer.current);
      }, []);

      function markSaved() {
        setSaved("已自动保存");
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(""), 1800);
      }

      async function save(patch) {
        const sequence = ++requestSeq.current;
        setBusy(true);
        setError("");
        try {
          const next = await callRpc(props.ctx, "set", patch);
          if (sequence === requestSeq.current) {
            setConfig(next);
            markSaved();
          }
        } catch (reason) {
          if (sequence === requestSeq.current) {
            setError(String(reason?.message ?? reason));
          }
        } finally {
          if (sequence === requestSeq.current) setBusy(false);
        }
      }

      function scheduleSave(patch) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          save(patch);
        }, 350);
      }

      function flushSave(patch) {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        save(patch);
      }

      async function pick(kind) {
        setBusy(true);
        setError("");
        try {
          const picked = await callRpc(props.ctx, kind, {}, 300000);
          if (picked) {
            await save(kind === "pickFile" ? { browserPath: picked } : { userDataDir: picked });
          }
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        } finally {
          setBusy(false);
        }
      }

      const local = config?.local === true;
      const browserPathValue = config && typeof config.browserPath === "string" ? config.browserPath : "";
      const userDataValue = config && typeof config.userDataDir === "string" ? config.userDataDir : "";
      const detectedPath = config && typeof config.detectedBrowserPath === "string" ? config.detectedBrowserPath : "";
      const detectedName = detectedPath ? String(detectedPath).split(/[\\/]/).pop() : "自动检测";
      const userDataHint = userDataValue ? "" : "默认：临时 profile";

      return h(
        "div",
        { style: styles.root },
        h(
          "button",
          {
            type: "button",
            title: "本地浏览器搜索设置",
            disabled: props.locked === true,
            onClick: () => setActive(!open),
            style: styles.trigger,
          },
          h("span", { style: local ? { ...styles.dot, ...styles.dotOn } : styles.dot }),
          "本地搜索",
          h("span", { style: { opacity: 0.85 } }, config === null ? "…" : local ? "开" : "关"),
        ),
        open
          ? h(
              "div",
              { style: styles.panel },
              Row(
                "使用本地浏览器",
                h("input", {
                  type: "checkbox",
                  checked: local,
                  disabled: busy,
                  onChange: (event) => save({ local: event.target.checked }),
                }),
              ),
              Row(
                "显示浏览器窗口",
                h("input", {
                  type: "checkbox",
                  checked: config ? config.headless === false : false,
                  disabled: busy || !config,
                  onChange: (event) => save({ headless: !event.target.checked }),
                }),
              ),
              Row(
                "搜索引擎",
                h(
                  "select",
                  {
                    value: config?.engine ?? "bing",
                    disabled: busy || !config,
                    onChange: (event) => save({ engine: event.target.value }),
                    style: styles.select,
                  },
                  h("option", { value: "bing" }, "Bing"),
                  h("option", { value: "baidu" }, "百度"),
                  h("option", { value: "sogou" }, "搜狗"),
                  h("option", { value: "duckduckgo" }, "DuckDuckGo"),
                  h("option", { value: "google" }, "Google"),
                ),
              ),
              Row(
                "结果数",
                h("input", {
                  type: "number",
                  min: 1,
                  max: 20,
                  value: config?.maxResults ?? 8,
                  disabled: !config,
                  onChange: (event) => {
                    const value = Number(event.target.value);
                    setConfig((current) => (current ? { ...current, maxResults: value } : current));
                    scheduleSave({ maxResults: value });
                  },
                  onBlur: (event) => flushSave({ maxResults: Number(event.target.value) }),
                  onKeyDown: (event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  },
                  style: styles.input,
                }),
              ),
              Row(
                "超时 ms",
                h("input", {
                  type: "number",
                  min: 5000,
                  max: 120000,
                  step: 1000,
                  value: config?.timeoutMs ?? 30000,
                  disabled: !config,
                  onChange: (event) => {
                    const value = Number(event.target.value);
                    setConfig((current) => (current ? { ...current, timeoutMs: value } : current));
                    scheduleSave({ timeoutMs: value });
                  },
                  onBlur: (event) => flushSave({ timeoutMs: Number(event.target.value) }),
                  onKeyDown: (event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  },
                  style: { ...styles.input, width: "78px" },
                }),
              ),
              Row(
                "浏览器",
                h(
                  "span",
                  { style: { display: "inline-flex", alignItems: "center", gap: "4px" } },
                  h("input", {
                    type: "text",
                    value: browserPathValue,
                    placeholder: `自动：${detectedName}`,
                    disabled: !config,
                    onChange: (event) => {
                      const value = event.target.value;
                      setConfig((current) => (current ? { ...current, browserPath: value } : current));
                      scheduleSave({ browserPath: value });
                    },
                    onBlur: (event) => flushSave({ browserPath: event.target.value }),
                    onKeyDown: (event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    },
                    style: { ...styles.input, width: "190px" },
                  }),
                  h(
                    "button",
                    {
                      type: "button",
                      disabled: busy || !config,
                      onClick: () => pick("pickFile"),
                      style: styles.close,
                    },
                    "选择…",
                  ),
                ),
              ),
              Row(
                "User Data",
                h(
                  "span",
                  { style: { display: "inline-flex", alignItems: "center", gap: "4px" } },
                  h("input", {
                    type: "text",
                    value: userDataValue,
                    placeholder: userDataHint,
                    disabled: !config,
                    onChange: (event) => {
                      const value = event.target.value;
                      setConfig((current) => (current ? { ...current, userDataDir: value } : current));
                      scheduleSave({ userDataDir: value });
                    },
                    onBlur: (event) => flushSave({ userDataDir: event.target.value }),
                    onKeyDown: (event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    },
                    style: { ...styles.input, width: "190px" },
                  }),
                  h(
                    "button",
                    {
                      type: "button",
                      disabled: busy || !config,
                      onClick: () => pick("pickDirectory"),
                      style: styles.close,
                    },
                    "选择…",
                  ),
                ),
              ),
              error ? h("span", { style: styles.error, title: error }, error) : null,
              busy ? h("span", { style: styles.hint }, "保存中…") : null,
              saved ? h("span", { style: styles.hint }, saved) : null,
              h("button", { type: "button", onClick: () => setActive(false), style: styles.close }, "收起"),
            )
          : null,
      );
    }

    function apply(ctx) {
      ctx.effect(() => {
        try {
          return ctx.slots.inject("conversation.input.activity", () =>
            ctx.slots.register(
              {
                name: "conversation.input.activity",
                id: "local-web-control",
                order: 40,
                label: () => "本地搜索",
              },
              (props) => h(Boundary, null, h(Control, { ...props, ctx })),
            ),
          );
        } catch (error) {
          try {
            console.warn("[local-web-control] composer slot unavailable:", error);
          } catch {
            /* ignore */
          }
          return () => {};
        }
      }, "local-web-control: composer activity");
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    exports.name = NAME;
    return module.exports;
    })();
    const webds = (function() {

    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    //#region rolldown:runtime
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __copyProps = (to, from, except, desc) => {
    	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
    		key = keys[i];
    		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
    			get: ((k) => from[k]).bind(null, key),
    			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    		});
    	}
    	return to;
    };
    var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
    	value: mod,
    	enumerable: true
    }) : target, mod));
    
    //#endregion
    const react = __toESM(require("react"));
    
    //#region src/client/token-estimator.ts
    /**
    
    * 本地 Token 估算器 + 阈值配置。
    
    *
    
    * 规则：中文按 字符数 / 1.5，其他字符（英文/符号）按 字符数 / 4，混合文本按字符类别加权。
    
    * 这是估算，不是分词器；用于自动续接的阈值判断足够。
    
    */
    /** 默认上下文阈值。 */
    const DEFAULT_TOKEN_THRESHOLD = 8e4;
    const STORAGE_KEY = "webds.tokenThreshold";
    /** CJK（中日韩）字符范围。 */
    const CJK_PATTERN = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/u;
    /** 估算一段文本的 token 数。 */
    function estimateTokens(text) {
    	const value = String(text ?? "");
    	if (value.length === 0) return 0;
    	let cjk = 0;
    	let other = 0;
    	for (const char of value) if (CJK_PATTERN.test(char)) cjk += 1;
    	else other += 1;
    	return Math.ceil(cjk / 1.5 + other / 4);
    }
    let currentTokens = 0;
    /** 内存级阈值覆盖：dsh-app:// 属于非 HTTP origin，localStorage 可能不可用。 */
    let overrideThreshold;
    function getCurrentTokens() {
    	return currentTokens;
    }
    function addTokens(tokens) {
    	if (Number.isFinite(tokens) && tokens > 0) currentTokens += tokens;
    	return currentTokens;
    }
    function resetTokens() {
    	currentTokens = 0;
    }
    function setCurrentTokens(value) {
    	currentTokens = Number.isFinite(value) && value > 0 ? value : 0;
    }
    /** 读取阈值：内存覆盖 > localStorage > 默认 80000。 */
    function getTokenThreshold() {
    	if (overrideThreshold !== void 0) return overrideThreshold;
    	try {
    		const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    		const parsed = raw === null || raw === void 0 ? Number.NaN : Number(raw);
    		if (Number.isFinite(parsed) && parsed > 0) return parsed;
    	} catch {}
    	return DEFAULT_TOKEN_THRESHOLD;
    }
    /** 写入阈值（调试用，例如 2000）。内存覆盖保证在 dsh-app:// 下也立即生效。 */
    function setTokenThreshold(value) {
    	const next = Math.max(1, Math.floor(Number(value)));
    	overrideThreshold = next;
    	try {
    		globalThis.localStorage?.setItem(STORAGE_KEY, String(next));
    	} catch {}
    	return next;
    }
    
    //#endregion
    //#region src/client/dom-ops.ts
    /**
    
    * DSH × 网页版 DeepSeek —— 浏览器内 DOM 操作模块（最小验证版）
    
    *
    
    * 真实桥接契约（DSH 0.2.0-rc.2，已核对 app.asar）：
    
    *   dshDesktop.browser.acquire(workspace) -> Promise<{ lease: string, partition: string }>
    
    * acquire 只预租一个 guest 分区，不返回 webview。真正的 <webview> 由
    
    * @deepseek-ai/dsh-client-ui-sidebar-browser 创建，挂载协议为：
    
    *   <webview data-sidebar-browser-frame name={lease} partition={partition}
    
    *            src="about:blank#{lease}">
    
    * 主进程会在 will-attach-webview 校验 lease/partition，之后侧栏插件再导航到目标 URL。
    
    *
    
    * 因此本模块走官方公开入口 ctx.sidebarRight.openTab('browser', { params: { url } })，
    
    * 再从 DOM 里取到该 <webview>，用 webview.executeJavaScript 在访客页主世界执行 DOM 脚本。
    
    */
    const CHAT_URL = "https://chat.deepseek.com";
    const TEST_PROMPT = "你好，请用Python写一个冒泡排序，并包含在代码块中";
    /**
    
    * 用于确认页面加载的是最新 bundle。
    
    * 每次实质改动客户端逻辑时都要手动 +1，否则控制台里的版本号会误导排查。
    
    * v8：新对话按钮改为全页 textContent 扫描（含 open shadow root）+ 红框高亮 + 多级兜底点击。
    
    * v9：设置页 UI 面板（settings.section slot）。
    
    * v10：设置页配色改用官方 --dsw-alias-* 主题变量，修复深色模式白底白字。
    
    * v11：会话头部快捷操作栏 + webview 活动状态按可见性判定（修复后台 tab 抢占）。
    
    * v12：多对话独立记忆（别名命名）+ 自定义存储根目录 + 历史目录一键迁移。
    
    * v13：修复迁移后新根丢失 lastKey（重启会静默回落到 progress）。
    
    */
    const BUILD_TAG = "2026-10-23-webds-auto-v15";
    let browserConfig = {
    	enabled: true,
    	mode: "sidebar",
    	headless: true,
    	browserPath: "",
    	userDataDir: "",
    	maxConcurrency: 3
    };
    let browserProfileDefault = "";
    async function refreshBrowserConfig(ctx) {
    	const info = await callWebdsRpc(ctx, "info");
    	if (info && info.browser) browserConfig = {
    		enabled: true,
    		mode: info.browser.mode === "standalone" ? "standalone" : "sidebar",
    		headless: info.browser.headless !== false,
    		browserPath: String(info.browser.browserPath ?? ""),
    		userDataDir: String(info.browser.userDataDir ?? ""),
    		maxConcurrency: Number.isInteger(info.browser.maxConcurrency) ? info.browser.maxConcurrency : 3
    	};
    	if (info && typeof info.browserProfileDefault === "string") browserProfileDefault = info.browserProfileDefault;
    	return browserConfig;
    }
    async function setBrowserConfigRpc(ctx, patch) {
    	const next = await callWebdsRpc(ctx, "setBrowser", { browser: patch });
    	browserConfig = {
    		enabled: true,
    		mode: next.mode === "standalone" ? "standalone" : "sidebar",
    		headless: next.headless !== false,
    		browserPath: String(next.browserPath ?? ""),
    		userDataDir: String(next.userDataDir ?? ""),
    		maxConcurrency: Number.isInteger(next.maxConcurrency) ? next.maxConcurrency : 3
    	};
    	return browserConfig;
    }
    const WEBVIEW_SELECTOR = "webview[data-sidebar-browser-frame]";
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    /** 当前页面里所有侧栏浏览器 webview。 */
    function webviews() {
    	return Array.from(document.querySelectorAll(WEBVIEW_SELECTOR));
    }
    /** 读取 webview 的当前 URL，尚未 attach 时返回空串。 */
    function safeUrl(view) {
    	try {
    		return typeof view.getURL === "function" ? String(view.getURL() ?? "") : "";
    	} catch {
    		return "";
    	}
    }
    function leaseOf(view) {
    	try {
    		return String(view?.getAttribute?.("name") ?? "");
    	} catch {
    		return "";
    	}
    }
    function isChatUrl(url) {
    	return /(?:^|\/\/|\.)chat\.deepseek\.com/i.test(url);
    }
    /**
    
    * 上一次成功操作过的 webview。
    
    * 侧栏切后台、折叠或重排时 getURL()/DOM 查询可能短暂失效，靠它兜底复用。
    
    */
    let activeChatView;
    function rememberChatView(view) {
    	activeChatView = view;
    	return view;
    }
    function getActiveChatView() {
    	return activeChatView;
    }
    /**
    
    * 当前主会话 ID。优先从活动 webview 所属的右侧栏根节点读取
    
    * （官方 sidebar-right 用 data-sidebar-right-session 标记会话）。
    
    */
    function activeSessionId(view) {
    	const target = view ?? activeChatView;
    	try {
    		const owner = target?.closest?.("[data-sidebar-right-session]");
    		const id = owner?.getAttribute?.("data-sidebar-right-session");
    		if (typeof id === "string" && id.length > 0) return id;
    	} catch {}
    	const owners = Array.from(document.querySelectorAll("[data-sidebar-right-session]"));
    	const openOwner = owners.find((element) => element.hasAttribute("data-sidebar-right-open")) ?? owners[0];
    	return String(openOwner?.getAttribute?.("data-sidebar-right-session") ?? "");
    }
    function describeView(view) {
    	return {
    		lease: leaseOf(view),
    		url: safeUrl(view),
    		connected: typeof view?.isConnected === "boolean" ? view.isConnected : void 0,
    		visible: isViewVisible(view)
    	};
    }
    /**
    
    * webview 当前是否处在**前台 tab**。
    
    *
    
    * 背景：右侧栏用 dockkit 承载多个 tab，**非活动 tab 的 body 仍留在 DOM 里**
    
    * （keepMounted），只是被 `[hidden]` / `aria-hidden="true"` 隐藏。官方自己的
    
    * sidebarTargetFromElement 正是用这组标记判断「元素是不是活动 tab 的」。
    
    * 只看 getURL() 就会命中后台的旧 tab——这正是「切到网页版 tab 反而控制不了」的根因。
    
    *
    
    * 判定只用**可靠信号**：祖先上的 hidden / aria-hidden。
    
    * 刻意不把「尺寸为 0 / 已移出 DOM」判成不可见：
    
    *   - 侧栏重排时 webview 会短暂脱离文档，但 guest 仍活着，复用它是原有设计
    
    *     （e2e-reuse 的 scenario 1 就是这条约定）；
    
    *   - 折叠、dock 过渡期也会有零尺寸的瞬时状态。
    
    * 误判成「不可见」的代价是重复开 tab / 丢会话，比误用一次旧 tab 更贵。
    
    */
    function isViewVisible(view) {
    	if (!view) return false;
    	try {
    		if (view.closest?.("[hidden], [aria-hidden=\"true\"]") != null) return false;
    		return true;
    	} catch {
    		return true;
    	}
    }
    /** 诊断用：当前活动引用 + DOM 里所有 webview。 */
    function debugWebviews() {
    	return {
    		active: activeChatView ? describeView(activeChatView) : null,
    		sessionId: activeSessionId(),
    		views: webviews().map(describeView)
    	};
    }
    /** 是否已经打开了 chat.deepseek.com（含登录页/子路径）。 */
    function findChatWebview() {
    	const views = webviews();
    	const visibleChat = views.find((view) => isChatUrl(safeUrl(view)) && isViewVisible(view));
    	if (visibleChat) return rememberChatView(visibleChat);
    	const anyChat = views.find((view) => isChatUrl(safeUrl(view)));
    	if (anyChat) return rememberChatView(anyChat);
    	const lease = leaseOf(activeChatView);
    	if (lease !== "") {
    		const byLease = views.find((view) => leaseOf(view) === lease);
    		if (byLease) return rememberChatView(byLease);
    	}
    	const visibleBlank = views.find((view) => safeUrl(view) === "" && isViewVisible(view));
    	if (visibleBlank) return rememberChatView(visibleBlank);
    	return void 0;
    }
    /**
    
    * 优先复用缓存的 webview，但仅在它**没有退到后台 tab** 时才算数。
    
    *
    
    * 注意这里不能加 executeJavaScript 兜底：用户切到别的 tab 后旧 webview 依然
    
    * 能执行脚本，盲目兜底就会对着后台页面发消息——这正是「网页版 Tab 激活时
    
    * 反而控制不了」的根因。退到后台就交回调用方重新挑一个。
    
    * （侧栏重排导致短暂脱离 DOM 不算后台，那条路径由 isViewVisible 的设计保留。）
    
    */
    async function resolveActiveView() {
    	const view = activeChatView;
    	if (!view) return void 0;
    	if (isViewVisible(view)) return view;
    	return void 0;
    }
    let turnCompleteHandler;
    /** 由 auto-continue 模块注册；dom-ops 不反向依赖它，避免循环引用。 */
    function setTurnCompleteHandler(handler) {
    	turnCompleteHandler = handler;
    }
    /**
    
    * 打开（或复用）一个 chat.deepseek.com 的侧栏 Browser tab。
    
    * @param ctx - 客户端插件上下文，用来取 sidebarRight 服务。
    
    * @param url - 目标地址。
    
    * @param options - reuseOnly 时不会新建 tab。
    
    */
﻿    /**
     * 关闭当前 DeepSeek Browser tab（侧边栏模式）。
     * 优先使用 sidebarRight.close(tabId)；拿不到 tabId 时点击 tab 上的关闭按钮兜底。
     */
    async function closeChatTab(ctx) {
    	const view = getActiveChatView() ?? findChatWebview();
    	if (!view) throw new Error("当前没有打开的 DeepSeek Browser tab");
    	const tabElement = view.closest?.("[data-dockkit-tab], [data-sidebar-right-tab]");
    	let tabId = tabElement?.getAttribute?.("data-dockkit-tab") ?? tabElement?.getAttribute?.("data-sidebar-right-tab") ?? "";
    	const sidebar = ctx?.get?.("sidebarRight") ?? ctx?.sidebarRight;
    	if (tabId.length === 0 && sidebar && typeof sidebar.active === "function") {
    		const active = sidebar.active();
    		if (active && active.kind === "browser") tabId = active.id;
    	}
    	if (tabId.length > 0 && sidebar && typeof sidebar.close === "function") {
    		sidebar.close(tabId);
    		activeChatView = void 0;
    		return { ok: true, tabId, status: debugWebviews() };
    	}
    	const closeButton = tabElement?.querySelector?.('button[aria-label*="关闭"], button[aria-label*="Close"], [data-dockkit-tab-close]');
    	if (closeButton) {
    		closeButton.click();
    		activeChatView = void 0;
    		return { ok: true, tabId: tabId || null, status: debugWebviews() };
    	}
    	throw new Error("找不到 Browser tab 的关闭按钮；请直接在侧边栏标签上点关闭");
    }

    async function openChatTab(ctx, url = CHAT_URL, options = {}) {
    	const cached = await resolveActiveView();
    	if (cached) {
    		console.log("[webds] 复用当前活动 webview:", JSON.stringify(describeView(cached)));
    		return rememberChatView(cached);
    	}
    	const existing = findChatWebview();
    	if (existing) {
    		console.log("[webds] 复用已打开的 DeepSeek 页面:", JSON.stringify(describeView(existing)));
    		return existing;
    	}
    	console.log("[webds] 未找到可复用的 webview，当前列表=", JSON.stringify(debugWebviews()));
    	if (options.reuseOnly === true) {
    		const deadline = Date.now() + (options.reuseWaitMs ?? 2e3);
    		while (Date.now() < deadline) {
    			await sleep(100);
    			const late = findChatWebview();
    			if (late) {
    				console.log("[webds] 延迟复用到 DeepSeek 页面:", JSON.stringify(describeView(late)));
    				return late;
    			}
    		}
    		throw new Error("没有找到已打开的 chat.deepseek.com 页面；save 不会新建空会话。请先执行 __webds_test__() 或 __webds_open__()");
    	}
    	const previousNames = new Set(webviews().map(leaseOf));
    	const sidebar = ctx?.get?.("sidebarRight") ?? ctx?.sidebarRight;
    	if (!sidebar || typeof sidebar.openTab !== "function") throw new Error("sidebarRight 服务不可用，无法创建 Browser tab（确认 ui-sidebar-right / ui-sidebar-browser 已启用）");
    	sidebar.openTab("browser", { params: { url } });
    	console.log("[webds] 已请求打开 Browser tab:", url);
    	const created = await waitForNewWebview(previousNames, 2e4);
    	return rememberChatView(created);
    }
    /**
    
    * 等待侧栏创建一个新的 webview（宁可超时也不误用旧 tab）。
    
    *
    
    * 选择顺序：
    
    *   1. lease 不在 previous 里的新 webview；
    
    *   2. 任何**可见**的 webview（新建的 tab 一定是可见的）；
    
    *   3. 已经落在 chat.deepseek.com 的 webview。
    
    * 第 3 条只在 1、2 都没等到时才用，避免把后台的旧 tab 当成刚开的新页。
    
    */
    async function waitForNewWebview(previous, timeoutMs = 2e4) {
    	const deadline = Date.now() + timeoutMs;
    	while (Date.now() < deadline) {
    		const views = webviews();
    		const fresh = views.find((view) => !previous.has(leaseOf(view)));
    		if (fresh && isViewVisible(fresh)) return fresh;
    		const visible = views.find((view) => isViewVisible(view));
    		if (visible) return visible;
    		const chat = views.find((view) => isChatUrl(safeUrl(view)));
    		if (chat) return chat;
    		await sleep(100);
    	}
    	throw new Error(`等待 Browser tab 的 <webview> 超时：${JSON.stringify(debugWebviews())}`);
    }
    /** 等待访客页真正可执行脚本。不依赖 getURL()，直接问访客页自己的 location.href。 */
    async function waitForGuestReady(view, timeoutMs = 45e3) {
    	const deadline = Date.now() + timeoutMs;
    	let lastError = "";
    	let lastHref = "";
    	while (Date.now() < deadline) {
    		try {
    			const info = await view.executeJavaScript("({ ready: document.readyState, href: location.href })");
    			const href = String(info?.href ?? "");
    			lastHref = href;
    			if (isChatUrl(href)) return;
    		} catch (error) {
    			lastError = String(error?.message ?? error);
    		}
    		await sleep(150);
    	}
    	throw new Error(`等待 webview 就绪超时：href=${lastHref || safeUrl(view)} lastError=${lastError}`);
    }
    /**
    
    * 在访客页主世界执行的完整脚本（输入 → 发送 → 等回复 → 还原代码块）。
    
    * 注意：该函数会被 .toString() 注入 webview，必须保持自包含，不能引用模块作用域。
    
    * @param prompt - 要发送的问题。
    
    */
    function guestChat(prompt) {
    	const sleep$1 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    	const FENCE = String.fromCharCode(96, 96, 96);
    	const bodyText = (limit) => String(document.body && document.body.innerText || "").replace(/\s+/gu, " ").slice(0, limit);
    	const diag = () => ({
    		href: location.href,
    		title: document.title,
    		bodyText: bodyText(400)
    	});
    	const isVisible = (element) => {
    		if (!element) return false;
    		try {
    			const rect = element.getBoundingClientRect();
    			const style = getComputedStyle(element);
    			return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    		} catch {
    			return false;
    		}
    	};
    	const dumpHtml = (element, limit) => {
    		try {
    			return String(element?.outerHTML ?? "").slice(0, limit);
    		} catch {
    			return "";
    		}
    	};
    	const rectOf = (element) => {
    		try {
    			const rect = element.getBoundingClientRect();
    			return {
    				width: Math.round(rect.width),
    				height: Math.round(rect.height),
    				left: Math.round(rect.left),
    				top: Math.round(rect.top)
    			};
    		} catch {
    			return null;
    		}
    	};
    	const describeElement = (element) => {
    		let cursor = null;
    		try {
    			cursor = getComputedStyle(element).cursor;
    		} catch {
    			cursor = null;
    		}
    		const className = typeof element.className === "string" ? element.className : String(element.getAttribute?.("class") ?? "");
    		return {
    			tag: element.tagName,
    			id: element.id || null,
    			className: className.slice(0, 120),
    			role: element.getAttribute?.("role") || null,
    			ariaLabel: element.getAttribute?.("aria-label") || null,
    			title: element.getAttribute?.("title") || null,
    			testId: element.getAttribute?.("data-testid") || element.getAttribute?.("data-test-id") || null,
    			text: String(element.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 60),
    			disabled: element.disabled === true || element.getAttribute?.("aria-disabled") === "true",
    			ariaDisabled: element.getAttribute?.("aria-disabled") || null,
    			visible: isVisible(element),
    			hasSvg: !!element.querySelector?.("svg"),
    			cursor,
    			rect: rectOf(element),
    			html: dumpHtml(element, 220)
    		};
    	};
    	const findInput = () => {
    		const selectors = [
    			"#chat-input",
    			"textarea[placeholder]",
    			"textarea",
    			"[contenteditable=\"true\"]",
    			"[role=\"textbox\"]"
    		];
    		for (const selector of selectors) {
    			const elements = Array.from(document.querySelectorAll(selector));
    			const visible = elements.find((element) => isVisible(element));
    			if (visible) return {
    				element: visible,
    				selector
    			};
    		}
    		for (const selector of selectors) {
    			const element = document.querySelector(selector);
    			if (element) return {
    				element,
    				selector
    			};
    		}
    		return void 0;
    	};
    	return (async () => {
    		let found = findInput();
    		for (let index = 0; index < 120 && !found; index += 1) {
    			await sleep$1(100);
    			found = findInput();
    		}
    		if (!found) return {
    			ok: false,
    			stage: "need-login",
    			message: "12s 内未找到输入框，可能需要先手动登录 DeepSeek",
    			...diag()
    		};
    		const input = found.element;
    		const isField = input.tagName === "TEXTAREA" || input.tagName === "INPUT";
    		const fireInput = (data) => {
    			try {
    				input.dispatchEvent(new InputEvent("input", {
    					bubbles: true,
    					cancelable: true,
    					inputType: "insertText",
    					data
    				}));
    			} catch {
    				input.dispatchEvent(new Event("input", {
    					bubbles: true,
    					cancelable: true
    				}));
    			}
    		};
    		const readInput = () => String(isField ? input.value ?? "" : input.textContent ?? "");
    		try {
    			input.focus();
    			input.click();
    		} catch {}
    		let execOk = false;
    		try {
    			if (isField) input.select();
    			else {
    				const selection = window.getSelection();
    				const range = document.createRange();
    				range.selectNodeContents(input);
    				selection?.removeAllRanges();
    				selection?.addRange(range);
    			}
    			execOk = document.execCommand("insertText", false, prompt);
    		} catch {
    			execOk = false;
    		}
    		if (!execOk || readInput() !== prompt) if (isField) {
    			const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    			const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    			try {
    				const tracker = input._valueTracker;
    				if (tracker && typeof tracker.setValue === "function") tracker.setValue("");
    			} catch {}
    			if (setter) setter.call(input, "");
    			else input.value = "";
    			fireInput("");
    			if (setter) setter.call(input, prompt);
    			else input.value = prompt;
    			fireInput(prompt);
    			input.dispatchEvent(new Event("change", { bubbles: true }));
    		} else {
    			input.textContent = prompt;
    			fireInput(prompt);
    		}
    		const valueAfterSet = readInput();
    		await sleep$1(1e3 + Math.floor(Math.random() * 2e3));
    		const assistantNodes = () => Array.from(document.querySelectorAll(".ds-markdown")).filter((node$1) => !node$1.closest("ds-think-content, .ds-think-content"));
    		const countMarkdown = () => assistantNodes().length;
    		const userMessageCount = () => Array.from(document.querySelectorAll("[data-message-author-role=\"user\"], .ds-user-message, [class*=\"user-message\"]")).length;
    		const initialNodes = assistantNodes();
    		const baselineText = initialNodes.length ? String(initialNodes[initialNodes.length - 1].innerText || initialNodes[initialNodes.length - 1].textContent || "") : "";
    		const before = countMarkdown();
    		const beforeUser = userMessageCount();
    		const hadText = valueAfterSet.trim().length > 0;
    		const inputEmpty = () => readInput().trim().length === 0;
    		const labelOf = (element) => [
    			element.getAttribute?.("aria-label"),
    			element.getAttribute?.("title"),
    			element.getAttribute?.("data-testid"),
    			element.getAttribute?.("data-test-id"),
    			element.textContent
    		].filter(Boolean).join(" ");
    		const stopVisible = () => Array.from(document.querySelectorAll("button, [role=\"button\"]")).some((element) => isVisible(element) && /停止|stop generating|stop/iu.test(labelOf(element)));
    		const startHref = location.href;
    		const navigatedToConversation = () => location.href !== startHref && /\/a\/chat\/s\//u.test(location.href);
    		const sentNow = () => navigatedToConversation() || countMarkdown() > before || userMessageCount() > beforeUser || hadText && inputEmpty() || stopVisible();
    		const fireKey = (type) => {
    			input.dispatchEvent(new KeyboardEvent(type, {
    				key: "Enter",
    				code: "Enter",
    				keyCode: 13,
    				which: 13,
    				bubbles: true,
    				cancelable: true,
    				composed: true,
    				shiftKey: false,
    				ctrlKey: false,
    				altKey: false,
    				metaKey: false,
    				isComposing: false
    			}));
    		};
    		const waitFor = async (predicate, timeoutMs) => {
    			const deadline = Date.now() + timeoutMs;
    			while (Date.now() < deadline) {
    				if (predicate()) return true;
    				await sleep$1(100);
    			}
    			return predicate();
    		};
    		const scrollTo = (element) => {
    			try {
    				element.scrollIntoView({ block: "center" });
    			} catch {}
    		};
    		const clickElement = (element) => {
    			scrollTo(element);
    			try {
    				element.click();
    			} catch {}
    		};
    		const mouseClickElement = (element) => {
    			scrollTo(element);
    			let rect = {
    				left: 0,
    				top: 0,
    				width: 0,
    				height: 0
    			};
    			try {
    				rect = element.getBoundingClientRect();
    			} catch {}
    			const options = {
    				bubbles: true,
    				cancelable: true,
    				composed: true,
    				view: window,
    				clientX: rect.left + rect.width / 2,
    				clientY: rect.top + rect.height / 2,
    				button: 0
    			};
    			for (const type of [
    				"pointerdown",
    				"mousedown",
    				"pointerup",
    				"mouseup",
    				"click"
    			]) try {
    				if (type.startsWith("pointer")) element.dispatchEvent(new PointerEvent(type, options));
    				else element.dispatchEvent(new MouseEvent(type, options));
    			} catch {}
    		};
    		const findSendButton = () => {
    			let inputRect = {
    				left: 0,
    				top: 0,
    				bottom: 0
    			};
    			try {
    				inputRect = input.getBoundingClientRect();
    			} catch {}
    			const candidates = [];
    			for (const element of Array.from(document.querySelectorAll("button, [role=\"button\"], [aria-label], [tabindex]"))) {
    				if (!isVisible(element)) continue;
    				if (element === input || element.contains(input)) continue;
    				const label = labelOf(element);
    				if (/停止|stop/iu.test(label)) continue;
    				const isButtonish = element.tagName === "BUTTON" || element.getAttribute("role") === "button";
    				if (!isButtonish && !/发送|send/iu.test(label)) continue;
    				const disabled = element.disabled === true || element.getAttribute("aria-disabled") === "true";
    				const className = String(element.className || "");
    				let score = 0;
    				if (/发送|send/iu.test(label)) score += 1e3;
    				if (/上传|attach|文件|file|语音|voice|麦克风|mic|深度思考|联网|搜索|新对话|new chat/iu.test(label)) score -= 500;
    				if (element.querySelector("svg")) score += 50;
    				if (element.closest("form")) score += 100;
    				if (/ds-button--primary|ds-button--filled/iu.test(className)) score += 400;
    				if (/ds-button--iconLabelTertiary/iu.test(className)) score -= 100;
    				try {
    					const rect = element.getBoundingClientRect();
    					if (inputRect.bottom > 0 && Math.abs(rect.top - inputRect.bottom) < 140) score += 80;
    					if (rect.left > inputRect.left) score += 20;
    					score += Math.min(80, Math.max(0, Math.round(rect.left / 25)));
    				} catch {}
    				if (disabled) score -= 200;
    				candidates.push({
    					element,
    					score,
    					info: describeElement(element)
    				});
    			}
    			for (const svg of Array.from(document.querySelectorAll("svg"))) {
    				const element = svg.parentElement;
    				if (!element) continue;
    				if (element.tagName !== "DIV" && element.tagName !== "SPAN") continue;
    				if (element.closest("button, [role=\"button\"]")) continue;
    				if (!isVisible(element)) continue;
    				let rect = {
    					width: 0,
    					height: 0,
    					top: 0,
    					left: 0
    				};
    				try {
    					rect = element.getBoundingClientRect();
    				} catch {}
    				if (rect.width === 0 || rect.height === 0 || rect.width > 90 || rect.height > 90) continue;
    				let score = 150;
    				try {
    					if (getComputedStyle(element).cursor === "pointer") score += 60;
    					if (inputRect.bottom > 0 && Math.abs(rect.top - inputRect.bottom) < 140) score += 80;
    				} catch {}
    				candidates.push({
    					element,
    					score,
    					info: describeElement(element)
    				});
    			}
    			candidates.sort((left, right) => right.score - left.score);
    			return candidates;
    		};
    		fireKey("keydown");
    		fireKey("keypress");
    		fireKey("keyup");
    		let sent = await waitFor(sentNow, 1500);
    		let buttonCandidate;
    		let buttons = [];
    		if (!sent) {
    			await sleep$1(500);
    			buttons = findSendButton();
    			buttonCandidate = buttons[0];
    			if (buttonCandidate && !buttonCandidate.info.disabled) {
    				clickElement(buttonCandidate.element);
    				sent = await waitFor(sentNow, 1500);
    				if (!sent) {
    					mouseClickElement(buttonCandidate.element);
    					sent = await waitFor(sentNow, 3e3);
    				}
    			} else sent = await waitFor(sentNow, 1e3);
    		}
    		if (!sent) {
    			try {
    				input.focus();
    				if (isField) input.select();
    				try {
    					const tracker = input._valueTracker;
    					if (tracker && typeof tracker.setValue === "function") tracker.setValue("");
    				} catch {}
    				document.execCommand("insertText", false, prompt);
    				fireInput(prompt);
    			} catch {}
    			fireKey("keydown");
    			fireKey("keyup");
    			sent = await waitFor(sentNow, 2e3);
    		}
    		if (!sent) {
    			const allCandidates = Array.from(document.querySelectorAll("button, [role=\"button\"], [aria-label], [tabindex]")).slice(0, 40).map(describeElement);
    			const svgClickables = Array.from(document.querySelectorAll("svg")).map((svg) => svg.parentElement).filter((element) => element && (element.tagName === "DIV" || element.tagName === "SPAN")).slice(0, 20).map(describeElement);
    			const container = input.closest("form") || input.parentElement?.parentElement || input.parentElement;
    			return {
    				ok: false,
    				stage: "send",
    				message: "未能确认消息已发送（Enter 与发送按钮都没有产生新回复）",
    				...diag(),
    				inputSelector: found.selector,
    				inputTag: input.tagName,
    				inputId: input.id || null,
    				inputClass: typeof input.className === "string" ? input.className.slice(0, 120) : "",
    				inputHtml: dumpHtml(input, 300),
    				inputValueLength: valueAfterSet.length,
    				inputValuePreview: valueAfterSet.slice(0, 120),
    				inputValueNow: readInput().slice(0, 120),
    				inputDisabled: input.disabled === true,
    				inputReadOnly: input.readOnly === true,
    				execCommandOk: execOk,
    				activeElement: document.activeElement ? describeElement(document.activeElement) : null,
    				buttons: buttons.slice(0, 10).map((candidate) => candidate.info),
    				allCandidates,
    				svgClickables,
    				containerTag: container?.tagName ?? null,
    				containerHtml: dumpHtml(container, 1500),
    				bestButtonScore: buttonCandidate?.score ?? null,
    				stopVisible: stopVisible(),
    				markdownDelta: countMarkdown() - before,
    				userMessageDelta: userMessageCount() - beforeUser,
    				hadText
    			};
    		}
    		let observer;
    		let idleTimer = null;
    		let hardTimer = null;
    		let lastText = "";
    		const done = new Promise((resolve) => {
    			let settled = false;
    			const finish = () => {
    				if (settled) return;
    				settled = true;
    				if (observer) observer.disconnect();
    				clearTimeout(idleTimer);
    				clearTimeout(hardTimer);
    				resolve();
    			};
    			const consider = () => {
    				const nodes$1 = assistantNodes();
    				const node$1 = nodes$1[nodes$1.length - 1];
    				const text = node$1 ? String(node$1.innerText || node$1.textContent || "") : "";
    				if (!text) return;
    				const isNew = nodes$1.length > before;
    				if (!isNew && text === baselineText) return;
    				if (text === lastText) return;
    				lastText = text;
    				clearTimeout(idleTimer);
    				idleTimer = setTimeout(finish, 300);
    			};
    			observer = new MutationObserver(consider);
    			observer.observe(document.body, {
    				childList: true,
    				subtree: true,
    				characterData: true
    			});
    			hardTimer = setTimeout(finish, 12e4);
    			setTimeout(consider, 0);
    		});
    		await done;
    		const nodes = assistantNodes();
    		const node = nodes[nodes.length - 1];
    		if (!node) return {
    			ok: false,
    			stage: "reply",
    			message: "等待回复超时，未找到正文容器 .ds-markdown",
    			...diag()
    		};
    		const clone = node.cloneNode(true);
    		for (const thinking of Array.from(clone.querySelectorAll("ds-think-content, .ds-think-content"))) thinking.remove();
    		const codeBlocks = [];
    		for (const pre of Array.from(clone.querySelectorAll("pre"))) {
    			const codeElement = pre.querySelector("code") || pre;
    			const raw = String(codeElement.innerText || codeElement.textContent || "");
    			const code = raw.replace(/\n+$/u, "");
    			const classes = String(codeElement.getAttribute && codeElement.getAttribute("class") || "") + " " + String(pre.getAttribute && pre.getAttribute("class") || "");
    			let language = "";
    			const match = classes.match(/(?:language|lang)-([A-Za-z0-9_+#.-]+)/u);
    			if (match) language = match[1];
    			else {
    				const dataLang = codeElement.getAttribute && (codeElement.getAttribute("data-lang") || codeElement.getAttribute("data-language")) || pre.getAttribute && pre.getAttribute("data-lang");
    				if (dataLang) language = String(dataLang);
    			}
    			codeBlocks.push({
    				language,
    				code
    			});
    			const replacement = document.createTextNode("\n" + FENCE + language + "\n" + code + "\n" + FENCE + "\n");
    			if (pre.parentNode) pre.parentNode.replaceChild(replacement, pre);
    		}
    		clone.style.position = "fixed";
    		clone.style.left = "-99999px";
    		clone.style.top = "0";
    		clone.style.whiteSpace = "pre-wrap";
    		document.body.appendChild(clone);
    		const replyMarkdown = String(clone.innerText || clone.textContent || "").trim();
    		clone.remove();
    		return {
    			ok: true,
    			stage: "done",
    			message: "回复完成，代码块已还原为 Markdown 围栏",
    			...diag(),
    			inputSelector: found.selector,
    			replyText: replyMarkdown,
    			replyMarkdown,
    			codeBlocks
    		};
    	})();
    }
    /** 执行一次完整测试：打开/复用 tab → 等就绪 → 注入脚本 → 返回结构化结果。 */
    async function runStandaloneChat(ctx, prompt, options = {}) {
    	const result = await callWebdsRpc(ctx, "browserChat", {
    		script: guestChat.toString(),
    		prompt
    	}, 24e4);
    	if (result) result.build = BUILD_TAG;
    	if (result && result.stage === "send") console.log("[webds][SEND_DIAG] " + JSON.stringify(result));
    	if (result && result.stage === "need-login") console.warn("[webds] 独立浏览器需要先登录 DeepSeek：切换到“显示浏览器窗口”，在窗口中完成登录后再试。");
    	if (result && result.stage === "done" && options.suppressAutoContinue !== true) {
    		const turnTokens = estimateTokens(prompt) + estimateTokens(String(result.replyMarkdown ?? ""));
    		addTokens(turnTokens);
    		result.tokens = {
    			turn: turnTokens,
    			total: getCurrentTokens(),
    			threshold: getTokenThreshold()
    		};
    		console.log("[webds] tokens +=", turnTokens, "| total =", Math.round(getCurrentTokens()), "/", getTokenThreshold());
    		if (turnCompleteHandler !== void 0) try {
    			await turnCompleteHandler({
    				prompt,
    				reply: String(result.replyMarkdown ?? ""),
    				tokens: turnTokens,
    				result
    			});
    		} catch (error) {
    			console.warn("[webds] turn-complete handler failed:", error);
    		}
    	}
    	return result;
    }
    async function runDomTest(ctx, prompt = TEST_PROMPT, options = {}) {
    	try {
    		await refreshBrowserConfig(ctx);
    	} catch (error) {
    		console.warn("[webds] 读取浏览器配置失败，沿用缓存:", String(error?.message ?? error));
    	}
    	if (browserConfig.enabled === false) return {
    		ok: false,
    		stage: "disabled",
    		message: "网页版未启用：请先在「网页版」配置中打开开关"
    	};
    	if (browserConfig.mode === "standalone") return await runStandaloneChat(ctx, prompt, options);
    	const view = await openChatTab(ctx, CHAT_URL, options);
    	console.log("[webds] 使用 webview:", JSON.stringify(describeView(view)));
    	if (typeof view.executeJavaScript !== "function") throw new Error("该 <webview> 没有 executeJavaScript（keys=" + Object.keys(view).slice(0, 20).join(",") + "）");
    	await waitForGuestReady(view);
    	console.log("[webds] guest ready, lease=", leaseOf(view), "—— 开始注入 DOM 脚本");
    	const script = "(" + guestChat.toString() + ")(" + JSON.stringify(prompt) + ")";
    	const result = await view.executeJavaScript(script);
    	if (result) result.build = BUILD_TAG;
    	if (result && result.stage === "send") console.log("[webds][SEND_DIAG] " + JSON.stringify(result));
    	if (result && result.stage === "need-login") console.warn("[webds] 需要先登录：请在右侧 Browser tab 里完成 DeepSeek 登录，然后重新执行 __webds_test__()");
    	if (result && result.stage === "done" && options.suppressAutoContinue !== true) {
    		const turnTokens = estimateTokens(prompt) + estimateTokens(String(result.replyMarkdown ?? ""));
    		addTokens(turnTokens);
    		result.tokens = {
    			turn: turnTokens,
    			total: getCurrentTokens(),
    			threshold: getTokenThreshold()
    		};
    		console.log("[webds] tokens +=", turnTokens, "| total =", Math.round(getCurrentTokens()), "/", getTokenThreshold());
    		if (turnCompleteHandler !== void 0) try {
    			await turnCompleteHandler({
    				prompt,
    				reply: String(result.replyMarkdown ?? ""),
    				tokens: turnTokens,
    				result
    			});
    		} catch (error) {
    			console.warn("[webds] turn-complete handler failed:", error);
    		}
    	}
    	return result;
    }
    
    //#endregion
    //#region src/client/memory-sync.ts
    const SUMMARY_PROMPT = `请对以上全部对话内容进行结构化总结，输出格式如下：
    
    ## 核心结论
    （已达成共识的关键结论，按重要性排列）
    
    ## 已确定方案
    （已经确定的实现方案、技术选型、设计决策）
    
    ## 待解决问题
    （尚未解决的疑问、需要进一步讨论的点）
    
    ## 关键上下文
    （理解后续讨论所必需的背景信息、约束条件、用户偏好）
    
    要求：精炼、准确、不超过 800 字。不要遗漏任何已确定的决策。`;
    /** 任务书规定的硬上限。 */
    const SUMMARY_LIMIT = 1800;
    const TRUNCATION_MARKER = "\n\n> （内容超长，已截断）";
    /**
    
    * 超过 limit 时优先完整保留“核心结论 + 已确定方案”，
    
    * 剩余预算再补“待解决问题 / 关键上下文”，最后附截断标记。
    
    */
    function truncateSummary(text, limit = SUMMARY_LIMIT) {
    	const originalChars = text.length;
    	if (originalChars <= limit) return {
    		text,
    		truncated: false,
    		originalChars,
    		finalChars: originalChars
    	};
    	const budget = Math.max(0, limit - TRUNCATION_MARKER.length);
    	const headingIndex = (title) => {
    		const escaped = title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    		const pattern = new RegExp(`^\\s*(?:#{1,6}\\s*|\\*\\*\\s*)?${escaped}\\s*(?:\\*\\*)?\\s*$`, "mu");
    		return text.match(pattern)?.index ?? -1;
    	};
    	const starts = [
    		"核心结论",
    		"已确定方案",
    		"待解决问题",
    		"关键上下文"
    	].map((title) => headingIndex(title)).filter((index) => index >= 0).sort((left, right) => left - right);
    	const nextStart = (from) => starts.find((index) => index > from) ?? text.length;
    	const planStart = headingIndex("已确定方案");
    	const coreStart = headingIndex("核心结论");
    	const anchor = planStart >= 0 ? planStart : coreStart >= 0 ? coreStart : -1;
    	const mandatoryEnd = anchor >= 0 ? nextStart(anchor) : Math.min(text.length, budget);
    	let kept = text.slice(0, mandatoryEnd).trimEnd();
    	if (kept.length > budget) kept = kept.slice(0, budget).trimEnd();
    	else {
    		const room = budget - kept.length - 2;
    		if (room > 0) {
    			const rest = text.slice(mandatoryEnd).trim();
    			if (rest.length > 0) kept = `${kept}\n\n${rest.slice(0, room).trimEnd()}`;
    		}
    	}
    	const finalText = kept.trimEnd() + TRUNCATION_MARKER;
    	return {
    		text: finalText,
    		truncated: true,
    		originalChars,
    		finalChars: finalText.length
    	};
    }
    function connectionRpc(ctx) {
    	const connection = ctx?.get?.("connection", false) ?? ctx?.connection;
    	const rpc = connection?.rpc;
    	if (!rpc || typeof rpc.call !== "function") throw new Error("connection.rpc 不可用：Client 与 Host 的 RPC 通道未挂载");
    	return rpc;
    }
    function timeoutSignal(ms = 3e4) {
    	return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : void 0;
    }
    /** 读取一次总结并写入 Host 的 dsh_memory。 */
    async function saveMemory(ctx) {
    	const conversation = await runDomTest(ctx, SUMMARY_PROMPT, {
    		reuseOnly: true,
    		suppressAutoContinue: true
    	});
    	if (!conversation.ok) return {
    		ok: false,
    		stage: conversation.stage,
    		message: conversation.message ?? "总结对话失败",
    		conversation
    	};
    	const raw = String(conversation.replyMarkdown ?? "").trim();
    	if (raw.length === 0) return {
    		ok: false,
    		stage: "summary",
    		message: "DeepSeek 返回了空总结",
    		conversation
    	};
    	const cut = truncateSummary(raw);
    	const host = await saveSummaryToHost(ctx, cut.text, {
    		originalChars: cut.originalChars,
    		finalChars: cut.finalChars,
    		truncated: cut.truncated
    	});
    	return {
    		ok: true,
    		stage: "saved",
    		message: "记忆已写入 Host",
    		chars: cut.finalChars,
    		originalChars: cut.originalChars,
    		truncated: cut.truncated,
    		summary: cut.text,
    		host
    	};
    }
    /**
    
    * 当前生效的记忆别名。
    
    * 面板切换后由 index.ts 写入，使"保存记忆"和"执行注入"指向同一个文件，
    
    * 避免出现"保存到 A、注入读 B"的错位。
    
    */
    let currentMemoryKey = "progress";
    function getMemoryKey() {
    	return currentMemoryKey;
    }
    function setMemoryKey(key) {
    	const next = String(key ?? "").trim();
    	currentMemoryKey = next.length > 0 ? next : "progress";
    }
    /** 通用 RPC 调用：统一信封、统一错误收敛。 */
    async function callWebdsRpc(ctx, endpoint, payload = {}, timeoutMs = 3e4) {
    	const rpc = connectionRpc(ctx);
    	const response = await rpc.call("/api", "plugin-rpc/webds", {
    		endpoint,
    		payload
    	}, timeoutSignal(timeoutMs));
    	if (!response || response.ok !== true) {
    		const error = response?.error;
    		throw new Error(`Host ${endpoint} 失败：${String(error?.code ?? "unknown")} ${String(error?.message ?? "")}`.trim());
    	}
    	return response.value;
    }
    /** 把已经拿到的总结写入 Host（手动保存与自动续接共用）。 */
    async function saveSummaryToHost(ctx, summary, meta = {}) {
    	const rpc = connectionRpc(ctx);
    	const sessionId = activeSessionId();
    	const key = getMemoryKey();
    	const response = await rpc.call("/api", "plugin-rpc/webds", {
    		endpoint: "save",
    		payload: {
    			key,
    			summary,
    			meta: {
    				source: "chat.deepseek.com",
    				sessionId,
    				savedAt: new Date().toISOString(),
    				...meta
    			}
    		}
    	}, timeoutSignal());
    	if (!response || response.ok !== true) {
    		const error = response?.error;
    		throw new Error(`Host 保存失败：${String(error?.code ?? "unknown")} ${String(error?.message ?? "")}`.trim());
    	}
    	const savedKey = String(response.value?.key ?? key);
    	setMemoryKey(savedKey);
    	return response.value;
    }
    /**
    
    * 读取 Host 的 progress.md，并作为一条用户消息投递到当前主会话。
    
    * sessionId 来自右侧栏根节点的 data-sidebar-right-session（官方 sidebar-right 自己就用它）。
    
    */
    async function executeMemory(ctx) {
    	const view = getActiveChatView();
    	const sessionId = activeSessionId(view) || String(document.querySelector('[data-conversation-region="chat"]')?.getAttribute?.("data-conversation-session") ?? "");
    	if (sessionId.length === 0) return {
    		ok: false,
    		stage: "session",
    		message: "无法确定当前主会话 ID：请先打开一个 DSH 会话，或执行 __webds_open__() 打开侧栏 Browser tab"
    	};
    	const rpc = connectionRpc(ctx);
    	const key = getMemoryKey();
    	const response = await rpc.call("/api", "plugin-rpc/webds", {
    		endpoint: "execute",
    		payload: {
    			sessionId,
    			key
    		}
    	}, timeoutSignal());
    	if (!response || response.ok !== true) {
    		const error = response?.error;
    		throw new Error(`Host 执行注入失败：${String(error?.code ?? "unknown")} ${String(error?.message ?? "")}`.trim());
    	}
    	return {
    		ok: true,
    		stage: "executed",
    		message: `已把 ${key} 作为用户消息投递到主会话`,
    		sessionId,
    		host: response.value
    	};
    }
    
    //#endregion
    //#region src/client/auto-continue.ts
    let running = false;
    /**
    
    * 在访客页执行的“新建对话”脚本。自包含，靠 .toString() 注入。
    
    */
    function guestNewChat() {
    	const sleep$1 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    	const PHRASES = [
    		"开启新对话",
    		"新建对话",
    		"新对话",
    		"new chat",
    		"new conversation",
    		"start new chat"
    	];
    	/** 可见且在视口内（排除 left:-198 这种折叠侧栏幽灵按钮）。 */
    	const onScreen = (element) => {
    		if (!element) return false;
    		try {
    			if (typeof element.isConnected === "boolean" && element.isConnected === false) return false;
    			if (element.closest && element.closest("[hidden], [aria-hidden=\"true\"]") !== null) return false;
    			const rect = element.getBoundingClientRect();
    			const style = getComputedStyle(element);
    			const opacity = style.opacity === "" ? 1 : Number(style.opacity);
    			return rect.width >= 8 && rect.height >= 8 && rect.left >= -4 && rect.top >= -4 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight && style.display !== "none" && style.visibility !== "hidden" && opacity > 0;
    		} catch {
    			return false;
    		}
    	};
    	const textOf = (element) => String(element.innerText || element.textContent || "").replace(/\s+/gu, " ").trim();
    	const rawTextOf = (element) => String(element.textContent || "").replace(/\s+/gu, " ").trim();
    	const rectOf = (element) => {
    		try {
    			const value = element.getBoundingClientRect();
    			return {
    				width: Math.round(value.width),
    				height: Math.round(value.height),
    				left: Math.round(value.left),
    				top: Math.round(value.top)
    			};
    		} catch {
    			return null;
    		}
    	};
    	const describe = (element) => ({
    		tag: element.tagName,
    		ariaLabel: element.getAttribute?.("aria-label") || null,
    		title: element.getAttribute?.("title") || null,
    		testId: element.getAttribute?.("data-testid") || null,
    		text: textOf(element).slice(0, 50),
    		href: element.getAttribute?.("href") || element.closest?.("a")?.getAttribute?.("href") || null,
    		className: String(element.className || "").slice(0, 100),
    		hasSvg: !!element.querySelector?.("svg"),
    		rect: rectOf(element)
    	});
    	/** 包括 open shadow root 在内的全部元素。 */
    	const collectAll = () => {
    		const list = [];
    		const walk = (root) => {
    			let nodes = [];
    			try {
    				nodes = Array.from(root.querySelectorAll ? root.querySelectorAll("*") : []);
    			} catch {
    				nodes = [];
    			}
    			for (const node of nodes) {
    				list.push(node);
    				if (node.shadowRoot) walk(node.shadowRoot);
    			}
    		};
    		walk(document);
    		return list;
    	};
    	const countMessages = () => document.querySelectorAll(".ds-markdown").length;
    	const findInput = () => {
    		for (const selector of [
    			"#chat-input",
    			"textarea",
    			"[contenteditable=\"true\"]"
    		]) {
    			const elements = Array.from(document.querySelectorAll(selector));
    			const visible = elements.find(onScreen);
    			if (visible) return visible;
    		}
    		return void 0;
    	};
    	const clickNative = (element) => {
    		try {
    			element.click();
    			return true;
    		} catch {
    			return false;
    		}
    	};
    	const clickMouse = (element) => {
    		let rect = {
    			left: 0,
    			top: 0,
    			width: 0,
    			height: 0
    		};
    		try {
    			rect = element.getBoundingClientRect();
    		} catch {}
    		const options = {
    			bubbles: true,
    			cancelable: true,
    			composed: true,
    			view: window,
    			clientX: rect.left + rect.width / 2,
    			clientY: rect.top + rect.height / 2,
    			button: 0,
    			buttons: 1,
    			pointerId: 1,
    			pointerType: "mouse",
    			isPrimary: true
    		};
    		for (const type of [
    			"pointerdown",
    			"mousedown",
    			"pointerup",
    			"mouseup",
    			"click"
    		]) try {
    			if (type.startsWith("pointer")) element.dispatchEvent(new PointerEvent(type, options));
    			else element.dispatchEvent(new MouseEvent(type, options));
    		} catch {}
    	};
    	/** 真机上直接可见：给点击目标加 12 秒红框。 */
    	const highlight = (element) => {
    		try {
    			const previousOutline = element.style.outline;
    			const previousOffset = element.style.outlineOffset;
    			element.style.outline = "2px solid red";
    			element.style.outlineOffset = "2px";
    			element.setAttribute("data-webds-new-chat-target", "1");
    			window.setTimeout(() => {
    				try {
    					element.style.outline = previousOutline;
    					element.style.outlineOffset = previousOffset;
    					element.removeAttribute("data-webds-new-chat-target");
    				} catch {}
    			}, 12e3);
    			return true;
    		} catch {
    			return false;
    		}
    	};
    	return (async () => {
    		const beforeHref = location.href;
    		const beforeCount = countMessages();
    		const deadline = Date.now() + 5e3;
    		const candidates = [];
    		const seen = new Set();
    		const textMatches = [];
    		const svgMatches = [];
    		const addCandidate = (element, score, source, explicitTarget) => {
    			let target = explicitTarget;
    			if (!target) try {
    				target = element.closest?.("a, button, [role=\"button\"]") || element;
    			} catch {
    				target = element;
    			}
    			if (!target || seen.has(target)) return;
    			if (!onScreen(target) && !onScreen(element)) return;
    			const finalTarget = onScreen(target) ? target : element;
    			seen.add(finalTarget);
    			candidates.push({
    				element,
    				target: finalTarget,
    				score,
    				source,
    				info: describe(finalTarget)
    			});
    		};
    		for (const element of collectAll()) {
    			if (!onScreen(element)) continue;
    			const text = rawTextOf(element);
    			if (text.length === 0 || text.length > 40) continue;
    			const lower = text.toLowerCase();
    			if (!PHRASES.some((phrase) => lower.includes(phrase))) continue;
    			const rect = element.getBoundingClientRect();
    			textMatches.push({
    				element,
    				text,
    				textLength: text.length,
    				area: rect.width * rect.height,
    				rect: rectOf(element)
    			});
    		}
    		textMatches.sort((left, right) => left.textLength - right.textLength || left.area - right.area);
    		for (const match of textMatches.slice(0, 12)) {
    			let target = match.element;
    			try {
    				target = match.element.closest?.("button, a, [role=\"button\"], .ds-button") || match.element;
    			} catch {
    				target = match.element;
    			}
    			if (!onScreen(target)) target = match.element;
    			addCandidate(match.element, 5e3, "text", target);
    		}
    		for (const svg of Array.from(document.querySelectorAll("svg"))) {
    			if (!onScreen(svg)) continue;
    			const rect = svg.getBoundingClientRect();
    			if (rect.top > 180 || rect.left > 340) continue;
    			if (rect.width < 10 || rect.width > 48 || rect.height < 10 || rect.height > 48) continue;
    			const markup = String(svg.innerHTML || "").toLowerCase();
    			if (!/(?:m12 5v14|m5 12h14|m12 6v12|m6 12h12|m19 13h-6|m11 5h2|m12 4v16|m4 12h16)/u.test(markup)) continue;
    			let target = svg.parentElement;
    			try {
    				target = svg.closest?.("button, a, [role=\"button\"], [class*=\"button\"], [class*=\"btn\"]") || svg.parentElement;
    			} catch {
    				target = svg.parentElement;
    			}
    			if (!target) continue;
    			svgMatches.push({
    				markup: markup.slice(0, 120),
    				rect: rectOf(svg),
    				parent: describe(target)
    			});
    			addCandidate(target, 1500, "svg-plus");
    		}
    		for (const element of Array.from(document.querySelectorAll("a, button, [role=\"button\"], [aria-label], [data-testid]"))) {
    			if (!onScreen(element)) continue;
    			const label = [
    				element.getAttribute?.("aria-label"),
    				element.getAttribute?.("title"),
    				element.getAttribute?.("data-testid"),
    				textOf(element)
    			].filter(Boolean).join(" ").toLowerCase();
    			let score = 0;
    			if (PHRASES.some((phrase) => label.includes(phrase))) score += 1e3;
    			const href = element.getAttribute?.("href") || element.closest?.("a")?.getAttribute?.("href") || "";
    			if (href === "/") score += 120;
    			if (score > 0) addCandidate(element, score, "scored");
    		}
    		candidates.sort((left, right) => right.score - left.score);
    		if (candidates.length === 0) return {
    			ok: false,
    			stage: "new-chat",
    			message: "未找到可见的“开启新对话/新对话”按钮",
    			beforeHref,
    			beforeCount,
    			candidates: [],
    			textMatches: [],
    			svgMatches: []
    		};
    		const best = candidates[0];
    		const targetInfo = describe(best.target);
    		const elementInfo = describe(best.element);
    		const highlighted = highlight(best.target);
    		const tried = [];
    		const attempt = async (target, label) => {
    			if (Date.now() >= deadline) return;
    			if (!target || !onScreen(target)) return;
    			tried.push({
    				label,
    				info: describe(target)
    			});
    			if (label.endsWith("mouse")) clickMouse(target);
    			else clickNative(target);
    			await sleep$1(1200);
    		};
    		const check = () => {
    			const afterHref = location.href;
    			const afterCount = countMessages();
    			const input = findInput();
    			const inputFound = !!input;
    			const emptyInput = !!input && String(input.value ?? input.textContent ?? "").trim().length === 0;
    			const changed = afterHref !== beforeHref;
    			const cleared = beforeCount > 0 && afterCount === 0;
    			return {
    				afterHref,
    				afterCount,
    				inputFound,
    				emptyInput,
    				switched: (changed || cleared) && inputFound && emptyInput
    			};
    		};
    		let state = check();
    		if (!state.switched) {
    			await attempt(best.target, "target-native");
    			state = check();
    		}
    		if (!state.switched) {
    			await attempt(best.target, "target-mouse");
    			state = check();
    		}
    		if (!state.switched && best.element !== best.target) {
    			await attempt(best.element, "element-native");
    			state = check();
    		}
    		if (!state.switched) {
    			await attempt(best.target.parentElement, "parent-native");
    			state = check();
    		}
    		if (!state.switched) {
    			await attempt(best.target.parentElement, "parent-mouse");
    			state = check();
    		}
    		while (!state.switched && Date.now() < deadline) {
    			await sleep$1(120);
    			state = check();
    		}
    		return {
    			ok: state.switched,
    			stage: state.switched ? "new-chat" : "new-chat-failed",
    			message: state.switched ? "已创建新对话" : "点击后 5s 内未确认新对话（URL 未变化且消息未清空）",
    			beforeHref,
    			afterHref: state.afterHref,
    			beforeCount,
    			afterCount: state.afterCount,
    			inputFound: state.inputFound,
    			emptyInput: state.emptyInput,
    			source: best.source,
    			highlighted,
    			clicked: targetInfo,
    			element: elementInfo,
    			tried,
    			candidates: candidates.slice(0, 10).map((candidate) => ({
    				score: candidate.score,
    				source: candidate.source,
    				info: candidate.info
    			})),
    			textMatches: textMatches.slice(0, 12).map((match) => ({
    				text: match.text,
    				tag: match.element.tagName,
    				className: String(match.element.className || "").slice(0, 80),
    				rect: match.rect
    			})),
    			svgMatches: svgMatches.slice(0, 6)
    		};
    	})();
    }
    /**
    
    * 达到阈值时执行自动续接。
    
    * @param ctx - Client 插件上下文。
    
    * @param options.force - 跳过阈值检查（测试用）。
    
    */
    async function maybeAutoContinue(ctx, options = {}) {
    	if (running) return {
    		ok: false,
    		stage: "busy",
    		message: "自动续接已在进行中"
    	};
    	try {
    		await refreshBrowserConfig(ctx);
    	} catch (error) {
    		console.warn("[webds] 读取浏览器配置失败，沿用缓存:", String(error?.message ?? error));
    	}
    	const threshold = getTokenThreshold();
    	const current = getCurrentTokens();
    	if (options.force !== true && current < threshold * .85) return {
    		ok: false,
    		stage: "below-threshold",
    		message: `token 未达阈值（${Math.round(current)} / ${threshold}）`
    	};
    	running = true;
    	try {
    		console.log("[webds] 触发自动续接: tokens =", Math.round(current), "/", threshold);
    		const summaryTurn = await runDomTest(ctx, SUMMARY_PROMPT, {
    			reuseOnly: true,
    			suppressAutoContinue: true
    		});
    		if (!summaryTurn.ok) return {
    			ok: false,
    			stage: "summary",
    			message: summaryTurn.message ?? "总结失败",
    			conversation: summaryTurn
    		};
    		const raw = String(summaryTurn.replyMarkdown ?? "").trim();
    		if (raw.length === 0) return {
    			ok: false,
    			stage: "summary",
    			message: "总结为空"
    		};
    		const cut = truncateSummary(raw);
    		let saved;
    		try {
    			saved = await saveSummaryToHost(ctx, cut.text, {
    				source: "auto-continue",
    				reason: options.force === true ? "force-test" : "token-threshold",
    				originalChars: cut.originalChars,
    				finalChars: cut.finalChars,
    				truncated: cut.truncated,
    				tokens: Math.round(current)
    			});
    		} catch (error) {
    			return {
    				ok: false,
    				stage: "save",
    				message: String(error?.message ?? error)
    			};
    		}
    		let newChat;
    		if (browserConfig.mode === "standalone") {
    			newChat = await callWebdsRpc(ctx, "browserNewChat", { script: guestNewChat.toString() }, 12e4);
    		} else {
    			const view = getActiveChatView();
    			if (!view || typeof view.executeJavaScript !== "function") return {
    				ok: false,
    				stage: "new-chat",
    				message: "没有可用的 webview"
    			};
    			newChat = await view.executeJavaScript("(" + guestNewChat.toString() + ")()");
    		}
    		if (!newChat || newChat.ok !== true) {
    			console.warn("[webds] 新建对话失败，停止续接:", JSON.stringify(newChat));
    			return {
    				ok: false,
    				stage: "new-chat",
    				message: newChat?.message ?? "新建对话失败",
    				newChat
    			};
    		}
    		const continuation = "这是前一轮对话的总结，请在此基础之上继续讨论：\n---\n" + cut.text + "\n---\n请确认你已理解上述上下文，然后我们继续。";
    		const continued = await runDomTest(ctx, continuation, {
    			reuseOnly: true,
    			suppressAutoContinue: true
    		});
    		if (!continued.ok) return {
    			ok: false,
    			stage: "continue",
    			message: continued.message ?? "续接消息发送失败",
    			conversation: continued,
    			newChat
    		};
    		resetTokens();
    		console.log("[webds] 续接成功，已开始新对话");
    		return {
    			ok: true,
    			stage: "continued",
    			message: "续接成功，已开始新对话",
    			summaryChars: cut.text.length,
    			saved,
    			newChat: {
    				beforeHref: newChat.beforeHref,
    				afterHref: newChat.afterHref,
    				beforeCount: newChat.beforeCount,
    				afterCount: newChat.afterCount,
    				source: newChat.source,
    				highlighted: newChat.highlighted,
    				clicked: newChat.clicked,
    				tried: newChat.tried
    			},
    			reply: String(continued.replyMarkdown ?? "").slice(0, 300)
    		};
    	} finally {
    		running = false;
    	}
    }
    /** 测试入口：跳过阈值检查，强制走一遍完整续接。 */
    async function forceAutoContinue(ctx) {
    	return await maybeAutoContinue(ctx, { force: true });
    }
    
    //#endregion
    //#region src/client/ui/SettingsPanel.ts
    const h$1 = react.createElement;
    /** 判断 href 是否已进入网页版的对话页（而非登录页）。 */
    function loginState(href) {
    	if (href.length === 0) return {
    		label: "未打开",
    		tone: "info"
    	};
    	if (!/chat\.deepseek\.com/u.test(href)) return {
    		label: "已打开（非网页版）",
    		tone: "info"
    	};
    	if (/(?:\/sign_in|\/login|\/signup)/u.test(href)) return {
    		label: "未登录（登录页）",
    		tone: "err"
    	};
    	return {
    		label: "已登录",
    		tone: "ok"
    	};
    }
    /** 把任意异常收敛成一行可读文案。 */
    function errorText$1(error) {
    	if (error instanceof Error) return error.message;
    	const message = error?.message;
    	return typeof message === "string" && message.length > 0 ? message : String(error);
    }
    /**
    
    * 构造设置页组件。
    
    * @param deps 行为注入。
    
    * @returns 一个无 props 的 React 函数组件。
    
    */
    function createSettingsPanel(deps) {
    	return function SettingsPanel() {
    		const [busy, setBusy] = react.useState(null);
    		const [notice, setNotice] = react.useState(null);
    		const [status, setStatus] = react.useState(() => deps.tokenStatus());
    		const [view, setView] = react.useState(() => deps.webviewStatus());
    		const [thresholdDraft, setThresholdDraft] = react.useState(() => String(deps.tokenStatus().threshold));
    		const lockedRef = react.useRef(false);
    		const [info, setInfo] = react.useState(null);
    		const [aliasDraft, setAliasDraft] = react.useState("");
    		const [rootDraft, setRootDraft] = react.useState("");
    		const [migrateDraft, setMigrateDraft] = react.useState("");
    		const [migrateState, setMigrateState] = react.useState(null);
    		const [preview, setPreview] = react.useState(null);
    		const refreshMemoryInfo = react.useCallback(async () => {
    			try {
    				const next = await deps.memoryInfo();
    				setInfo(next);
    				return next;
    			} catch {
    				return null;
    			}
    		}, []);
    		react.useEffect(() => {
    			let disposed = false;
    			refreshMemoryInfo();
    			const timer = window.setInterval(() => {
    				if (!disposed) refreshMemoryInfo();
    			}, 5e3);
    			return () => {
    				disposed = true;
    				window.clearInterval(timer);
    			};
    		}, []);
    		react.useEffect(() => {
    			if (info === null) return;
    			setAliasDraft((current) => current.length > 0 ? current : info.activeKey);
    			setRootDraft((current) => current.length > 0 ? current : info.memoryDir);
    			setMigrateDraft((current) => current.length > 0 ? current : info.memoryDir);
    		}, [info]);
    		react.useEffect(() => {
    			const tick = () => {
    				try {
    					setStatus(deps.tokenStatus());
    					setView(deps.webviewStatus());
    				} catch {}
    			};
    			tick();
    			const timer = window.setInterval(tick, 2e3);
    			return () => window.clearInterval(timer);
    		}, []);
    		/**
    		
    		* 统一包装：置 busy 防连点 → 执行 → 写提示 → 解除 busy。
    		
    		* 不依赖 useCallback 缓存 availability，所有判断走 ref，避免闭包读到旧值。
    		
    		*/
    		const run = async (key, label, task) => {
    			if (lockedRef.current) return;
    			lockedRef.current = true;
    			setBusy(key);
    			setNotice({
    				tone: "info",
    				text: `${label}…`
    			});
    			try {
    				const result = await task();
    				const ok = result?.ok !== false;
    				setNotice({
    					tone: ok ? "ok" : "err",
    					text: ok ? `${label}完成` : `${label}未完成：${result?.message ?? "未知原因"}`
    				});
    			} catch (error) {
    				setNotice({
    					tone: "err",
    					text: `${label}失败：${errorText$1(error)}`
    				});
    			} finally {
    				lockedRef.current = false;
    				setBusy(null);
    				try {
    					setStatus(deps.tokenStatus());
    					setView(deps.webviewStatus());
    				} catch {}
    			}
    		};
    		const applyThreshold = () => {
    			const parsed = Number(thresholdDraft);
    			if (!Number.isFinite(parsed) || parsed <= 0) {
    				setNotice({
    					tone: "err",
    					text: "阈值必须是大于 0 的数字"
    				});
    				return;
    			}
    			const next = deps.setTokenThreshold(parsed);
    			setThresholdDraft(String(next));
    			setStatus(deps.tokenStatus());
    			setNotice({
    				tone: "ok",
    				text: `阈值已设为 ${next}`
    			});
    		};
    		/** 切换记忆别名。规范化由 Host 负责，这里只做非空兜底。 */
    		const applyAlias = () => {
    			const next = aliasDraft.trim().length > 0 ? aliasDraft.trim() : "progress";
    			try {
    				deps.setMemoryKey(next);
    				setAliasDraft(next);
    				setNotice({
    					tone: "ok",
    					text: `记忆别名已切换为 ${next}`
    				});
    				refreshMemoryInfo();
    			} catch (error) {
    				setNotice({
    					tone: "err",
    					text: `切换别名失败：${errorText$1(error)}`
    				});
    			}
    		};
    		const state = loginState(view.href);
    		const ratio = Math.max(0, Math.min(1, Number.isFinite(status.ratio) ? status.ratio : 0));
    		const pct = Math.round(ratio * 100);
    		const disabled = busy !== null;
    		const button = (key, label, task) => h$1("button", {
    			key,
    			type: "button",
    			disabled,
    			onClick: () => {
    				run(key, label, task);
    			},
    			style: buttonStyle(disabled, busy === key)
    		}, busy === key ? `${label}中…` : label);
    		return h$1("div", { style: {
    			display: "flex",
    			flexDirection: "column",
    			gap: "16px",
    			padding: "4px 0"
    		} }, h$1("div", null, h$1("div", { style: {
    			fontSize: "16px",
    			fontWeight: 600,
    			color: "var(--dsw-alias-label-primary, #111827)"
    		} }, "DSH 网页版桥接"), h$1("div", { style: muted(12, 4) }, `把网页版 DeepSeek 对话桥接到 DSH 主会话 · build=${deps.buildTag}`)), h$1("div", { style: card() }, row("网页版状态", badge(state.label, state.tone)), row("Href", h$1("span", {
    			style: {
    				...mono(),
    				wordBreak: "break-all",
    				textAlign: "right",
    				maxWidth: "60%"
    			},
    			title: view.href
    		}, view.href.length > 0 ? view.href : "（未打开网页版 tab）")), row("Token 估算", h$1("span", { style: mono() }, `${Math.round(status.current)} / ${status.threshold}（${pct}%）`)), h$1("div", { style: barTrack() }, h$1("div", { style: barFill(ratio, ratio >= .85) })), row("主会话 ID", h$1("span", { style: mono() }, view.sessionId.length > 0 ? view.sessionId : "（未知）"))), h$1("div", { style: card() }, h$1("div", { style: sectionTitle() }, "操作"), h$1("div", { style: {
    			display: "flex",
    			flexWrap: "wrap",
    			gap: "8px"
    		} }, button("open", "打开网页版", async () => {
    			await deps.openChat();
    			return { ok: true };
    		}), button("save", "保存记忆", () => deps.saveMemory()), button("execute", "执行注入", () => deps.execute()), button("auto", "强制自动续接", () => deps.autoContinue())), notice === null ? null : h$1("div", { style: {
    			marginTop: "10px",
    			fontSize: "12px",
    			lineHeight: 1.6,
    			wordBreak: "break-word",
    			color: notice.tone === "ok" ? "var(--dsw-alias-state-success-primary, #16a34a)" : notice.tone === "err" ? "var(--dsw-alias-state-error-primary, #dc2626)" : "var(--dsw-alias-label-secondary, #6b7280)"
    		} }, notice.text)), h$1("div", { style: card() }, h$1("div", { style: sectionTitle() }, "配置"), h$1("div", { style: {
    			display: "flex",
    			alignItems: "center",
    			gap: "8px",
    			flexWrap: "wrap"
    		} }, h$1("span", { style: { fontSize: "13px" } }, "Token 阈值"), h$1("input", {
    			type: "number",
    			min: 1,
    			value: thresholdDraft,
    			disabled,
    			onChange: (event) => {
    				setThresholdDraft(event.target.value);
    			},
    			onKeyDown: (event) => {
    				if (event.key === "Enter") applyThreshold();
    			},
    			style: inputStyle()
    		}), h$1("button", {
    			type: "button",
    			disabled,
    			onClick: applyThreshold,
    			style: buttonStyle(disabled, false)
    		}, "应用")), h$1("div", { style: muted(12, 6) }, "每轮问答结束后累加估算 token；达到阈值自动触发总结 + 新建对话 + 续接。")), h$1("div", { style: card() }, h$1("div", { style: sectionTitle() }, "记忆存储"), row("存储根目录", h$1("span", {
    			style: {
    				...mono(),
    				wordBreak: "break-all",
    				textAlign: "right"
    			},
    			title: info?.memoryDir
    		}, info === null ? "（读取中…）" : info.memoryDir)), row("目录来源", badge(info === null ? "—" : info.rootSource === "env" ? "环境变量（只读）" : info.rootSource === "config" ? "面板配置" : "默认", info?.rootSource === "env" ? "info" : "ok")), info !== null && info.rootSource === "env" ? h$1("div", { style: muted(12, 6) }, `已被 DSH_WEBDS_MEMORY_DIR 固定为 ${info.envDir ?? "—"}，面板修改不生效。`) : null, h$1("div", { style: {
    			display: "flex",
    			alignItems: "center",
    			gap: "8px",
    			flexWrap: "wrap",
    			marginTop: "10px"
    		} }, h$1("span", { style: {
    			fontSize: "13px",
    			flex: "0 0 auto"
    		} }, "记忆别名"), h$1("input", {
    			type: "text",
    			value: aliasDraft,
    			disabled,
    			placeholder: "progress 或 projects/xxx",
    			onChange: (event) => {
    				setAliasDraft(event.target.value);
    			},
    			onKeyDown: (event) => {
    				if (event.key === "Enter") applyAlias();
    			},
    			style: {
    				...inputStyle(),
    				width: "200px"
    			}
    		}), h$1("button", {
    			type: "button",
    			disabled,
    			onClick: applyAlias,
    			style: buttonStyle(disabled, false)
    		}, "使用"), info !== null && info.memories.length > 0 ? h$1("select", {
    			value: "",
    			disabled,
    			onChange: (event) => {
    				const picked = String(event.target.value ?? "");
    				if (picked.length > 0) {
    					setAliasDraft(picked);
    					deps.setMemoryKey(picked);
    					setNotice({
    						tone: "info",
    						text: `已切换记忆别名：${picked}`
    					});
    					refreshMemoryInfo();
    				}
    			},
    			style: inputStyle()
    		}, h$1("option", { value: "" }, `已有记忆（${info.memories.length}）`), ...info.memories.map((memory) => h$1("option", {
    			key: memory.key,
    			value: memory.key
    		}, `${memory.key}（${Math.max(1, Math.round(memory.bytes / 1024))}KB）`))) : null), h$1("div", { style: muted(12, 6) }, `当前别名：${info?.activeKey ?? "—"}；保存与注入都作用于该文件。留空则用 progress。`), h$1("div", { style: {
    			display: "flex",
    			gap: "8px",
    			marginTop: "8px",
    			flexWrap: "wrap"
    		} }, h$1("button", {
    			type: "button",
    			disabled,
    			onClick: () => {
    				(async () => {
    					try {
    						const key = aliasDraft.trim().length > 0 ? aliasDraft.trim() : "progress";
    						const memory = await deps.readMemory(key);
    						setPreview({
    							key: memory.key,
    							chars: memory.content.length,
    							head: memory.content.slice(0, 240)
    						});
    						setNotice(memory.content.length > 0 ? {
    							tone: "ok",
    							text: `已读取 ${memory.key}（${memory.content.length} 字符）`
    						} : {
    							tone: "info",
    							text: `${memory.key} 还不存在或为空`
    						});
    					} catch (error) {
    						setPreview(null);
    						setNotice({
    							tone: "err",
    							text: `读取失败：${errorText$1(error)}`
    						});
    					}
    				})();
    			},
    			style: buttonStyle(disabled, false)
    		}, "预览")), preview === null ? null : h$1("pre", {
    			key: "preview",
    			style: {
    				marginTop: "8px",
    				maxHeight: "120px",
    				overflow: "auto",
    				padding: "8px 10px",
    				borderRadius: "var(--dsw-radius-sm, 8px)",
    				border: "0.5px solid var(--dsw-alias-border-l3, #e5e7eb)",
    				fontSize: "11px",
    				lineHeight: 1.5,
    				whiteSpace: "pre-wrap",
    				color: "var(--dsw-alias-label-secondary, #6b7280)"
    			}
    		}, `${preview.key} · ${preview.chars} 字符\n\n${preview.head}${preview.chars > 240 ? "\n…" : ""}`)), h$1("div", { style: card() }, h$1("div", { style: sectionTitle() }, "更换存储目录"), h$1("div", { style: {
    			display: "flex",
    			alignItems: "center",
    			gap: "8px",
    			flexWrap: "wrap"
    		} }, h$1("span", { style: {
    			fontSize: "13px",
    			flex: "0 0 auto"
    		} }, "新目录"), h$1("input", {
    			type: "text",
    			value: migrateDraft,
    			disabled: disabled || info?.rootSource === "env",
    			placeholder: "例如 D:\\notes\\dsh_memory",
    			onChange: (event) => {
    				setMigrateDraft(event.target.value);
    				setRootDraft(event.target.value);
    			},
    			style: {
    				...inputStyle(),
    				width: "260px"
    			}
    		})), h$1("div", { style: {
    			display: "flex",
    			gap: "8px",
    			marginTop: "10px",
    			flexWrap: "wrap"
    		} }, h$1("button", {
    			type: "button",
    			disabled: disabled || info?.rootSource === "env",
    			onClick: () => {
    				run("migrate", "迁移", async () => {
    					const target = migrateDraft.trim();
    					if (target.length === 0) throw new Error("请填写新目录");
    					const result = await deps.migrate(target, info?.memoryDir);
    					setMigrateState(result);
    					await refreshMemoryInfo();
    					if (result.ok) {
    						setRootDraft(result.to);
    						setNotice({
    							tone: "ok",
    							text: `迁移完成：复制 ${result.copied} 个、跳过 ${result.skipped} 个`
    						});
    						return { ok: true };
    					}
    					setNotice({
    						tone: "err",
    						text: `迁移未完成：${result.failed.slice(0, 3).join("；")}`
    					});
    					return {
    						ok: false,
    						message: "部分文件校验失败"
    					};
    				});
    			},
    			style: buttonStyle(disabled || info?.rootSource === "env", busy === "migrate")
    		}, busy === "migrate" ? "迁移中…" : "迁移并切换"), h$1("button", {
    			type: "button",
    			disabled: disabled || info?.rootSource === "env",
    			onClick: () => {
    				run("root", "切换目录", async () => {
    					const target = migrateDraft.trim();
    					if (target.length === 0) throw new Error("请填写新目录");
    					const result = await deps.setRoot(target);
    					await refreshMemoryInfo();
    					setRootDraft(result.memoryDir);
    					return { ok: true };
    				});
    			},
    			style: buttonStyle(disabled || info?.rootSource === "env", busy === "root")
    		}, busy === "root" ? "切换中…" : "仅切换（不迁移）")), h$1("div", { style: muted(12, 6) }, "「迁移并切换」会复制 progress.md、projects/ 与 history/ 到新目录并逐文件校验，旧文件保留不删；「仅切换」直接改指针。两者都写入 config.json，重启后仍生效。"), migrateState === null ? null : h$1("div", {
    			key: "migrate-status",
    			style: {
    				marginTop: "10px",
    				fontSize: "12px",
    				lineHeight: 1.6,
    				color: migrateState.ok ? "var(--dsw-alias-state-success-primary, #16a34a)" : "var(--dsw-alias-state-error-primary, #dc2626)"
    			}
    		}, [
    			`${migrateState.ok ? "✔ 迁移成功" : "✖ 迁移有失败项"}  ${migrateState.from} → ${migrateState.to}`,
    			`复制 ${migrateState.copied} 个 · 跳过 ${migrateState.skipped} 个 · 失败 ${migrateState.failed.length} 个`,
    			migrateState.configWritten ? "已写入新目录 config.json（重启后沿用）" : "未写入配置",
    			migrateState.failed.length > 0 ? `失败项：${migrateState.failed.slice(0, 5).join("；")}` : ""
    		].filter((line) => line.length > 0).join("\n"))));
    	};
    }
    function card() {
    	return {
    		border: "0.5px solid var(--dsw-alias-border-l2, #e5e7eb)",
    		borderRadius: "var(--dsw-radius-md, 12px)",
    		padding: "12px 14px"
    	};
    }
    function sectionTitle() {
    	return {
    		fontSize: "13px",
    		fontWeight: 600,
    		marginBottom: "10px",
    		color: "var(--dsw-alias-label-primary, #111827)"
    	};
    }
    function muted(size = 12, marginTop = 0) {
    	return {
    		fontSize: `${size}px`,
    		lineHeight: 1.5,
    		marginTop: `${marginTop}px`,
    		color: "var(--dsw-alias-label-secondary, #6b7280)"
    	};
    }
    function mono() {
    	return {
    		fontSize: "12px",
    		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    		color: "var(--dsw-alias-label-primary, #111827)"
    	};
    }
    function row(label, value) {
    	return h$1("div", {
    		key: label,
    		style: {
    			display: "flex",
    			alignItems: "center",
    			justifyContent: "space-between",
    			gap: "12px",
    			padding: "5px 0",
    			borderBottom: "0.5px solid var(--dsw-alias-border-l3, #f1f2f4)"
    		}
    	}, h$1("span", { style: {
    		fontSize: "13px",
    		flex: "0 0 auto",
    		color: "var(--dsw-alias-label-primary, #111827)"
    	} }, label), h$1("span", { style: {
    		fontSize: "12px",
    		textAlign: "right"
    	} }, value));
    }
    function badge(label, tone) {
    	const palette = tone === "ok" ? {
    		color: "var(--dsw-alias-state-success-primary, #16a34a)",
    		border: "var(--dsw-alias-state-success-primary, #16a34a)",
    		bg: "var(--dsw-alias-state-success-tertiary, #dcfce7)"
    	} : tone === "err" ? {
    		color: "var(--dsw-alias-state-error-primary, #dc2626)",
    		border: "var(--dsw-alias-state-error-primary, #dc2626)",
    		bg: "var(--dsw-alias-interactive-bg-hover-danger, #fee2e2)"
    	} : {
    		color: "var(--dsw-alias-label-secondary, #6b7280)",
    		border: "var(--dsw-alias-border-l4, #d1d5db)",
    		bg: "var(--dsw-alias-interactive-bg-hover, transparent)"
    	};
    	return h$1("span", { style: {
    		fontSize: "12px",
    		lineHeight: "18px",
    		padding: "0 8px",
    		borderRadius: "999px",
    		color: palette.color,
    		background: palette.bg,
    		border: `0.5px solid ${palette.border}`
    	} }, label);
    }
    function barTrack() {
    	return {
    		height: "4px",
    		borderRadius: "2px",
    		background: "var(--dsw-alias-interactive-bg-hover, #f1f2f4)",
    		overflow: "hidden",
    		margin: "6px 0 2px"
    	};
    }
    function barFill(ratio, warn) {
    	return {
    		width: `${Math.round(ratio * 100)}%`,
    		height: "100%",
    		background: warn ? "var(--dsw-alias-state-warn-primary, #f59e0b)" : "var(--dsw-alias-brand-primary, #3b82f6)",
    		transition: "width 240ms ease"
    	};
    }
    /**
    
    * 按钮配色，完全照官方 settings-models 的写法：
    
    *   secondary —— 无填充 + 0.5px 边框 + label-primary 文字（随主题反色）
    
    *   active    —— button-primary-fill 填充 + label-primary-foreground 文字（深色下是浅字压深底）
    
    * 关键：不要写死 background/color，也不要用 `color: inherit`——
    
    * 深色主题下 inherit 会继承到浅色，叠在浅底上就是白底白字。
    
    */
    function buttonStyle(disabled, active) {
    	return {
    		fontSize: "13px",
    		lineHeight: "28px",
    		padding: "0 12px",
    		fontFamily: "inherit",
    		borderRadius: "var(--dsw-radius-sm, 8px)",
    		cursor: disabled ? "default" : "pointer",
    		opacity: disabled ? .5 : 1,
    		border: "0.5px solid var(--dsw-alias-border-l3, #e5e7eb)",
    		background: active ? "var(--dsw-alias-button-primary-fill, #4176e6)" : "transparent",
    		color: active ? "var(--dsw-alias-label-primary-foreground, #ffffff)" : "var(--dsw-alias-label-primary, #111827)",
    		transition: "background-color .12s, border-color .12s, color .12s"
    	};
    }
    function inputStyle() {
    	return {
    		width: "140px",
    		fontSize: "13px",
    		lineHeight: "26px",
    		padding: "0 8px",
    		fontFamily: "inherit",
    		borderRadius: "var(--dsw-radius-sm, 8px)",
    		border: "0.5px solid var(--dsw-alias-border-l3, #e5e7eb)",
    		background: "var(--dsw-alias-bg-layer-1, transparent)",
    		color: "var(--dsw-alias-label-primary, #111827)",
    		colorScheme: "light dark"
    	};
    }
    
    //#endregion
    //#region src/client/ui/HeaderToolbar.ts
    const h = react.createElement;
    /** 三个高频操作的紧凑定义。 */
    const ACTIONS = [
    	{
    		key: "save",
    		short: "存记忆",
    		tip: "保存记忆：总结当前网页版对话并写入 progress.md",
    		run: (deps) => deps.saveMemory()
    	},
    	{
    		key: "execute",
    		short: "执行",
    		tip: "执行注入：把 progress.md 作为用户消息投递到当前主会话",
    		run: (deps) => deps.execute()
    	},
    	{
    		key: "auto",
    		short: "续接",
    		tip: "强制自动续接：总结 → 新建对话 → 发送续接 Prompt（跳过阈值检查）",
    		run: (deps) => deps.autoContinue()
    	}
    ];
    function errorText(error) {
    	if (error instanceof Error) return error.message;
    	const message = error?.message;
    	return typeof message === "string" && message.length > 0 ? message : String(error);
    }
    /**
    
    * 构造工具栏组件。
    
    * @param deps 与设置页共用的行为注入。
    
    * @returns 无 props 的 React 函数组件。
    
    */
    function createHeaderToolbar(deps) {
    	return function WebdsHeaderToolbar() {
    		const [busy, setBusy] = react.useState(null);
    		const [notice, setNotice] = react.useState(null);
    		const lockedRef = react.useRef(false);
    		const run = async (action) => {
    			if (lockedRef.current) return;
    			lockedRef.current = true;
    			setBusy(action.key);
    			setNotice(null);
    			try {
    				const result = await action.run(deps);
    				const ok = result?.ok !== false;
    				setNotice(ok ? {
    					tone: "ok",
    					text: `${action.short}完成`
    				} : {
    					tone: "err",
    					text: `${action.short}失败：${result?.message ?? "未知原因"}`
    				});
    			} catch (error) {
    				setNotice({
    					tone: "err",
    					text: `${action.short}失败：${errorText(error)}`
    				});
    			} finally {
    				lockedRef.current = false;
    				setBusy(null);
    			}
    		};
    		const disabled = busy !== null;
    		return h("div", {
    			style: {
    				display: "flex",
    				alignItems: "center",
    				gap: "4px",
    				flex: "none"
    			},
    			"data-webds-toolbar": "1"
    		}, ...ACTIONS.map((action) => h("button", {
    			key: action.key,
    			type: "button",
    			title: action.tip,
    			"aria-label": action.tip,
    			disabled,
    			onClick: () => {
    				run(action);
    			},
    			style: {
    				fontSize: "12px",
    				lineHeight: "22px",
    				padding: "0 8px",
    				fontFamily: "inherit",
    				whiteSpace: "nowrap",
    				borderRadius: "var(--dsw-radius-sm, 8px)",
    				border: "0.5px solid var(--dsw-alias-border-l3, #e5e7eb)",
    				background: busy === action.key ? "var(--dsw-alias-button-primary-fill, #4176e6)" : "transparent",
    				color: busy === action.key ? "var(--dsw-alias-label-primary-foreground, #ffffff)" : "var(--dsw-alias-label-primary, #111827)",
    				cursor: disabled ? "default" : "pointer",
    				opacity: disabled && busy !== action.key ? .5 : 1,
    				transition: "background-color .12s, color .12s, opacity .12s"
    			}
    		}, busy === action.key ? `${action.short}…` : action.short)), notice === null ? null : h("span", {
    			key: "notice",
    			title: notice.text,
    			style: {
    				fontSize: "11px",
    				lineHeight: "20px",
    				maxWidth: "180px",
    				overflow: "hidden",
    				textOverflow: "ellipsis",
    				whiteSpace: "nowrap",
    				marginLeft: "2px",
    				color: notice.tone === "ok" ? "var(--dsw-alias-state-success-primary, #16a34a)" : "var(--dsw-alias-state-error-primary, #dc2626)"
    			}
    		}, notice.text));
    	};
    }
    
    //#endregion
    //#region src/client-entry.ts
    /**
    
    * 插件名与包名保持一致。
    
    *
    
    * 单包发布后 Host 与 Client 共用包名 `dsh-webds-bridge`；客户端 bundle 的
    
    * `__ModuleLoader__.load({ id })` 也必须用这个全名（见 scripts/wrap-client-bundle.mjs），
    
    * 否则 dsh-client-modules 按包名找不到对应模块。
    
    */
    const name = "dsh-webds-bridge";
    /**
    
    * Injected dependencies。
    
    *
    
    * `slots` 用于把设置页面板注册进 `settings.section`。声明后 Cordis 会等该服务就绪再
    
    * 运行 apply；拿不到服务时插件不会静默半启动。
    
    */
    const inject = ["slots", "sessions"];
    /**
    
    * Plugin apply function
    
    * @param ctx - Client context
    
    */
    function createComposerConfig(deps) {
    	const h = react.createElement;
    	const styles = {
    		trigger: {
    			display: "inline-flex",
    			alignItems: "center",
    			gap: "6px",
    			height: "28px",
    			padding: "0 10px",
    			borderRadius: "999px",
    			border: "1px solid var(--dsw-alias-border-l2, #3a3a3a)",
    			background: "transparent",
    			color: "inherit",
    			cursor: "pointer",
    			fontSize: "12px",
    			whiteSpace: "nowrap"
    		},
    		dot: {
    			width: "7px",
    			height: "7px",
    			borderRadius: "50%",
    			flex: "none"
    		},
    		dialog: {
    			position: "fixed",
    			inset: "0",
    			margin: "auto",
    			width: "460px",
    			maxWidth: "calc(100vw - 32px)",
    			height: "fit-content",
    			maxHeight: "calc(100vh - 48px)",
    			overflow: "auto",
    			padding: "16px",
    			border: "1px solid var(--dsw-alias-border-l2, #3a3a3a)",
    			borderRadius: "12px",
    			background: "var(--dsw-alias-bg-layer-1, #1e1e1e)",
    			color: "var(--dsw-alias-label-primary, #eee)",
    			boxShadow: "0 18px 60px rgba(0,0,0,.35)"
    		},
    		row: {
    			display: "flex",
    			alignItems: "center",
    			gap: "8px",
    			margin: "8px 0",
    			flexWrap: "wrap"
    		},
    		label: {
    			color: "var(--dsw-alias-label-secondary, #aaa)",
    			fontSize: "12px",
    			minWidth: "76px"
    		},
    		input: {
    			height: "26px",
    			padding: "0 8px",
    			borderRadius: "6px",
    			border: "1px solid var(--dsw-alias-border-l2, #3a3a3a)",
    			background: "var(--dsw-alias-bg-layer-2, #262626)",
    			color: "inherit",
    			fontSize: "12px",
    			flex: "1",
    			minWidth: "180px"
    		},
    		button: {
    			height: "26px",
    			padding: "0 10px",
    			borderRadius: "6px",
    			border: "1px solid var(--dsw-alias-border-l2, #3a3a3a)",
    			background: "transparent",
    			color: "inherit",
    			cursor: "pointer",
    			fontSize: "12px"
    		},
    		error: {
    			color: "var(--dsw-alias-state-error-primary, #ff6b6b)",
    			fontSize: "12px",
    			wordBreak: "break-all"
    		},
    		hint: {
    			color: "var(--dsw-alias-label-tertiary, #888)",
    			fontSize: "12px",
    			wordBreak: "break-all"
    		}
    	};
    	return function WebdsComposerConfig(props) {
    		const [open, setOpen] = react.useState(false);
    		const [config, setConfig] = react.useState(() => ({ ...browserConfig }));
    		const [status, setStatus] = react.useState(null);
    		const [sidebar, setSidebar] = react.useState(null);
    		const [busy, setBusy] = react.useState(false);
    		const [error, setError] = react.useState("");
    		const [hostReady, setHostReady] = react.useState(false);
    		const [testNotice, setTestNotice] = react.useState("");
    		const [webActive, setWebActive] = react.useState(false);
    		const [autoActive, setAutoActive] = react.useState(false);
    		const dialogRef = react.useRef(null);
    		react.useEffect(() => {
    			if (open) {
    				const dialog = dialogRef.current;
    				if (dialog && dialog.open !== true) try {
    					dialog.showModal();
    				} catch {}
    			}
    		}, [open]);
    		const refresh = async () => {
    			try {
    				const info = await deps.getInfo();
    				const ready = !!(info && info.browser);
    				setHostReady(ready);
    				if (info && info.browser) setConfig(info.browser);
    				setStatus(await deps.status());
    				setSidebar(deps.sidebarStatus());
    				setWebActive(deps.isWebActive(deps.getSessionId()));
    				setAutoActive(deps.isAutoSource(deps.getSessionId()));
    				setError(ready ? "" : "Host 端仍是旧版本：请从托盘完全退出 DSH 再重新打开（Ctrl+R 只刷新页面，不够）");
    			} catch (reason) {
    				setHostReady(false);
    				setError("Host 端仍是旧版本：请从托盘完全退出 DSH 再重新打开（Ctrl+R 只刷新页面，不够）");
    			}
    		};
    		react.useEffect(() => {
    			refresh();
    		}, []);
    		const save = async (patch) => {
    			setBusy(true);
    			setError("");
    			try {
    				const next = await deps.setBrowser(patch);
    				setConfig(next);
    				setStatus(await deps.status());
    			} catch (reason) {
    				const message = String(reason?.message ?? reason);
    				setError(/unknown-endpoint|unknown endpoint/iu.test(message) ? "Host 端未加载新版本：请从托盘完全退出 DSH 再重新打开" : message);
    			} finally {
    				setBusy(false);
    			}
    		};
    		const pick = async (kind) => {
    			setBusy(true);
    			setError("");
    			try {
    				const picked = await (kind === "file" ? deps.pickFile() : deps.pickDirectory());
    				if (picked) await save(kind === "file" ? { browserPath: picked } : { userDataDir: picked });
    			} catch (reason) {
    				const message = String(reason?.message ?? reason);
    				setError(/unknown-endpoint|unknown endpoint/iu.test(message) ? "Host 端未加载新版本：请从托盘完全退出 DSH 再重新打开" : message);
    			} finally {
    				setBusy(false);
    			}
    		};
    		const closeDialog = () => {
    			const dialog = dialogRef.current;
    			if (dialog && dialog.open === true) try {
    				dialog.close();
    			} catch {}
    			setOpen(false);
    		};
		const enabled = config.enabled !== false;
		const standalone = config.mode === "standalone";
		const dotColor = !enabled ? "#666" : webActive ? "#22c55e" : standalone ? (status?.open ? "#4d6bfe" : "#888") : (sidebar?.found ? "#4d6bfe" : "#888");
		const statusText = !enabled ? "已关闭" : standalone ? (status === null ? "读取中…" : status.open ? "运行中 · " + (status.href || "") : "未启动") : sidebar === null ? "读取中…" : sidebar.found ? "已打开 · " + (sidebar.href || "") : "侧边栏未打开";
		const openStandalone = async () => {
			setBusy(true);
			try {
				setStatus(await deps.open());
				setError("");
			} catch (reason) {
				const message = String(reason?.message ?? reason);
				setError(/unknown-endpoint|unknown endpoint/iu.test(message) ? "Host 端未加载新版本：请从托盘完全退出 DSH 再重新打开" : message);
			} finally {
				setBusy(false);
			}
		};
		const closeStandalone = async () => {
			setBusy(true);
			try {
				await deps.close();
				setStatus(await deps.status());
				setError("");
			} catch (reason) {
				setError(String(reason?.message ?? reason));
			} finally {
				setBusy(false);
			}
		};
		const openSidebar = async () => {
			setBusy(true);
			try {
				await deps.openSidebar();
				setSidebar(deps.sidebarStatus());
				setTestNotice("已请求打开侧边栏 Browser tab");
				setError("");
			} catch (reason) {
				setError(String(reason?.message ?? reason));
			} finally {
				setBusy(false);
			}
		};
﻿		const closeSidebar = async () => {
			setBusy(true);
			try {
				await deps.closeSidebar();
				setSidebar(deps.sidebarStatus());
				setTestNotice("已关闭侧边栏 Browser tab");
				setError("");
			} catch (reason) {
				setError(String(reason?.message ?? reason));
			} finally {
				setBusy(false);
			}
		};
﻿		const toggleWeb = async (next) => {
			const sessionId = deps.getSessionId();
			if (!sessionId) {
				setError("无法确定当前对话 ID，无法切换网页版");
				return;
			}
			deps.setSessionWebActive(sessionId, next);
			setWebActive(next);
			if (!next) {
				deps.setSessionAutoSource(sessionId, false);
				setAutoActive(false);
			}
			setError("");
		};
		const toggleAutoSource = async (next) => {
			const sessionId = deps.getSessionId();
			if (!sessionId) {
				setError("无法确定当前对话 ID，无法切换自动对话源");
				return;
			}
			if (!webActive) {
				setError("请先启用网页版，再开启自动对话源");
				setAutoActive(false);
				return;
			}
			deps.setSessionAutoSource(sessionId, next);
			setAutoActive(next);
			setError("");
		};
		const runBridgeTest = async () => {
			setBusy(true);
			setTestNotice("测试中：正在通过网页版发送测试消息…");
			try {
				const result = await deps.test();
				setTestNotice(result && result.ok === true ? "测试成功：网页版已返回回复" : "测试失败：" + String(result?.message ?? "未返回结果"));
			} catch (reason) {
				setTestNotice("测试失败：" + String(reason?.message ?? reason));
			} finally {
				setBusy(false);
			}
		};
		const standaloneRows = [
			h("div", { style: styles.row }, h("span", { style: styles.label }, "无头模式"), h("input", {
				type: "checkbox",
				checked: config.headless !== false,
				disabled: busy || !enabled,
				onChange: (event) => save({ headless: event.target.checked })
			}), h("span", { style: styles.hint }, "关闭后会显示独立浏览器窗口")),
			h("div", { style: styles.row }, h("span", { style: styles.label }, "浏览器"), h("input", {
				type: "text",
				value: config.browserPath ?? "",
				placeholder: "留空自动探测 Edge/Chrome",
				disabled: busy || !enabled,
				onChange: (event) => {
					const value = event.target.value;
					setConfig((current) => ({ ...current, browserPath: value }));
				},
				onBlur: (event) => save({ browserPath: event.target.value }),
				style: styles.input
			}), h("button", { type: "button", disabled: busy || !enabled, onClick: () => pick("file"), style: styles.button }, "选择…")),
			h("div", { style: styles.row }, h("span", { style: styles.label }, "User Data"), h("input", {
				type: "text",
				value: config.userDataDir ?? "",
				placeholder: "默认：" + (browserProfileDefault || "$DSH_HOME/dsh_webds_browser"),
				disabled: busy || !enabled,
				onChange: (event) => {
					const value = event.target.value;
					setConfig((current) => ({ ...current, userDataDir: value }));
				},
				onBlur: (event) => save({ userDataDir: event.target.value }),
				style: styles.input
			}), h("button", { type: "button", disabled: busy || !enabled, onClick: () => pick("directory"), style: styles.button }, "选择…")),
			h("div", { style: styles.row }, h("span", { style: styles.label }, "最大并发"), h("input", {
				type: "number",
				min: 1,
				max: 10,
				value: config.maxConcurrency ?? 3,
				disabled: busy || !enabled,
				onChange: (event) => {
					const value = Number(event.target.value);
					setConfig((current) => ({ ...current, maxConcurrency: value }));
					scheduleSave({ maxConcurrency: value });
				},
				onBlur: (event) => flushSave({ maxConcurrency: Number(event.target.value) }),
				style: { ...styles.input, flex: "0 0 80px" }
			}), h("span", { style: styles.hint }, "1–10，默认 3")),
			h("div", { style: styles.row }, h("span", { style: styles.label }, "状态"), h("span", { style: styles.hint }, statusText)),
			h("div", { style: styles.row },
				h("button", { type: "button", disabled: busy || !enabled || !hostReady, onClick: openStandalone, style: styles.button }, "打开独立浏览器"),
				h("button", { type: "button", disabled: busy, onClick: closeStandalone, style: styles.button }, "关闭浏览器"),
				h("button", { type: "button", disabled: busy || !enabled || !hostReady, onClick: runBridgeTest, style: styles.button }, "测试网页桥接")
			)
		];
		const sidebarRows = [
			h("div", { style: styles.row }, h("span", { style: styles.label }, "状态"), h("span", { style: styles.hint }, statusText)),
			h("div", { style: styles.row }, h("span", { style: styles.hint }, "侧边栏模式在右侧 Browser tab 中登录 DeepSeek；不启动独立浏览器，也不读取独立浏览器的路径/User Data 配置。")),
			h("div", { style: styles.row },
				h("button", { type: "button", disabled: busy || !enabled || !hostReady, onClick: openSidebar, style: styles.button }, "打开侧边栏"),
				h("button", { type: "button", disabled: busy || !enabled || !hostReady || !sidebar?.found, onClick: closeSidebar, style: styles.button }, "关闭侧边栏"),
				h("button", { type: "button", disabled: busy || !enabled || !hostReady, onClick: runBridgeTest, style: styles.button }, "测试网页桥接")
			)
		];
		return h(react.Fragment, null, h("button", {
			type: "button",
			title: "网页版桥接设置",
			disabled: props.locked === true,
			onClick: () => {
				if (open) closeDialog();
				else {
					refresh();
					setOpen(true);
				}
			},
			style: styles.trigger
		}, h("span", { style: { ...styles.dot, background: dotColor } }), "网页版", h("span", { style: { opacity: 0.75 } }, enabled ? "" : "关")), h("dialog", {
			ref: dialogRef,
			onClose: () => setOpen(false),
			onCancel: () => setOpen(false),
			style: styles.dialog
		}, h("div", {
			style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }
		}, h("strong", null, "网页版桥接设置"), h("button", { type: "button", onClick: closeDialog, style: styles.button }, "关闭")), h("div", { style: styles.row }, h("span", { style: styles.label }, "启用网页版"), h("input", { type: "checkbox", checked: webActive, disabled: busy || !hostReady, onChange: (event) => toggleWeb(event.target.checked) }), h("span", { style: styles.hint }, webActive ? "已启用：隐藏模型选择，当前对话使用网页版" : "已关闭：显示模型选择")), h("div", { style: styles.row }, h("span", { style: styles.label }, "自动对话源"), h("input", { type: "checkbox", checked: autoActive, disabled: busy || !hostReady || !webActive, onChange: (event) => toggleAutoSource(event.target.checked) }), h("span", { style: styles.hint }, autoActive ? "已开启：自动对话源（独立开关）" : "独立开关；需先启用网页版")), h("div", { style: styles.row }, h("span", { style: styles.hint }, "测试状态：网页版=" + (webActive ? "开" : "关") + "；自动对话源=" + (autoActive ? "开" : "关") + "；模型选择=" + (webActive ? "隐藏" : "显示"))), h("div", {
			style: styles.row
		}, h("span", { style: styles.label }, "运行位置"), h("select", {
			value: config.mode ?? "sidebar",
			disabled: busy || !hostReady,
			onChange: (event) => save({ mode: event.target.value }),
			style: { ...styles.input, flex: "0 0 180px" }
		}, h("option", { value: "sidebar" }, "侧边栏 Browser tab"), h("option", { value: "standalone" }, "独立浏览器"))), ...(standalone ? standaloneRows : sidebarRows), testNotice ? h("div", { style: styles.hint }, testNotice) : null, error ? h("div", { style: styles.error }, error) : null, busy ? h("div", { style: styles.hint }, "处理中…") : null));

    	};
    }

    function apply(ctx) {
    	console.log("[Dsh Webds Bridge] Client plugin loaded");
    	console.log("[webds] build=", BUILD_TAG);
    	const carrier = globalThis.dshDesktop;
    	if (carrier?.protocolVersion !== 1) console.warn("[webds] no desktop bridge, protocolVersion=", carrier?.protocolVersion);
    	else {
    		const bridge = carrier.browser;
    		console.log("[webds] bridge ok, keys=", Object.keys(bridge));
    		console.log("[webds] acquire type=", typeof bridge?.acquire, "release type=", typeof bridge?.release);
    	}
    	setTurnCompleteHandler(() => maybeAutoContinue(ctx));
    	const runTest = async () => {
    		console.log("--- 开始 DOM 测试 ---");
    		try {
    			const result = await runDomTest(ctx, TEST_PROMPT);
    			if (result.ok) {
    				console.log("[webds] 测试成功，回复 Markdown 如下：");
    				console.log(result.replyMarkdown);
    				console.log("[webds] codeBlocks=", result.codeBlocks);
    			} else {
    				console.warn("[webds] 测试未完成：stage=", result.stage, "message=", result.message);
    				console.log("[webds] 诊断(JSON)=\n" + JSON.stringify(result, null, 2));
    				console.log("[webds] 诊断(raw)=", result);
    			}
    			return result;
    		} catch (error) {
    			console.error("[webds] 测试异常=", error);
    			return {
    				ok: false,
    				stage: "error",
    				message: String(error?.message ?? error)
    			};
    		} finally {
    			console.log("--- DOM 测试结束 ---");
    		}
    	};
    	const runSave = async () => {
    		console.log("--- 开始保存记忆 ---");
    		try {
    			const result = await saveMemory(ctx);
    			if (result.ok) {
    				console.log("[webds] 保存成功:", result.host);
    				console.log("[webds] 字符数:", result.chars, "原始:", result.originalChars, "截断:", result.truncated);
    				console.log("[webds] 已保存内容:\n" + String(result.summary ?? ""));
    			} else {
    				console.warn("[webds] 保存未完成：", result.stage, result.message);
    				console.log("[webds] 诊断=", result);
    			}
    			return result;
    		} catch (error) {
    			console.error("[webds] 保存异常=", error);
    			return {
    				ok: false,
    				stage: "error",
    				message: String(error?.message ?? error)
    			};
    		} finally {
    			console.log("--- 保存记忆完成 ---");
    		}
    	};
    	window.__webds_test__ = runTest;
    	window.__webds_save_memory__ = runSave;
    	window.__webds_execute__ = async () => {
    		console.log("--- 开始执行注入 ---");
    		try {
    			const result = await executeMemory(ctx);
    			if (result.ok) {
    				console.log("[webds] 执行注入成功:", result.host);
    				console.log("[webds] sessionId=", result.sessionId);
    			} else console.warn("[webds] 执行注入未完成：", result.stage, result.message);
    			return result;
    		} catch (error) {
    			console.error("[webds] 执行注入异常=", error);
    			return {
    				ok: false,
    				stage: "error",
    				message: String(error?.message ?? error)
    			};
    		} finally {
    			console.log("--- 执行注入结束 ---");
    		}
    	};
    	window.__webds_test_auto_continue__ = async () => {
    		console.log("--- 强制触发自动续接 ---");
    		const threshold = getTokenThreshold();
    		setCurrentTokens(Math.floor(threshold * .9) + 1);
    		console.log("[webds] forced tokens =", Math.round(getCurrentTokens()), "/", threshold);
    		try {
    			const result = await forceAutoContinue(ctx);
    			console.log("[webds] 自动续接结果=", JSON.stringify(result));
    			return result;
    		} catch (error) {
    			console.error("[webds] 自动续接异常=", error);
    			return {
    				ok: false,
    				stage: "error",
    				message: String(error?.message ?? error)
    			};
    		} finally {
    			console.log("--- 自动续接结束 ---");
    		}
    	};
    	window.__webds_token_status__ = () => {
    		const status = {
    			current: Math.round(getCurrentTokens()),
    			threshold: getTokenThreshold(),
    			ratio: getCurrentTokens() / getTokenThreshold()
    		};
    		console.log("[webds] token status=", status);
    		return status;
    	};
    	window.__webds_set_token_threshold__ = (value) => {
    		const next = setTokenThreshold(Number(value));
    		console.log("[webds] token threshold =", next);
    		return next;
    	};
    	window.__webds_memory_key__ = (key) => {
    		if (typeof key === "string" && key.trim().length > 0) {
    			setMemoryKey(key);
    			console.log("[webds] 记忆别名 ->", getMemoryKey());
    		}
    		console.log("[webds] 当前记忆别名 =", getMemoryKey());
    		return getMemoryKey();
    	};
    	window.__webds_memory_info__ = async () => {
    		const info = await callWebdsRpc(ctx, "info");
    		console.log("[webds] memory info=", info);
    		return info;
    	};
    	window.__webds_memory_list__ = async () => {
    		const result = await callWebdsRpc(ctx, "list");
    		console.log("[webds] memory list=", result);
    		return result;
    	};
    	window.__webds_test_and_save__ = async () => {
    		console.log("--- 开始 测试并保存 ---");
    		const tested = await runTest();
    		if (!tested || tested.ok !== true) {
    			console.warn("[webds] 测试未成功，跳过保存");
    			return tested;
    		}
    		return await runSave();
    	};
    	window.__webds_open__ = async () => {
    		try {
    			await refreshBrowserConfig(ctx);
    			if (browserConfig.mode === "standalone") {
    				const info = await callWebdsRpc(ctx, "browserOpen", {}, 18e4);
    				console.log("[webds] standalone open ok:", JSON.stringify(info));
    				return { ok: true, mode: "standalone", browser: info };
    			}
    			await openChatTab(ctx);
    			const info = debugWebviews();
    			console.log("[webds] open ok:", JSON.stringify(info));
    			return info;
    		} catch (error) {
    			console.error("[webds] open 失败=", error);
    			return {
    				ok: false,
    				message: String(error?.message ?? error),
    				debug: debugWebviews()
    			};
    		}
    	};
    	window.__webds_debug__ = () => {
    		const info = debugWebviews();
    		console.log("[webds] debug=", JSON.stringify(info, null, 2));
    		return info;
    	};
    	const WEB_ACTIVE_KEY = "webds.activeSessions";
    	const readActiveSessions = () => {
    		try {
    			const parsed = JSON.parse(localStorage.getItem(WEB_ACTIVE_KEY) || "[]");
    			return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === "string")) : new Set();
    		} catch {
    			return new Set();
    		}
    	};
    	const writeActiveSessions = (set) => {
    		try {
    			localStorage.setItem(WEB_ACTIVE_KEY, JSON.stringify([...set]));
    		} catch {}
    	};
﻿    	const WEB_AUTO_KEY = "webds.autoSourceSessions";
    	const readAutoSessions = () => {
    		try {
    			const parsed = JSON.parse(localStorage.getItem(WEB_AUTO_KEY) || "[]");
    			return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === "string")) : new Set();
    		} catch {
    			return new Set();
    		}
    	};
    	const writeAutoSessions = (set) => {
    		try {
    			localStorage.setItem(WEB_AUTO_KEY, JSON.stringify([...set]));
    		} catch {}
    	};
    	const setSessionAutoSource = (sessionId, active) => {
    		if (sessionId.length === 0) return;
    		const set = readAutoSessions();
    		if (active) set.add(sessionId);
    		else set.delete(sessionId);
    		writeAutoSessions(set);
    	};
    	const getCurrentSessionId = () => {
    		return String(document.querySelector('[data-conversation-region="chat"]')?.getAttribute?.("data-conversation-session") ?? "");
    	};
    	const syncWebClasses = () => {
    		const active = readActiveSessions();
    		const current = getCurrentSessionId();
    		for (const root of document.querySelectorAll("[data-conversation-session]")) {
    			const id = String(root.getAttribute("data-conversation-session") ?? "");
    			root.classList.toggle("webds-web-active", id.length > 0 && active.has(id));
    		}
    		for (const seat of document.querySelectorAll("[data-provider-id][data-model-id]")) {
    			const id = String(seat.closest?.("[data-conversation-session]")?.getAttribute?.("data-conversation-session") ?? current);
    			seat.style.display = active.has(id) ? "none" : "";
    		}
    	};
    	const readModelSeat = () => {
    		const seat = document.querySelector('[data-conversation-region="chat"] [data-provider-id][data-model-id]') || document.querySelector("[data-provider-id][data-model-id]");
    		const provider = seat?.getAttribute?.("data-provider-id");
    		const model = seat?.getAttribute?.("data-model-id");
    		return provider && model ? { provider, model } : void 0;
    	};
    	const setSessionWebActive = (sessionId, active) => {
    		if (sessionId.length === 0) return;
    		const set = readActiveSessions();
    		if (active) set.add(sessionId);
    		else set.delete(sessionId);
    		writeActiveSessions(set);
    		syncWebClasses();
    	};
    	const selectSessionModel = async (selection) => {
    		const sessions = ctx.get?.("sessions", false) ?? ctx.sessions;
    		if (sessions && typeof sessions.selectModel === "function") {
    			const result = await sessions.selectModel(selection);
    			if (result && result.ok === false) throw new Error(String(result.error?.message ?? "selectModel failed"));
    			return result;
    		}
    		const remote = ctx.get?.("remote", false) ?? ctx.remote;
    		if (remote?.session && typeof remote.session.selectModel === "function") {
    			const result = await remote.session.selectModel(selection);
    			if (result && result.ok === false) throw new Error(String(result.error?.message ?? "selectModel failed"));
    			return result;
    		}
    		throw new Error("sessions.selectModel 不可用（sessions=" + Boolean(sessions) + ", remote.session=" + Boolean(remote?.session) + "）");
    	};
    	const styleElement = document.createElement("style");
    	styleElement.id = "webds-web-source-css";
    	styleElement.textContent = ".webds-web-active [data-provider-id][data-model-id]{display:none!important}";
    	if (!document.getElementById(styleElement.id)) document.head.append(styleElement);
    	syncWebClasses();
    	let syncTimer;
    	const observer = new MutationObserver(() => {
    		clearTimeout(syncTimer);
    		syncTimer = setTimeout(syncWebClasses, 120);
    	});
    	observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-conversation-session"] });
    	ctx.effect(() => () => {
    		observer.disconnect();
    		clearTimeout(syncTimer);
    		styleElement.remove();
    	});
    	const panelDeps = {
    		buildTag: BUILD_TAG,
    		openChat: async () => {
    			await refreshBrowserConfig(ctx);
    			if (browserConfig.mode === "standalone") return await callWebdsRpc(ctx, "browserOpen", {}, 18e4);
    			await openChatTab(ctx);
    			return debugWebviews();
    		},
    		saveMemory: runSave,
    		execute: async () => {
    			const fn = window.__webds_execute__;
    			return typeof fn === "function" ? await fn() : {
    				ok: false,
    				message: "执行入口不可用"
    			};
    		},
    		autoContinue: async () => {
    			const fn = window.__webds_test_auto_continue__;
    			return typeof fn === "function" ? await fn() : {
    				ok: false,
    				message: "续接入口不可用"
    			};
    		},
    		tokenStatus: () => ({
    			current: getCurrentTokens(),
    			threshold: getTokenThreshold(),
    			ratio: getCurrentTokens() / Math.max(1, getTokenThreshold())
    		}),
    		setTokenThreshold: (value) => setTokenThreshold(Number(value)),
    		webviewStatus: () => {
    			const info = debugWebviews();
    			return {
    				href: String(info.active?.url ?? ""),
    				sessionId: String(info.sessionId ?? ""),
    				connected: info.active?.connected === true,
    				visible: info.active?.visible === true,
    				found: info.active !== null
    			};
    		},
    		memoryInfo: async () => await callWebdsRpc(ctx, "info"),
    		setMemoryKey: (key) => {
    			setMemoryKey(key);
    			console.log("[webds] 记忆别名已切换为", getMemoryKey());
    		},
    		readMemory: async (key) => await callWebdsRpc(ctx, "read", { key }),
    		setRoot: async (dir) => await callWebdsRpc(ctx, "setRoot", { memoryDir: dir }),
    		migrate: async (to, from) => await callWebdsRpc(ctx, "migrate", from === void 0 ? { to } : {
    			to,
    			from
    		})
    	};
    	const SettingsPanel = createSettingsPanel(panelDeps);
    	ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
    		name: "settings.section",
    		id: "webds-bridge",
    		order: 47,
    		label: () => "DSH 网页版桥接"
    	}, SettingsPanel)), "webds-bridge: settings page");
    	console.log("[webds] settings.section 面板已注册");
    	const HeaderToolbar = createHeaderToolbar(panelDeps);
    	ctx.effect(() => {
    		try {
    			return ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
    				name: "conversation.session.header.utilities",
    				id: "webds-bridge-toolbar",
    				order: 10,
    				label: () => "网页版桥接快捷操作"
    			}, HeaderToolbar));
    		} catch (error) {
    			console.warn("[webds] conversation.session.header.utilities 槽位不可用，快捷操作栏将不显示：", error);
    			return;
    		}
    	}, "webds-bridge: header toolbar");
    	console.log("[webds] conversation.session.header.utilities 快捷操作栏已注册");
    	const ComposerConfig = createComposerConfig({
    		getInfo: async () => await callWebdsRpc(ctx, "info"),
    		setBrowser: async (patch) => await setBrowserConfigRpc(ctx, patch),
    		status: async () => await callWebdsRpc(ctx, "browserStatus", {}, 6e4),
    		open: async () => await callWebdsRpc(ctx, "browserOpen", {}, 18e4),
    		close: async () => await callWebdsRpc(ctx, "browserClose", {}, 3e4),
    		pickFile: async () => await callWebdsRpc(ctx, "pickFile", {}, 3e5),
    		pickDirectory: async () => await callWebdsRpc(ctx, "pickDirectory", {}, 3e5),
    		test: async () => await runDomTest(ctx, TEST_PROMPT),
    		getSessionId: getCurrentSessionId,
    		readModelSeat,
    		selectModel: selectSessionModel,
    		isWebActive: (sessionId) => readActiveSessions().has(sessionId),
    		setSessionWebActive,
    		isAutoSource: (sessionId) => readAutoSessions().has(sessionId),
    		setSessionAutoSource,
    		sidebarStatus: () => {
    			const info = debugWebviews();
    			return {
    				found: info.active !== null,
    				href: String(info.active?.url ?? ""),
    				sessionId: String(info.sessionId ?? ""),
    				visible: info.active?.visible === true
    			};
    		},
    		openSidebar: async () => {
    			await openChatTab(ctx);
    			return debugWebviews();
    		},
    		closeSidebar: async () => await closeChatTab(ctx)
    	});
    	ctx.effect(() => {
    		try {
    			return ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
    				name: "conversation.input.right",
    				id: "webds-bridge-config",
    				order: 20,
    				label: () => "网页版桥接设置"
    			}, ComposerConfig));
    		} catch (error) {
    			console.warn("[webds] conversation.input.right 槽位不可用，输入框配置按钮将不显示：", error);
    			return () => {};
    		}
    	}, "webds-bridge: composer config");
    	console.log("[webds] conversation.input.right 配置按钮已注册");
    }
    
    //#endregion
    exports.apply = apply;
    exports.estimateTokens = estimateTokens;
    exports.guestChat = guestChat;
    exports.guestNewChat = guestNewChat;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
    })();
    const apply = (ctx) => {
      control.apply(ctx);
      webds.apply(ctx);
    };
    const inject = [...new Set([...(control.inject || []), ...(webds.inject || [])])];
    return { apply, inject, name: "dsh-browser-suite" };
  }
});
