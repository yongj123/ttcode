import { Box, Text } from "ink";
import type { TodoItem } from "../tools/TodoTools";

interface Props {
  todos: TodoItem[];
}

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✔",
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "red",
  medium: "yellow",
  low: "green",
};

function sortTodos(todos: TodoItem[]): TodoItem[] {
  const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };
  return [...todos].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
}

export function TodoListView({ todos }: Props) {
  if (todos.length === 0) return null;

  const sorted = sortTodos(todos);
  const inProgress = sorted.filter((t) => t.status === "in_progress").length;
  const pending = sorted.filter((t) => t.status === "pending").length;
  const completed = sorted.filter((t) => t.status === "completed").length;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 顶部分隔 + 统计 */}
      <Box>
        <Text dimColor>── 任务列表 </Text>
        <Text color="cyan">{inProgress} 进行中</Text>
        <Text dimColor> · </Text>
        <Text dimColor>{pending} 待处理</Text>
        {completed > 0 && (
          <>
            <Text dimColor> · </Text>
            <Text color="green">{completed} 已完成</Text>
          </>
        )}
        <Text dimColor> ──</Text>
      </Box>

      {/* 任务条目 */}
      {sorted.map((todo) => {
        const dimmed = todo.status === "completed";
        const icon = STATUS_ICON[todo.status] ?? " ";
        const color = PRIORITY_COLOR[todo.priority] ?? "white";

        return (
          <Box key={todo.id}>
            <Text color={dimmed ? "gray" : color} dimColor={dimmed}>
              {"  "}{icon}
            </Text>
            <Text dimColor={dimmed} strikethrough={dimmed}>
              {" "}{todo.content}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
