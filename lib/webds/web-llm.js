/**
 * Native LLM adapter that uses web DeepSeek as the model source.
 *
 * It is stateless from the web app's perspective: each request sends the full
 * harness conversation (system, tools, history, tool results) into a fresh web
 * chat and returns one text or tool-call stream. The pool bounds concurrency.
 */

const MODEL_ID = 'web-deepseek';
const MODEL_NAME = 'Web DeepSeek';
const CONTEXT_WINDOW = 128000;
const MAX_TOKENS = 8192;

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'tool-call') parts.push(`[assistant called tool ${block.name} with ${block.arguments ?? '{}'}]`);
    else if (block.type === 'tool-result') parts.push(`[tool result ${block.name ?? ''}]: ${contentText(block.content)}`);
    else if (block.type === 'image') parts.push('[image omitted]');
  }
  return parts.join('\n').trim();
}

function flattenMessages(messages) {
  const lines = [];
  for (const message of messages ?? []) {
    const text = contentText(message?.content);
    if (!text) continue;
    const role = String(message?.role ?? 'user');
    if (role === 'system') lines.push(`System:\n${text}`);
    else if (role === 'assistant') lines.push(`Assistant:\n${text}`);
    else if (role === 'tool') lines.push(`Tool:\n${text}`);
    else lines.push(`User:\n${text}`);
  }
  return lines.join('\n\n');
}

function truncatePrompt(text, limit = 60000) {
  if (text.length <= limit) return text;
  const head = 8000;
  return `${text.slice(0, head)}\n\n[... middle omitted ...]\n\n${text.slice(-(limit - head))}`;
}

function buildPrompt(options) {
  const system = typeof options.system === 'string' && options.system.trim().length > 0 ? [options.system.trim()] : [];
  const tools = Array.isArray(options.tools) ? options.tools : [];
  const toolLines = tools.slice(0, 60).map((tool) => {
    const description = String(tool.description ?? '').replace(/\s+/g, ' ').slice(0, 240);
    return `- ${tool.name}: ${description}\n  parameters: ${JSON.stringify(tool.parameters ?? {})}`;
  });
  const protocol = [
    '你正在作为 DeepSeek Harness 的模型后端工作。下面是工具定义与完整对话上下文。',
    '当你需要调用工具时，只输出一个代码块，格式严格为：',
    '```tool_call',
    '{"name":"工具名","arguments":{...}}',
    '```',
    '不需要工具时直接回答，不要输出 tool_call 代码块。一次只调用一个工具。',
  ].join('\n');
  const body = flattenMessages(options.messages);
  return truncatePrompt(`${system.join('\n\n')}\n\n${protocol}\n\n可用工具：\n${toolLines.join('\n') || '(none)'}\n\n对话上下文：\n${body}`);
}

function extractToolCalls(reply, toolNames = new Set()) {
  const candidates = [];
  const fenced = /```([A-Za-z0-9_-]*)\s*([\s\S]*?)```/giu;
  let match;
  while ((match = fenced.exec(reply)) !== null) candidates.push(match[2]);
  const tagged = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/giu;
  while ((match = tagged.exec(reply)) !== null) candidates.push(match[1]);
  if (candidates.length === 0 && /^\s*\{/u.test(reply)) candidates.push(reply);
  const calls = [];
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        const name = item?.name ?? item?.tool;
        const args = item?.arguments ?? item?.args ?? {};
        if (typeof name !== 'string' || name.length === 0) continue;
        if (toolNames.size > 0 && !toolNames.has(name)) continue;
        calls.push({ name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
      }
    } catch {
      /* not a tool call */
    }
  }
  return calls;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

export function createWebDeepSeekAdapter({ getPool }) {
  return {
    providerInfo(provider) {
      return { id: provider, name: 'Web DeepSeek' };
    },
    async listModels(provider) {
      return [{
        provider,
        id: MODEL_ID,
        name: MODEL_NAME,
        description: '通过本机浏览器使用网页版 DeepSeek 对话，无需 API Key',
        contextWindow: CONTEXT_WINDOW,
        maxTokens: MAX_TOKENS,
        inputModalities: ['text'],
      }];
    },
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: MODEL_NAME,
        context: { contextWindow: CONTEXT_WINDOW },
        defaultMaxTokens: MAX_TOKENS,
        inputModalities: ['text'],
        systemPromptUpdate: 'in-history',
        toolUpdate: 'in-history',
      };
    },
    async *stream(options) {
      const pool = getPool();
      const prompt = buildPrompt(options);
      if (options.signal?.aborted) {
        yield { type: 'finish', reason: { kind: 'aborted' } };
        return;
      }
      let result;
      try {
        result = await pool.chat(prompt, options.signal);
      } catch (error) {
        throw new Error(`Web DeepSeek request failed: ${String(error?.message ?? error)}`);
      }
      if (!result || result.ok !== true) {
        const stage = result?.stage ?? 'unknown';
        const message = result?.message ?? '网页版没有返回结果';
        throw new Error(`Web DeepSeek ${stage}: ${message}`);
      }
      const reply = String(result.replyMarkdown ?? result.replyText ?? '').trim();
      const toolNames = new Set((Array.isArray(options.tools) ? options.tools : []).map((tool) => String(tool?.name ?? '')));
      const calls = extractToolCalls(reply, toolNames);
      if (calls.length > 0) {
        for (let index = 0; index < calls.length; index += 1) {
          const call = calls[index];
          const id = `webds-${Date.now()}-${index}`;
          yield { type: 'block-start', index, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments };
          yield {
            type: 'block-end',
            index,
            block: { type: 'tool-call', id, name: call.name, arguments: call.arguments },
          };
        }
        yield {
          type: 'usage',
          usage: {
            inputTokens: estimateTokens(prompt),
            outputTokens: estimateTokens(reply),
            totalTokens: estimateTokens(prompt) + estimateTokens(reply),
          },
        };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      if (reply.length === 0) throw new Error('Web DeepSeek returned an empty reply');
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: reply };
      yield {
        type: 'usage',
        usage: {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(reply),
          totalTokens: estimateTokens(prompt) + estimateTokens(reply),
        },
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
}
