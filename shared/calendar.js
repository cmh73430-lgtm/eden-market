// 날짜·이벤트 계산 — 순수 함수 (브라우저·Node 공용)
// 날짜는 모두 "YYYY-MM-DD" 문자열(한국 세션 날짜)로 다루고, 내부 계산은 UTC로 해서 기기 시간대 영향을 받지 않는다.

const pad = (n) => String(n).padStart(2, "0");
const toUTC = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUTC = (d) => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function kstNow(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000); // UTC 필드로 읽으면 KST
}
export function kstDate(now = new Date()) { return fromUTC(kstNow(now)); }
export function kstTime(now = new Date()) {
  const k = kstNow(now);
  return pad(k.getUTCHours()) + ":" + pad(k.getUTCMinutes()) + ":" + pad(k.getUTCSeconds());
}

export function addDays(s, n) { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return fromUTC(d); }
export function weekday(s) { return toUTC(s).getUTCDay(); }
export const isValidDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(toUTC(s)) === s;

// holidays: Set 또는 배열 (주말은 자동으로 휴장)
const toSet = (h) => (h instanceof Set ? h : new Set(h || []));
export function isBusinessDay(s, holidays) {
  const wd = weekday(s);
  return wd !== 0 && wd !== 6 && !toSet(holidays).has(s);
}
export function prevBusinessDay(s, holidays) {
  const set = toSet(holidays);
  let d = addDays(s, -1);
  while (!isBusinessDay(d, set)) d = addDays(d, -1);
  return d;
}

// n번째 특정 요일 (month 1~12, wd 0=일)
export function nthWeekday(year, month, wd, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return fromUTC(new Date(Date.UTC(year, month - 1, 1 + ((wd - first + 7) % 7) + 7 * (n - 1))));
}
export const secondThursday = (year, month) => nthWeekday(year, month, 4, 2);

// 월물 옵션만기: 둘째 목요일, 휴장이면 직전 영업일
export function monthlyExpiry(year, month, holidays) {
  const d = secondThursday(year, month);
  return isBusinessDay(d, holidays) ? d : prevBusinessDay(d, holidays);
}

// 미국 서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일 (한국 날짜 기준 근사)
export function isUsDst(s) {
  const y = Number(s.slice(0, 4));
  return s >= nthWeekday(y, 3, 0, 2) && s < nthWeekday(y, 11, 0, 1);
}
// 미 경제지표(08:30 ET) 발표 시각, KST
export const usReleaseKst = (s) => (isUsDst(s) ? "21:30" : "22:30");
// FOMC 성명(14:00 ET) 발표 시각, KST 다음 날 새벽
export const fomcKst = (s) => (isUsDst(s) ? "03:00" : "04:00");

/**
 * 날짜로 자동 감지되는 이벤트
 * @param {string} s  한국 세션 날짜
 * @param {object} cal { events: {fomc:[], cpi:[], jobs:[], bok:[], msci:[]}, holidays: string[]|Set, holidayNames?: {date: name} }
 * @returns {{k: string, lv: "a"|"r"|"", ev?: string}[]}  lv ""는 참고 표시(판정 제외), ev는 대응하는 수동 이벤트 칩
 */
export function autoEvents(s, cal = {}) {
  const holidays = toSet(cal.holidays);
  const ev = cal.events || {};
  const out = [];
  const [y, m] = s.split("-").map(Number);

  if (!isBusinessDay(s, holidays)) {
    const wd = weekday(s);
    const name = (cal.holidayNames || {})[s];
    out.push({ k: wd === 0 || wd === 6 ? "주말 · 휴장" : "휴장" + (name ? " · " + name : ""), lv: "" });
  }

  const exp = monthlyExpiry(y, m, holidays);
  if (exp === s) {
    const moved = exp !== secondThursday(y, m) ? " (둘째 목 휴장 → 앞당김)" : "";
    out.push([3, 6, 9, 12].includes(m)
      ? { k: "동시만기" + moved, lv: "r", ev: "동시만기" }
      : { k: "옵션만기" + moved, lv: "a", ev: "옵션만기" });
  }

  const has = (key) => (ev[key] || []).includes(s);
  if (has("fomc")) out.push({ k: "FOMC (오늘 밤 발표 · " + fomcKst(s) + " KST)", lv: "a", ev: "FOMC" });
  if (has("cpi")) out.push({ k: "미 CPI (" + usReleaseKst(s) + " KST)", lv: "a", ev: "CPI" });
  if (has("jobs")) out.push({ k: "미 고용 (" + usReleaseKst(s) + " KST)", lv: "a", ev: "고용" });
  if (has("bok")) out.push({ k: "금통위", lv: "a", ev: "금통위" });
  if (has("msci")) out.push({ k: "MSCI 리밸런싱", lv: "a", ev: "MSCI" });
  return out;
}

// data/holidays.json → {set, names}
export function holidayIndex(json) {
  const names = {};
  Object.values(json || {}).forEach((list) => {
    if (Array.isArray(list)) list.forEach((h) => (names[h.date] = h.name));
  });
  return { list: Object.keys(names), names };
}

// 하루 자동 수집 시점 (장전·오전·오후·장후). 시각은 .env 로 바꿀 수 있다 (server/app.js loadSessions).
export const DEFAULT_SESSIONS = [
  { key: "pre", label: "장전", at: "07:25" },
  { key: "am", label: "오전", at: "10:00" },
  { key: "pm", label: "오후", at: "13:30" },
  { key: "post", label: "장후", at: "15:40" },
];

// "HH:MM(:SS)" 시각이 속한 수집 시점 = 이미 지난 것 중 가장 늦은 것 (첫 시점 전이면 첫 시점)
export function sessionAt(time, sessions = DEFAULT_SESSIONS) {
  const t = time.slice(0, 5);
  let cur = sessions[0] || null;
  for (const s of sessions) if (s.at <= t) cur = s;
  return cur;
}
