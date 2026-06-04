import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

export interface ClientConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * LLM 客户端封装。
 * 对标 Claude Code 的 API 服务层。
 */
export class LLMClient {
  private client: OpenAI;
  public model: string;

  constructor(config: ClientConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || "https://api.deepseek.com",
    });
    this.model = config.model || "deepseek-v4-pro";
  }

  /**
   * 流式调用 LLM，逐 token yield。
   * 同时累积 tool_calls。
   */
  async *chatStream(
    messages: ChatCompletionMessageParam[],
    tools?: object[],
    signal?: AbortSignal
  ): AsyncGenerator<{
    type: "text" | "tool_call" | "done";
    content?: string;
    toolCall?: ToolCall;
    finishReason?: string;
    usage?: { input: number; output: number };
  }> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        tools: tools?.length
          ? (tools as ChatCompletionTool[])
          : undefined,
        stream: true,
        temperature: 0,
      },
      { signal }
    );

    // 累积工具调用（流式返回时 tool_calls 是分 chunk 的）
    const toolCallAcc: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let usage: { input: number; output: number } | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // 文本内容
      if (delta.content) {
        yield { type: "text", content: delta.content };
      }

      // 工具调用
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAcc.has(idx)) {
            toolCallAcc.set(idx, {
              id: tc.id || "",
              name: "",
              arguments: "",
            });
          }
          const acc = toolCallAcc.get(idx)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }

      // 结束
      const finishReason = chunk.choices?.[0]?.finish_reason;
      if (finishReason) {
        // 输出累积的工具调用
        for (const [, tc] of toolCallAcc) {
          if (tc.name) {
            yield {
              type: "tool_call",
              toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
            };
          }
        }
        yield { type: "done", finishReason, usage };
      }

      // token 使用量（部分模型支持）
      if (chunk.usage) {
        usage = {
          input: chunk.usage.prompt_tokens || 0,
          output: chunk.usage.completion_tokens || 0,
        };
      }
    }
  }

  /**
   * 非流式调用（用于摘要生成等不需要流式的场景）。
   */
  async chat(
    messages: ChatCompletionMessageParam[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxTokens,
    });
    return response.choices?.[0]?.message?.content || "";
  }
}
