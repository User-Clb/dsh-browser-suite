/**
 * Local OpenAI-compatible endpoint for the automatic web DeepSeek source.
 * pi-ai talks to this server; the server talks to the browser pool.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';

const MODEL = 'web-deepseek';
const CONTEXT_TOKENS = Number(process.env.DSH_WEBDS_CONTEXT_TOKENS) || 1000000;
const CONTEXT_CHARS = CONTEXT_TOKENS * 4;
const sessions = new Map();

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
  return [
    '你正在作为 DeepSeek Harness 的模型后端工作。下面是工具定义与完整对话上下文。',
    '当你需要调用工具时，只输出一个代码块：',
    '```tool_call',
    '{"name":"工具名","arguments":{...}}',
    '```',
    '不需要工具时直接回答。',
    '',
    '可用工具：\n' + (toolLines.join('\n') || '(none)'),
    '',
    '对话上下文：',
    lines.join('\n\n'),
  ].join('\n');
}

function compactText(text, limitChars) {
  if (text.length <= limitChars) return text;
  const head = Math.min(12000, Math.floor(limitChars * 0.1));
  const tail = Math.max(1, limitChars - head - 200);
  return text.slice(0, head) + '\n\n[...上下文过长，已压缩中间部分...]\n\n' + text.slice(-tail);
}

﻿function scanJsonObjects(text) {
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

function extractToolCalls(reply, toolNames) {
  const rawCandidates = [];
  const fenced = /```(?:tool_call)?\s*([\s\S]*?)```/giu;
  let match;
  while ((match = fenced.exec(reply)) !== null) rawCandidates.push(match[1]);
  const tagged = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/giu;
  while ((match = tagged.exec(reply)) !== null) rawCandidates.push(match[1]);
  rawCandidates.push(...scanJsonObjects(reply));
  const calls = [];
  for (const candidate of rawCandidates) {
    for (const objectText of scanJsonObjects(candidate)) {
      try {
        const parsed = JSON.parse(normalizeJsonText(objectText));
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
          calls.push({ id: 'call_webds_' + Date.now() + '_' + calls.length, name, arguments: args });
        }
      } catch {
        /* not JSON */
      }
    }
  }
  return calls;
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
        return sendJson(response, 200, { object: 'list', data: [...sessions.entries()].map(([id, s]) => ({ id, tokens: s.tokens, updatedAt: s.updatedAt, user: s.user, promptCacheKey: s.promptCacheKey, keys: s.keys })) });
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
      const sessionId = String(request.headers['x-session-id'] ?? '') || deriveSessionId(body);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const fullPrompt = buildPrompt(body);
      const state = sessions.get(sessionId);
      const tokens = Math.ceil(fullPrompt.length / 4);
      const compacted = tokens > CONTEXT_TOKENS;
      let prompt = compacted ? compactText(fullPrompt, CONTEXT_CHARS) : fullPrompt;
      let fresh = !state || compacted;
      if (state && !compacted) {
        const prefix = commonPrefixCount(state.messages ?? [], messages);
        const delta = deltaPrompt(messages.slice(prefix));
        if (delta.length > 0) {
          prompt = delta;
          fresh = false;
        }
      }
      if (compacted) {
        logger?.info?.("[webds] context compaction for " + sessionId + ": " + tokens + " > " + CONTEXT_TOKENS + " tokens");
      }
      response.setHeader('x-webds-compacted', compacted ? '1' : '0');
      response.setHeader('x-webds-context-tokens', String(tokens));
      response.setHeader('x-webds-session-id', sessionId);
      const result = await getPool().chat(prompt, { sessionId, fresh });
      if (!result || result.ok !== true) {
        return sendJson(response, 502, { error: { message: result?.message ?? 'web DeepSeek failed' } });
      }
      const reply = String(result.replyMarkdown ?? result.replyText ?? '').trim();
      const toolNames = new Set((Array.isArray(body.tools) ? body.tools : []).map((tool) => String(tool?.function?.name ?? tool?.name ?? '')));
      sessions.set(sessionId, { messages: JSON.parse(JSON.stringify(messages)), tokens, updatedAt: Date.now(), user: body.user ?? null, promptCacheKey: body.prompt_cache_key ?? null, keys: Object.keys(body) });
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
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
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
