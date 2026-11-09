/**
 * 同步的客户端：读本地 → 拉远端 → 合并 → 写回本地 → 推上去。
 *
 * 这一层管的是**顺序**，不是内容：
 * 合并规则在 domain/sync.ts（纯函数），加密在 sync-crypto.ts，
 * 怎么送到远端由 transport 决定（sync-http.ts 是其中一个实现）。
 *
 * ## 一轮同步做四件事
 *
 * 1. 把本地数据打包成一份载荷（buildLocalPayload）；
 * 2. 拉远端那份并解密（只有 404 表示不存在；网络失败停止本轮）；
 * 3. 两份合并（domain/sync.ts），结果写回本地（applyPayload）；
 * 4. 合并结果加密后推上去。
 *
 * **先写本地再推**：推失败（断网）时本地已经有远端的数据了，
 * 下次再推 —— 数据不会因为一次失败就两头都没有。
 *
 * ## 别人刚写過怎么办
 *
 * 两台设备同时同步时，后写的那份可能把先写的那份盖掉。
 * 所以推的时候带上"我读到的是第几版"（baseRev）：
 * 服务端发现版本对不上就说"冲突"并把当前那份退回来，
 * 客户端拿着它再合一次再推（最多两次）。
 */
import {
  getDeviceId, getSetting, saveClock, setSetting,
  readSyncPayload, commitSyncPayload,
} from "./db.ts";
import { validatePayload } from "./validate.ts";
import {
  stableStringify,
  payloadVersionIssue,
  type SyncPayload,
} from "../domain/sync.ts";
import {
  decryptPayload,
  deriveSecret,
  encryptPayload,
  type EncryptedBlob,
} from "./sync-crypto.ts";
import { httpTransport } from "./sync-http.ts";
import { githubTransport } from "./sync-github.ts";
import { webdavTransport } from "./sync-webdav.ts";

/** 口令最少几个字。太短的话，拿到密文的人猜得出来。 */
export const PASS_MIN = 8;

/**
 * 「同一位置」放在哪。
 *
 * 三种落点，用户自己选 —— **默认不需要自己搭任何服务端**：
 *
 * | 落点 | 要不要自己部署 | 浏览器能用 | 说明 |
 * | --- | --- | --- | --- |
 * | `github` | **不要** | 能 | 私有仓库里的一个文件；账号现成、API 现成 |
 * | `webdav` | **不要** | **不能**（坚果云不发 CORS 头） | 坚果云 / Nextcloud / NAS 都自带 |
 * | `http` | 要 | 能 | 自建的中转服务（`sync/` 那个 Worker），自己跑 |
 */
export type SyncKind = "github" | "webdav" | "http";

export interface SyncConfig {
  /** 用户有没有开同步（默认关） */
  enabled: boolean;
  /** 落在哪 */
  kind: SyncKind;
  /**
   * 地址：落点各不相同 ——
   * `http` → 中转服务的完整地址；`webdav` → WebDAV 根地址；
   * `github` → `owner/repo`。
   */
  serverUrl: string;
  /** `webdav`：账号（坚果云是邮箱） */
  user: string;
  /** `webdav`：应用密码 */
  password: string;
  /** `github`：Personal Access Token */
  token: string;
  /** 同步口令：只存在这台设备，不上传 */
  passphrase: string;
}

const KEY_ENABLED = "syncEnabled";
const KEY_KIND = "syncKind";
const KEY_SERVER = "syncServer";
const KEY_USER = "syncUser";
const KEY_PASSWORD = "syncPassword";
const KEY_TOKEN = "syncToken";
const KEY_PASSPHRASE = "syncPassphrase";
const KEY_LAST_AT = "syncLastAt";
/** 上次传上去的那份内容的指纹 —— 用来判断"这次要不要真传" */
const KEY_PUSHED_HASH = "syncPushedHash";
/** 上次同步时本地那份的指纹 —— 用来判断"本地变了吗" */
const KEY_LOCAL_HASH = "syncLocalHash";
/** 上次同步用的是哪个位置（落点 + 地址 + 空间 id） */
const KEY_LAST_SPACE = "syncLastSpace";

/**
 * 「位置」的标识：落点 + 地址 + 空间 id。
 *
 * 空间 id 是口令派生的 —— **口令填错一个字，就是另一个位置**。
 * 记下它是为了看出"这次换了个地方"（见 syncNow 里的那句提醒）。
 */
function spaceKeyOf(cfg: SyncConfig, spaceId: string): string {
  return `${cfg.kind}|${cfg.serverUrl}|${spaceId}`;
}

