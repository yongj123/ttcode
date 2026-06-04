import { useState, useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface Props {
  onSubmit: (text: string) => void;
  busy: boolean;
  onInputChange?: (value: string) => void;
}

export function InputBox({ onSubmit, busy, onInputChange }: Props) {
  const [value, setValue] = useState("");

  const handleChange = useCallback(
    (text: string) => {
      setValue(text);
      onInputChange?.(text);
    },
    [onInputChange]
  );

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
    <Box paddingX={1} height={1} width="100%" overflow="hidden">
      <Text color="cyan" bold>
        ❯{" "}
      </Text>
      {busy ? (
        <Text dimColor>处理中，请稍候 (Esc 取消)...</Text>
      ) : (
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder="输入任务..."
        />
      )}
    </Box>
  );
}
