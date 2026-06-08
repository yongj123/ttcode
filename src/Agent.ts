import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LLMClient, type ToolCall } from "./client";
import { createTools, getToolDefinitions, findTool } from "./tools";
import { TodoStore, type TodoItem } from "./tools/TodoTools";
import { MemoryManager, type ConversationSummary } from "./memory/MemoryManager";
import type { Tool } from "./Tool";
import type { ToolResult } from "./Tool";
import {
  type PermissionResolver,
  createDeniedToolMessage,
  createToolResultMessage,
} from "./permission";

export interface AgentConfig {
  client: LLMClient;
  maxTurns?: number;
  systemPrompt?: string;
  /** 权限解析器。不传则默认所有工具自动放行。 */
  permissionResolver?: PermissionResolver;
}

export type AgentEventType =
  | "thinking"
  | "text"
  | "tool_call_start"
  | "tool_call_result"
  | "tool_permission_denied"
  | "turn_end"
  | "done"
  | "error";

export interface AgentEvent {
  type: AgentEventType;
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult;
  usage?: { input: number; output: number };
}

/**
 * ReAct Agent 循环。
 *
 * 权限流程：
 *   tool_call → resolvePermission() →
 *     ├── allowed  → execute → tool_result 喂回 LLM
 *     └── denied   → tool_permission_denied → 拒绝信息喂回 LLM（让它换方案）
 */
export class Agent {
  private client: LLMClient;
  private maxTurns: number;
  private systemPrompt: string;
  private permissionResolver?: PermissionResolver;
  private messages: ChatCompletionMessageParam[] = [];
  private usage = { input: 0, output: 0 };
  private todoStore = new TodoStore();
  private tools: Tool[];
  private memoryManager: MemoryManager;
  private summary?: ConversationSummary;

  constructor(config: AgentConfig) {
    this.client = config.client;
    this.maxTurns = config.maxTurns ?? 20;
    this.systemPrompt = config.systemPrompt ?? this.defaultSystemPrompt();
    this.permissionResolver = config.permissionResolver;
    this.tools = createTools({ todoStore: this.todoStore });
    this.memoryManager = new MemoryManager(this.client);
  }

