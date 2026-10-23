/**
 * Local OpenAI-compatible endpoint for the automatic web DeepSeek source.
 * pi-ai talks to this server; the server talks to the browser pool.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MODEL = 'web-deepseek';
const CONTEXT_TOKENS = Number(process.env.DSH_WEBDS_CONTEXT_TOKENS) || 1000000;
const CONTEXT_CHARS = CONTEXT_TOKENS * 4;
const sessions = new Map();

function statePath(sessionId) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const name = String(sessionId).replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 160);
  return path.join(home, 'dsh_memory', 'web_states', name + '.json');
}

function loadPersistedState(sessionId) {
  try {
    const file = statePath(sessionId);
    if (!existsSync(file)) return undefined;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || !Array.isArray(data.messages)) return undefined;
    return { ...data, updatedAt: Number(data.updatedAt) || Date.now() };
  } catch { return undefined; }
}

function savePersistedState(sessionId, state) {
  try {
    const file = statePath(sessionId);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), 'utf8');
  } catch {}
}

function nonSystemMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter((message) => String(message?.role ?? '') !== 'system');
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (!block || typeof block !== 'object') return '';
    if (block.type === 'text') return String(block.text ?? '');
    if (block.type === 'tool-call') return `[assistant called tool ${block.name} with ${block.arguments ?? '{}'}]`;
    if (block.type === 'tool-result') return `[tool result ${block.name ?? ''}]: ${contentText(block.content)}`;
    return '';
  }).filter(Boolean).join('\n');
}

function buildPrompt(body) {
  const lines = [];
  if (typeof body.system === 'string' && body.system.trim()) lines.push('System:\n' + body.system.trim());
  for (const message of body.messages ?? []) {
    const text = contentText(message?.content);
    if (!text) continue;
    const role = String(message?.role ?? 'user');
    if (role === 'system') lines.push('System:\n' + text);
    else if (role === 'assistant') lines.push('Assistant:\n' + text);
    else if (role === 'tool') lines.push('Tool:\n' + text);
    else lines.push('User:\n' + text);
  }
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolLines = tools.slice(0, 60).map((tool) => { const fn = tool.function ?? tool; return '- ' + fn.name + ': ' + String(fn.description ?? '').slice(0, 240) + '\n  parameters: ' + JSON.stringify(fn.parameters ?? {}); });
﻿  return [
    'You are the agent model executing a DeepSeek Harness task, not a chat assistant.',
    'Think like an agent: plan, call a tool, observe the result, then continue the task.',
    'You MUST call tools for current or factual data such as weather, news, prices, URLs, files, shell commands, or any real-world action.',
    'For weather, call browser_search first; optionally browser_fetch the result. Never answer from memory or IP geolocation.',
    'After a Tool result, continue the task instead of asking the user again or repeating the same call.',
    'Do not emit DSML or any other native tool syntax.',
    'These tools are registered by the running DSH plugin system; their names and parameter schemas are authoritative. DSH executes every valid tool_call and returns a Tool result.',
    'The tool list below remains valid for the entire conversation. Do not ask for it again and do not repeat the tool schemas in replies.',
    'Do not invent tool names. For office/document work, call the skill tool first; for web/realtime work, call browser_search/browser_fetch or web_search/web_fetch.',
    'You are the model backend for DeepSeek Harness.',
    'When you need a tool, output exactly one fenced block:',
    '```tool_call',
    '{"name":"tool","arguments":{...}}',
    '```',
    'When no tool is needed, answer directly.',
    'Tool-call JSON must be one line; escape newlines as \\n and backslashes as \\\\.',
    '',
    'Tools:',
    toolLines.join('\n') || '(none)',
    '',
    'Conversation:',
    lines.join('\n\n'),
  ].join('\n');
}

function compactText(text, limitChars) {
  if (text.length <= limitChars) return text;
  const head = Math.min(12000, Math.floor(limitChars * 0.1));
  const tail = Math.max(1, limitChars - head - 200);
  return text.slice(0, head) + '\n\n[...上下文过长，已压缩中间部分...]\n\n' + text.slice(-tail);
}

function scanJsonObjects(text) {
  const out = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '{') { index += 1; continue; }
    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = false;
    for (; index < text.length; index += 1) {
      const ch = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { out.push(text.slice(start, index + 1)); closed = true; index += 1; break; }
      }
    }
    if (!closed) break;
  }
  return out;
}

function normalizeJsonText(text) {
  return text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

function extractDsmlToolCalls(reply, toolNames) {
  const calls = [];
  const invoke = /<[｜|]{1,2}DSML[｜|]{1,2}\s*invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/[｜|]{1,2}DSML[｜|]{1,2}\s*invoke>/giu;
  let match;
  while ((match = invoke.exec(reply)) !== null) {
    const name = match[1];
    if (toolNames.size > 0 && !toolNames.has(name)) continue;
    const body = match[2];
    const args = {};
    const parameter = /<[｜|]{1,2}DSML[｜|]{1,2}\s*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/[｜|]{1,2}DSML[｜|]{1,2}\s*parameter>/giu;
    let p;
    while ((p = parameter.exec(body)) !== null) {
      let value = String(p[2] ?? '').trim();
      if (value.startsWith('{') || value.startsWith('[')) {
        try { value = JSON.parse(normalizeJsonText(value)); } catch {}
      }
      args[p[1]] = value;
    }
    const raw = args.arguments;
    let finalArgs;
    if (raw && typeof raw === 'object') finalArgs = JSON.stringify(raw);
    else if (typeof raw === 'string') finalArgs = raw;
    else finalArgs = JSON.stringify(args);
    calls.push({ id: 'call_webds_dsml_' + Date.now() + '_' + calls.length, name, arguments: finalArgs });
  }
  return calls;
}

function extractToolCalls(reply, toolNames) {
  const rawCandidates = [];
  const fenced = /```(?:tool_call)?\s*([\s\S]*?)```/giu;
  let match;
  while ((match = fenced.exec(reply)) !== null) rawCandidates.push(match[1]);
  const tagged = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/giu;
  while ((match = tagged.exec(reply)) !== null) rawCandidates.push(match[1]);
  rawCandidates.push(...scanJsonObjects(reply));
  const calls = extractDsmlToolCalls(reply, toolNames);
  const seen = new Set(calls.map((call) => call.name + '|' + call.arguments));
  for (const candidate of rawCandidates) {
    for (const objectText of scanJsonObjects(candidate)) {
      try {
        let parsed;
        try {
          parsed = JSON.parse(objectText);
        } catch {
          parsed = JSON.parse(normalizeJsonText(objectText));
        }
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const name = item?.name ?? item?.tool;
          if (typeof name !== 'string' || !name) continue;
          if (toolNames.size > 0 && !toolNames.has(name)) continue;
          const rawArgs = item?.arguments ?? item?.args;
          let args;
          if (typeof rawArgs === 'string') args = rawArgs;
          else if (rawArgs && typeof rawArgs === 'object') args = JSON.stringify(rawArgs);
          else {
            const flat = { ...item };
            delete flat.name;
            delete flat.tool;
            args = JSON.stringify(flat);
          }
          const key = name + '|' + args;
          if (seen.has(key)) continue;
          seen.add(key);
          calls.push({ id: 'call_webds_' + Date.now() + '_' + calls.length, name, arguments: args });
        }
      } catch {
        /* not JSON */
      }
    }
  }
  return calls;
}