/** 读同步设置。 */
export async function readSyncConfig(): Promise<SyncConfig> {
  const [enabled, kind, serverUrl, user, password, token, passphrase] = await Promise.all([
    getSetting<boolean>(KEY_ENABLED, false),
    getSetting<SyncKind>(KEY_KIND, "webdav"),
    getSetting<string>(KEY_SERVER, ""),
    getSetting<string>(KEY_USER, ""),
    getSetting<string>(KEY_PASSWORD, ""),
    getSetting<string>(KEY_TOKEN, ""),
    getSetting<string>(KEY_PASSPHRASE, ""),
  ]);
  return { enabled, kind, serverUrl, user, password, token, passphrase };
}

/** 写同步设置。 */
export async function saveSyncConfig(cfg: Partial<SyncConfig>): Promise<void> {
  if (cfg.enabled !== undefined) await setSetting(KEY_ENABLED, cfg.enabled);
  if (cfg.kind !== undefined) await setSetting(KEY_KIND, cfg.kind);
  if (cfg.serverUrl !== undefined) await setSetting(KEY_SERVER, cfg.serverUrl.trim());
  if (cfg.user !== undefined) await setSetting(KEY_USER, cfg.user.trim());
  if (cfg.password !== undefined) await setSetting(KEY_PASSWORD, cfg.password);
  if (cfg.token !== undefined) await setSetting(KEY_TOKEN, cfg.token.trim());
  if (cfg.passphrase !== undefined) await setSetting(KEY_PASSPHRASE, cfg.passphrase);
}

/** 上次同步是什么时候（界面显示用）。 */
export async function lastSyncAt(): Promise<number | null> {
  const v = await getSetting<number | undefined>(KEY_LAST_AT, undefined);
  return v ?? null;
}

/**
 * 现在这份配置能不能同步 —— 不能的话给一句人话。
 *
 * **地址的形状也要在这里查**：少了协议头（`192.168.1.9:5006`）在桌面端报的是
 * 「地址不合法」，在浏览器端报的是「Failed to fetch」→ 都被翻译成
 * 「地址填对没有、网络通不通」—— 用户看不出是自己少打了 `http://`。
 * 在这儿拦住，才能说清要改哪。
 */
export function syncConfigProblem(cfg: SyncConfig): string | null {
  if (!cfg.enabled) return "同步没开";
  if (!cfg.serverUrl) {
    return cfg.kind === "github" ? "还没填仓库（owner/repo）" : "还没填地址";
  }
  if (cfg.kind === "github") {
    if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.serverUrl)) return "仓库要写成 owner/repo";
    if (!cfg.token) return "还没填 GitHub Token";
  }
  if (cfg.kind === "webdav" || cfg.kind === "http") {
    if (!/^https?:\/\//i.test(cfg.serverUrl)) return "地址要以 http:// 或 https:// 开头";
    try {
      new URL(cfg.serverUrl);
    } catch {
      return "地址不合法（检查一下有没有少字符或多空格）";
    }
  }
  if (cfg.kind === "webdav" && !cfg.user) return "还没填网盘账号";
  if (!cfg.passphrase) return "还没填同步口令";
  if (cfg.passphrase.length < PASS_MIN) return `同步口令至少 ${PASS_MIN} 个字`;
  return null;
}

/**
 * 按落点造一个传输层。
 *
 * 合并与加密那一层与落点无关 —— 换落点不用改它们。
 */
export function createTransport(cfg: SyncConfig): SyncTransport {
  if (cfg.kind === "github") {
    return githubTransport({
      repo: cfg.serverUrl,
      // 固定放在仓库的 life-guide/ 目录里 —— 界面上不再让用户填「目录」那项
      // （填了也是空的居多，少一个字段少一次犹豫）。
      //
      // **必须是固定值**：手动同步与自动同步读的是同一份配置，
      // 如果这里还看用户填的目录，两边可能写到不同地方（那就永远碰不到同一份）。
      dir: "life-guide",
      token: cfg.token,
    });
  }
  if (cfg.kind === "webdav") {
    return webdavTransport({
      url: cfg.serverUrl,
      user: cfg.user,
      password: cfg.password,
    });
  }
  return httpTransport(cfg.serverUrl);
}

/* ------------------------------------------------------------ 传输层 */

/**
 * 远端存的那一份。
 *
 * `rev` 是**版本标识**，各家不一样：自建服务给数字，GitHub 给 blob 的 sha，
 * WebDAV 给 ETag。所以它是字符串 —— 「我读到的是哪一版」只要求能原样退回去。
 */
