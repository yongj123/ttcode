import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LLMClient } from "../client";

export interface ConversationSummary {
  content: string;
  updatedAt: string;
  coveredMessageCount: number;
}

export interface MemoryOptions {
  compactMessageThreshold?: number;
  compactTokenThreshold?: number;
  recentMessageCount?: number;
  summaryMaxTokens?: number;
}

export interface CompactResult {
  summary: ConversationSummary;
  messages: ChatCompletionMessageParam[];
}

export class MemoryManager {
  private readonly compactMessageThreshold: number;
  private readonly compactTokenThreshold: number;
  private readonly recentMessageCount: number;
  private readonly summaryMaxTokens: number;

  constructor(private readonly client: LLMClient, options: MemoryOptions = {}) {
    this.compactMessageThreshold = options.compactMessageThreshold ?? 50;
    this.compactTokenThreshold = options.compactTokenThreshold ?? 24_000;
    this.recentMessageCount = options.recentMessageCount ?? 18;
    this.summaryMaxTokens = options.summaryMaxTokens ?? 1200;
  }

  shouldCompact(messages: ChatCompletionMessageParam[]): boolean {
    const nonSystemMessages = messages.filter((message) => message.role !== "system");
    if (nonSystemMessages.length > this.compactMessageThreshold) return true;
    return estimateTokens(messages) > this.compactTokenThreshold;
  }

  async compact(
    messages: ChatCompletionMessageParam[],
    previousSummary?: ConversationSummary
  ): Promise<CompactResult | null> {
    const systemMessage = messages.find((message) => message.role === "system");
    const bodyMessages = messages.filter((message) => message.role !== "system");
    const splitIndex = findSafeRecentStart(bodyMessages, this.recentMessageCount);

    if (splitIndex <= 0) return null;

    const messagesToSummarize = bodyMessages.slice(0, splitIndex);
    const recentMessages = bodyMessages.slice(splitIndex);
    if (messagesToSummarize.length === 0) return null;

    const summaryContent = await this.summarize(messagesToSummarize, previousSummary);
    const summary: ConversationSummary = {
      content: summaryContent.trim(),
      updatedAt: new Date().toISOString(),
      coveredMessageCount:
        (previousSummary?.coveredMessageCount ?? 0) + messagesToSummarize.length,
    };

    const compactedMessages: ChatCompletionMessageParam[] = [];
    if (systemMessage) compactedMessages.push(systemMessage);
    compactedMessages.push(...recentMessages);

    return { summary, messages: compactedMessages };
  }

  buildRuntimeMessages(
    messages: ChatCompletionMessageParam[],
    summary?: ConversationSummary
  ): ChatCompletionMessageParam[] {
    const systemMessage = messages.find((message) => message.role === "system");
    const bodyMessages = messages.filter(
      (message) => message.role !== "system" && !isSummaryMessage(message)
    );
    const splitIndex = findSafeRecentStart(bodyMessages, this.recentMessageCount);
    const recentMessages = bodyMessages.slice(splitIndex);

    const runtimeMessages: ChatCompletionMessageParam[] = [];
    if (systemMessage) runtimeMessages.push(systemMessage);
    if (summary?.content) runtimeMessages.push(createSummaryMessage(summary));
    runtimeMessages.push(...recentMessages);
    return runtimeMessages;
  }

  private async summarize(
    messages: ChatCompletionMessageParam[],
    previousSummary?: ConversationSummary
  ): Promise<string> {
    const transcript = messages.map(formatMessageForSummary).join("\n\n");
    const prior = previousSummary?.content
      ? `已有历史摘要：\n${previousSummary.content}\n\n`
      : "";

    return this.client.chat(
      [
        {
          role: "system",
          content:
            "你负责为编程 Agent 压缩长对话上下文。请用中文生成高密度摘要，只保留后续继续任务必需的信息。必须保留：用户目标、明确约束、当前任务状态、关键决策、已读/已改文件、工具执行结果、错误与验证结果、未完成事项。不要编造。不要输出寒暄。",
        },
        {
          role: "user",
          content: `${prior}请压缩以下对话片段：\n\n${transcript}`,
        },
      ],
      { temperature: 0, maxTokens: this.summaryMaxTokens }
    );
  }
}

export function createSummaryMessage(
  summary: ConversationSummary
): ChatCompletionMessageParam {
  return {
    role: "system",
    content: `[ttcode conversation summary]\n${summary.content}`,
  };
}

export function isSummaryMessage(message: ChatCompletionMessageParam): boolean {
  return message.role === "system" &&
    typeof message.content === "string" &&
    message.content.startsWith("[ttcode conversation summary]");
}

function findSafeRecentStart(
  messages: ChatCompletionMessageParam[],
  recentMessageCount: number
): number {
  let start = Math.max(0, messages.length - recentMessageCount);

  while (start > 0 && isToolMessage(messages[start])) {
    start--;
  }

  while (start > 0 && hasToolCalls(messages[start - 1])) {
    start--;
  }

  return start;
}

function hasToolCalls(message: ChatCompletionMessageParam | undefined): boolean {
  return Boolean(message && message.role === "assistant" && message.tool_calls?.length);
}

function isToolMessage(message: ChatCompletionMessageParam | undefined): boolean {
  return message?.role === "tool";
}

function formatMessageForSummary(message: ChatCompletionMessageParam): string {
  const role = message.role;
  const content = contentToText(message.content);

  if (role === "assistant" && message.tool_calls?.length) {
    const calls = message.tool_calls
      .map((call) => {
        if ("function" in call) {
          return `${call.function.name}(${call.function.arguments})`;
        }
        return JSON.stringify(call);
      })
      .join("\n");
    return `assistant tool_calls:\n${calls}${content ? `\nassistant text:\n${content}` : ""}`;
  }

  if (role === "tool") {
    const toolId = message.tool_call_id ? ` ${message.tool_call_id}` : "";
    return `tool${toolId}:\n${truncate(content, 2000)}`;
  }

  return `${role}:\n${truncate(content, 4000)}`;
}

function contentToText(content: ChatCompletionMessageParam["content"]): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return JSON.stringify(content);
}

function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  const textLength = messages.reduce(
    (sum, message) => sum + contentToText(message.content).length,
    0
  );
  return Math.ceil(textLength / 4);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...(已截断)`;
}
