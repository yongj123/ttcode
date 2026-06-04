import { Box, Text } from "ink";
import type { TodoItem } from "../tools/TodoTools";

interface Props {
  todos: TodoItem[];
}

const STATUS_ICON: Record<string, string> = {
  pending: "⬜",
  in_progress: "🔄",
  completed: "✅",
};

const PRIORITY_ICON: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

/** 按状态排序：in_progress > pending > completed */
function sortTodos(todos: TodoItem[]): TodoItem[] {
  const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };
  return [...todos].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
}

export function TodoListView({ todos }: Props) {
  if (todos.length === 0) return null;

  const sorted = sortTodos(todos);
  const pending = sorted.filter((t) => t.status === "pending").length;
  const inProgress = sorted.filter((t) => t.status === "in_progress").length;
  const completed = sorted.filter((t) => t.status === "completed").length;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" overflow="hidden">
      {/* 标题栏 */}
      <Box paddingX={1}>
        <Text bold dimColor>
          📋 任务列表
        </Text>
        <Text dimColor>
          {" "}
          {inProgress}进行中 / {pending}待处理 / {completed}已完成
        </Text>
      </Box>

      {/* 任务条目 — 只显示未完成的，状态变化时会减少 */}
      {sorted.map((todo) => {
        const dimmed = todo.status === "completed";
        return (
          <Box key={todo.id} paddingX={1} overflow="hidden">
            <Text dimColor={dimmed}>
              {STATUS_ICON[todo.status] ?? "  "}{" "}
              {PRIORITY_ICON[todo.priority] ?? ""}{" "}
              <Text dimColor={dimmed} strikethrough={dimmed}>
                {todo.content}
              </Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
