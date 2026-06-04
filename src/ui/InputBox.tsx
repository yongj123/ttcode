import { useState, useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface Props {
  onSubmit: (text: string) => void;
  busy: boolean;
}

export function InputBox({ onSubmit, busy }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
      setValue("");
    },
    [onSubmit]
  );

  return (
    <Box paddingX={1} paddingY={1}>
      <Text color="cyan" bold>
        ❯{" "}
      </Text>
      {busy ? (
        <Text dimColor>处理中，请稍候 (Esc 取消)...</Text>
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="输入任务..."
        />
      )}
    </Box>
  );
}
