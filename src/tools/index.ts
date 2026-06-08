import type { Tool } from "../Tool";
import { ListDirectoryTool, GlobTool, ReadTool, WriteTool, EditTool, MultiEditTool } from "./FileTools";
import { BashTool, GrepTool } from "./BashAndGrep";
import { TodoReadTool, TodoStore, TodoWriteTool } from "./TodoTools";

export interface ToolContext {
  todoStore?: TodoStore;
}

export function createTools(context: ToolContext = {}): Tool[] {
  const todoStore = context.todoStore ?? new TodoStore();
  return [
    new ListDirectoryTool(),
    new GlobTool(),
    new ReadTool(),
    new WriteTool(),
    new EditTool(),
    new MultiEditTool(),
    new BashTool(),
    new GrepTool(),
    new TodoWriteTool(todoStore),
    new TodoReadTool(todoStore),
  ];
}

const defaultTools = createTools();

/** 获取所有已注册的工具 */
export function getTools(): Tool[] {
  return defaultTools;
}

/** 按名称查找工具 */
export function findTool(name: string, tools: Tool[] = defaultTools): Tool | undefined {
  return tools.find((t) => t.name === name);
}

/** 生成所有工具的 OpenAI function calling definitions */
export function getToolDefinitions(tools: Tool[] = defaultTools): object[] {
  return tools.map((t) => t.toOpenAITool());
}
