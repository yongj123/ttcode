import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";

interface Props {
  message: string;
  onApprove: () => void;
  onDeny: () => void;
  /** 是否危险操作（shell/write/edit 等）。危险操作必须显式输入 Y */
  dangerous?: boolean;
}

/**
 * 权限确认弹窗。
 * 非危险操作：Enter/空输入 = 允许（和 deepcode-cli 一致）
 * 危险操作（Bash/Write/Edit）：必须输入 Y 才允许，空输入 = 拒绝
 */
export function PermissionPrompt({
  message,
  onApprove,
  onDeny,
  dangerous = false,
}: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string) => {
    const input = text.trim().toLowerCase();
    if (input === "y" || input === "yes") {
      onApprove();
    } else if (input === "n" || input === "no") {
      onDeny();
    } else {
      // 空输入处理
      if (dangerous) {
        onDeny();
      } else {
        onApprove();
      }
    }
    setValue("");
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={dangerous ? "red" : "yellow"}
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      <Text bold color={dangerous ? "red" : "yellow"}>
        {dangerous ? "🔴 权限确认（需显式确认）" : "⚠️ 权限确认"}
      </Text>
      <Text>{message}</Text>
      <Box marginTop={1}>
        <Text color="green">[Y] 允许 </Text>
        <Text color="red">[N] 拒绝 </Text>
        {dangerous ? (
          <Text color="red">(必须输入 Y 确认)</Text>
        ) : (
          <Text dimColor>(默认: 允许)</Text>
        )}
      </Box>
      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={dangerous ? "输入 Y/N" : "Y/n"}
        />
      </Box>
    </Box>
  );
}