  /**
   * 执行用户消息。
   * 如果已有历史消息（session恢复后或多轮对话），则追加到末尾；
   * 否则重新初始化 system + user。
   */
  async *run(
    userMessage: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent> {
    if (this.messages.length === 0) {
      // 全新对话：初始化 system + user
      this.messages = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: userMessage },
      ];
    } else {
      // 多轮对话 / session 恢复：追加 user 消息
      this.messages.push({ role: "user", content: userMessage });
    }
    yield* this.agentLoop(signal);
  }

  /**
   * 从已有消息历史继续执行（用于 session 恢复）。
   */
  async *continue(
    existingMessages: ChatCompletionMessageParam[],
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent> {
    this.messages = existingMessages;
    yield* this.agentLoop(signal);
  }

  // ================================================================
  // 核心循环
  // ================================================================

  private async *agentLoop(
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent> {
    for (let turn = 0; turn < this.maxTurns; turn++) {
      yield { type: "thinking", content: `思考中... (第${turn + 1}轮)` };

      const tools = getToolDefinitions(this.tools);
      let textContent = "";
      const toolCalls: ToolCall[] = [];

      // ---- 调用 LLM ----
      try {
        for await (const event of this.client.chatStream(
          this.memoryManager.buildRuntimeMessages(this.messages, this.summary),
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

      // ---- 无工具调用 → 最终回复 ----
      if (toolCalls.length === 0) {
        if (textContent) {
          this.messages.push({ role: "assistant", content: textContent });
        }
        await this.compactIfNeeded();
        yield { type: "done", usage: this.usage };
        return;
      }

      // ---- 添加 assistant 消息 ----
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

      // ---- 逐工具执行（带权限检查） ----
      for (const tc of toolCalls) {
        const tool = findTool(tc.name, this.tools);

        if (!tool) {
          const errorResult: ToolResult = {
            ok: false,
            llmContent: `未知工具: ${tc.name}`,
            userSummary: `未知工具: ${tc.name}`,
          };
          this.messages.push(createToolResultMessage(tc.id, errorResult));
          yield {
            type: "tool_call_result",
            toolName: tc.name,
            toolResult: errorResult,
          };
          continue;
        }

        // ---- 权限检查 ----
        const decision = await this.checkPermission(tool, tc.arguments);

        if (!decision.allowed) {
          const reason = decision.reason || "权限不足";
          yield {
            type: "tool_permission_denied",
            toolName: tc.name,
            content: reason,
          };
          this.messages.push(createDeniedToolMessage(tc.id, reason));
          continue;
        }

        // ---- 执行工具（兜底 catch，单工具失败不中断循环） ----
        let input: unknown;
        try {
          input = JSON.parse(tc.arguments);
        } catch {
          input = {};
        }

        yield { type: "tool_call_start", toolName: tc.name, toolInput: input };

        let result: ToolResult;
        try {
          result = await tool.execute(input);
        } catch (err) {
          result = {
            ok: false,
            llmContent: `工具执行异常: ${err instanceof Error ? err.message : String(err)}`,
            userSummary: `${tc.name}: 执行异常`,
          };
        }

        this.messages.push(createToolResultMessage(tc.id, result));
        yield {
          type: "tool_call_result",
          toolName: tc.name,
          toolResult: result,
        };
      }
    }

    yield {
      type: "error",
      content: `达到最大轮次 (${this.maxTurns})，任务未完成。`,
    };
  }

  // ================================================================
  // 权限
  // ================================================================

  private async checkPermission(
    tool: import("./Tool").Tool,
    rawArgs: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.permissionResolver) {
      return { allowed: true };
    }

    let input: unknown;
    try {
      input = JSON.parse(rawArgs);
    } catch {
      input = {};
    }

    const decision = await this.permissionResolver.resolve(tool, input);
    return decision;
  }

  // ================================================================
  // 状态管理
  // ================================================================

  getMessages(): ChatCompletionMessageParam[] {
    return [...this.messages];
  }

  getSummary(): ConversationSummary | undefined {
    return this.summary ? { ...this.summary } : undefined;
  }

  setSummary(summary?: ConversationSummary): void {
    this.summary = summary;
  }

  async compactNow(): Promise<ConversationSummary | undefined> {
    const result = await this.memoryManager.compact(this.messages, this.summary);
    if (!result) return this.summary;
    this.summary = result.summary;
    this.messages = result.messages;
    return this.getSummary();
  }

  setMessages(messages: ChatCompletionMessageParam[]): void {
    this.messages = messages;
  }

  reset(): void {
    this.messages = [];
    this.usage = { input: 0, output: 0 };
    this.summary = undefined;
    this.todoStore.replace([]);
  }

  getTodos(): TodoItem[] {
    return this.todoStore.list();
  }

  setTodos(todos: TodoItem[]): void {
    this.todoStore.replace(todos);
  }

  getUsage(): { input: number; output: number } {
    return { ...this.usage };
  }

  private async compactIfNeeded(): Promise<void> {
    if (!this.memoryManager.shouldCompact(this.messages)) return;
    try {
      await this.compactNow();
    } catch {
      // 摘要压缩是上下文优化，失败不应影响当前任务完成。
    }
  }

  // ================================================================
  // 系统提示词
  // ================================================================

  private defaultSystemPrompt(): string {
    return `你是一个专业的编程助手 ttcode，运行在用户的终端中。

你有以下能力：
- 读取和分析代码文件
- 创建和编辑文件
- 执行 shell 命令
- 搜索代码库
- 使用 todo_write / todo_read 拆分任务并持续跟踪进度

工作原则：
1. KISS — Keep It Simple, Stupid。优先选择最简单的方案。
2. 先读后改 — 编辑文件前先读取确认当前内容。
3. 精确编辑 — 使用 edit_file 时 oldString 必须与文件内容完全匹配。
4. 任务拆分 — 多步骤任务、调试任务、包含“并且/然后/同时/顺便”等要求的任务，必须先使用 todo_write 创建任务列表。
5. 持续反馈 — 开始某个任务前，将它标记为 in_progress；完成后立即标记为 completed；任务变化时调用 todo_write 更新完整列表。
6. Plan + Act — 复杂、高风险、跨模块或不确定的任务，先给出计划并等待用户确认；简单任务可直接拆分 todo 后执行。
7. 如果某个工具被权限拒绝，尝试用其他可用的方法完成任务。
8. 完成后总结 — 任务完成时给用户简洁的总结。

回复风格：
- 使用中文
- 简洁直接，避免冗余`;
  }
}
