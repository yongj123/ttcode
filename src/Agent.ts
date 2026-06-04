import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LLMClient, type ToolCall } from "./client";
import { getToolDefinitions, findTool } from "./tools";
import type { ToolResult } from "./Tool";

export interface AgentConfig {
  client: LLMClient;
  maxTurns?: number;
  systemPrompt?: string;
}

export interface AgentEvent {
  type:
    | "thinking"
    | "text"
    | "tool_call_start"
    | "tool_call_result"
    | "turn_end"
    | "done"
    | "error";
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult;
  usage?: { input: number; output: number };
}

/**
 * ReAct Agent 循环。
 * 对标 Claude Code QueryEngine：
 *   system → user → LLM → (tool_call → execute → 喂回)* → 回复
 */
export class Agent {
  private client: LLMClient;
  private maxTurns: number;
  private systemPrompt: string;
  private messages: ChatCompletionMessageParam[] = [];
  private usage = { input: 0, output: 0 };

  constructor(config: AgentConfig) {
    this.client = config.client;
    this.maxTurns = config.maxTurns ?? 20;
    this.systemPrompt = config.systemPrompt ?? this.defaultSystemPrompt();
  }

  /**
   * 流式执行任务。通过 AsyncGenerator 逐步产出事件，
   * UI 层可以逐事件消费来渲染。
   */
  async *run(
    userMessage: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent> {
    this.messages = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: userMessage },
    ];

    for (let turn = 0; turn < this.maxTurns; turn++) {
      yield { type: "thinking", content: `思考中... (第${turn + 1}轮)` };

      const tools = getToolDefinitions();
      let textContent = "";
      const toolCalls: ToolCall[] = [];

      try {
        for await (const event of this.client.chatStream(
          this.messages,
          tools,
          signal
        )) {
          switch (event.type) {
            case "text":
              textContent += event.content || "";
              yield { type: "text", content: event.content };
              break;
            case "tool_call":
              if (event.toolCall) toolCalls.push(event.toolCall);
              break;
            case "done":
              if (event.usage) {
                this.usage.input += event.usage.input;
                this.usage.output += event.usage.output;
              }
              break;
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          yield { type: "error", content: "已取消" };
          return;
        }
        yield {
          type: "error",
          content: `API 错误: ${err instanceof Error ? err.message : String(err)}`,
        };
        return;
      }

      // 无工具调用 → 最终回复
      if (toolCalls.length === 0) {
        if (textContent) {
          this.messages.push({ role: "assistant", content: textContent });
        }
        yield { type: "done", usage: this.usage };
        return;
      }

      // 有工具调用 → 执行
      const assistantMsg: ChatCompletionMessageParam = {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      this.messages.push(assistantMsg);

      for (const tc of toolCalls) {
        const tool = findTool(tc.name);
        if (!tool) {
          yield {
            type: "tool_call_result",
            toolName: tc.name,
            toolResult: {
              ok: false,
              llmContent: `未知工具: ${tc.name}`,
              userSummary: `未知工具: ${tc.name}`,
            },
          };
          continue;
        }

        let input: unknown;
        try {
          input = JSON.parse(tc.arguments);
        } catch {
          input = {};
        }

        yield {
          type: "tool_call_start",
          toolName: tc.name,
          toolInput: input,
        };

        const result = await tool.execute(input);

        yield {
          type: "tool_call_result",
          toolName: tc.name,
          toolResult: result,
        };

        this.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.llmContent,
        });
      }
    }

    yield {
      type: "error",
      content: `达到最大轮次 (${this.maxTurns})，任务未完成。`,
    };
  }

  /** 获取对话历史 */
  getMessages(): ChatCompletionMessageParam[] {
    return [...this.messages];
  }

  /** 重置对话 */
  reset(): void {
    this.messages = [];
    this.usage = { input: 0, output: 0 };
  }

  /** 获取 token 用量 */
  getUsage(): { input: number; output: number } {
    return { ...this.usage };
  }

  private defaultSystemPrompt(): string {
    return `你是一个专业的编程助手 ttcode，运行在用户的终端中。

你有以下能力：
- 读取和分析代码文件
- 创建和编辑文件
- 执行 shell 命令
- 搜索代码库

工作原则：
1. KISS — Keep It Simple, Stupid。优先选择最简单的方案。
2. 先读后改 — 编辑文件前先读取确认当前内容。
3. 精确编辑 — 使用 edit_file 时 oldString 必须与文件内容完全匹配。
4. 完成后总结 — 任务完成时给用户简洁的总结。

回复风格：
- 使用中文
- 简洁直接，避免冗余`;
  }
}
