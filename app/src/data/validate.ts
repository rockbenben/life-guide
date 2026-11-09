import type { Backup } from "./backup.ts";

export const BACKUP_VERSION = 7;
import {
  SYNC_PAYLOAD_VERSION,
  SYNCED_SETTING_KEYS,
  type SyncPayload,
} from "../domain/sync.ts";
import { sanitizeReminders } from "../domain/reminders.ts";

type Row = Record<string, unknown>;
const oneOf = (value: unknown, choices: readonly string[]) =>
  typeof value === "string" && choices.includes(value);
const object = (v: unknown): v is Row =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const time = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const strings = (v: unknown) => Array.isArray(v) && v.every(text);
const date = (v: unknown) =>
  text(v) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const optional = (v: unknown, check: (v: unknown) => boolean) =>
  v === undefined || check(v);

function uniqueRows(
  value: unknown,
  key: string,
  check: (v: Row) => boolean,
): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  return value.every((v) => {
    if (!object(v) || !text(v[key]) || ids.has(v[key]) || !check(v))
      return false;
    ids.add(v[key]);
    return true;
  });
}

function events(v: unknown): boolean {
  return uniqueRows(
    v,
    "eventId",
    (e) =>
      date(e.date) &&
      text(e.cardId) &&
      text(e.variant) &&
      time(e.ts) &&
      optional(e.updatedAt, time) &&
      optional(e.periodDone, (v) => typeof v === "boolean") &&
      optional(e.periodCadence, (v) => v === "weekly" || v === "monthly"),
  );
}

function custom(v: unknown): boolean {
  return uniqueRows(
    v,
    "id",
    (h) =>
      text(h.name) &&
      typeof h.text === "string" &&
      oneOf(h.slot, ["morning", "daytime", "evening", "anytime"]) &&
      text(h.createdAt) &&
      Number.isFinite(Date.parse(h.createdAt)) &&
      optional(h.updatedAt, time),
  );
}

function tombstones(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  const keys = new Set<string>();
  return v.every((t) => {
    if (
      !object(t) ||
      !oneOf(t.kind, ["event", "custom"]) ||
      !text(t.id) ||
      !time(t.updatedAt)
    )
      return false;
    const key = `${t.kind}:${t.id}`;
    if (keys.has(key) || (t.key !== undefined && t.key !== key)) return false;
    keys.add(key);
    return true;
  });
}

function reminders(v: unknown): boolean {
  return uniqueRows(v, "id", (r) => {
    if (
      typeof r.on !== "boolean" ||
      !(r.cardId === null || text(r.cardId)) ||
      typeof r.label !== "string" ||
      !oneOf(r.mode, ["daily", "weekly", "interval", "once"])
    )
      return false;
    if (sanitizeReminders([r]).length !== 1) return false;
    if (
      r.mode === "weekly" &&
      (!Array.isArray(r.days) ||
        !r.days.length ||
        !r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    )
      return false;
    if ((r.mode === "once" || r.mode === "interval") && !date(r.date))
      return false;
    return (
      r.mode !== "interval" ||
      (Number.isInteger(r.everyDays) && Number(r.everyDays) >= 1)
    );
  });
}

function setting(key: string, value: unknown): boolean {
  if (key === "tags" || key === "myRoutine") return strings(value);
  if (key === "mode") return oneOf(value, ["normal", "busy", "travel", "sick"]);
  if (key === "reminders") return reminders(value);
  if (key === "cadence")
    return (
      object(value) &&
      Object.values(value).every((v) =>
        oneOf(v, ["daily", "weekly", "monthly"]),
      )
    );
  if (key === "skipToday")
    return object(value) && Object.values(value).every(date);
  return false;
}

export function validateBackup(value: unknown): asserts value is Backup {
  if (!object(value) || !Array.isArray(value.events))
    throw new Error("这不是本应用导出的备份文件");
  if (value.schemaVersion !== BACKUP_VERSION)
    throw new Error("备份版本与当前应用不一致");
  const keys = ["tags", "mode", "myRoutine", "cadence", "skipToday"];
  if (
    !text(value.exportedAt) ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    !events(value.events) ||
    !custom(value.custom) ||
    !tombstones(value.tombstones) ||
    !reminders(value.reminders) ||
    !object(value.settings) ||
    Object.keys(value.settings).some((k) => !keys.includes(k)) ||
    !keys.every((k) => setting(k, (value.settings as Row)[k]))
  ) {
    throw new Error("备份数据不完整或格式错误");
  }
}

export function validatePayload(value: unknown): asserts value is SyncPayload {
  if (
    !object(value) ||
    value.v !== SYNC_PAYLOAD_VERSION ||
    !text(value.deviceId) ||
    !time(value.updatedAt) ||
    !events(value.events) ||
    !custom(value.custom) ||
    !tombstones(value.tombstones) ||
    !uniqueRows(
      value.settings,
      "key",
      (s) =>
        (SYNCED_SETTING_KEYS as readonly string[]).includes(String(s.key)) &&
        time(s.updatedAt) &&
        setting(String(s.key), s.value),
    )
  ) {
    throw new Error("同步数据格式错误或版本不一致");
  }
}
