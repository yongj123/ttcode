import { useState, useCallback, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { LLMClient } from "../client";
import { Agent } from "../Agent";
import { ChatView } from "./ChatView";
import { InputBox } from "./InputBox";
import type { ToolResult } from "../Tool";

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult;
}

interface AppProps {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export function App({ apiKey, baseURL, model }: AppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const { exit } = useApp();

  const clientRef = useRef<LLMClient | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!clientRef.current) {
    clientRef.current = new LLMClient({ apiKey, baseURL, model });
    agentRef.current = new Agent({ client: clientRef.current });
  }

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;

      // 特殊命令
      if (text === "/exit" || text === "/quit") {
        exit();
        return;
      }
      if (text === "/clear") {
        setMessages([]);
        agentRef.current?.reset();
        return;
      }

      setBusy(true);
      setStatusLine("思考中...");

      setMessages((prev) => [...prev, { role: "user", content: text }]);

      abortRef.current = new AbortController();
      const assistantMsg: ChatMessage = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        for await (const event of agentRef.current!.run(
          text,
          abortRef.current.signal
        )) {
          switch (event.type) {
            case "text":
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  last.content += event.content || "";
                }
                return next;
              });
              break;

            case "tool_call_start":
              setStatusLine(`🔧 ${event.toolName}...`);
              break;

            case "tool_call_result":
              setStatusLine("");
              setMessages((prev) => [
                ...prev,
                {
                  role: "tool",
                  content: event.toolResult?.userSummary || "",
                  toolName: event.toolName,
                  toolResult: event.toolResult,
                },
              ]);
              break;

            case "thinking":
              setStatusLine(event.content || "");
              break;

            case "done":
              setBusy(false);
              setStatusLine(
                `✅ 完成 | tokens: ${event.usage?.input ?? 0}→${event.usage?.output ?? 0}`
              );
              break;

            case "error":
              setBusy(false);
              setStatusLine(`❌ ${event.content}`);
              setMessages((prev) => [
                ...prev,
                { role: "system", content: event.content || "未知错误" },
              ]);
              break;
          }
        }
      } catch (err) {
        setBusy(false);
        setStatusLine(`❌ ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [busy, exit]
  );

  // 处理 Ctrl+C
  useInput((_input, key) => {
    if (key.escape && busy && abortRef.current) {
      abortRef.current.abort();
      setBusy(false);
      setStatusLine("已取消");
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        <ChatView messages={messages} busy={busy} />
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor="gray">
        <InputBox onSubmit={handleSubmit} busy={busy} />
        {statusLine ? (
          <Text dimColor>{statusLine}</Text>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * 渲染入口。供 cli.tsx 调用。
 */
export function renderApp(props: AppProps) {
  const { waitUntilExit } = render(
    <App {...props} />,
    { exitOnCtrlC: false }
  );
  return waitUntilExit;
}
