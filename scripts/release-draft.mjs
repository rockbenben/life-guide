/**
 * 建（或找到）这个 tag 的草稿 release，并把产物传上去。
 *
 * **为什么不用 `gh release create` / `gh release upload`**：
 *
 *   · 草稿在 `GET /releases/tags/<tag>` 里查不到（GitHub 的行为），
 *     `gh release upload <tag>` 找不到就会自己建一个 tag 叫
 *     `untagged-xxx` 的草稿，还把原来那个草稿的标签也改了 —— 404。
 *   · `gh release create --draft` 同样可能落下 `untagged-xxx` 这种标签，
 *     后面按 tag 找就找不到了。
 *
 * 所以这里全程走 API：自己按 tag 找草稿，没有就用 POST 建一个
 * （tag 存在时 GitHub 会照用），再按 release id 传附件。
 *
 * 发布说明：草稿里先放一句占位，**这一版特有的说明在放行审批前直接写在草稿页上**。
 *
 * 用法：REPO=owner/name TAG=v0.1.1 GH_TOKEN=... node scripts/release-draft.mjs dist
 *
 * **RELEASE_ID=...**：直接用这个 release，不按 tag 找，也不改发布说明。
 * 构建 job 用这个 —— 几个 job 并行往同一个草稿传东西时，
 * 「按 tag 找」会撞上草稿标签被 GitHub 改成 untagged-xxx 的老问题。
 */
import fs from "node:fs";
import path from "node:path";
import { STANDING_NOTICES } from "./release-notices.mjs";

const repo = process.env.REPO;
const tag = process.env.TAG;
const token = process.env.GH_TOKEN;
const releaseId = process.env.RELEASE_ID;
const dir = path.resolve(process.argv[2] ?? "dist");

/** 草稿正文里的占位 —— 人放行前把它改成这一版真正的说明。 */
const PLACEHOLDER =
  "这一版特有的说明待补 —— 放行审批前请写上这一版改了什么、有什么产物。";

