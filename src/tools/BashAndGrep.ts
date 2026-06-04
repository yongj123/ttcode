import { z } from "zod";
import { Tool, type ToolResult } from "../Tool";
import { spawnSync } from "child_process";

// ================================================================
// 危险命令检测
// ================================================================

/** 高风险命令模式：匹配即触发警告 */
const DANGEROUS_PATTERNS: { pattern: RegExp; risk: string }[] = [
  { pattern: /\brm\s+(-rf?\s+)?(\/|~|\*)/, risk: "删除文件/目录" },
  { pattern: />\s*\/dev\//, risk: "写入设备文件" },
  { pattern: /\bmkfs\b/, risk: "格式化文件系统" },
  { pattern: /\bdd\s+if=/, risk: "磁盘直接读写" },
  { pattern: /\bchmod\s+(-R\s+)?777/, risk: "宽松权限设置" },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh/, risk: "远程脚本直接执行" },
  { pattern: /\bgit\s+push\s+.*(--force|-f)/, risk: "强制推送" },
  { pattern: /\bgit\s+reset\s+--hard/, risk: "Git 硬重置" },
  { pattern: /\bdocker\s+rm\s+-f/, risk: "强制删除容器" },
  { pattern: /\bkill\s+-9/, risk: "强制杀进程" },
  { pattern: /\bsudo\b/, risk: "提权操作" },
];

function detectDanger(command: string): string[] {
  return DANGEROUS_PATTERNS
    .filter(({ pattern }) => pattern.test(command))
    .map(({ risk }) => `⚠️ ${risk}`);
}

// ================================================================
// BashTool
// ================================================================

export class BashTool extends Tool {
  name = "execute_command";
  description =
    "在终端中执行 shell 命令。用于运行构建、测试、git 操作等。命令超时 60 秒。\n" +
    "⚠️ 以下操作会触发额外警告：rm -rf、curl|sh、git push -f、sudo、chmod 777 等。";
  permission = "ask" as const;

  inputSchema = z.object({
    command: z.string().describe("要执行的 shell 命令"),
    cwd: z.string().optional().describe("工作目录，默认为当前目录"),
  });

  private readonly DEFAULT_TIMEOUT = 60_000;

  /** 重写审批信息：展示完整命令 + 工作目录 + 风险提示 */
  getApprovalMessage(raw: unknown): string {
    const input = this.inputSchema.safeParse(raw);
    if (!input.success) return `${this.name}(参数无效)`;
    const { command, cwd } = input.data;
    const workDir = cwd || process.cwd();
    const risks = detectDanger(command);
    const parts = [
      `执行命令: ${command}`,
      `工作目录: ${workDir}`,
    ];
    if (risks.length > 0) {
      parts.push(`风险检测:\n${risks.join("\n")}`);
    }
    return parts.join("\n");
  }

  protected async invoke(
    input: z.infer<typeof this.inputSchema>
  ): Promise<ToolResult> {
    const result = spawnSync(input.command, {
      shell: true,
      cwd: input.cwd || process.cwd(),
      timeout: this.DEFAULT_TIMEOUT,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const exitCode: number =
      (result as unknown as { exitCode: number | null }).exitCode ??
      (result.error ? 1 : 0);

    let llmContent = "";
    if (stdout) llmContent += stdout;
    if (stderr) llmContent += (llmContent ? "\n\n[stderr]\n" : "") + stderr;
    if (result.error) llmContent += `\n\n[执行异常]\n${result.error.message}`;
    if (!llmContent) llmContent = `(无输出)`;
    llmContent += `\n\n退出码: ${exitCode}`;

    const truncated = llmContent.length > 2000
      ? llmContent.slice(0, 2000) + "\n...(已截断)"
      : llmContent;

    return this.ok(truncated, `执行: ${input.command} (退出码: ${exitCode})`);
  }
}


export class GrepTool extends Tool {
  name = "search_code";
  description =
    "在项目中搜索代码。支持正则表达式，可指定文件类型过滤。";
  permission = "allow" as const;

  inputSchema = z.object({
    pattern: z.string().describe("正则表达式搜索模式"),
    path: z.string().optional().describe("搜索路径，默认为项目根目录"),
    include: z.string().optional().describe("文件类型过滤，如 '*.ts'"),
    maxResults: z.number().optional().describe("最大结果数，默认 20"),
  });

  protected async invoke(
    input: z.infer<typeof this.inputSchema>
  ): Promise<ToolResult> {
    const args: string[] = [
      "-n", // 行号
      "--color=never",
      "-H", // 文件名
    ];

    if (input.include) {
      args.push("--glob", input.include);
    }

    args.push(input.pattern);
    args.push(input.path || process.cwd());

    const result = spawnSync("rg", args, {
      encoding: "utf-8",
      timeout: 15_000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const stdout = (result.stdout || "").trim();
    const lines = stdout.split("\n").filter(Boolean);
    const maxResults = input.maxResults ?? 20;
    const truncated = lines.slice(0, maxResults);

    if (truncated.length === 0) {
      return this.ok("未找到匹配结果", `搜索 '${input.pattern}': 无结果`);
    }

    const summary =
      truncated.length < lines.length
        ? `搜索 '${input.pattern}': 找到 ${lines.length} 个结果 (显示前 ${truncated.length})`
        : `搜索 '${input.pattern}': 找到 ${truncated.length} 个结果`;

    return this.ok(truncated.join("\n"), summary);
  }
}
