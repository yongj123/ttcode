import { z } from "zod";
import { Tool, type ToolResult } from "../Tool";
import * as fs from "fs";
import * as path from "path";
import { Glob } from "bun";

export class ListDirectoryTool extends Tool {
  name = "list_directory";
  description = "列出指定目录下的文件和子目录。用于探索项目结构。";
  permission = "allow" as const;

  inputSchema = z.object({
    path: z.string().describe("目录绝对路径"),
  });

  protected async invoke(input: z.infer<typeof this.inputSchema>): Promise<ToolResult> {
    const resolved = path.resolve(input.path);

    if (!fs.existsSync(resolved)) {
      return this.fail(`目录不存在: ${resolved}`, `目录不存在: ${input.path}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return this.fail(`${resolved} 不是目录`, `${input.path} 不是目录`);
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const lines = entries.map((entry) => {
      const suffix = entry.isDirectory() ? "/" : "";
      return `${entry.name}${suffix}`;
    });

    if (lines.length === 0) {
      return this.ok("(空目录)", `列出 ${input.path}: 空目录`);
    }

    const content = lines.join("\n");
    return this.ok(content, `列出 ${input.path} (${entries.length}项)`);
  }
}


export class GlobTool extends Tool {
  name = "find_files";
  description = "按 glob 模式查找文件。用于按名称或路径模式搜索文件，如 '**/*.ts'、'src/**/*.tsx'。";
  permission = "allow" as const;

  inputSchema = z.object({
    pattern: z.string().describe("glob 匹配模式，如 '**/*.ts'、'src/**/*.tsx'"),
    path: z.string().optional().describe("搜索根目录，默认为当前工作目录"),
    maxResults: z.number().optional().describe("最大结果数，默认 50"),
  });

  protected async invoke(input: z.infer<typeof this.inputSchema>): Promise<ToolResult> {
    const cwd = input.path || process.cwd();
    const maxResults = input.maxResults ?? 50;

    if (!fs.existsSync(cwd)) {
      return this.fail(`目录不存在: ${cwd}`, `目录不存在: ${cwd}`);
    }

    try {
      const glob = new Glob(input.pattern);
      const matches: string[] = [];
      for await (const file of glob.scan({ cwd, dot: false })) {
        matches.push(file);
        if (matches.length >= maxResults) break;
      }

      if (matches.length === 0) {
        return this.ok("未找到匹配文件", `查找 '${input.pattern}': 无结果`);
      }

      const content = matches.join("\n");
      const truncated = matches.length >= maxResults
        ? `查找 '${input.pattern}': 显示前 ${maxResults} 个结果`
        : `查找 '${input.pattern}': 找到 ${matches.length} 个文件`;

      return this.ok(content, truncated);
    } catch (err) {
      return this.fail(
        `glob 匹配失败: ${err instanceof Error ? err.message : String(err)}`,
        `查找 '${input.pattern}' 失败`
      );
    }
  }
}


export class ReadTool extends Tool {
  name = "read_file";
  description = "读取指定文件的内容。支持指定行号范围。";
  permission = "allow" as const;

  inputSchema = z.object({
    filePath: z.string().describe("文件绝对路径"),
    offset: z.number().optional().describe("起始行号（0-based）"),
    limit: z.number().optional().describe("读取行数"),
  });

  protected async invoke(input: z.infer<typeof this.inputSchema>): Promise<ToolResult> {
    const resolved = path.resolve(input.filePath);

    if (!fs.existsSync(resolved)) {
      return this.fail(`文件不存在: ${resolved}`, `文件不存在: ${input.filePath}`);
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return this.fail(`${resolved} 是一个目录`, `${input.filePath} 是目录`);
    }

    const content = fs.readFileSync(resolved, "utf-8");
    const lines = content.split("\n");

    if (input.offset !== undefined || input.limit !== undefined) {
      const start = input.offset ?? 0;
      const end = input.limit ? start + input.limit : lines.length;
      const sliced = lines.slice(start, end);
      const result = sliced
        .map((line, i) => `${start + i + 1}: ${line}`)
        .join("\n");
      return this.ok(result, `读取 ${input.filePath} 第${start + 1}-${Math.min(end, lines.length)}行`);
    }

    // 返回带行号的内容
    const numbered = lines
      .map((line, i) => `${i + 1}: ${line}`)
      .join("\n");
    return this.ok(numbered, `读取 ${input.filePath} (${lines.length}行)`);
  }
}


const WRITE_SCHEMA = z.object({
  filePath: z.string().describe("文件绝对路径"),
  content: z.string().describe("要写入的完整内容"),
});

export class WriteTool extends Tool<typeof WRITE_SCHEMA> {
  name = "write_to_file";
  description = "创建或覆盖写入文件。会覆盖已有文件的全部内容。";
  permission = "ask" as const;

  inputSchema = WRITE_SCHEMA;

  protected async invoke(
    input: z.infer<typeof this.inputSchema>
  ): Promise<ToolResult> {
    const resolved = path.resolve(input.filePath);
    const dir = path.dirname(resolved);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolved, input.content, "utf-8");
    return this.ok(
      `文件已成功写入: ${resolved}\n${input.content.length} 字符`,
      `写入 ${input.filePath} (${input.content.length}字)`
    );
  }
}


const EDIT_SCHEMA = z.object({
  filePath: z.string().describe("文件绝对路径"),
  oldString: z.string().describe("要替换的精确文本片段"),
  newString: z.string().describe("替换后的新文本"),
  replaceAll: z.boolean().optional().describe("是否替换所有匹配项，默认只替换第一个"),
});

export class EditTool extends Tool<typeof EDIT_SCHEMA> {
  name = "edit_file";
  description =
    "精确替换文件中的文本。oldString 必须完全匹配文件中唯一出现的片段。";
  permission = "ask" as const;

  inputSchema = EDIT_SCHEMA;

  protected async invoke(
    input: z.infer<typeof this.inputSchema>
  ): Promise<ToolResult> {
    const resolved = path.resolve(input.filePath);

    if (!fs.existsSync(resolved)) {
      return this.fail(`文件不存在: ${resolved}`, `文件不存在: ${input.filePath}`);
    }

    const original = fs.readFileSync(resolved, "utf-8");

    if (input.replaceAll) {
      if (!original.includes(input.oldString)) {
        return this.fail(
          `oldString 在文件中未找到，请确认文本片段与文件内容完全一致。`,
          `编辑失败：未找到匹配`
        );
      }
      const replaced = original.split(input.oldString).join(input.newString);
      fs.writeFileSync(resolved, replaced, "utf-8");
      const count = original.split(input.oldString).length - 1;
      return this.ok(
        `已替换 ${count} 处匹配。文件: ${resolved}`,
        `编辑 ${input.filePath} (替换${count}处)`
      );
    }

    const count = original.split(input.oldString).length - 1;
    if (count === 0) {
      return this.fail(
        `oldString 在文件中未找到。`,
        `编辑失败：未找到匹配`
      );
    }
    if (count > 1) {
      return this.fail(
        `oldString 在文件中匹配了 ${count} 处，请提供更多上下文使之唯一，或设置 replaceAll=true。`,
        `编辑失败：${count}处匹配不唯一`
      );
    }

    const replaced = original.replace(input.oldString, input.newString);
    fs.writeFileSync(resolved, replaced, "utf-8");
    return this.ok(
      `已替换 1 处匹配。文件: ${resolved}`,
      `编辑 ${input.filePath} (替换1处)`
    );
  }
}


const MULTI_EDIT_SCHEMA = z.object({
  edits: z.array(z.object({
    filePath: z.string().describe("文件绝对路径"),
    oldString: z.string().describe("要替换的精确文本片段"),
    newString: z.string().describe("替换后的新文本"),
  })).min(1).describe("要执行的编辑列表，每个编辑包含 filePath、oldString、newString"),
});

export class MultiEditTool extends Tool<typeof MULTI_EDIT_SCHEMA> {
  name = "multi_edit";
  description =
    "在多个文件中批量执行精确文本替换。每个编辑项的 oldString 必须在对应文件中唯一匹配。所有编辑按顺序执行，某个编辑失败不影响后续编辑。";
  permission = "ask" as const;

  inputSchema = MULTI_EDIT_SCHEMA;

  protected async invoke(
    input: z.infer<typeof this.inputSchema>
  ): Promise<ToolResult> {
    const results: string[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const edit of input.edits) {
      const resolved = path.resolve(edit.filePath);

      if (!fs.existsSync(resolved)) {
        results.push(`❌ ${edit.filePath}: 文件不存在`);
        failCount++;
        continue;
      }

      const original = fs.readFileSync(resolved, "utf-8");
      const count = original.split(edit.oldString).length - 1;

      if (count === 0) {
        results.push(`❌ ${edit.filePath}: oldString 未找到`);
        failCount++;
        continue;
      }

      if (count > 1) {
        results.push(`❌ ${edit.filePath}: oldString 匹配 ${count} 处，不唯一`);
        failCount++;
        continue;
      }

      const replaced = original.replace(edit.oldString, edit.newString);
      fs.writeFileSync(resolved, replaced, "utf-8");
      results.push(`✅ ${edit.filePath}: 替换1处`);
      successCount++;
    }

    const summary = `批量编辑: ${successCount}成功 / ${failCount}失败`;
    return this.ok(results.join("\n"), summary);
  }
}
