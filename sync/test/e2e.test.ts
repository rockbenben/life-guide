/**
 * 端到端：真的 HTTP + 真的 Worker 处理逻辑 + 真的加密与合并。
 *
 * 前面那些单测各自验一块；这一条把它们串起来跑一遍 ——
 * 协议写错了、CORS 头漏了、密文拼错了，在这里才会露出来。
 *
 * Wrangler 在本地启动实际 Worker 与 SQLite Durable Object，
 * 客户端走的是 App 里那个 `httpTransport`（真身，不是假的）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { httpTransport } from "../../app/src/data/sync-http.ts";
import {
  decryptPayload,
  deriveSecret,
  encryptPayload,
} from "../../app/src/data/sync-crypto.ts";
import {
  mergePayloads,
  SYNC_PAYLOAD_VERSION,
  type SyncPayload,
} from "../../app/src/domain/sync.ts";
import { testServer } from "./server.ts";

const server = testServer();
let base = "";
beforeEach(async () => {
  base = (await server.listen()).url.origin;
});
const PASS = "一句不会忘的话-2026";

function payload(over: Partial<SyncPayload>): SyncPayload {
  return {
    v: SYNC_PAYLOAD_VERSION,
    deviceId: "dev-a",
    updatedAt: 1,
    events: [],
    tombstones: [],
    settings: [],
    custom: [],
    ...over,
  };
}

describe("端到端", () => {
  it.each(["同时首次创建", "同版本并发更新"])(
    "%s 冲突后合并重试，两台设备都读到全部记录",
    async (scenario) => {
      const { key, spaceId } = await deriveSecret(PASS + scenario);
      const a = httpTransport(base);
      const b = httpTransport(base);
      if (scenario === "同版本并发更新") {
        expect(
          (await a.push(spaceId, await encryptPayload(key, payload({})), null))
            .ok,
        ).toBe(true);
      }
      const [baseA, baseB] = await Promise.all([
        a.fetch(spaceId),
        b.fetch(spaceId),
      ]);
      expect(baseA?.rev ?? null).toBe(baseB?.rev ?? null);
      const snapshots = ["a", "b"].map((id) =>
        payload({
          deviceId: id,
          events: [
            {
              eventId: id,
              cardId: id,
              date: "2026-11-09",
              ts: 1000,
              updatedAt: 1000,
              variant: "normal",
            },
          ],
        }),
      );
      const [blobA, blobB] = await Promise.all(
        snapshots.map((p) => encryptPayload(key, p)),
      );
      const results = await Promise.all([
        a.push(spaceId, blobA, baseA?.rev ?? null),
        b.push(spaceId, blobB, baseB?.rev ?? null),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loserIndex = results.findIndex((r) => !r.ok);
      const loser = results[loserIndex];
      if (loser.ok) throw new Error("应有一台设备收到冲突");
      const theirPayload = await decryptPayload(key, loser.conflict.blob);
      const merged = mergePayloads(snapshots[loserIndex], theirPayload).payload;
      expect(
        (
          await [a, b][loserIndex].push(
            spaceId,
            await encryptPayload(key, merged),
            loser.conflict.rev,
          )
        ).ok,
      ).toBe(true);
      for (const transport of [httpTransport(base), httpTransport(base)]) {
        const current = await transport.fetch(spaceId);
        expect(current?.rev).toBe(scenario === "同时首次创建" ? "2" : "3");
        const final = await decryptPayload(key, current!.blob);
        expect(final.events.map((e) => e.eventId).sort()).toEqual(["a", "b"]);
      }
    },
  );

  it("两台设备通过服务端把数据合到一处", async () => {
    const { key, spaceId } = await deriveSecret(
      PASS + expect.getState().currentTestName,
    );
    const transport = httpTransport(base);

    // A 设备先写：一条记录 + 一个清单
    const a = payload({
      deviceId: "dev-a",
      updatedAt: 100,
      events: [
        {
          date: "2026-10-29",
          cardId: "card-a",
          variant: "normal",
          eventId: "event-1001",
          ts: 1001,
          updatedAt: 100,
        },
      ],
      settings: [{ key: "myRoutine", value: ["card-a"], updatedAt: 100 }],
    });
    const putA = await transport.push(
      spaceId,
      await encryptPayload(key, a),
      null,
    );
    expect(putA.ok).toBe(true);

    // B 设备来拉：拉到 A 的那份
    const got = await transport.fetch(spaceId);
    expect(got).not.toBeNull();
    const remote = await decryptPayload(key, got!.blob);
    expect(remote.events).toHaveLength(1);
    expect(remote.events[0].cardId).toBe("card-a");

    // B 设备自己也有东西 → 合起来推回去
    const b = payload({
      deviceId: "dev-b",
      updatedAt: 200,
      events: [
        {
          date: "2026-10-29",
          cardId: "card-b",
          variant: "normal",
          eventId: "event-1002",
          ts: 1002,
          updatedAt: 200,
        },
      ],
      settings: [{ key: "myRoutine", value: ["card-b"], updatedAt: 200 }],
    });
    const merged = mergePayloads(b, remote, "dev-b");
    expect(merged.payload.events).toHaveLength(2);
    // 设置：B 写得晚 → B 的那份赢
    expect(
      merged.payload.settings.find((s) => s.key === "myRoutine")?.value,
    ).toEqual(["card-b"]);

    const putB = await transport.push(
      spaceId,
      await encryptPayload(key, merged.payload),
      got!.rev,
    );
    expect(putB.ok).toBe(true);

    // A 再来拉：两条记录都在
    const again = await transport.fetch(spaceId);
    const final = await decryptPayload(key, again!.blob);
    expect(final.events.map((e) => e.cardId).sort()).toEqual([
      "card-a",
      "card-b",
    ]);
  });

  it("两台设备同时推 → 后推的那个被告知冲突，并拿到当前那份", async () => {
    const { key, spaceId } = await deriveSecret(
      PASS + expect.getState().currentTestName,
    );
    const transport = httpTransport(base);

    // 先有一份
    await transport.push(
      spaceId,
      await encryptPayload(key, payload({ updatedAt: 10, events: [] })),
      null,
    );
    const base1 = (await transport.fetch(spaceId))!.rev;

    // 两台设备都读到第 1 版
    const mine = payload({
      deviceId: "dev-c",
      updatedAt: 20,
      events: [
        {
          date: "2026-10-29",
          cardId: "card-c",
          variant: "normal",
          eventId: "event-2001",
          ts: 2001,
          updatedAt: 20,
        },
      ],
    });
    const theirs = payload({
      deviceId: "dev-d",
      updatedAt: 30,
      events: [
        {
          date: "2026-10-29",
          cardId: "card-d",
          variant: "normal",
          eventId: "event-2002",
          ts: 2002,
          updatedAt: 30,
        },
      ],
    });

    // C 先推成功
    const pushC = await transport.push(
      spaceId,
      await encryptPayload(key, mine),
      base1,
    );
    expect(pushC.ok).toBe(true);

    // D 用的是过期的版本号 → 冲突，服务端把当前那份退回来
    const pushD = await transport.push(
      spaceId,
      await encryptPayload(key, theirs),
      base1,
    );
    expect(pushD.ok).toBe(false);
    if (pushD.ok) return;
    const current = await decryptPayload(key, pushD.conflict.blob);
    expect(current.events.map((e) => e.cardId)).toEqual(["card-c"]);

    // D 拿回那份合一次再推 → 两边都在
    const merged = mergePayloads(theirs, current, "dev-d");
    const pushD2 = await transport.push(
      spaceId,
      await encryptPayload(key, merged.payload),
      pushD.conflict.rev,
    );
    expect(pushD2.ok).toBe(true);
    const final = await decryptPayload(
      key,
      (await transport.fetch(spaceId))!.blob,
    );
    expect(final.events.map((e) => e.cardId).sort()).toEqual([
      "card-c",
      "card-d",
    ]);
  });

  it("口令不对 → 解不开，且说人话", async () => {
    const { key, spaceId } = await deriveSecret(
      PASS + expect.getState().currentTestName,
    );
    const transport = httpTransport(base);
    await transport.push(spaceId, await encryptPayload(key, payload({})), null);

    const other = await deriveSecret("另一句口令-2026");
    const got = await transport.fetch(spaceId);
    await expect(decryptPayload(other.key, got!.blob)).rejects.toThrow(
      "口令不对",
    );
  });

  it("服务端存的是密文：检查 SQLite 记录，里面没有明文", async () => {
    const { key, spaceId } = await deriveSecret(
      PASS + expect.getState().currentTestName,
    );
    const transport = httpTransport(base);
    await transport.push(
      spaceId,
      await encryptPayload(
        key,
        payload({
          events: [
            {
              date: "2026-10-29",
              cardId: "card-secret",
              variant: "normal",
              eventId: "event-3001",
              ts: 3001,
              updatedAt: 1,
            },
          ],
          settings: [
            { key: "myRoutine", value: ["card-secret"], updatedAt: 1 },
          ],
        }),
      ),
      null,
    );
    const sql = await server
      .getWorker()
      .getDurableObjectStorage("SyncSpace", { name: spaceId });
    const raw = JSON.stringify(await sql.exec("SELECT * FROM snapshot"));
    expect(raw).not.toContain("card-secret");
    expect(raw).not.toContain("myRoutine");
  });
});
