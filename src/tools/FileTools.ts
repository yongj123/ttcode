import { z } from "zod";
import { Tool, type ToolResult } from "../Tool";
import * as fs from "fs";
import * as path from "path";

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
