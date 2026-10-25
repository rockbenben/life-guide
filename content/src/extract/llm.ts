/**
 * LLM 客户端：Anthropic 兼容协议（POST {baseUrl}/messages）。
 *
 * 为什么不装 SDK：不为一次调用引一个新包，全局 fetch 就够。
 *
 * 凭据从哪来（顺序：环境变量 → 本地文件）：
 *   1. 环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 *   2. content/llm.local.json（已 gitignore，只在本机存在）
 * 两者都没有就报错退出 —— 绝不瞎编凭据，也绝不把 key 写进日志或文件。
 */
import fs from "node:fs";
import path from "node:path";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

/** 抽起草用的客户端。测试里换成假实现，命令里换成真实实现。 */
export interface LlmClient {
  complete(req: LlmRequest): Promise<string>;
}

export interface LlmConfigResult {
  config?: LlmConfig;
  /** 缺哪些字段 —— 直接给用户看，所以写成人话 */
  missing: string[];
  /** 凭据来自哪里 */
  from: "env" | "file" | "none";
}

const ENV_KEYS = {
  baseUrl: "LLM_BASE_URL",
  apiKey: "LLM_API_KEY",
  model: "LLM_MODEL",
} as const;

/** 本地凭据文件名（相对 content/），已写进 .gitignore。 */
export const LOCAL_CONFIG_FILE = "llm.local.json";

function readLocalConfig(contentDir: string): Partial<LlmConfig> {
  const p = path.join(contentDir, LOCAL_CONFIG_FILE);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<LlmConfig>;
    return {
      baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : undefined,
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : undefined,
      model: typeof raw.model === "string" ? raw.model : undefined,
    };
  } catch {
    // 配置文件坏了就当没有：报错信息由 missing 列表给出
    return {};
  }
}

/**
 * 读凭据。环境变量优先，缺的那一项回落到本地文件。
 *
 * 逐项回落而不是「二选一」：本机通常只有文件里有 model，
 * 而 baseUrl 走环境变量，两边拼起来才完整。
 */
export function loadLlmConfig(contentDir: string): LlmConfigResult {
  const local = readLocalConfig(contentDir);
  const pick = (field: keyof LlmConfig): string | undefined => {
    const env = process.env[ENV_KEYS[field]];
    if (env && env.trim()) return env.trim();
    const fromFile = local[field];
    if (fromFile && fromFile.trim()) return fromFile.trim();
    return undefined;
  };

  const baseUrl = pick("baseUrl");
  const apiKey = pick("apiKey");
  const model = pick("model");

  const missing: string[] = [];
  if (!baseUrl) missing.push(`${ENV_KEYS.baseUrl}（或 ${LOCAL_CONFIG_FILE} 里的 baseUrl）`);
  if (!apiKey) missing.push(`${ENV_KEYS.apiKey}（或 ${LOCAL_CONFIG_FILE} 里的 apiKey）`);
  if (!model) missing.push(`${ENV_KEYS.model}（或 ${LOCAL_CONFIG_FILE} 里的 model）`);
  if (missing.length) return { missing, from: "none" };

  const usedEnv = Object.values(ENV_KEYS).some((k) => process.env[k]?.trim());
  return {
    config: { baseUrl: baseUrl!, apiKey: apiKey!, model: model! },
    missing: [],
    from: usedEnv ? "env" : "file",
  };
}

/**
 * 从 Anthropic 兼容响应里取正文。
 *
 * 取**最后一个** type === "text" 的块：响应里可能夹着 thinking 块，
 * 而且 thinking 之后还可能跟多个 text 块，最后一个才是完整答案。
 */
export function extractText(body: unknown): string {
  const b = body as { content?: unknown; stop_reason?: string } | null;
  const content = b?.content;
  if (Array.isArray(content)) {
    for (let i = content.length - 1; i >= 0; i--) {
      const block = content[i] as { type?: string; text?: string } | null;
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        return block.text;
      }
    }
    // 常见原因：max_tokens 太小，全被 thinking 吃掉了，正文没轮上
    const kinds = content
      .map((c) => (c as { type?: string } | null)?.type ?? "?")
      .join("、");
    throw new Error(
      `响应里没有 text 块（块类型：${kinds}；stop_reason：${b?.stop_reason ?? "?"}）。` +
        `若是 max_tokens 用尽，调大预算再试。`,
    );
  }
  throw new Error("响应里没有 content 字段");
}

export interface LlmClientOptions {
  timeoutMs?: number;
  /** 失败后重试几次（默认 1 次） */
  retries?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 默认预算与超时。
 *
 * max_tokens 给到 32k 不是保守，是实测出来的：这个模型**每次都会先输出一段
 * thinking**，8000 的预算在一篇文章上就被 thinking 吃光了，正文块根本没轮上
 * （响应里只剩 thinking，没有 text）。一篇 3KB 的文章实测要 100～180 秒，
 * 所以超时给到 10 分钟。
 */
const DEFAULT_MAX_TOKENS = 32000;
const DEFAULT_TIMEOUT_MS = 600_000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createLlmClient(config: LlmConfig, opts: LlmClientOptions = {}): LlmClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? 1;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/messages`;

  return {
    async complete(req: LlmRequest): Promise<string> {
      const body = {
        model: config.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      };

      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await doFetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "anthropic-version": "2023-06-01",
              authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const text = await res.text();
          if (!res.ok) {
            // 只回传状态码与响应片段，不回传请求（请求里有 key）
            throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`);
          }
          return extractText(JSON.parse(text));
        } catch (err) {
          lastError = err;
          if (attempt < retries) await delay(1000 * (attempt + 1));
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}
