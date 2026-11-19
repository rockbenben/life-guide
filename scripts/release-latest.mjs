function versionOf(tag) {
  if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Release tag 不是稳定版本：${tag}`);
  }
  return tag.slice(1).split(".").map(BigInt);
}

/** 在工作流的仓库级发布队列内比较并切换 latest。 */
export async function promoteLatest({ repo, releaseId, tag, token }, request = fetch) {
  const candidate = versionOf(tag);
  if (!repo || !/^\d+$/.test(releaseId ?? "") || !token) {
    throw new Error("需要 REPO、RELEASE_ID 和 GH_TOKEN");
  }
  const url = `https://api.github.com/repos/${repo}/releases`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const current = await request(`${url}/latest`, { headers, cache: "no-store" });
  if (current.ok) {
    const { tag_name: currentTag } = await current.json();
    const latest = versionOf(currentTag);
    for (let index = 0; index < candidate.length; index++) {
      if (candidate[index] < latest[index]) return false;
      if (candidate[index] > latest[index]) break;
    }
    if (currentTag === tag) return true;
  } else if (current.status !== 404) {
    throw new Error(`读取当前 latest 失败（HTTP ${current.status}）`);
  }

  const updated = await request(`${url}/${releaseId}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ make_latest: "true" }),
  });
  if (!updated.ok) throw new Error(`切换 latest 失败（HTTP ${updated.status}）`);
  return true;
}

if (import.meta.main) {
  const { REPO, RELEASE_ID, TAG, GH_TOKEN, GITHUB_OUTPUT } = process.env;
  const selected = await promoteLatest({
    repo: REPO, releaseId: RELEASE_ID, tag: TAG, token: GH_TOKEN,
  });
  if (GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(GITHUB_OUTPUT, `selected=${selected}\n`);
  }
  console.log(selected ? `${TAG} 已是 latest` : `已有更新的 latest，保留 ${TAG} 为历史版本`);
}
