import { useState, useCallback, useRef, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { LLMClient } from "../client";
import { Agent } from "../Agent";
import { ChatView } from "./ChatView";
import { InputBox } from "./InputBox";
import { PermissionPrompt } from "./PermissionPrompt";
import { SessionList } from "./SessionList";
import { SessionManager } from "../session";
import { InteractiveResolver } from "../permission";
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

type ViewMode = "chat" | "sessions";

/** Bash/Write/Edit 需要显式确认，不能空输入通过 */
function isDangerousTool(toolName?: string): boolean {
  if (!toolName) return false;
  return ["execute_command", "write_to_file", "edit_file"].includes(toolName);
}

export function App({ apiKey, baseURL, model }: AppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [sessions, setSessions] = useState<ReturnType<typeof SessionManager.prototype.list>>([]);
  const { exit } = useApp();

  // ---- 持久引用 ----
  const clientRef = useRef<LLMClient | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const sessionRef = useRef<SessionManager | null>(null);
  const resolverRef = useRef<InteractiveResolver | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 同步防重入守卫：state 是异步的，ref 可以立即阻断重复调用 */
  const busyRef = useRef(false);

  // ---- 权限确认状态 ----
  const [pendingPermission, setPendingPermission] = useState<{
    approvalMessage: string;
    toolName?: string;
  } | null>(null);

  // ---- 初始化 ----
  if (!clientRef.current) {
    clientRef.current = new LLMClient({ apiKey, baseURL, model });
    sessionRef.current = new SessionManager();
    resolverRef.current = new InteractiveResolver();
    agentRef.current = new Agent({
      client: clientRef.current,
      permissionResolver: resolverRef.current,
    });
  }

  const sessionManager = sessionRef.current!;
  const permissionResolver = resolverRef.current!;

  // ---- Esc 取消 ----
  useInput((_input, key) => {
    if (key.escape && busy && abortRef.current) {
      abortRef.current.abort();
      busyRef.current = false;
      setBusy(false);
      setStatusLine("已取消");
      // 释放权限等待（防止 generator 悬挂）
      permissionResolver.cancel();
      setPendingPermission(null);
      // 不保存 in-flight 消息 —— 可能包含未闭合的 tool_calls，
      // 恢复时会导致 API 报错。下次正常完成时再保存。
    }
  });

  // ---- 权限确认：事件驱动（替代轮询） ----
  useEffect(() => {
    permissionResolver.onPending = (msg: string, toolName: string) => {
      setPendingPermission({ approvalMessage: msg, toolName });
    };
    return () => {
      permissionResolver.onPending = null;
    };
  }, [permissionResolver]);

  // ---- 初次加载 session 列表 ----
  useEffect(() => {
    setSessions(sessionManager.list());
  }, [sessionManager]);

  // ---- 提交处理 ----
  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || busyRef.current) return;

      // 命令处理
      if (text.startsWith("/")) {
        handleCommand(text);
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setStatusLine("");

      // 确保有活跃 session
      if (!sessionManager.getCurrent()) {
        sessionManager.create(text.slice(0, 40));
      } else if (sessionManager.getCurrent()!.messages.length === 0) {
        sessionManager.updateTitle(text.slice(0, 40));
      }

      // 添加用户消息
      const userMsg: ChatMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);

      abortRef.current = new AbortController();
      const agent = agentRef.current!;

      try {
        const stream = agent.run(text, abortRef.current.signal);
        let assistantContent = "";

        for await (const event of stream) {
          switch (event.type) {
            case "text":
              assistantContent += event.content || "";
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  last.content = assistantContent;
                } else {
                  next.push({ role: "assistant", content: assistantContent });
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

            case "tool_permission_denied":
              setStatusLine(`🚫 ${event.toolName}: ${event.content || "已拒绝"}`);
              break;

            case "thinking":
              setStatusLine(event.content || "");
              break;

            case "done": {
              busyRef.current = false;
              setBusy(false);
              setStatusLine(
                `✅ 完成 | tokens: ${event.usage?.input ?? 0}→${event.usage?.output ?? 0}`
              );
              // 持久化
              const msgs = agent.getMessages();
              sessionManager.updateMessages(msgs);
              break;
            }

            case "error":
              busyRef.current = false;
              setBusy(false);
              setStatusLine(`❌ ${event.content}`);
              break;
          }
        }
      } catch (err) {
        busyRef.current = false;
        setBusy(false);
        setStatusLine(`❌ ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [exit, sessionManager, permissionResolver]
  );

  // ---- 权限确认 ----
  const handlePermissionApprove = useCallback(() => {
    permissionResolver.approve();
    setPendingPermission(null);
  }, [permissionResolver]);

  const handlePermissionDeny = useCallback(() => {
    permissionResolver.deny("用户手动拒绝");
    setPendingPermission(null);
  }, [permissionResolver]);

  // ---- 命令 ----
  const handleCommand = useCallback(
    (cmd: string) => {
      switch (cmd) {
        case "/exit":
        case "/quit":
          exit();
          break;
        case "/clear":
          setMessages([]);
          agentRef.current?.reset();
          sessionManager.create();
          break;
        case "/new":
          setMessages([]);
          agentRef.current?.reset();
          sessionManager.create();
          setStatusLine("新对话已创建");
          break;
        case "/sessions":
        case "/list":
          setSessions(sessionManager.list());
          setViewMode("sessions");
          break;
        default:
          setStatusLine(`未知命令: ${cmd}`);
      }
    },
    [exit, sessionManager]
  );

  // ---- Session 恢复 ----
  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      const session = sessionManager.load(sessionId);
      if (!session) {
        setStatusLine("会话不存在");
        return;
      }

      setViewMode("chat");
      agentRef.current!.setMessages(session.messages);

      // 建立 tool_call_id → function.name 映射
      const toolNameMap = new Map<string, string>();
      for (const m of session.messages) {
        if (m.role === "assistant" && m.tool_calls) {
          for (const tc of m.tool_calls) {
            if (tc.id && "function" in tc && tc.function?.name) {
              toolNameMap.set(tc.id, tc.function.name);
            }
          }
        }
      }

      // 转换 ChatCompletionMessageParam → ChatMessage（用于 UI 展示）
      const uiMessages: ChatMessage[] = [];
      for (const m of session.messages) {
        if (m.role === "system") continue;

        if (m.role === "assistant") {
          if (m.tool_calls && !m.content) continue;
          uiMessages.push({
            role: "assistant",
            content: typeof m.content === "string" ? m.content : "",
          });
        } else if (m.role === "tool") {
          const realName = m.tool_call_id
            ? toolNameMap.get(m.tool_call_id)
            : undefined;
          uiMessages.push({
            role: "tool",
            content: typeof m.content === "string"
              ? m.content.slice(0, 80)
              : "(工具调用)",
            toolName: realName || (m.tool_call_id ? `${m.tool_call_id.slice(0, 8)}` : "tool"),
          });
        } else if (m.role === "user") {
          uiMessages.push({
            role: "user",
            content: typeof m.content === "string" ? m.content : "",
          });
        }
      }

      setMessages(uiMessages);
      setStatusLine(`已恢复: ${session.title}`);
    },
    [sessionManager]
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      sessionManager.delete(sessionId);
      setSessions(sessionManager.list());
      setStatusLine("会话已删除");
    },
    [sessionManager]
  );

  const handleBackToChat = useCallback(() => {
    setViewMode("chat");
  }, []);

  // ---- 渲染 ----
  if (viewMode === "sessions") {
    return (
      <SessionList
        sessions={sessions}
        onResume={handleResumeSession}
        onDelete={handleDeleteSession}
        onBack={handleBackToChat}
      />
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* 权限确认弹窗 */}
      {pendingPermission && (
        <PermissionPrompt
          message={pendingPermission.approvalMessage}
          dangerous={isDangerousTool(pendingPermission.toolName)}
          onApprove={handlePermissionApprove}
          onDeny={handlePermissionDeny}
        />
      )}

      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        <ChatView messages={messages} busy={busy} />
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor="gray">
        <InputBox onSubmit={handleSubmit} busy={busy} />
        {statusLine ? <Text dimColor>{statusLine}</Text> : null}
      </Box>
    </Box>
  );
}

export function renderApp(props: AppProps) {
  const { waitUntilExit } = render(<App {...props} />, { exitOnCtrlC: false });
  return waitUntilExit;
}