export interface RemoteRecord {
  blob: EncryptedBlob;
  /** 版本标识：用来发现「别人刚写过」 */
  rev: string;
  updatedAt: number;
  /**
   * 远端**没变**（服务端回了 304，body 都没发）。
   *
   * 这一条是省流量的关键：每次同步本来都要把整份载荷拉下来，
   * 一天几十次就是几十 MB 下载 —— 网盘的下载流量是按月算的。
   * 带上 `If-None-Match` 问一句「还是那一版吗」，没变就只花几百字节。
   */
  unchanged?: boolean;
}

/**
 * 怎么把东西送到远端。
 *
 * 抽成接口是为了两件事：测试不用联网；换一种落点
 * （自己搭的服务 / 网盘 / GitHub 仓库 / 局域网）不用改合并与加密那一层。
 */
export interface SyncTransport {
  /** 取远端那份；远端还没有就是 null */
  fetch(spaceId: string): Promise<RemoteRecord | null>;
  /** 推上去。baseRev 是「我读到的版本」；对不上就报冲突。 */
  push(
    spaceId: string,
    blob: EncryptedBlob,
    baseRev: string | null,
  ): Promise<{ ok: true } | { ok: false; conflict: RemoteRecord }>;
}

/* ------------------------------------------------------------ 本地 ↔ 载荷 */

/**
 * 把本地数据打包成一份载荷。
 *
 * 只带走白名单里的设置项（SYNCED_SETTING_KEYS）——
 * 同步口令、服务器地址这些东西**不能**跟着走。
 */
export async function buildLocalPayload(deviceId: string): Promise<SyncPayload> {
  return readSyncPayload(deviceId);
}

/** 单事务重读、合并、提交；调用者获得实际提交的载荷。 */
export async function applyPayload(payload: SyncPayload): Promise<SyncPayload> {
  validatePayload(payload);
  return (await commitSyncPayload(payload)).payload;
}

/* ------------------------------------------------------------ 一轮同步 */

export interface SyncReport {
  ok: boolean;
  /** 给用户看的一句话 */
  message: string;
  /** 从远端收到的记录条数 */
  added: number;
  /** 被远端更新过的条数 */
  updated: number;
  /** 被远端删掉的条数 */
  removed: number;
  /** 被远端改掉的设置项 */
  settingsChanged: number;
  /** 推上去了没有 */
  pushed: boolean;
  /** 拉到东西了没有 */
  pulled: boolean;
  /**
   * 另一轮同步正在跑（不是失败）。
   *
   * 自动同步碰到这个**不该进冷却** —— 它不是"连不上"，
   * 只是有人正在做同一件事（多半是用户刚点了「立即同步」）。
   */
  busy?: boolean;
}

/**
 * 网络报错的说法。
 *
 * 浏览器连不上时抛的是英文的 "Failed to fetch" —— 直接甩给用户等于没说话。
 * 这一层把它换成"去检查什么"，技术细节留在括号里。
 */
export function networkErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|err_|econnrefused|enotfound|timeout/i.test(raw)) {
    return "地址填对没有、网络通不通";
  }
  return raw;
}

/**
 * 同步一轮。
 *
 * 推的时候如果对方刚写过（版本对不上），会退回来一份 ——
 * 拿着它再合一次再推（最多两次）。合不赢就不硬来，如实说失败。
 *
 * **同一时刻只跑一轮**（`syncing` 那把锁）：自动同步在后台跑，
 * 用户同时点了「立即同步」时不该两个一起推 —— 那正是把对方那份盖掉的时候。
 */
let syncing = false;

export async function syncNow(
  transport: SyncTransport,
  cfg?: SyncConfig,
): Promise<SyncReport> {
  if (syncing) {
    return {
      ok: false,
      message: "正在同步，稍等一下",
      busy: true,
      added: 0, updated: 0, removed: 0, settingsChanged: 0, pushed: false, pulled: false,
    };
  }
  syncing = true;
  try {
    return await syncOnce(transport, cfg);
  } finally {
    syncing = false;
  }
}

/**
 * 载荷的指纹：同一份内容 → 同一个指纹。
 *
 * 用来判断"这次要不要传"—— 传一份几百 KB 的东西到网盘是有代价的
 * （坚果云按流量算钱），而**本地没改、远端也没改**的时候根本不用传。
 *
 * **不算载荷自己的 `updatedAt`**：那个字段是"这份是什么时候写出来的"，
 * 每次读本地都会变成现在 —— 算进去的话指纹每次都不同，这个判断就废了。
 */
