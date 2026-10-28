/**
 * 数据导出 / 导入。
 *
 * iOS 的坑：未「添加到主屏幕」的 Safari 站点，长期不访问可能被系统回收本地数据。
 * 所以必须提供导出（AGENTS.md §8），而且导出格式要带版本号，
 * 以后 schema 变了还能迁移（ARCHITECTURE.md §5）。
 */
import { allEvents, clearEvents, addEvent, getSetting, setSetting, allCustomHabits, putCustomHabit, deleteCustomHabit } from "./db.ts";
import type { DoneEvent, Settings, CustomHabit } from "./db.ts";
import type { Reminder } from "../domain/reminders.ts";

/**
 * v5 起：设置里带 skipToday（「今天不做」）。
 *
 * 备份格式每加一个字段就升一版：旧备份照常能导进来（各版本该带的东西由
 * backup.ts 负责补齐），新备份被旧版 App 挡住时会说清楚「请先升级应用」，
 * 而不是悄悄丢掉它不认识的字段。
 */
export const BACKUP_VERSION = 5;

export interface Backup {
  schemaVersion: number;
  exportedAt: string;
  events: DoneEvent[];
  settings: Partial<Settings>;
  /**
   * 用户自己加的习惯（v2 起）。
   *
   * 不带走它们，「搬家」就搬了一半：日常清单里那几条会变成空引用。
   */
  custom?: CustomHabit[];
  /**
   * 提醒（v3 起）。
   *
   * 不带走就等于「换设备后所有提醒都回到默认、绑在卡上的那些全没了」，
   * 而设置页写的就是「换设备时用导出 / 导入搬家」—— 搬家得把闹钟也搬走。
   */
  reminders?: Reminder[];
}

export async function buildBackup(): Promise<Backup> {
  const [events, tags, mode, myRoutine, cadence, skipToday, custom, reminders] = await Promise.all([
    allEvents(),
    getSetting<string[]>("tags", []),
    getSetting<string>("mode", "normal"),
    getSetting<string[]>("myRoutine", []),
    getSetting<Record<string, string>>("cadence", {}),
    getSetting<Record<string, string>>("skipToday", {}),
    allCustomHabits(),
    getSetting<Reminder[]>("reminders", []),
  ]);
  return {
    schemaVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    events,
    settings: { tags, mode, myRoutine, cadence, skipToday },
    custom,
    reminders,
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

/** 导入。会先清空现有数据再写入，所以导入前最好先导出一份。 */
export async function restoreBackup(backup: Backup): Promise<number> {
  if (backup.schemaVersion > BACKUP_VERSION) {
    throw new Error(
      `备份版本 ${backup.schemaVersion} 比当前支持的 ${BACKUP_VERSION} 新，请先升级应用`,
    );
  }
  await clearEvents();
  for (const e of backup.events ?? []) await addEvent(e);
  if (backup.settings?.tags) await setSetting("tags", backup.settings.tags);
  if (backup.settings?.mode) await setSetting("mode", backup.settings.mode);
  if (backup.settings?.myRoutine) {
    await setSetting("myRoutine", backup.settings.myRoutine);
  }
  await setSetting("cadence", backup.settings?.cadence ?? {});
  await setSetting("skipToday", backup.settings?.skipToday ?? {});
  // 导进来的是用户自己的数据，不是「App 刚替新用户放好的清单」——
  // 别让首启说明在换设备后重新冒出来。
  await setSetting("firstRunPending", false);
  // 自定义习惯：先清掉现有的，再把备份里的放回去（id 相同则覆盖）
  for (const h of await allCustomHabits()) await deleteCustomHabit(h.id);
  for (const h of backup.custom ?? []) await putCustomHabit(h);
  // 提醒：备份里有就换过去（v3 起才有；旧备份不动本地这一份）
  if (backup.reminders) await setSetting("reminders", backup.reminders);
  return backup.events?.length ?? 0;
}

export function parseBackup(text: string): Backup {
  let data: Backup;
  try {
    data = JSON.parse(text) as Backup;
  } catch {
    // JSON.parse 的原始报错是英文的技术信息，选错文件的人看不懂。
    throw new Error("这个文件读不出来，可能不是本应用导出的备份");
  }
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.schemaVersion !== "number" ||
    !Array.isArray(data.events)
  ) {
    throw new Error("这不是本应用导出的备份文件");
  }
  return data;
}