if (!repo || !tag || !token) {
  console.error("需要 REPO / TAG / GH_TOKEN 三个环境变量");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
const api = (p, init = {}) =>
  fetch(`https://api.github.com${p}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });

/**
 * 每次发布都要写清的那几条固定告知 —— 常量在 scripts/release-notices.mjs。
 * 为什么要固定附在正文后面：未签名 → 用户会看到 SmartScreen「未知发布者」；
 * macOS 未公证 → Gatekeeper 拦一下。这些是**一直如此**的事实，不该指望每一版
 * 都有人记得抄一遍 —— 兜底那条只有一行占位，忘了写就等于没告知用户为什么会有
 * 那个提示。house style 也是这么要求的：未签名时在 release 说明里提前告知。
 *
 * 放在单独的文件里，是为了让「改已发布的那一版正文」也能用同一份 ——
 * 两处拼法必须一致，否则改一次就对不齐。
 */

/**
 * 发布说明的正文。
 *
 * **这一版特有的说明直接写在发布草稿上**（放行审批前改好）——
 * 仓库里不再留 `docs/发布说明/<tag>.md` 那样的文件：版本说明的归属地就是发布页本身，
 * 仓库里再存一份只是重复；而且真出过「那份文件是在 tag 推上去之后才提交的，
 * 发布页上只剩一句占位」（v0.2.0）—— 说明写在仓库里，靠的是记得先提交。
 *
 * 下面那几条一直如此的事实（未签名、哪些形态能自动更新）由
 * scripts/release-notices.mjs 的 STANDING_NOTICES 每次附上：那是必须每次都在的，
 * 不能指望人记得抄一遍。
 */
function releaseBody() {
  console.log("发布说明：草稿里先放占位，这一版特有的说明在放行审批前补");
  return `${PLACEHOLDER}\n\n${STANDING_NOTICES}\n`;
}

// 1. 找草稿
let release;
if (releaseId) {
  // 指定了 id：直接用它，不按 tag 找，也不碰发布说明
  // （几个构建 job 并行传同一个草稿时，改发布说明会互相覆盖）。
  const found = await api(`/repos/${repo}/releases/${releaseId}`).then((r) => r.json());
  if (!found?.id) {
    console.error(`找不到 release ${releaseId}`);
    process.exit(1);
  }
  if (!found.draft) {
    console.error(`${found.tag_name} 已经发布了；要再发一版请升版本`);
    process.exit(1);
  }
  release = found;
  console.log(`用指定的 release：${release.tag_name}（id ${release.id}）`);
} else {
  const list = await api(`/repos/${repo}/releases?per_page=100`).then((r) => r.json());
  release = list.find((r) => r.tag_name === tag);
}

if (release && !release.draft) {
  console.error(`${tag} 已经发布了；要再发一版请升版本`);
  process.exit(1);
}

if (!release) {
  // 2. 建草稿（tag 存在时 GitHub 会照用这个 tag）
  const res = await api(`/repos/${repo}/releases`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: `生活指南 ${tag}`,
      body: releaseBody(),
      draft: true,
    }),
  });
  if (!res.ok) {
    console.error("建草稿失败：", res.status, await res.text());
    process.exit(1);
  }
  release = await res.json();
  console.log(`建了草稿：${release.tag_name}（id ${release.id}）`);
  if (release.tag_name !== tag) {
    console.error(`草稿的标签是 ${release.tag_name}，不是 ${tag} —— 停在这里，别发布出去。`);
    process.exit(1);
  }
} else if (!releaseId) {
  console.log(`用已有的草稿：${release.tag_name}（id ${release.id}）`);
  // 说明也更新一下（重跑时用最新的文件）。
  //
  // **必须带上 tag_name**：草稿的标签在 GitHub 侧不稳，
  // 只改 body 不带 tag_name 的话，它会被打回 "untagged-<sha>" 这种占位名 ——
  // 后面再按 tag 找这个 release 就找不到了（实测踩过）。
  const res = await api(`/repos/${repo}/releases/${release.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ tag_name: tag, body: releaseBody() }),
  });
  if (res.ok) release = await res.json();
}

// 3. 传附件
if (!fs.existsSync(dir)) {
  console.error("找不到目录：", dir);
  process.exit(1);
}
const files = fs
  .readdirSync(dir)
  .filter((f) => fs.statSync(path.join(dir, f)).isFile())
  .sort();

for (const name of files) {
  const file = path.join(dir, name);
  const data = fs.readFileSync(file);

  const existing = (release.assets ?? []).find((a) => a.name === name);
  if (existing) {
    await api(`/repos/${repo}/releases/assets/${existing.id}`, { method: "DELETE" });
    console.log(`  删掉旧的 ${name}`);
  }

  const up = await fetch(
    `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(data.length),
      },
      body: data,
    },
  );
  if (!up.ok) {
    console.error(`  ✗ ${name}：${up.status} ${await up.text()}`);
    process.exit(1);
  }
  const asset = await up.json();
  console.log(`  → ${asset.name}  ${(asset.size / 1048576).toFixed(2)} MB`);
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_id=${release.id}\n`);
}

// 传完之后再确认一次标签还在。
// 草稿的标签名在 GitHub 侧不稳（列表里可能已经是 untagged-xxx 了），
// 显式写回去最省事 —— 发布那一步直接用 release id，不再按 tag 找。
const final = await api(`/repos/${repo}/releases/${release.id}`, {
  method: "PATCH",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ tag_name: tag }),
}).then((r) => r.json());
if (final.tag_name !== tag) {
  console.error(`草稿的标签还是 ${final.tag_name}，不是 ${tag}`);
  process.exit(1);
}
console.log(`草稿就绪（id ${release.id}，标签 ${final.tag_name}），附件传完了。`);
