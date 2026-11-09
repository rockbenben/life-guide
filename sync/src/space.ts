import type { DurableObjectState } from "@cloudflare/workers-types";
import { DurableObject } from "cloudflare:workers";
import type { BlobWrite, StoredBlob, WriteResult } from "./worker.ts";

/** 一个同步空间的全部状态由这一行 SQLite 记录持有。 */
export class SyncSpace extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        iv TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        rev INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
  }

  read(): StoredBlob | null {
    return (
      this.ctx.storage.sql
        .exec<StoredBlob>(
          "SELECT iv, ciphertext, rev, updatedAt FROM snapshot WHERE id = 1",
        )
        .toArray()[0] ?? null
    );
  }

  write(input: BlobWrite): WriteResult {
    return this.ctx.storage.transactionSync(() => {
      const current = this.read();
      // null 只允许首次创建；已有快照的更新必须携带精确版本。
      if ((current?.rev ?? null) !== input.baseRev) {
        return { ok: false, current };
      }
      const rev = (current?.rev ?? 0) + 1;
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO snapshot (id, iv, ciphertext, rev, updatedAt) VALUES (1, ?, ?, ?, ?)",
        input.iv,
        input.ciphertext,
        rev,
        Date.now(),
      );
      return { ok: true, rev };
    });
  }
}