async function payloadFingerprint(payload: SyncPayload): Promise<string> {
  const stable = {
    ...payload, deviceId: "", updatedAt: 0,
    events: [...payload.events].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    custom: [...payload.custom].sort((a, b) => a.id.localeCompare(b.id)),
    settings: [...payload.settings].sort((a, b) => a.key.localeCompare(b.key)),
    tombstones: [...payload.tombstones].sort((a, b) =>
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)),
  };
  const bytes = new TextEncoder().encode(stableStringify(stable));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function syncOnce(
  transport: SyncTransport,
  cfg?: SyncConfig,
): Promise<SyncReport> {
  const conf = cfg ?? (await readSyncConfig());
  const problem = syncConfigProblem(conf);
  if (problem) {
    return { ok: false, message: problem, added: 0, updated: 0, removed: 0, settingsChanged: 0, pushed: false, pulled: false };
  }

  const secret = await deriveSecret(conf.passphrase);
  const deviceId = await getDeviceId();
  const local = await buildLocalPayload(deviceId);

  let remote: RemoteRecord | null = null;
  try {
    remote = await transport.fetch(secret.spaceId);
  } catch (err) {
    return {
      ok: false,
      message: `连不上同步服务器：${networkErrorText(err)}`,
      added: 0, updated: 0, removed: 0, settingsChanged: 0, pushed: false, pulled: false,
    };
  }

  let remotePayload: SyncPayload | null = null;
  if (remote && remote.unchanged) {
    /*
     * 远端没变（服务端回了 304，body 都没发）—— 省下的是**下载流量**，
     * 网盘的下载额度是按月算的，不省就是白花。
     *
     * 远端还是上次那份 → 本地已经含了它 → 合并结果就是本地这份。
     * 于是只剩一个问题：**本地变了吗？**
     */
    const localFp = await payloadFingerprint(local);
    const lastLocal = await getSetting<string>(KEY_LOCAL_HASH, "");
    if (localFp === lastLocal) {
      // 两边都没变 → 什么都不用做（连 PUT 都省了）
      await setSetting(KEY_LAST_AT, Date.now());
      await saveClock();
      return {
        ok: true,
        message: "同步完成：没有要传的改动。",
        added: 0, updated: 0, removed: 0, settingsChanged: 0, pushed: false, pulled: false,
      };
    }
    /*
     * 本地变了 → 接着往下走（合并结果就是本地这份，然后推上去）。
     *
     * **这里不能先把 KEY_LOCAL_HASH 写掉**：
     * 那个指纹是"上次同步时本地长什么样"，只在**这一轮真的成了**之后才该更新
     * （函数尾部统一写）。提前写了，推失败时（断网）指纹却已经记成"新的"——
     * 下一轮远端回 304，本地指纹 == 记着的那个 → 走「两边都没变」那条路 →
     * **本地这份改动永远传不上去**，而且界面还显示「没有要传的改动」。
     */
  } else if (remote) {
    try {
      remotePayload = await decryptPayload(secret.key, remote.blob);
      validatePayload(remotePayload);
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        added: 0, updated: 0, removed: 0, settingsChanged: 0, pushed: false, pulled: false,
      };
    }
    const issue = payloadVersionIssue(remotePayload);
    if (issue) {
      return { ok: false, message: issue, added: 0, updated: 0, removed: 0, settingsChanged: 0, pushed: false, pulled: false };
    }
  }

  let merged = await commitSyncPayload(remotePayload ?? local, deviceId);
  let applied = merged.payload;
  const totalStats = { ...merged.stats };
  let baseRev = remote?.rev ?? null;

  /*
   * 这次要不要真传一份上去？
   *
   * 远端那份还在、而合出来的结果与**上次传上去的**一模一样 → 不用传。
   * 理由：网盘按流量算钱，每次开 App 都重传几百 KB 是白花；
   * 而且"没改动"时多一次 PUT 就多一次被别人撞上的机会。
   *
   * 远端那份没了（404）时**一定要传** —— 否则本地这份就永远上不去了。
   */
  let fingerprint = await payloadFingerprint(applied);
  const lastPushed = await getSetting<string>(KEY_PUSHED_HASH, "");
  const remoteFingerprint = remotePayload ? await payloadFingerprint(remotePayload) : lastPushed;
  const needPush = !remote || fingerprint !== remoteFingerprint;

  /*
   * 「这次换了个位置」的提醒。
   *
   * 空间 id 是口令派生的 —— **口令填错一个字，就是另一个空位置**：
   * 同步会"成功"（本地那份传上去了），但另一台设备永远看不到它。
   * 这个症状最费时间查，所以在这里直接说。
   *
   * 只在「这个位置是空的」时说：空位置 + 上次用的是别处 = 大概率口令/地址填错了。
   */
  const lastSpace = await getSetting<string>(KEY_LAST_SPACE, "");
  const spaceKey = spaceKeyOf(conf, secret.spaceId);
  const switchedPlace = !remote && Boolean(lastSpace) && lastSpace !== spaceKey;

  /* 推：别人刚写过就退回来一份，合完再推 */
  let pushed = false;
  for (let attempt = 0; attempt < 2 && needPush; attempt++) {
    const blob = await encryptPayload(secret.key, applied);
    let res: { ok: true } | { ok: false; conflict: RemoteRecord };
    try {
      res = await transport.push(secret.spaceId, blob, baseRev);
    } catch (err) {
      return {
        ok: false,
        message: `写不上去：${networkErrorText(err)}`,
        added: totalStats.eventsAdded + totalStats.customAdded,
        updated: totalStats.eventsUpdated + totalStats.customUpdated,
        removed: totalStats.eventsRemoved + totalStats.customRemoved,
        settingsChanged: totalStats.settingsChanged,
        pushed: false,
        pulled: Boolean(remote),
      };
    }
    if (res.ok) {
      pushed = true;
      break;
    }
    // 冲突：拿回对方那份，重新合一次再推
    //
    // **用「已应用的那份」当底，不是最初那份 local** ——
    // 最初那份 local 里没有远端带来的记录；用它重合并，
    // 第一轮从远端收到的那批记录会被挤掉（本地还在、推上去的那份没了）。
    try {
      const theirPayload = await decryptPayload(secret.key, res.conflict.blob);
      validatePayload(theirPayload);
      const issue = payloadVersionIssue(theirPayload);
      if (issue) {
        return { ok: false, message: issue, added: 0, updated: 0, removed: 0, settingsChanged: 0, pushed: false, pulled: true };
      }
      merged = await commitSyncPayload(theirPayload, deviceId);
      for (const key of Object.keys(totalStats) as (keyof typeof totalStats)[]) totalStats[key] += merged.stats[key];
      applied = merged.payload;
      fingerprint = await payloadFingerprint(applied);
      baseRev = res.conflict.rev;
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        added: totalStats.eventsAdded + totalStats.customAdded,
        updated: totalStats.eventsUpdated + totalStats.customUpdated,
        removed: totalStats.eventsRemoved + totalStats.customRemoved,
        settingsChanged: totalStats.settingsChanged,
        pushed: false,
        pulled: true,
      };
    }
  }

  if (needPush && !pushed) {
    return {
      ok: false, message: "同步冲突仍未解决，请稍后重试",
      added: totalStats.eventsAdded + totalStats.customAdded,
      updated: totalStats.eventsUpdated + totalStats.customUpdated,
      removed: totalStats.eventsRemoved + totalStats.customRemoved,
      settingsChanged: totalStats.settingsChanged, pushed: false, pulled: Boolean(remote),
    };
  }

  await setSetting(KEY_LAST_AT, Date.now());
  // 时钟存下来：下次启动接着用（单调性跨重启也成立）
  await saveClock();
  // 记下"这次传上去的是哪一份" —— 下次好判断还需不需要传
  if (pushed) await setSetting(KEY_PUSHED_HASH, fingerprint);
  // 记下本地那份的指纹 —— 下次远端说"没变"时，靠它判断本地要不要传
  await setSetting(KEY_LOCAL_HASH, await payloadFingerprint(applied));
  // 记下"上次同步用的是哪个位置" —— 下次能看出"这次换了个地方"
  await setSetting(KEY_LAST_SPACE, spaceKeyOf(conf, secret.spaceId));

  const s = totalStats;
  const changed = Object.values(s).reduce((sum, value) => sum + value, 0);
  const base = changed
    ? `同步完成：新收 ${s.eventsAdded + s.customAdded} 条，改了 ${s.eventsUpdated + s.customUpdated} 条，删了 ${s.eventsRemoved + s.customRemoved} 条，设置改了 ${s.settingsChanged} 项。`
    : pushed
      ? "同步完成：两台设备的数据已经一样。"
      : "同步完成：没有要传的改动。";
  return {
    ok: true,
    message: switchedPlace
      ? `${base} ⚠️ 这是一个新的位置（上次同步用的是另一个）—— 如果口令或地址填错了，两台设备就碰不到同一份数据。`
      : base,
    added: s.eventsAdded + s.customAdded,
    updated: s.eventsUpdated + s.customUpdated,
    removed: s.eventsRemoved + s.customRemoved,
    settingsChanged: s.settingsChanged,
    pushed,
    pulled: Boolean(remote),
  };
}
