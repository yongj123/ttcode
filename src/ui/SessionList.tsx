import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import type { SessionSummary } from "../session";

interface Props {
  sessions: SessionSummary[];
  onResume: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onBack: () => void;
}

/**
 * 会话列表视图。
 * /sessions 命令触发。
 */
export function SessionList({ sessions, onResume, onDelete, onBack }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string) => {
    const input = text.trim();

    // 输入序号 → 恢复/删除
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= sessions.length) {
      onResume(sessions[num - 1].id);
      return;
    }

    // r<N> → 恢复, d<N> → 删除
    const match = input.match(/^([rd])(\d+)$/i);
    if (match) {
      const idx = parseInt(match[2], 10) - 1;
      if (idx >= 0 && idx < sessions.length) {
        if (match[1].toLowerCase() === "d") {
          onDelete(sessions[idx].id);
        } else {
          onResume(sessions[idx].id);
        }
        return;
      }
    }

    // b/back → 返回
    if (input === "b" || input === "back") {
      onBack();
      return;
    }
  };

  const formatTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return iso;
    }
  };

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold color="cyan">
        📋 历史会话
      </Text>
      <Text dimColor>输入序号恢复，rN恢复 / dN删除 / b返回</Text>

      {sessions.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>(无历史会话)</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginY={1}>
          {sessions.map((s, i) => (
            <Box key={s.id}>
              <Text color="cyan">{i + 1}. </Text>
              <Text>{s.title.slice(0, 30)}</Text>
              <Text dimColor> — {formatTime(s.updateTime)}</Text>
              <Text dimColor> ({s.messageCount}条)</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="输入序号..."
        />
      </Box>
    </Box>
  );
}
