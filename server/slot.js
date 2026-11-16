// 9.29-158 원장 [집2664] 「수집 시각·날짜 고정」: GitHub 예약이 3~10시간 늦게 돌아(155 B 문제 1 · 실측 10/28~) 「지금 시각」으로 종류(whenOf)·날짜(kstDate)를 정하면
//  20:20 칸이 새벽에 「아침」으로 · 16:00 칸이 자정 넘어 다음 날 「장마감_1600」 으로 · 확정 마감이 안 돌아 점수판(leaders-ab.json)이 멈췄다.
//  → 워크플로가 예약 칸(github.event.schedule = cron 글자)을 --cron= 으로 넘기고, 여기 표가 칸 → 종류·날짜·허용 창을 정한다 (순수 함수만 · 실행은 scripts/collect-auto.mjs)
//  GitHub 는 예정 시각을 주지 않으므로 「지금 이전의 가장 최근 그 칸 시각」을 예정 시각으로 본다(같은 칸이 하루 넘게 늦으면 구분 못 함 — 그 전에 창이 닫혀 건너뜀).
//  날짜 = 예정 시각의 KST 날짜(그 칸이 속한 거래일) · 휴장·주말이면 수집기가 건너뜀(skipReason) · 창 밖이면 저장 0 + 로그.
import { kstDate, kstTime, addDays, nextBusinessDays, isUsDst } from "../shared/calendar.js";

// 칸 표 (cron 은 UTC · eden/collect.yml 과 글자 그대로 같아야 함 — test/cockpit158 이 대조)
//  at = 예정 KST 시각 · lateAt = 이 시각 뒤 받으면 「늦게 받음」(late) 표시 · until = 이 시각 뒤면 건너뜀(next = 다음 거래일의 그 시각)
export const SLOTS = [
  { cron: "35 21 * * 0-4", name: "아침 06:35", when: "morning", at: "06:35", lateAt: "09:00", until: "15:30" },
  { cron: "5 22 * * 0-4", name: "아침 07:05", when: "morning", at: "07:05", lateAt: "09:00", until: "15:30" },
  { cron: "5 23 * * 0-4", name: "아침 08:05", when: "morning", at: "08:05", lateAt: "09:00", until: "15:30" },
  { cron: "32 0 * * 1-5", name: "장중 09:32", when: "intraday", at: "09:32", lateAt: "10:02", until: "15:30" },
  { cron: "*/5 0-6 * * 1-5", name: "실시간 5분", when: "live", live: true }, // 날짜·시각 = 지금(받는 값이 지금 값 · liveSlot 이 09:05~16:00 밖 건너뜀) — 예전과 같음
  { cron: "0 7 * * 1-5", name: "오후 4시 기준 16:00", when: "close1600", at: "16:00", lateAt: "16:30", until: "18:00" },
  { cron: "20 7 * * 1-5", name: "마감 16:20", when: "close", at: "16:20", lateAt: "16:50", until: "08:00", next: true },
  { cron: "45 10 * * 1-5", name: "마감 19:45", when: "close", at: "19:45", lateAt: "20:15", until: "08:00", next: true },
  { cron: "20 11 * * 1-5", name: "마감 20:20", when: "close", at: "20:20", lateAt: "20:50", until: "08:00", next: true },
];
// 창 근거: 아침 = 미국장 마감(05:00 서머타임 · 06:00) 뒤 ~ 장 시작 09:00 제때 · 장 마감 15:30 까지 늦게(미국 마감 값은 그대로라 「늦게 받음」 표시로 저장) · 그 뒤 건너뜀
//  장중 = 정규장 15:30 까지(값마다 받은 시각 at 이 붙음) · 오후 4시 기준 = 18:00 야간 파생 거래 시작 전까지(16:30 뒤 = 늦게 받음 · 18:00 뒤 = 「4시」 뜻과 어긋나 건너뜀)
//  마감 = 다음 거래일 08:00 까지 그 날 파일에 저장 · 18:00 뒤·다음 날이면 확정(수급 포함) — 실측(gate [집2672]): 네이버 종목 값 다음 날 전환은 07:10 이고 바뀌는 것은 NXT 칸뿐 · 마감 수집(지수·수급·프로그램·종목 정규장 값)은 그 칸을 안 씀
//   → 08:00 은 여유 끝 · 받은 값 날짜(지수 시각 · 수급·프로그램 bizdate)는 collectClose(date) 가 다시 검사해 다르면 그 칸 저장 안 함
export const slotOf = (cron) => SLOTS.find((s) => s.cron === String(cron || "").trim()) || null;

