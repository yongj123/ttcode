import { useState, useCallback, useRef, useEffect } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { LLMClient } from "../client";
import { Agent } from "../Agent";
import { MessageLine } from "./MessageLine";
import { InputBox } from "./InputBox";
import { TodoListView } from "./TodoListView";
import { PermissionPrompt } from "./PermissionPrompt";
import { SessionList } from "./SessionList";
import { SessionManager } from "../session";
import { InteractiveResolver } from "../permission";
import type { ToolResult } from "../Tool";
import type { TodoItem } from "../tools/TodoTools";

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

function isDangerousTool(toolName?: string): boolean {
  if (!toolName) return false;
  return ["execute_command", "write_to_file", "edit_file"].includes(toolName);
}

export function App({ apiKey, baseURL, model }: AppProps) {
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [sessions, setSessions] = useState<ReturnType<typeof SessionManager.prototype.list>>([]);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const clientRef = useRef<LLMClient | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const sessionRef = useRef<SessionManager | null>(null);
  const resolverRef = useRef<InteractiveResolver | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

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
      permissionResolver.cancel();
      setPendingPermission(null);
    }
  });

  useEffect(() => {
    permissionResolver.onPending = (msg: string, toolName: string) => {
      setPendingPermission({ approvalMessage: msg, toolName });
    };
    return () => {
      permissionResolver.onPending = null;
    };
  }, [permissionResolver]);

  useEffect(() => {
    setSessions(sessionManager.list());
  }, [sessionManager]);

  // ---- 提交处理 ----
  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || busyRef.current) return;

      if (text.startsWith("/")) {
        handleCommand(text);
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setStatusLine("");

      if (!sessionManager.getCurrent()) {
        sessionManager.create(text.slice(0, 40));
      } else if (sessionManager.getCurrent()!.messages.length === 0) {
        sessionManager.updateTitle(text.slice(0, 40));
      }

      // 用户消息直接追加到列表
      const userMsg: ChatMessage = { role: "user", content: text };
      setAllMessages((prev) => [...prev, userMsg]);

      abortRef.current = new AbortController();
      const agent = agentRef.current!;

      try {
        const stream = agent.run(text, abortRef.current.signal);
        let assistantContent = "";

        for await (const event of stream) {
          switch (event.type) {
            case "text":
              assistantContent += event.content || "";
              // 更新最后一条 assistant，或追加新的
              setAllMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [
                    ...prev.slice(0, -1),
                    { role: "assistant" as const, content: assistantContent },
                  ];
                }
                return [...prev, { role: "assistant", content: assistantContent }];
              });
              break;

            case "tool_call_start":
              setStatusLine(`🔧 ${event.toolName}...`);
              break;

            case "tool_call_result":
              setStatusLine("");
              // 下一轮 text 独立开始，重置累积
              assistantContent = "";
              setAllMessages((prev) => [
                ...prev,
                {
                  role: "tool",
                  content: event.toolResult?.userSummary || "",
                  toolName: event.toolName,
                  toolResult: event.toolResult,
                },
              ]);
              if (event.toolName === "todo_write" || event.toolName === "todo_read") {
                setTodos(agentRef.current?.getTodos() ?? []);
                // 立即持久化，避免中断丢失
                sessionManager.updateTodos(agentRef.current?.getTodos() ?? []);
              }
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
              // 确保最后的 assistant 消息不在列表中以空内容残留
              setAllMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && !last.content) {
                  return prev.slice(0, -1);
                }
                return prev;
              });
              const msgs = agent.getMessages();
              sessionManager.updateMemory(msgs, agent.getSummary());
              sessionManager.updateTodos(agent.getTodos());
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

  const handleCompact = useCallback(async () => {
    if (busyRef.current) {
      setStatusLine("任务执行中，暂不能压缩上下文");
      return;
    }
    const agent = agentRef.current;
    if (!agent) return;
    busyRef.current = true;
    setBusy(true);
    setStatusLine("正在压缩上下文...");
    try {
      const summary = await agent.compactNow();
      sessionManager.updateMemory(agent.getMessages(), summary);
      setStatusLine(summary ? "上下文已压缩" : "当前上下文无需压缩");
    } catch (err) {
      setStatusLine(`压缩失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [sessionManager]);

  // ---- 命令 ----
  const handleCommand = useCallback(
    (cmd: string) => {
      switch (cmd) {
        case "/exit":
        case "/quit":
          exit();
          break;
        case "/clear":
        case "/new":
          setAllMessages([]);
          setTodos([]);
          agentRef.current?.reset();
          sessionManager.create();
          if (cmd === "/new") setStatusLine("新对话已创建");
          break;
        case "/sessions":
        case "/list":
          setSessions(sessionManager.list());
          setViewMode("sessions");
          break;
        case "/compact":
          void handleCompact();
          break;
        default:
          setStatusLine(`未知命令: ${cmd}`);
      }
    },
    [exit, sessionManager, handleCompact]
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
      agentRef.current!.setSummary(session.summary);
      if (session.todos && session.todos.length > 0) {
        agentRef.current!.setTodos(session.todos);
        setTodos(session.todos);
      } else {
        agentRef.current!.setTodos([]);
        setTodos([]);
      }

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

      setAllMessages(uiMessages);
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

  const showEmpty = allMessages.length === 0;

  return (
    <Box flexDirection="column" height="100%">
      {pendingPermission && (
        <PermissionPrompt
          message={pendingPermission.approvalMessage}
          dangerous={isDangerousTool(pendingPermission.toolName)}
          onApprove={handlePermissionApprove}
          onDeny={handlePermissionDeny}
        />
      )}

      {/* 消息区域：flexGrow 自动撑满，overflow 裁剪旧消息，自然滚动到最新 */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {showEmpty ? (
          <Box flexDirection="column" paddingY={1}>
            <Text bold color="cyan" wrap="truncate-end">ttcode</Text>
            <Text dimColor wrap="truncate-end">AI 编码助手 | 输入任务开始</Text>
            <Text dimColor wrap="truncate-end">/clear 清屏 | /exit 退出 | Esc 取消当前任务</Text>
          </Box>
        ) : (
          allMessages.map((msg, i) => (
            <MessageLine key={`${i}-${msg.role}`} message={msg} />
          ))
        )}
        {busy && <Text dimColor>...</Text>}
      </Box>

      {/* 任务列表 */}
      <TodoListView todos={todos} />

      {/* 输入框 + 状态栏，固定底部 */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        width={terminalWidth}
        height={statusLine ? 4 : 3}
        overflow="hidden"
      >
        <InputBox onSubmit={handleSubmit} busy={busy} onInputChange={() => setStatusLine("")} />
        {statusLine ? <Text dimColor>{statusLine}</Text> : null}
      </Box>
    </Box>
  );
}

export function renderApp(props: AppProps) {
  const { waitUntilExit } = render(<App {...props} />);
  return waitUntilExit;
}
