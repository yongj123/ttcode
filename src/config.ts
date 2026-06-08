import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AppConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".ttcode");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/**
 * 加载配置，优先级：环境变量 > 配置文件 > 默认值
 */
export function loadConfig(): AppConfig {
  let fileConfig: AppConfig = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // 字段类型校验：只接受 string 类型的值
      if (parsed.apiKey !== undefined && typeof parsed.apiKey === "string") {
        fileConfig.apiKey = parsed.apiKey;
      }
      if (parsed.baseURL !== undefined && typeof parsed.baseURL === "string") {
        fileConfig.baseURL = parsed.baseURL;
      }
      if (parsed.model !== undefined && typeof parsed.model === "string") {
        fileConfig.model = parsed.model;
      }

      // 类型不匹配的字段打警告
      const fields = ["apiKey", "baseURL", "model"] as const;
      for (const f of fields) {
        if (parsed[f] !== undefined && typeof parsed[f] !== "string") {
          console.warn(`⚠️ 配置文件 ${CONFIG_FILE} 中 ${f} 字段类型错误（期望 string，实际 ${typeof parsed[f]}），已忽略`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ 配置文件 ${CONFIG_FILE} 解析失败: ${err instanceof Error ? err.message : String(err)}，将使用环境变量和默认值`);
    }
  }

  return {
    apiKey: process.env.DEEPSEEK_API_KEY || fileConfig.apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || fileConfig.baseURL,
    model: process.env.DEEPSEEK_MODEL || fileConfig.model,
  };
}
