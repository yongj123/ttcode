import { Box, Text } from "ink";
import type { ChatMessage } from "./App";
import { MessageLine } from "./MessageLine";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  showEmptyState: boolean;
}

export function ChatView({ messages, busy, showEmptyState }: Props) {
  // 仅渲染进行中的最后一条助手消息；历史消息交给 <Static>，避免输入框变化时反复擦写历史区。
  // flexGrow={1} 由父容器提供，自动占据 Static 和底部输入框之间的剩余空间。

  if (messages.length === 0) {
    if (!showEmptyState) return null;

    return (
      <Box flexDirection="column" paddingY={1} overflow="hidden">
        <Text bold color="cyan" wrap="truncate-end">ttcode</Text>
        <Text dimColor wrap="truncate-end">AI 编码助手 | 输入任务开始</Text>
        <Text dimColor wrap="truncate-end">/clear 清屏 | /exit 退出 | Esc 取消当前任务</Text>
      </Box>
    );
  }

  const lastMessage = messages[messages.length - 1];
  if (!busy || lastMessage?.role !== "assistant") return null;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <MessageLine message={lastMessage} />
      {busy && <Text dimColor>...</Text>}
    </Box>
  );
}
