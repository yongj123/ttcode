import { z } from "zod";
import { Tool, type ToolResult } from "../Tool";
import { spawn } from "child_process";

// ================================================================
// 危险命令检测
// ================================================================

/** 高风险命令模式：匹配即触发确认 */
const DANGEROUS_PATTERNS: { pattern: RegExp; risk: string }[] = [
  { pattern: /(^|[;&|()])\s*rm\s+/, risk: "删除文件/目录" },
  { pattern: /(^|\s)unlink\s+/, risk: "删除文件" },
  { pattern: /\bfind\b[\s\S]*(\s-delete\b|\s-exec\b|\s-ok\b)/, risk: "find 执行删除或外部命令" },
  { pattern: /\bxargs\b[\s\S]*\brm\b/, risk: "批量删除文件/目录" },
  { pattern: /(^|\s)(mv|cp)\s+.*\s+\//, risk: "移动/复制到系统路径" },
  { pattern: /(^|\s)truncate\s+/, risk: "截断文件内容" },
  { pattern: /(^|\s)tee\s+/, risk: "写入文件" },
  { pattern: /(^|[^2])>\s*(?!&)/, risk: "重定向写文件" },
  { pattern: />\s*\/dev\//, risk: "写入设备文件" },
  { pattern: /\bmkfs\b/, risk: "格式化文件系统" },
  { pattern: /\bdd\s+/, risk: "磁盘直接读写" },
  { pattern: /\bchmod\s+(-R\s+)?(777|\+w)/, risk: "宽松权限设置" },
  { pattern: /\bchown\s+(-R\s+)?/, risk: "修改文件所有者" },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh/, risk: "远程脚本直接执行" },
  { pattern: /\bwget\b.*\|\s*(ba)?sh/, risk: "远程脚本直接执行" },
  { pattern: /\b(node|python|python3|ruby|perl)\s+(-e|-c)\b/, risk: "执行内联脚本" },
  { pattern: /\b(sed|perl)\s+[^;&|]*\s-i\b/, risk: "原地修改文件" },
  { pattern: /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|update)\b/, risk: "修改依赖" },
  { pattern: /\b(pip|pip3)\s+(install|uninstall)\b/, risk: "修改 Python 依赖" },
  { pattern: /\bgit\s+push\s+.*(--force|-f)/, risk: "强制推送" },
  { pattern: /\bgit\s+reset\s+--hard/, risk: "Git 硬重置" },
  { pattern: /\bgit\s+clean\s+/, risk: "清理未跟踪文件" },
  { pattern: /\bgit\s+(checkout|restore)\s+.*(--|\.)/, risk: "还原工作区文件" },
  { pattern: /\bdocker\s+rm\s+-f/, risk: "强制删除容器" },
  { pattern: /\bkill\s+(-9|-KILL)\b/, risk: "强制杀进程" },
  { pattern: /\bsudo\b/, risk: "提权操作" },
];

function detectDanger(command: string): string[] {
  return DANGEROUS_PATTERNS
    .filter(({ pattern }) => pattern.test(command))
    .map(({ risk }) => `⚠️ ${risk}`);
}

// ================================================================
// 异步执行辅助
// ================================================================

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: Error;
}

/** 通过 shell 执行命令（用于 BashTool，支持管道、重定向等 shell 特性） */
function runCommand(
  command: string,
  cwd: string,
  timeout: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      shell: true,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += "\n[命令超时，已终止]";
    }, timeout);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: err,
      });
    });
  });
}

/** 直接执行命令（不经过 shell，参数安全传递，用于 GrepTool 等不需要 shell 特性的场景） */
function runCommandDirect(
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += "\n[命令超时，已终止]";
    }, timeout);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: err,
      });
    });
  });
}

// ================================================================
// BashTool
// ================================================================

export class BashTool extends Tool {
  name = "execute_command";
  description =
    "在终端中执行 shell 命令。用于运行构建、测试、git 操作等。命令超时 60 秒。\n" +
    "⚠️ 以下操作会触发额外警告：rm -rf、curl|sh、git push -f、sudo、chmod 777 等。";
  /** 静态标记为 ask，运行时根据命令内容动态降级为 allow */
  permission = "ask" as const;

  inputSchema = z.object({
    command: z.string().describe("要执行的 shell 命令"),
    cwd: z.string().optional().describe("工作目录，默认为当前目录"),
  });

  private readonly DEFAULT_TIMEOUT = 60_000;

  /** 安全命令自动放行，危险命令才询问用户 */
  resolvePermission(raw: unknown): "allow" | "ask" {
    const parsed = this.inputSchema.safeParse(raw);
    if (!parsed.success) return "ask";
    const risks = detectDanger(parsed.data.command);
    return risks.length === 0 ? "allow" : "ask";
  }

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
    const result = await runCommand(
      input.command,
      input.cwd || process.cwd(),
      this.DEFAULT_TIMEOUT,
    );

    let llmContent = "";
    if (result.stdout) llmContent += result.stdout;
    if (result.stderr) llmContent += (llmContent ? "\n\n[stderr]\n" : "") + result.stderr;
    if (result.error) llmContent += `\n\n[执行异常]\n${result.error.message}`;
    if (!llmContent) llmContent = `(无输出)`;
    llmContent += `\n\n退出码: ${result.exitCode}`;

    // LLM 获取完整输出以保证推理质量；用户看简要
    const userSummary = `执行: ${input.command} (退出码: ${result.exitCode})`;

    return this.ok(llmContent, userSummary);
  }
}


// ================================================================
// GrepTool
// ================================================================

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

    const result = await runCommandDirect(
      "rg",
      args,
      input.path || process.cwd(),
      15_000,
    );

    // rg 不存在：ENOENT
    if (result.error) {
      if ("code" in result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
        return this.fail(
          "ripgrep (rg) 未安装或不在 PATH 中。请安装 ripgrep: https://github.com/BurntSushi/ripgrep#installation",
          "rg 未安装"
        );
      }
      return this.fail(`搜索执行失败: ${result.error.message}`, "搜索失败");
    }

    // rg 退出码: 0=有匹配, 1=无匹配, 2=错误（正则错误、权限等）
    if (result.exitCode === 2) {
      const errMsg = result.stderr || "未知错误";
      return this.fail(`搜索出错: ${errMsg}`, `搜索 '${input.pattern}' 出错`);
    }

    const lines = result.stdout.split("\n").filter(Boolean);
    const maxResults = input.maxResults ?? 20;
    const truncated = lines.slice(0, maxResults);

    if (truncated.length === 0) {
      return this.ok("未找到匹配结果", `搜索 '${input.pattern}': 无结果`);
    }

    const content = truncated.join("\n");
    const summary =
      truncated.length < lines.length
        ? `搜索 '${input.pattern}': 找到 ${lines.length} 个结果 (显示前 ${truncated.length})`
        : `搜索 '${input.pattern}': 找到 ${truncated.length} 个结果`;

    return this.ok(content, summary);
  }
}
