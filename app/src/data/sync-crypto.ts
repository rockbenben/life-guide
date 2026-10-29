/**
 * 同步的加密：口令 → 空间 id 与密钥 → 密文。
 *
 * **服务端只拿到密文**。它存的是一串看不出内容的字节，
 * 没有口令就解不开 —— 这条是「数据放在别人服务器上」的前提。
 *
 * ## 口令怎么变成两样东西
 *
 * ```
 *   口令 ──PBKDF2(210000 次, SHA-256)──→ 主密钥
 *                                        ├─HKDF("space")→ 空间 id（公开的定位符）
 *                                        └─HKDF("key")  → AES-GCM 密钥
 * ```
 *
 * - **空间 id**：同一个口令在任何设备上都算出同一个 id ——
 *   所以换设备只要输入同一个口令，不用再抄一串「空间编号」。
 * - **密钥**：真正的加密密钥，由口令 + 空间 id 一起派生。
 *
 * PBKDF2 那 21 万次不是形式主义：它让**拿到密文的人**猜口令很慢
 * （离线爆破每个候选要 21 万次哈希）。派生一次要半秒左右，
 * 所以结果按口令缓存（见 cache），同一个会话里只慢一次。
 *
 * ## 为什么不用「随机密钥 + 抄一串码」
 *
 * 那样安全性更高（熵保证），但换设备要抄两样东西（空间 id + 密钥）。
 * 口令方案只抄一样，代价是口令弱时能被慢慢猜 ——
 * 所以界面上要求长一点（见 sync.ts 的 PASS_MIN）。
 */
import type { SyncPayload } from "../domain/sync.ts";

/** PBKDF2 迭代次数。OWASP 2023 对 PBKDF2-HMAC-SHA256 的建议是 600k，这里取 210k。 */
const PBKDF2_ITERATIONS = 210_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 加密后的内容（服务端存的就是它）。 */
export interface EncryptedBlob {
  /** 密文格式版本 */
  v: 1;
  /** 初始向量（base64） */
  iv: string;
  /** 密文（base64） */
  ciphertext: string;
}

/** 口令派生出来的东西。 */
export interface SyncSecret {
  /** 空间 id：公开的定位符（同口令同 id） */
  spaceId: string;
  /** AES-GCM 密钥 */
  key: CryptoKey;
}

/** 没有加密能力的环境（非安全上下文）会明确说出来，而不是报一个看不懂的错。 */
function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error(
      "这个环境没有加密能力（浏览器的加密接口只在 https 或 localhost 下可用）",
    );
  }
  return c.subtle;
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  // 拷一份：TextEncoder 出来的类型带 ArrayBufferLike，
  // 而 WebCrypto 的入参要的是确切的 ArrayBuffer（TS 5.9 起分得细）
  const src = enc.encode(s);
  const out = new Uint8Array(src.length);
  out.set(src);
  return out;
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  // 一段一段拼：一次 spread 几万个参数会爆栈
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** URL 友好的 base64（空格 id 要放进网址里）。 */
function base64url(bytes: Uint8Array<ArrayBuffer>): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pbkdf2Bits(
  passphrase: string,
  salt: string,
  bits: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const base = await subtle().importKey("raw", utf8(passphrase), "PBKDF2", false, [
    "deriveBits",
  ]);
  const out = await subtle().deriveBits(
    {
      name: "PBKDF2",
      salt: utf8(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    bits,
  );
  return new Uint8Array(out);
}

async function hkdfBits(
  master: Uint8Array<ArrayBuffer>,
  info: string,
  bits: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle().importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const out = await subtle().deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) },
    key,
    bits,
  );
  return new Uint8Array(out);
}

/**
 * 口令 → 空间 id + 密钥。
 *
 * 结果按口令缓存：派生一次半秒，同一会话里不该反复付这个代价。
 * 缓存只在本进程内存里（关掉 App 就没有了）。
 */
const cache = new Map<string, SyncSecret>();

export async function deriveSecret(passphrase: string): Promise<SyncSecret> {
  const hit = cache.get(passphrase);
  if (hit) return hit;

  const master = await pbkdf2Bits(passphrase, "life-guide-sync-v1", 256);
  const spaceId = base64url(await hkdfBits(master, "space", 128));
  const keyBits = await hkdfBits(master, "key", 256);
  const key = await subtle().importKey(
    "raw",
    keyBits,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );

  const secret: SyncSecret = { spaceId, key };
  cache.set(passphrase, secret);
  return secret;
}

/** 忘掉缓存的口令（换口令时用）。 */
export function forgetSecret(passphrase: string): void {
  cache.delete(passphrase);
}

/** 加密一份载荷。 */
export async function encryptPayload(
  key: CryptoKey,
  payload: SyncPayload,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = utf8(JSON.stringify(payload));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, plain);
  return { v: 1, iv: base64(iv), ciphertext: base64(new Uint8Array(ct)) };
}

/**
 * 解密一份载荷。
 *
 * 解不开只有两种可能：口令不对，或者密文坏了。
 * 这两件事对用户来说是同一件事 —— "这台设备和那台设备不是同一个口令"，
 * 所以直接说人话，别把 WebCrypto 的原始报错甩出去。
 */
export async function decryptPayload(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<SyncPayload> {
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromBase64(blob.iv) },
      key,
      fromBase64(blob.ciphertext),
    );
  } catch {
    throw new Error("口令不对 —— 这台设备和那台设备要填同一个口令");
  }
  try {
    return JSON.parse(dec.decode(plain)) as SyncPayload;
  } catch {
    throw new Error("远端那份数据解不开（可能已经损坏）");
  }
}
