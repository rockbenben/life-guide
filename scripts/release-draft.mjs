/**
 * Create a public release and upload assets without Actions artifact staging.
 * The historical filename is retained for workflow/script compatibility.
 * Prepare owns the body. Build jobs use RELEASE_ID and preserve it on retries.
 * The release becomes latest after all platform checks succeed.
 */
import fs from "node:fs";
import path from "node:path";
import { releaseBodyFor } from "./release-notes.mjs";

const {REPO: repo, TAG: tag, GH_TOKEN: token, RELEASE_ID: releaseId} = process.env;
const directory = path.resolve(process.argv[2] ?? "dist");
if (!repo || !/^v\d+\.\d+\.\d+$/.test(tag ?? "") || !token) {
  throw new Error("需要 REPO、稳定 TAG 和 GH_TOKEN");
}

async function api(endpoint, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}${endpoint}`, {
    ...options,
    headers: {Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28", ...options.headers},
  });
  if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

let release;
if (releaseId) {
  release = await api(`/releases/${releaseId}`);
} else {
  const releases = await api("/releases?per_page=100");
  release = releases.find(item => item.tag_name === tag);
  if (release && !release.draft) throw new Error(`${tag} 已经发布；请为新发布使用新版本`);
  const body = {tag_name: tag, name: `生活指南 ${tag}`, body: releaseBodyFor(tag), draft: false, make_latest: "false"};
  release = release
    ? await api(`/releases/${release.id}`, {method: "PATCH", body: JSON.stringify(body)})
    : await api("/releases", {method: "POST", body: JSON.stringify(body)});
}
if (!release?.id || release.tag_name !== tag || release.draft) {
  throw new Error("上传目标必须是当前 tag 的公开 Release");
}
if (!fs.existsSync(directory)) throw new Error(`找不到目录 ${directory}`);
for (const name of fs.readdirSync(directory).sort()) {
  const file = path.join(directory, name);
  if (!fs.statSync(file).isFile()) continue;
  const existing = (release.assets ?? []).find(asset => asset.name === name);
  if (existing) await api(`/releases/assets/${existing.id}`, {method: "DELETE"});
  const data = fs.readFileSync(file);
  const uploaded = await fetch(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Content-Length": String(data.length)}, body: data,
  });
  if (!uploaded.ok) throw new Error(`${name}: ${uploaded.status} ${await uploaded.text()}`);
  console.log(`Uploaded ${name}`);
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_id=${release.id}\n`);
console.log(`Public release ${tag}, id ${release.id}`);
