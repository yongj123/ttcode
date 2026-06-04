import { z } from "zod";
import { Tool, type ToolResult } from "../Tool";

const TODO_STATUS = ["pending", "in_progress", "completed"] as const;
const TODO_PRIORITY = ["high", "medium", "low"] as const;

export type TodoStatus = (typeof TODO_STATUS)[number];
export type TodoPriority = (typeof TODO_PRIORITY)[number];

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export class TodoStore {
  private todos: TodoItem[] = [];

  list(): TodoItem[] {
    return this.todos.map((todo) => ({ ...todo }));
  }

  replace(todos: TodoItem[]): TodoItem[] {
    this.todos = todos.map((todo) => ({ ...todo }));
    return this.list();
  }
}

const TODO_ITEM_SCHEMA = z.object({
  id: z.string().min(1).describe("任务唯一 ID，保持稳定，例如 task_1"),
  content: z.string().min(1).describe("任务内容，清晰描述要完成的具体事项"),
  status: z.enum(TODO_STATUS).describe("任务状态：pending、in_progress、completed"),
  priority: z.enum(TODO_PRIORITY).describe("任务优先级：high、medium、low"),
});

const TODO_WRITE_SCHEMA = z.object({
  todos: z.array(TODO_ITEM_SCHEMA).describe("完整任务列表。每次调用都应传入全量列表，而不是增量修改。"),
});

export class TodoWriteTool extends Tool<typeof TODO_WRITE_SCHEMA> {
  name = "todo_write";
  description =
    "创建或更新当前会话的任务列表。用于多步骤任务拆分、进度跟踪和 Agent Loop 持续反馈。每次必须传入完整任务列表。";
  permission = "allow" as const;
  inputSchema = TODO_WRITE_SCHEMA;

  constructor(private readonly store: TodoStore) {
    super();
  }

  protected async invoke(
    input: z.infer<typeof this.inputSchema>
  ): Promise<ToolResult> {
    const todos = this.store.replace(input.todos);
    return this.ok(formatTodos(todos), summarizeTodos(todos));
  }
}

const TODO_READ_SCHEMA = z.object({});

export class TodoReadTool extends Tool<typeof TODO_READ_SCHEMA> {
  name = "todo_read";
  description = "读取当前会话的任务列表，用于恢复上下文或确认下一步任务。";
  permission = "allow" as const;
  inputSchema = TODO_READ_SCHEMA;

  constructor(private readonly store: TodoStore) {
    super();
  }

  protected async invoke(): Promise<ToolResult> {
    const todos = this.store.list();
    if (todos.length === 0) {
      return this.ok("当前没有任务。", "读取任务列表：空");
    }
    return this.ok(formatTodos(todos), summarizeTodos(todos));
  }
}

function formatTodos(todos: TodoItem[]): string {
  if (todos.length === 0) return "当前没有任务。";

  const lines = todos.map((todo) => {
    const marker = todo.status === "completed" ? "x" : todo.status === "in_progress" ? ">" : " ";
    return `- [${marker}] (${todo.priority}) ${todo.id}: ${todo.content} — ${todo.status}`;
  });

  return ["当前任务列表：", ...lines].join("\n");
}

function summarizeTodos(todos: TodoItem[]): string {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
  const pending = todos.filter((todo) => todo.status === "pending").length;
  return `任务更新：${completed}已完成 / ${inProgress}进行中 / ${pending}待处理`;
}
