import { Box, Text } from "ink";
import type { ChatMessage } from "./App";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
}

export function ChatView({ messages, busy }: Props) {
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold color="cyan">ttcode</Text>
        <Text dimColor>AI 编码助手 | 输入任务开始</Text>
        <Text dimColor>/clear 清屏 | /exit 退出 | Esc 取消当前任务</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => (
        <MessageLine key={i} message={msg} />
      ))}
      {busy && (
        <Text dimColor>...</Text>
      )}
    </Box>
  );
}

function MessageLine({ message }: { message: ChatMessage }) {
  switch (message.role) {
    case "user":
      return (
        <Box marginBottom={1}>
          <Text color="green" bold>👤 </Text>
          <Text>{message.content}</Text>
        </Box>
      );

    case "assistant":
      return (
        <Box marginBottom={1} flexDirection="column">
          <Text>{message.content}</Text>
        </Box>
      );

    case "tool":
      return (
        <Box marginBottom={1}>
          <Text color="yellow" dimColor>
            🔧 {message.toolName}: {message.toolResult?.userSummary || message.content}
          </Text>
        </Box>
      );

    case "system":
      return (
        <Box marginBottom={1}>
          <Text color="red">{message.content}</Text>
        </Box>
      );

    default:
      return null;
  }
}
