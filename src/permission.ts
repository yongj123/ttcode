import type { Tool, ToolResult } from "./Tool";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * 单次工具调用的权限决策。
 */
export interface PermissionDecision {
  /** 是否批准执行 */
  allowed: boolean;
  /** 拒绝原因（仅 allowed=false 时） */
  reason?: string;
}

/**
 * 权限解析器接口。
 * 不同模式有不同实现：
 *   - InteractiveResolver → UI 弹窗等待用户确认
 *   - AutoAllowResolver → 非交互模式，自动放行 allow 级别
 */
export interface PermissionResolver {
  resolve(
    tool: Tool,
    input: unknown
  ): Promise<PermissionDecision>;
}

/**
 * 非交互模式解析器。
 * @param allowedTools 指定允许的 ask 级别工具名列表（空 = allow级别放行，ask/deny拒绝）
 * @param dangerousAutoApprove 是否对所有 ask 工具自动批准
 */
export class AutoAllowResolver implements PermissionResolver {
  private allowedTools: Set<string>;
  private autoApproveAll: boolean;

  constructor(allowedTools: string[] = [], autoApproveAll = false) {
    this.allowedTools = new Set(allowedTools);
    this.autoApproveAll = autoApproveAll;
  }

  async resolve(tool: Tool, _input: unknown): Promise<PermissionDecision> {
    if (tool.permission === "deny") {
      return { allowed: false, reason: `工具 ${tool.name} 已被禁止使用` };
    }
    if (tool.permission === "allow") {
      return { allowed: true };
    }
    // ask 级别
    if (this.autoApproveAll) {
      return { allowed: true };
    }
    if (this.allowedTools.has(tool.name)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `非交互模式下，工具 ${tool.name} 需要 --allow-tools 或 --dangerously-auto-approve 标志`,
    };
  }
}

/**
 * 交互模式解析器。
 * - 通过 onPending 回调通知 UI 弹出确认框（事件驱动）
 * - cancel() 释放所有等待中的 promise（Esc 取消时调用）
 * - deny 级别直接拒，allow 级别自动放
 */
export class InteractiveResolver implements PermissionResolver {
  private pending:
    | {
        resolve: (decision: PermissionDecision) => void;
        tool: Tool;
        approvalMessage: string;
      }
    | null = null;

  /** 当新权限请求待确认时回调（事件驱动）。参数: approvalMessage, toolName */
  onPending: ((msg: string, toolName: string) => void) | null = null;

  async resolve(
    tool: Tool,
    input: unknown
  ): Promise<PermissionDecision> {
    if (tool.permission === "deny") {
      return { allowed: false, reason: `工具 ${tool.name} 已被禁止使用` };
    }

    if (tool.permission === "allow") {
      return { allowed: true };
    }

    const approvalMessage = tool.getApprovalMessage(input);

    return new Promise<PermissionDecision>((resolve) => {
      this.pending = { resolve, tool, approvalMessage };
      // 事件驱动：立即通知 UI
      this.onPending?.(approvalMessage, tool.name);
    });
  }

  /** 取消所有待确认请求（任务被中止时调用） */
  cancel(): void {
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = null;
      resolve({ allowed: false, reason: "任务已取消" });
    }
  }

  getPending(): {
    tool: Tool;
    approvalMessage: string;
  } | null {
    if (!this.pending) return null;
    return { tool: this.pending.tool, approvalMessage: this.pending.approvalMessage };
  }

  approve(): void {
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = null;
      resolve({ allowed: true });
    }
  }

  deny(reason?: string): void {
    if (this.pending) {
      const { resolve, approvalMessage } = this.pending;
      this.pending = null;
      resolve({ allowed: false, reason: reason || `用户拒绝了 ${approvalMessage}` });
    }
  }
}

/**
 * 为被拒绝的工具调用生成一个 tool role 消息，
 * 告知 LLM 该工具未被执行。
 */
export function createDeniedToolMessage(
  toolCallId: string,
  reason: string
): ChatCompletionMessageParam {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: `[权限拒绝] ${reason}\n请尝试其他方案完成用户的任务。`,
  };
}

/**
 * 从 ToolResult 生成 tool role 消息。
 */
export function createToolResultMessage(
  toolCallId: string,
  result: ToolResult
): ChatCompletionMessageParam {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: result.llmContent,
  };
}
