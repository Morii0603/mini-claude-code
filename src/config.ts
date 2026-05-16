import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as readline from "readline";

const CONFIG_DIR = join(homedir(), ".mini-claude");
const CONFIG_PATH = join(CONFIG_DIR, "settings.json");

export interface ModelConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface AppConfig {
  models: ModelConfig[];
  activeModel: string;
}

// 从 ~/.mini-claude/settings.json 读取配置
export function loadConfig(): AppConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

// 从 ~/.mini-claude/settings.json 写配置
export function saveConfig(config: AppConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// 返回当前激活的模型配置
export function getActiveModel(config: AppConfig): ModelConfig {
  const active = config.models.find((m) => m.name === config.activeModel);
  return active ?? config.models[0]!;
}

// 切换激活模型并持久化
export function switchModel(config: AppConfig, name: string): ModelConfig | null {
  const found = config.models.find((m) => m.name === name);
  if (!found) return null;
  config.activeModel = name;
  saveConfig(config);
  return found;
}

// 交互式首次运行向导，引导用户输入模型名称、Base URL、API Key 和模型 ID
export async function runSetupWizard(): Promise<AppConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log("\n  Welcome to Mini Claude Code!");
  console.log("  Let's set up your first model configuration.\n");

  const name = await question("  Model display name (e.g. deepseek-v4): ");
  const baseURL = await question("  API Base URL (e.g. https://api.deepseek.com/anthropic): ");
  const apiKey = await question("  API Key: ");
  const model = await question("  Model ID (e.g. deepseek-v4-flash): ");

  rl.close();

  const modelConfig: ModelConfig = {
    name: name || "default",
    baseURL: baseURL || "https://api.deepseek.com/anthropic",
    apiKey,
    model: model || name || "deepseek-v4-flash",
  };

  const config: AppConfig = {
    models: [modelConfig],
    activeModel: modelConfig.name,
  };

  saveConfig(config);
  console.log(`\n  Configuration saved to ${CONFIG_PATH}`);
  console.log(`  Active model: ${modelConfig.name}\n`);

  return config;
}

// 交互式添加新模型的向导
export async function addModelWizard(config: AppConfig): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log("\n  Add a new model configuration:\n");

  const name = await question("  Model display name: ");
  if (!name) {
    console.log("  Cancelled.");
    rl.close();
    return;
  }
  if (config.models.some((m) => m.name === name)) {
    console.log(`  Model "${name}" already exists.`);
    rl.close();
    return;
  }

  const baseURL = await question("  API Base URL: ");
  const apiKey = await question("  API Key: ");
  const model = await question("  Model ID: ");

  rl.close();

  config.models.push({
    name,
    baseURL: baseURL || config.models[0]?.baseURL || "",
    apiKey,
    model: model || name,
  });
  config.activeModel = name;
  saveConfig(config);
  console.log(`  Model "${name}" added and set as active.\n`);
}