const pad = (n) => String(n).padStart(2, "0");
// KST 날짜·시각 → ms
export const kstMs = (date, hm) => { const [y, m, d] = date.split("-").map(Number), [h, mi] = hm.split(":").map(Number); return Date.UTC(y, m - 1, d, h - 9, mi); };
// cron 「분 시 * * 요일」(UTC · 숫자 하나 · 요일 a-b) 의 지금 이전 가장 최근 시각(ms) · 모양이 다르면 null
export function lastFire(cron, nowMs) {
  const p = String(cron || "").trim().split(/\s+/); if (p.length !== 5 || !/^\d+$/.test(p[0]) || !/^\d+$/.test(p[1])) return null;
  const mi = Number(p[0]), h = Number(p[1]), dw = p[4] === "*" ? [0, 1, 2, 3, 4, 5, 6] : (() => { const m = p[4].match(/^(\d)-(\d)$/); if (m) { const out = []; for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i); return out; } return p[4].split(",").map(Number); })();
  const n = new Date(nowMs);
  for (let k = 0; k <= 8; k++) { const t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - k, h, mi); if (t <= nowMs && dw.includes(new Date(t).getUTCDay())) return t; }
  return null;
}
// 미국장 마감 KST 시각(그 날 아침에 끝나는 미국 정규장 = 전날 미국 날짜) — 서머타임 05:00 · 아니면 06:00
export const usCloseKst = (date) => (isUsDst(addDays(date, -1)) ? "05:00" : "06:00");

// 칸 → { when, date, slot(기록용 메타), skip(창 밖 이유 · 없으면 null) } · cron 이 없으면 null(수동 실행 = 예전처럼 지금 시각 · --when·--date)
//  알 수 없는 cron = 건너뜀(추정 0 · 표에 넣을 것)
export function slotRun(cron, now = new Date(), holidays = []) {
  if (!cron) return null;
  const s = slotOf(cron), nowMs = now.getTime(), ranDate = kstDate(now), ranAt = kstTime(now).slice(0, 5);
  if (!s) return { when: null, date: null, slot: null, skip: "모르는 예약 칸 「" + cron + "」 — server/slot.js SLOTS 에 없음 — 추정 안 하고 건너뜀" };
  if (s.live) return { when: s.when, date: ranDate, slot: null, skip: null };
  const fire = lastFire(s.cron, nowMs); if (fire === null) return { when: s.when, date: null, slot: null, skip: "예정 시각 계산 실패 「" + cron + "」 — 건너뜀" };
  const date = kstDate(new Date(fire)), delayMin = Math.round((nowMs - fire) / 60000);
  const endDay = s.next ? nextBusinessDays(date, holidays, 1)[0] || addDays(date, 1) : date, endMs = kstMs(endDay, s.until);
  const late = nowMs > kstMs(date, s.lateAt);
  const slot = { name: s.name, cron: s.cron, date, at: s.at, ranDate, ranAt, delayMin, late };
  const skip = nowMs > endMs ? `${s.name} 칸(${date}) 이 ${delayMin}분 늦게 옴(${ranDate} ${ranAt}) — 허용 창(${endDay === date ? "" : endDay + " "}${s.until} 까지) 밖이라 저장 안 함` : null;
  return { when: s.when, date, slot, skip };
}
export const slotText = (r) => !r ? "수동 실행(예약 칸 없음 · 지금 시각·인자로)" : r.skip ? r.skip : !r.slot ? `예약 칸 → ${r.when} · 날짜 ${r.date}` : `예약 칸 ${r.slot.name} → ${r.when} · 날짜 ${r.date} · 실제 ${r.slot.ranDate} ${r.slot.ranAt}(${r.slot.delayMin}분 늦음${r.slot.late ? " · 늦게 받음 표시" : ""})`;

// 아침 값이 그 칸 뜻(미국장 마감 뒤 · 장 시작 전)에 맞나: 받은 날이 그 날이고 미국장 마감 전이면 「마감 전 값」 → 저장 안 함(수동·--force 제외)
export function morningEarly(date, now = new Date()) { const d = kstDate(now), hm = kstTime(now).slice(0, 5); return d < date || (d === date && hm < usCloseKst(date)); }
// 이미 있는 블록이 「제때」 값인가(늦게 온 값이 덮지 않게) — slot 메타가 있으면 late 거짓 · 옛 기록(slot 없음)은 받은 시각으로: 아침 = 미국장 마감 ~ 09:00 · 4시 = 16:00 ~ 16:30
export function onTimeBlock(kind, b, date) {
  if (!b || typeof b !== "object") return false;
  if (b.slot && typeof b.slot === "object") return !b.slot.late;
  const at = typeof b.at === "string" ? b.at : "";
  return kind === "morning" ? at >= usCloseKst(date) && at < "09:00" : kind === "close1600" ? at >= "16:00" && at <= "16:30" : false;
}
// 성적표 마감 봉 규칙(close.at ≥ 16:20)용 시각: 다음 날 받은 확정 마감은 그 날 장이 다 끝난 뒤라 「24:00」 (실제 받은 시각은 close.at · close.slot 에 그대로)
export const closeAtFor = (at, date, ranDate) => (ranDate && ranDate > date ? "24:00" : at);

// 장중 회차(abRuns) 합치기 — 같은 at 은 뒤(새) 값 · at 순 · 최근 max 개 (live.json 은 다음 날 첫 실시간이 덮으므로 날짜 파일에도 보관)
export function mergeRuns(a, b, max = 200) {
  const m = new Map(); for (const r of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) if (r && typeof r.at === "string") m.set(r.at, r);
  return [...m.values()].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)).slice(-max);
}
export const AB_RUNS_KEY = "abRuns"; // 날짜 파일 최상위 칸(close 블록 밖 — mergeAuto 가 close 를 통째로 바꿔도 남음)
