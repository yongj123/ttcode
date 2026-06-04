#!/usr/bin/env bun
/**
 * ttcode CLI 入口。
 * UI 模块使用动态 import，避免非交互模式下加载 Ink。
 */

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  const pkg = require("../package.json") as { version?: string };
  process.stdout.write(`${pkg.version || "0.1.0"}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      "ttcode — AI coding assistant for your terminal",
      "",
      "Usage:",
      "  ttcode                                     Launch interactive TUI",
      "  ttcode -p <task>                           Run a task (read/grep only)",
      "  ttcode -p <task> --allow-tools edit,write  Allow specific tools",
      "  ttcode -p <task> --dangerously-auto-approve Allow ALL tools",
      "  ttcode --version                           Print version",
      "  ttcode --help                              Show this help",
      "",
      "Configuration:",
      "  Set DEEPSEEK_API_KEY environment variable.",
      "",
      "Inside TUI:",
      "  Enter     Send message",
      "  Esc       Cancel current task",
      "  /clear    Clear conversation",
      "  /new      Start fresh session",
      "  /sessions List & resume past sessions",
      "  /exit     Quit",
    ].join("\n") + "\n"
  );
  process.exit(0);
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  process.stderr.write(
    "❌ 缺少 DEEPSEEK_API_KEY 环境变量。\n" +
      "请设置: export DEEPSEEK_API_KEY=your-key\n"
  );
  process.exit(1);
}

const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

// 按模式选择入口
void (async () => {
  const promptIndex = args.findIndex(
    (a) => a === "-p" || a === "--prompt"
  );
  if (promptIndex !== -1) {
    const task = args[promptIndex + 1];
    if (!task) {
      process.stderr.write("❌ -p 参数后需要提供任务描述\n");
      process.exit(1);
    }
    // 解析允许的工具
    const allowToolsIdx = args.indexOf("--allow-tools");
    const allowedTools: string[] = [];
    if (allowToolsIdx !== -1 && allowToolsIdx + 1 < args.length) {
      allowedTools.push(...args[allowToolsIdx + 1].split(",").map((s) => s.trim()));
    }
    const dangerouslyApprove = args.includes("--dangerously-auto-approve");
    await runNonInteractive(task, { apiKey, baseURL, model, allowedTools, dangerouslyApprove });
  } else {
    const app = await import("./ui/App");
    void app.renderApp({ apiKey, baseURL, model });
  }
})();

async function runNonInteractive(
  task: string,
  opts: {
    apiKey: string;
    baseURL: string;
    model: string;
    allowedTools: string[];
    dangerouslyApprove: boolean;
  }
): Promise<void> {
  const { LLMClient } = await import("./client");
  const { Agent } = await import("./Agent");
  const { AutoAllowResolver } = await import("./permission");

  const client = new LLMClient(opts);
  const agent = new Agent({
    client,
    permissionResolver: new AutoAllowResolver(
      opts.allowedTools,
      opts.dangerouslyApprove
    ),
  });

  process.stdout.write(`⏳ ${task.slice(0, 60)}...\n\n`);

  try {
    for await (const event of agent.run(task)) {
      switch (event.type) {
        case "text":
          process.stdout.write(event.content || "");
          break;
        case "tool_call_start":
          process.stdout.write(
            `\n\n🔧 ${event.toolName}\n`
          );
          break;
        case "tool_call_result":
          if (event.toolResult) {
            process.stdout.write(
              `📦 ${event.toolResult.userSummary}\n`
            );
          }
          break;
        case "tool_permission_denied":
          process.stdout.write(
            `\n🚫 ${event.toolName}: ${event.content || "已拒绝"}\n`
          );
          break;
        case "error":
          process.stderr.write(`\n❌ ${event.content}\n`);
          break;
        case "done":
          process.stdout.write("\n\n✅ 完成\n");
          break;
      }
    }
  } catch (err) {
    process.stderr.write(
      `\n❌ ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}
