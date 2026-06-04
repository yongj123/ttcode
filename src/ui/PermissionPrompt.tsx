import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";

interface Props {
  message: string;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * 权限确认弹窗。
 * 当工具需要用户确认时显示。
 */
export function PermissionPrompt({ message, onApprove, onDeny }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string) => {
    const input = text.trim().toLowerCase();
    if (input === "y" || input === "yes" || input === "") {
      onApprove();
    } else if (input === "n" || input === "no") {
      onDeny();
    }
    setValue("");
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      <Text bold color="yellow">
        ⚠️ 权限确认
      </Text>
      <Text>{message}</Text>
      <Box marginTop={1}>
        <Text color="green">[Y] 允许 </Text>
        <Text color="red">[N] 拒绝 </Text>
        <Text dimColor>(默认: 允许)</Text>
      </Box>
      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="Y/n"
        />
      </Box>
    </Box>
  );
}