function deriveSessionId(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const firstUser = messages.find((message) => String(message?.role ?? '') === 'user') ?? messages.find((message) => String(message?.role ?? '') !== 'system');
  const seed = JSON.stringify({ model: body.model ?? '', firstUser: contentText(firstUser?.content) });
  return 'web-' + createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function messageText(message) {
  return contentText(message?.content);
}

function deltaPrompt(messages) {
  const lines = [];
  for (const message of messages ?? []) {
    const text = messageText(message);
    if (!text) continue;
    const role = String(message?.role ?? 'user');
    if (role === 'tool') lines.push('Tool:\n' + text);
    else if (role === 'assistant') lines.push('Assistant:\n' + text);
    else if (role === 'system') lines.push('System:\n' + text);
    else lines.push('User:\n' + text);
  }
  return lines.join('\n\n');
}

function commonPrefixCount(previous, current) {
  const limit = Math.min(previous.length, current.length);
  let index = 0;
  while (index < limit) {
    const a = previous[index];
    const b = current[index];
    if (String(a?.role) !== String(b?.role) || messageText(a) !== messageText(b)) break;
    index += 1;
  }
  return index;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  const text = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}

export function startWebApiServer({ getPool, port = 34567, logger }) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/v1/context') {
        return sendJson(response, 200, { object: 'list', data: [...sessions.entries()].map(([id, s]) => ({ id, tokens: s.tokens, updatedAt: s.updatedAt, user: s.user, promptCacheKey: s.promptCacheKey, keys: s.keys, headers: s.headers })) });
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        return sendJson(response, 200, {
          object: 'list',
          data: [{ id: MODEL, object: 'model', created: 0, owned_by: 'web-deepseek' }],
        });
      }
      if (request.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
        return sendJson(response, 404, { error: { message: 'not found' } });
      }
      const raw = await readBody(request);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return sendJson(response, 400, { error: { message: 'invalid JSON body' } });
      }
      const sessionId = String(request.headers['x-session-id'] ?? request.headers['x-dsh-session-id'] ?? request.headers['x-dsh-session'] ?? request.headers['session_id'] ?? request.headers['x-session-affinity'] ?? request.headers['x-client-request-id'] ?? '') || deriveSessionId(body);


      const messages = Array.isArray(body.messages) ? body.messages : [];
      const isTitleRequest = !(Array.isArray(body.tools) && body.tools.length > 0) && messages.some((message) => message?.role === 'system' && /Create a concise title/i.test(contentText(message.content)));
      if (isTitleRequest) {
        const firstUser = messages.find((message) => message?.role === 'user');
        const title = contentText(firstUser?.content).replace(/\s+/gu, ' ').trim().slice(0, 40) || 'New chat';
        const id = 'chatcmpl-webds-title-' + Date.now();
        const created = Math.floor(Date.now() / 1000);
        if (body.stream === true) {
          response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          response.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model: MODEL, choices: [{ index: 0, delta: { role: 'assistant', content: title }, finish_reason: null }] }) + '\n\n');
          response.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
          response.write('data: [DONE]\n\n');
          response.end();
          return;
        }
        return sendJson(response, 200, { id, object: 'chat.completion', created, model: MODEL, choices: [{ index: 0, message: { role: 'assistant', content: title }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      }
      const fullPrompt = buildPrompt(body);
      let state = sessions.get(sessionId) ?? loadPersistedState(sessionId);
      if (state) sessions.set(sessionId, state);
      const tokens = Math.ceil(fullPrompt.length / 4);
      const compacted = tokens > CONTEXT_TOKENS;
      const toolNames = new Set((Array.isArray(body.tools) ? body.tools : []).map((tool) => String(tool?.function?.name ?? tool?.name ?? '')).filter(Boolean));
      let prompt = compacted ? compactText(fullPrompt, CONTEXT_CHARS) : fullPrompt;
      let fresh = !state || compacted;
      if (state && !compacted) {
        const previous = nonSystemMessages(state.messages);
        const current = nonSystemMessages(messages);
        const prefix = commonPrefixCount(previous, current);
        if (prefix === previous.length && current.length >= previous.length) {
          const delta = deltaPrompt(current.slice(prefix));
          prompt = delta.length > 0 ? delta : '继续'; 
          fresh = false;
        }
      }
      if (compacted) {
        logger?.info?.("[webds] context compaction for " + sessionId + ": " + tokens + " > " + CONTEXT_TOKENS + " tokens");
      }
      response.setHeader('x-webds-compacted', compacted ? '1' : '0');
      response.setHeader('x-webds-context-tokens', String(tokens));
      response.setHeader('x-webds-session-id', sessionId);
      let keepAliveTimer;
      if (body.stream === true) {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        keepAliveTimer = setInterval(() => {
          try { response.write(': keep-alive\n\n'); } catch {}
        }, 10000);
      }
      let result;
      try {
        result = await getPool().chat(prompt, { sessionId, fresh });
      } catch (error) {
        clearInterval(keepAliveTimer);
        if (body.stream === true) {
          response.write('data: ' + JSON.stringify({ error: { message: String(error?.message ?? error) } }) + '\n\n');
          response.end();
          return;
        }
        throw error;
      }
      clearInterval(keepAliveTimer);
      if (!result || result.ok !== true) {
        const message = result?.message ?? 'web DeepSeek failed';
        if (body.stream === true) {
          response.write('data: ' + JSON.stringify({ error: { message } }) + '\n\n');
          response.end();
          return;
        }
        return sendJson(response, 502, { error: { message } });
      }
      const reply = String(result.replyMarkdown ?? result.replyText ?? '').trim();
      const nextState = { messages: JSON.parse(JSON.stringify(messages)), tokens, updatedAt: Date.now(), user: body.user ?? null, promptCacheKey: body.prompt_cache_key ?? null, keys: Object.keys(body), headers: request.headers };
      sessions.set(sessionId, nextState);
      savePersistedState(sessionId, nextState);
      const calls = extractToolCalls(reply, toolNames);
      const created = Math.floor(Date.now() / 1000);
      const id = `chatcmpl-webds-${Date.now()}`;
      const toolCalls = calls.map((call, index) => ({
        index,
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }));
      const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
      if (body.stream === true) {
        if (!response.headersSent) {
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
        }
        const chunk = (delta, finish) => `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model: MODEL,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
        if (toolCalls.length > 0) {
          response.write(chunk({ role: 'assistant', content: null, tool_calls: toolCalls }, null));
        } else {
          response.write(chunk({ role: 'assistant', content: reply }, null));
        }
        response.write(chunk({}, finishReason));
        response.write('data: [DONE]\n\n');
        response.end();
        return;
      }
      return sendJson(response, 200, {
        id,
        object: 'chat.completion',
        created,
        model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: toolCalls.length > 0 ? null : reply, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }, finish_reason: finishReason }],
        usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(reply.length / 4), total_tokens: Math.ceil((prompt.length + reply.length) / 4) },
      });
    } catch (error) {
      logger?.warn?.(`[webds] local API error: ${String(error)}`);
      try {
        return sendJson(response, 500, { error: { message: String(error?.message ?? error) } });
      } catch {
        /* response may already be closed */
      }
    }
  });
  server.on('error', (error) => logger?.warn?.(`[webds] local API server failed: ${String(error)}`));
  server.listen(port, '127.0.0.1', () => logger?.info?.(`[webds] web DeepSeek OpenAI-compatible endpoint on http://127.0.0.1:${port}/v1`));
  return {
    server,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
