import type { Tool } from "../Tool";
import { ReadTool, WriteTool, EditTool } from "./FileTools";
import { BashTool, GrepTool } from "./BashAndGrep";

const toolList: Tool[] = [
  new ReadTool(),
  new WriteTool(),
  new EditTool(),
  new BashTool(),
  new GrepTool(),
];

/** 获取所有已注册的工具 */
export function getTools(): Tool[] {
  return toolList;
}

/** 按名称查找工具 */
export function findTool(name: string): Tool | undefined {
  return toolList.find((t) => t.name === name);
}

/** 生成所有工具的 OpenAI function calling definitions */
export function getToolDefinitions(): object[] {
  return toolList.map((t) => t.toOpenAITool());
}
