/**
 * .ics 文件的校验规则（纯函数，不碰浏览器）。
 *
 * 为什么要单独拆出来：AGENTS.md §7 的 P2 退出条件里有一条是
 * 「.ics 在 iOS 日历与 Google 日历导入后按时提醒」。真机导入没法自动化，
 * 能自动化的只有「文件本身对不对」——而「对不对」是一组纯规则，
 * 跟浏览器无关，拆开才能单独验。
 *
 * 拆开也跟仓库既有结构一致：app/src/domain/ics.ts 是纯函数，
 * 界面那层（app/src/ui/Settings.tsx）只负责触发下载。
 */

/** 20261019T230000Z → Date（UTC） */
export function parseUtcStamp(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/** Date → 20261019T230000Z */
export function utcStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    "T" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "Z"
  );
}

/** 拆出 VEVENT 块（先展开折行）。 */
export function parseIcs(text) {
  const raw = text.split("\r\n");
  if (raw.length && raw[raw.length - 1] === "") raw.pop();

  // 折行：续行以一个空格开头，接回上一行
  const lines = [];
  for (const line of raw) {
    if (line.startsWith(" ") && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = [];
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  return { raw, lines, events };
}

/** VEVENT 块的属性表（同名属性可能有多个，取第一个）。 */
function props(block) {
  const map = new Map();
  for (const line of block) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const name = line.slice(0, i).split(";")[0].toUpperCase();
    const value = line.slice(i + 1);
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(value);
  }
  return map;
}

/**
 * 校验一份 .ics。
 * @param {string} text 文件内容
 * @returns {{failures: string[], details: string[]}} failures 非空即不合格
 */
export function validateIcs(text) {
  const details = [];
  const failures = [];

  const { raw, lines, events } = parseIcs(text);

  // 换行必须是 CRLF（RFC 5545）
  if (/(?<!\r)\n/.test(text)) {
    failures.push("文件里有裸 LF 换行，ICS 要求 CRLF");
  }

  // 每行 ≤ 75 字节（RFC 5545）
  const tooLong = raw
    .map((l, i) => ({ i: i + 1, bytes: Buffer.byteLength(l, "utf8") }))
    .filter((x) => x.bytes > 75);
  if (tooLong.length > 0) {
    failures.push(
      `有 ${tooLong.length} 行超过 75 字节（最长 ${Math.max(...tooLong.map((x) => x.bytes))} 字节，第 ${tooLong[0].i} 行）`,
    );
  } else {
    details.push(`全部 ${raw.length} 行都在 75 字节以内`);
  }

  if (!lines.includes("BEGIN:VCALENDAR") || !lines.includes("END:VCALENDAR")) {
    failures.push("不是一个完整的 VCALENDAR（缺 BEGIN:VCALENDAR 或 END:VCALENDAR）");
  }
  if (events.length !== 2) {
    failures.push(`期望 2 条每日重复事件（早晚各一条），实际 ${events.length} 条`);
  }
  if (/VALUE=DATE/i.test(text)) {
    failures.push("事件里出现 VALUE=DATE —— 全天事件在系统日历里不会按时响");
  }

  const bySlot = new Map();
  for (const block of events) {
    const p = props(block);
    const get = (k) => p.get(k)?.[0];

    const dtstart = get("DTSTART");
    const dtend = get("DTEND");
    if (!dtstart || !/^\d{8}T\d{6}Z$/.test(dtstart)) {
      failures.push(
        `DTSTART 不是 UTC 定时时间戳（期望 20261019T070000Z 这种形式），实际：${dtstart ?? "（缺失）"}`,
      );
      continue;
    }
    const start = parseUtcStamp(dtstart);
    if (!start) {
      failures.push(`DTSTART 解析不了：${dtstart}`);
      continue;
    }
    if (!dtend || !/^\d{8}T\d{6}Z$/.test(dtend)) {
      failures.push(`DTEND 不是 UTC 定时时间戳，实际：${dtend ?? "（缺失）"}`);
    } else {
      const end = parseUtcStamp(dtend);
      const mins = (end - start) / 60000;
      if (!(mins > 0 && mins <= 1440)) {
        failures.push(`DTEND − DTSTART = ${mins} 分钟，不像一个定时事件`);
      }
    }

    const rrule = get("RRULE");
    if (!rrule || !/FREQ=DAILY/.test(rrule)) {
      failures.push(`缺 RRULE:FREQ=DAILY（每日重复），实际：${rrule ?? "（缺失）"}`);
    }

    const alarmStart = block.indexOf("BEGIN:VALARM");
    const alarmEnd = block.indexOf("END:VALARM");
    if (alarmStart < 0 || alarmEnd < alarmStart) {
      failures.push("事件里没有 BEGIN:VALARM…END:VALARM（没有提醒，系统日历不会响）");
    } else {
      const alarm = block.slice(alarmStart + 1, alarmEnd);
      const trigger = alarm.find((l) => l.startsWith("TRIGGER:"));
      if (!trigger) {
        failures.push("VALARM 里没有 TRIGGER");
      } else if (!/^TRIGGER:-PT\d+M$/.test(trigger)) {
        failures.push(`TRIGGER 不是提前 N 分钟的形式，实际：${trigger}`);
      } else {
        const mins = Number(/PT(\d+)M/.exec(trigger)[1]);
        if (mins < 1 || mins > 60) {
          failures.push(`TRIGGER 提前 ${mins} 分钟，不合理`);
        }
      }
      if (!alarm.some((l) => l.startsWith("ACTION:"))) {
        failures.push("VALARM 里没有 ACTION");
      }
    }

    const url = get("URL");
    if (!url || !/\?slot=(morning|evening)/.test(url)) {
      failures.push(
        `URL 没带 ?slot=morning|evening（打开后落不到对应时段），实际：${url ?? "（缺失）"}`,
      );
    } else {
      const slot = /\?slot=(morning|evening)/.exec(url)[1];
      if (bySlot.has(slot)) failures.push(`两条事件的 slot 都是 ${slot}`);
      bySlot.set(slot, { start, block });
    }
  }

  // 换算到本地时间后，早提醒要在早上、晚提醒要在晚上
  // （「早 7 点提醒其实是凌晨 5 点」就是本地时区换算错了）
  const morning = bySlot.get("morning");
  const evening = bySlot.get("evening");
  if (morning) {
    const h = morning.start.getHours();
    details.push(`晨间事件本地时间 ${h}:00`);
    if (h < 5 || h > 11) {
      failures.push(
        `晨间提醒换算成本地时间是 ${h}:00，不像早晨（本地时区换算可能错了）`,
      );
    }
  }
  if (evening) {
    const h = evening.start.getHours();
    details.push(`晚间事件本地时间 ${h}:00`);
    if (h < 18 || h > 23) {
      failures.push(
        `晚间提醒换算成本地时间是 ${h}:00，不像晚上（本地时区换算可能错了）`,
      );
    }
  }
  if (morning && evening && morning.start >= evening.start) {
    failures.push("晨间事件不早于晚间事件");
  }

  if (failures.length === 0) {
    details.push(
      `两条每日重复定时事件，各带 VALARM，URL 带 slot，${raw.length} 行全部合规`,
    );
  }

  return { details, failures };
}
