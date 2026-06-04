import type { z } from "zod";

/**
 * 工具执行结果。
 * 对标 Claude Code Tool.ts 的 ToolResult。
 */
export interface ToolResult {
  /** 是否成功 */
  ok: boolean;
  /** 给 LLM 看的文本（放入 tool role message） */
  llmContent: string;
  /** 给用户看的摘要（UI 展示） */
  userSummary: string;
  /** 是否需要用户确认 */
  requiresApproval?: boolean;
  /** 审批提示文本 */
  approvalHint?: string;
}

/**
 * 权限级别。
 * 对标 deepcode-cli 的 always_allow / ask / deny。
 */
export type PermissionLevel = "allow" | "ask" | "deny";

/**
 * 工具基类。
 * 每个工具 = 一个模块，包含：
 *   1. name / description → 注册到 LLM
 *   2. inputSchema → Zod schema，自动生成 function declarations
 *   3. execute → 执行逻辑
 *   4. permission → 权限级别
 *
 * 对标 Claude Code 的 Tool.ts 设计。
 */
export abstract class Tool<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  /** 工具名（LLM 可见） */
  abstract name: string;

  /** 工具描述（LLM 可见） */
  abstract description: string;

  /** 参数 schema */
  abstract inputSchema: TInput;

  /** 权限级别：allow（自动放行）/ ask（每次询问）/ deny（禁止） */
  abstract permission: PermissionLevel;

  /**
   * 执行工具。
   * 子类实现具体逻辑。
   */
  protected abstract invoke(input: z.infer<TInput>): Promise<ToolResult>;

  /**
   * 公开执行入口，包裹 invoke，做统一的异常处理。
   */
  async execute(raw: unknown): Promise<ToolResult> {
    let input: z.infer<TInput>;
    try {
      input = this.inputSchema.parse(raw);
    } catch (err) {
      return this.fail(
        `参数校验失败: ${err instanceof Error ? err.message : String(err)}`,
        "参数错误"
      );
    }

    try {
      return await this.invoke(input);
    } catch (err) {
      return this.fail(
        `工具执行异常: ${err instanceof Error ? err.message : String(err)}`,
        "执行异常"
      );
    }
  }

  /**
   * 生成 OpenAI function calling 兼容的 tool definition。
   */
  toOpenAITool(): {
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  } {
    const zodToJson = (schema: z.ZodTypeAny): object => {
      const def = schema._def;
      // 简化版 zod → JSON Schema，覆盖基本类型
      switch (def.typeName) {
        case "ZodString":
          return { type: "string", ...(def.description ? { description: def.description } : {}) };
        case "ZodNumber":
          return { type: "number", ...(def.description ? { description: def.description } : {}) };
        case "ZodBoolean":
          return { type: "boolean", ...(def.description ? { description: def.description } : {}) };
        case "ZodEnum":
          return { type: "string", enum: def.values, ...(def.description ? { description: def.description } : {}) };
        case "ZodOptional":
          return zodToJson(def.innerType);
        case "ZodObject": {
          const shape = def.shape();
          const required = Object.keys(shape).filter(
            (k) => shape[k]._def.typeName !== "ZodOptional"
          );
          const properties: Record<string, object> = {};
          for (const [key, val] of Object.entries(shape)) {
            properties[key] = zodToJson(val as z.ZodTypeAny);
          }
          return {
            type: "object",
            properties,
            required,
            ...(def.description ? { description: def.description } : {}),
          };
        }
        case "ZodArray":
          return { type: "array", items: zodToJson(def.type), ...(def.description ? { description: def.description } : {}) };
        default:
          return {};
      }
    };

    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: zodToJson(this.inputSchema),
      },
    };
  }

  /**
   * 生成审批提示文本。
   * 例如："read_file /path/to/file (读取文件)"
   */
  getApprovalMessage(raw: unknown): string {
    const input = this.inputSchema.safeParse(raw);
    if (!input.success) return `${this.name}(参数无效)`;
    const brief = JSON.stringify(input.data, null, 0)
      .replace(/[{}"]/g, "")
      .replace(/,/g, ", ");
    return `${this.name} ${brief}`;
  }

  protected ok(llmContent: string, userSummary: string = ""): ToolResult {
    return { ok: true, llmContent, userSummary: userSummary || llmContent.slice(0, 80) };
  }

  protected fail(llmContent: string, userSummary: string = ""): ToolResult {
    return { ok: false, llmContent, userSummary: userSummary || llmContent.slice(0, 80) };
  }
}
