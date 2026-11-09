/**
 * 数据导出 / 导入。
 *
 * iOS 的坑：未「添加到主屏幕」的 Safari 站点，长期不访问可能被系统回收本地数据。
 * 所以必须提供导出（AGENTS.md §8），而且导出格式要带版本号，
 * 以后 schema 变了还能迁移（ARCHITECTURE.md §5）。
 */
import { readUserData, replaceUserData } from "./db.ts";
import { validateBackup, BACKUP_VERSION } from "./validate.ts";
export { BACKUP_VERSION } from "./validate.ts";
import { sanitizeReminders } from "../domain/reminders.ts";
import type { DoneEvent, Settings, CustomHabit, Tombstone } from "./db.ts";
import type { Reminder } from "../domain/reminders.ts";

export interface Backup {
  schemaVersion: number;
  exportedAt: string;
  events: DoneEvent[];
  settings: Required<Settings>;
  /**
   * 用户自己加的习惯（v2 起）。
   *
   * 不带走它们，「搬家」就搬了一半：日常清单里那几条会变成空引用。
   */
  custom: CustomHabit[];
  /**
   * 提醒（v3 起）。
   *
   * 不带走就等于「换设备后所有提醒都回到默认、绑在卡上的那些全没了」，
   * 而设置页写的就是「换设备时用导出 / 导入搬家」—— 搬家得把闹钟也搬走。
   */
  reminders: Reminder[];
  /**
   * 删除标记（v6 起）。
   *
   * 带走它，导进来的设备才知道哪些东西「已经被删掉了」——
   * 不带走的话，对面设备会把这些又带回来。
   */
  tombstones: Tombstone[];
}

export async function buildBackup(): Promise<Backup> {
  const { events, settings, custom, tombstones } = await readUserData();
  const byKey = new Map(settings.map((s) => [s.key, s.value]));
  const tags = (byKey.get("tags") ?? []) as string[];
  const mode = (byKey.get("mode") ?? "normal") as string;
  const myRoutine = (byKey.get("myRoutine") ?? []) as string[];
  const cadence = (byKey.get("cadence") ?? {}) as Record<string, string>;
  const skipToday = (byKey.get("skipToday") ?? {}) as Record<string, string>;
  return {
    schemaVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    events,
    settings: { tags, mode, myRoutine, cadence, skipToday },
    custom,
    reminders: sanitizeReminders(byKey.get("reminders")),
    tombstones,
  };
}

export function downloadBackup(backup: Backup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `life-guide-backup-${backup.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 验证完整快照后，用单个事务提交。 */
export async function restoreBackup(backup: Backup): Promise<number> {
  validateBackup(backup);
  await replaceUserData({
    events: backup.events,
    custom: backup.custom,
    tombstones: backup.tombstones,
    settings: {
      ...backup.settings,
      reminders: backup.reminders,
      firstRunPending: false,
    },
  });
  return backup.events.length;
}

export function parseBackup(text: string): Backup {
  let data: Backup;
  try {
    data = JSON.parse(text) as Backup;
  } catch {
    // JSON.parse 的原始报错是英文的技术信息，选错文件的人看不懂。
    throw new Error("这个文件读不出来，可能不是本应用导出的备份");
  }
  validateBackup(data);
  return data;
}
