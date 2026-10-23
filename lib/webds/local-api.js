/**
 * Local OpenAI-compatible endpoint for the automatic web DeepSeek source.
 * pi-ai talks to this server; the server talks to the browser pool.
 */
import http from 'node:http';

const MODEL = 'web-deepseek';

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
  if (typeof body.system === 'string' && body.system.trim()) lines.push(`System:\n${body.system.trim()}`);
  for (const message of body.messages ?? []) {
    const text = contentText(message?.content);
    if (!text) continue;
    const role = String(message?.role ?? 'user');
    if (role === 'system') lines.push(`System:\n${text}`);
    else if (role === 'assistant') lines.push(`Assistant:\n${text}`);
    else if (role === 'tool') lines.push(`Tool:\n${text}`);
    else lines.push(`User:\n${text}`);
  }
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolLines = tools.slice(0, 60).map((tool) => { const fn = tool.function ?? tool; return `- ${fn.name}: ${String(fn.description ?? '').slice(0, 240)}\n  parameters: ${JSON.stringify(fn.parameters ?? {})}`; });
  const prompt = [
    '你正在作为 DeepSeek Harness 的模型后端工作。下面是工具定义与完整对话上下文。',
    '当你需要调用工具时，只输出一个代码块：',
    '```tool_call',
    '{"name":"工具名","arguments":{...}}',
    '```',
    '不需要工具时直接回答。',
    '',
    `可用工具：\n${toolLines.join('\n') || '(none)'}`,
    '',
    '对话上下文：',
    lines.join('\n\n'),
  ].join('\n');
  return prompt.length > 60000 ? `${prompt.slice(0, 8000)}\n\n[...中间省略...]\n\n${prompt.slice(-52000)}` : prompt;
}

function extractToolCalls(reply, toolNames) {
  const blocks = [];
  const fenced = /```(?:tool_call)?\s*([\s\S]*?)```/giu;
  let match;
  while ((match = fenced.exec(reply)) !== null) blocks.push(match[1]);
  const tagged = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/giu;
  while ((match = tagged.exec(reply)) !== null) blocks.push(match[1]);
  if (blocks.length === 0 && /^\s*\{/u.test(reply)) blocks.push(reply);
  const calls = [];
  for (const block of blocks) {
    const start = block.indexOf('{');
    const end = block.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(block.slice(start, end + 1));
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        const name = item?.name ?? item?.tool;
        const args = item?.arguments ?? item?.args ?? {};
        if (typeof name !== 'string' || !name) continue;
        if (toolNames.size > 0 && !toolNames.has(name)) continue;
        calls.push({ id: `call_webds_${Date.now()}_${calls.length}`, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
      }
    } catch {}
  }
  return calls;
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
      const prompt = buildPrompt(body);
      const result = await getPool().chat(prompt);
      if (!result || result.ok !== true) {
        return sendJson(response, 502, { error: { message: result?.message ?? 'web DeepSeek failed' } });
      }
      const reply = String(result.replyMarkdown ?? result.replyText ?? '').trim();
      const toolNames = new Set((Array.isArray(body.tools) ? body.tools : []).map((tool) => String(tool?.function?.name ?? tool?.name ?? '')));
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
