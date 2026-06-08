import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ConversationSummary } from "./memory/MemoryManager";
import type { TodoItem } from "./tools/TodoTools";

// ================================================================
// 类型定义
// ================================================================

export interface SessionSummary {
  id: string;
  title: string;
  createTime: string;
  updateTime: string;
  messageCount: number;
}

export interface SessionData {
  id: string;
  title: string;
  createTime: string;
  updateTime: string;
  messages: ChatCompletionMessageParam[];
  summary?: ConversationSummary;
  todos?: TodoItem[];
}

// ================================================================
// SessionManager
// ================================================================

export class SessionManager {
  private storageDir: string;
  private currentSession: SessionData | null = null;

  constructor(storageDir?: string) {
    this.storageDir =
      storageDir || path.join(os.homedir(), ".ttcode", "sessions");
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  // ================================================================
  // CRUD
  // ================================================================

  /** 创建新会话 */
  create(title?: string): SessionData {
    const session: SessionData = {
      id: randomUUID(),
      title: title || "新对话",
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString(),
      messages: [],
    };
    this.currentSession = session;
    this.save(session);
    return session;
  }

  /** 保存会话 */
  save(session: SessionData): void {
    session.updateTime = new Date().toISOString();
    const filePath = this.sessionPath(session.id);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  /** 加载会话 */
  load(sessionId: string): SessionData | null {
    const filePath = this.sessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const session = JSON.parse(raw) as SessionData;

      // 兼容旧格式
      if (!session.messages) session.messages = [];
      if (!session.title) session.title = "未命名";

      this.currentSession = session;
      return session;
    } catch {
      return null;
    }
  }

  /** 删除会话 */
  delete(sessionId: string): boolean {
    const filePath = this.sessionPath(sessionId);
    if (!fs.existsSync(filePath)) return false;

    fs.unlinkSync(filePath);

    // 如果删除的是当前会话，清空
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }
    return true;
  }

  /** 列出所有会话摘要（按更新时间降序） */
  list(): SessionSummary[] {
    if (!fs.existsSync(this.storageDir)) return [];

    return fs
      .readdirSync(this.storageDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const filePath = path.join(this.storageDir, f);
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          const data = JSON.parse(raw) as SessionData;
          return {
            id: data.id,
            title: data.title || this.extractTitle(data),
            createTime: data.createTime,
            updateTime: data.updateTime,
            messageCount: data.messages?.length ?? 0,
          };
        } catch {
          return null;
        }
      })
      .filter((s): s is SessionSummary => s !== null)
      .sort(
        (a, b) =>
          new Date(b.updateTime).getTime() - new Date(a.updateTime).getTime()
      );
  }

  /** 获取当前会话 */
  getCurrent(): SessionData | null {
    return this.currentSession;
  }

  /** 更新当前会话的 messages */
  updateMessages(messages: ChatCompletionMessageParam[]): void {
    if (this.currentSession) {
      this.currentSession.messages = messages;
      this.save(this.currentSession);
    }
  }

  /** 更新当前会话的压缩摘要 */
  updateSummary(summary?: ConversationSummary): void {
    if (this.currentSession) {
      this.currentSession.summary = summary;
      this.save(this.currentSession);
    }
  }

  /** 同时更新当前会话的 messages 与压缩摘要 */
  updateMemory(messages: ChatCompletionMessageParam[], summary?: ConversationSummary): void {
    if (this.currentSession) {
      this.currentSession.messages = messages;
      this.currentSession.summary = summary;
      this.save(this.currentSession);
    }
  }

  /** 更新当前会话的 Todo 列表 */
  updateTodos(todos: TodoItem[]): void {
    if (this.currentSession) {
      this.currentSession.todos = todos;
      this.save(this.currentSession);
    }
  }

  /** 更新当前会话标题（取用户第一条消息前30字） */
  updateTitle(title: string): void {
    if (this.currentSession) {
      this.currentSession.title = title.slice(0, 40);
      this.save(this.currentSession);
    }
  }

  // ================================================================
  // 内部
  // ================================================================

  private sessionPath(sessionId: string): string {
    return path.join(this.storageDir, `${sessionId}.json`);
  }

  private extractTitle(data: SessionData): string {
    const userMsg = data.messages?.find((m: ChatCompletionMessageParam) => m.role === "user");
    if (userMsg && typeof userMsg.content === "string") {
      return userMsg.content.slice(0, 40);
    }
    return "新对话";
  }
}
