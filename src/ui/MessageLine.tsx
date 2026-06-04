import { Box, Text } from "ink";
import type { ChatMessage } from "./App";

interface Props {
  message: ChatMessage;
}

export function MessageLine({ message }: Props) {
  switch (message.role) {
    case "user":
      return (
        <Box marginBottom={1} overflow="hidden">
          <Text color="green" bold wrap="wrap">
            {"> "}
          </Text>
          <Text wrap="wrap">{normalizeForTerminal(message.content)}</Text>
        </Box>
      );

    case "assistant":
      return (
        <Box marginBottom={1} flexDirection="column" overflow="hidden">
          <Text wrap="wrap">{normalizeForTerminal(message.content)}</Text>
        </Box>
      );

    case "tool":
      return (
        <Box marginBottom={1} overflow="hidden">
          <Text color="yellow" dimColor wrap="wrap">
            [tool] {message.toolName}: {" "}
            {normalizeForTerminal(message.toolResult?.userSummary || message.content)}
          </Text>
        </Box>
      );

    case "system":
      return (
        <Box marginBottom={1} overflow="hidden">
          <Text color="red" wrap="wrap">{normalizeForTerminal(message.content)}</Text>
        </Box>
      );

    default:
      return null;
  }
}

function normalizeForTerminal(text: string) {
  return text.replace(/[\uFE00-\uFE0F]/g, "");
}
