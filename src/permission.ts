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
 * 自动放行解析器（非交互模式）。
 * allow → 放行，ask/deny → 拒绝。
 */
export class AutoAllowResolver implements PermissionResolver {
  async resolve(tool: Tool, _input: unknown): Promise<PermissionDecision> {
    if (tool.permission === "deny") {
      return { allowed: false, reason: `工具 ${tool.name} 已被禁止使用` };
    }
    if (tool.permission === "ask") {
      return {
        allowed: false,
        reason: `非交互模式下，需要确认的工具 ${tool.name} 自动跳过`,
      };
    }
    return { allowed: true };
  }
}

/**
 * 交互模式解析器。
 * 通过回调将确认请求交给 UI 层处理。
 */
export class InteractiveResolver implements PermissionResolver {
  private pending:
    | {
        resolve: (decision: PermissionDecision) => void;
        tool: Tool;
        approvalMessage: string;
      }
    | null = null;

  /**
   * 等待权限决策。
   * UI 层调用此方法弹出确认框。
   */
  async resolve(
    tool: Tool,
    input: unknown
  ): Promise<PermissionDecision> {
    // deny 级别直接拒绝，不需要用户确认
    if (tool.permission === "deny") {
      return {
        allowed: false,
        reason: `工具 ${tool.name} 已被禁止使用`,
      };
    }

    // allow 级别自动放行
    if (tool.permission === "allow") {
      return { allowed: true };
    }

    // ask 级别 → 弹出确认框
    const approvalMessage = tool.getApprovalMessage(input);

    return new Promise<PermissionDecision>((resolve) => {
      this.pending = { resolve, tool, approvalMessage };
    });
  }

  /** 获取当前等待确认的请求（UI 层调用） */
  getPending(): {
    tool: Tool;
    approvalMessage: string;
  } | null {
    if (!this.pending) return null;
    return {
      tool: this.pending.tool,
      approvalMessage: this.pending.approvalMessage,
    };
  }

  /** 用户确认通过 */
  approve(): void {
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = null;
      resolve({ allowed: true });
    }
  }

  /** 用户拒绝 */
  deny(reason?: string): void {
    if (this.pending) {
      const { resolve, approvalMessage } = this.pending;
      this.pending = null;
      resolve({
        allowed: false,
        reason: reason || `用户拒绝了 ${approvalMessage}`,
      });
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
