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
      fileConfig = JSON.parse(raw) as AppConfig;
    } catch {
      // 配置文件解析失败，忽略
    }
  }

  return {
    apiKey: process.env.DEEPSEEK_API_KEY || fileConfig.apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || fileConfig.baseURL,
    model: process.env.DEEPSEEK_MODEL || fileConfig.model,
  };
}
