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

// 미국 증시(NYSE) 휴장일 — 규칙으로 해마다 계산 (연 1회 손으로 고칠 필요 없음)
// 신정·MLK(1월 셋째 월)·대통령의 날(2월 셋째 월)·성금요일·메모리얼(5월 마지막 월)·준틴스(6/19)·독립기념일·노동절(9월 첫 월)·추수감사절(11월 넷째 목)·성탄절
// 토요일이면 전날 금요일, 일요일이면 다음 월요일 (단, 신정이 토요일이면 전년 12/31 은 쉬지 않음 — NYSE 규칙)
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return y + "-" + String(mo).padStart(2, "0") + "-" + String(da).padStart(2, "0"); }
const ymd = (y, m, d) => y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
function lastWeekday(y, m, wd) { let d = ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate()); while (weekday(d) !== wd) d = addDays(d, -1); return d; }
function observed(d, newYear) { const w = weekday(d); if (w === 6) return newYear ? null : addDays(d, -1); if (w === 0) return addDays(d, 1); return d; }
export function usHolidays(y) {
  return [observed(ymd(y, 1, 1), true), nthWeekday(y, 1, 1, 3), nthWeekday(y, 2, 1, 3), addDays(easter(y), -2), lastWeekday(y, 5, 1),
    ...(y >= 2022 ? [observed(ymd(y, 6, 19))] : []), observed(ymd(y, 7, 4)), nthWeekday(y, 9, 1, 1), nthWeekday(y, 11, 4, 4), observed(ymd(y, 12, 25))].filter(Boolean).sort();
}
export const US_HOLIDAYS = Array.from({ length: 2080 - 2020 + 1 }, (_, i) => usHolidays(2020 + i)).flat();
export const isUsTradingDay = (s) => isBusinessDay(s, US_HOLIDAYS);
// 한국 날짜 s 아침에 볼 수 있는 가장 최근 미국 거래일 (미국 날짜로 s보다 앞선 날)
export function lastUsTradingDayBefore(s) { let d = addDays(s, -1); while (!isUsTradingDay(d)) d = addDays(d, -1); return d; }
// 연휴 뒤 첫 거래일인지: 직전 한국 거래일과 오늘 사이에 쉰 평일(휴장일)이 있으면 그 날들을 돌려준다
export function holidayGap(s, holidays) {
  const set = toSet(holidays), prevKr = prevBusinessDay(s, set), skipped = [];
  for (let d = addDays(prevKr, 1); d < s; d = addDays(d, 1)) { const wd = weekday(d); if (wd !== 0 && wd !== 6 && set.has(d)) skipped.push(d); }
  return { prevKr, skipped };
}
// 시세 시각 → 미국 동부 날짜 (YYYY-MM-DD)
export function usDateOf(time) {
  if (!time) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(time))) return String(time); // 이미 미국 날짜 (일봉 날짜)
  const t = new Date(time); if (isNaN(t)) return null;
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(t); } catch (e) { return String(time).slice(0, 10); }
}

export function nextBusinessDays(s, holidays, n = 2) {
  const set = toSet(holidays), out = [];
  let d = s;
  while (out.length < n) { d = addDays(d, 1); if (isBusinessDay(d, set)) out.push(d); }
  return out;
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

  if (isBusinessDay(s, holidays)) {
    const g = holidayGap(s, holidays);
    if (g.skipped.length) {
      let off = 0; for (let d = addDays(g.prevKr, 1); d < s; d = addDays(d, 1)) off++;
      out.push({ k: "연휴 후 첫날 (" + off + "일 쉬고 · 미국 신호는 연휴 누적)", lv: "a", ev: "연휴후" });
    }
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
// 한국거래소(KRX) 휴장일 — 규칙 + 음력 날짜(설·추석·부처님오신날)로 해마다 계산 (scripts/refresh-calendar.mjs 가 음력 날짜를 받아 와서 data/holidays.json 에 채운다)
// lunar = { seol: 설날 당일, chuseok: 추석 당일, buddha: 부처님오신날 } · extras = 선거일 같은 임시 공휴일 [{date,name}]
// 대체공휴일: 삼일절·어린이날·부처님오신날·제헌절·광복절·개천절·한글날·성탄절이 토·일이면, 설·추석 연휴가 일요일과 겹치면 다음 평일(공휴일 아닌 날)
export function krxHolidays(y, lunar = {}, extras = []) {
  const base = [], add = (date, name, sub) => date && base.push({ date, name, sub });
  add(ymd(y, 1, 1), "신정");
  const block = (day, name) => { if (!day) return; [addDays(day, -1), day, addDays(day, 1)].forEach((d, i) => add(d, i === 1 ? name : name + " 연휴", i === 1 ? "block" : "block")); };
  block(lunar.seol, "설날");
  add(ymd(y, 3, 1), "삼일절", "wk"); add(ymd(y, 5, 1), "근로자의 날"); add(ymd(y, 5, 5), "어린이날", "kids");
  add(lunar.buddha, "부처님오신날", "wk"); add(ymd(y, 6, 6), "현충일");
  if (y >= 2026) add(ymd(y, 7, 17), "제헌절", "wk");
  add(ymd(y, 8, 15), "광복절", "wk"); block(lunar.chuseok, "추석");
  add(ymd(y, 10, 3), "개천절", "wk"); add(ymd(y, 10, 9), "한글날", "wk"); add(ymd(y, 12, 25), "성탄절", "wk");
  (extras || []).forEach((e) => add(e.date, e.name));
  const taken = new Set(base.map((h) => h.date)), isOff = (d) => [0, 6].includes(weekday(d)) || taken.has(d);
  const nextFree = (d) => { let n = addDays(d, 1); while (isOff(n)) n = addDays(n, 1); return n; };
  const subs = [];
  const count = {}; base.forEach((h) => (count[h.date] = (count[h.date] || 0) + 1));
  base.forEach((h) => {
    const w = weekday(h.date);
    if ((h.sub === "wk" && (w === 0 || w === 6)) || (h.sub === "kids" && (w === 0 || w === 6 || count[h.date] > 1))) { const d = nextFree(h.date); taken.add(d); subs.push({ date: d, name: h.name + " 대체" }); }
  });
  [["설날", lunar.seol], ["추석", lunar.chuseok]].forEach(([nm, day]) => {
    if (!day) return; const days = [addDays(day, -1), day, addDays(day, 1)];
    if (days.some((d) => weekday(d) === 0 || (count[d] || 0) > 1)) { const d = nextFree(days[2]); taken.add(d); subs.push({ date: d, name: nm + " 대체" }); }
  });
  // 연말 휴장: 12/31 (주말이면 그 전 평일)
  let ye = ymd(y, 12, 31); while ([0, 6].includes(weekday(ye))) ye = addDays(ye, -1);
  const all = [...base, ...subs, { date: ye, name: "연말 휴장" }].filter((h) => ![0, 6].includes(weekday(h.date)));
  const seen = new Map(); all.forEach((h) => { if (!seen.has(h.date)) seen.set(h.date, h.name); });
  return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, name]) => ({ date, name }));
}

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
