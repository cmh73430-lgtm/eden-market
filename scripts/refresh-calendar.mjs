// 달력 자동 갱신: 올해·내년 한국거래소 휴장일과 미국 일정(FOMC·CPI·고용)을 채운다. eden-market 의 calendar.yml 이 매달 돌린다.
// 휴장일 = shared/calendar.js krxHolidays() 규칙 + 음력 날짜(설·추석·부처님오신날)·임시 공휴일은 date.nager.at 공개 API
// 이미 있는 해는 그대로 둔다 (KRX 공지로 손본 값 우선). --force 면 다시 계산, --dry 면 저장하지 않고 보여 주기만.
// 실행: node scripts/refresh-calendar.mjs [--dry] [--force] [--years=2027,2028]
import { readFileSync, writeFileSync } from "node:fs";
import { krxHolidays } from "../shared/calendar.js";
import { lunarFromNager, lunarFromIcs, KR_ICS, parseFomc, parseBlsIcs } from "../server/calendar-src.js";

const arg = (k) => { const a = process.argv.find((x) => x.startsWith("--" + k)); return a ? (a.includes("=") ? a.split("=")[1] : true) : null; };
const DRY = !!arg("dry"), FORCE = !!arg("force");
const kstYear = Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 4));
const YEARS = arg("years") ? String(arg("years")).split(",").map(Number) : [kstYear, kstYear + 1];
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36" };
const get = async (url, type = "json") => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status + " " + url); return type === "json" ? r.json() : r.text(); };
const HOL = "data/holidays.json", EV = "data/events.json";
const hol = JSON.parse(readFileSync(HOL, "utf8")), ev = JSON.parse(readFileSync(EV, "utf8"));
const log = [];

// ---- 한국거래소 휴장일 ----
for (const y of YEARS) {
  if (hol[y] && !FORCE) { log.push(`휴장일 ${y}: 이미 있음 (${hol[y].length}일)`); continue; }
  try {
    // 1순위 구글 대한민국 공휴일 달력, 안 되면 date.nager.at
    let got = null, src = "";
    try { const g = lunarFromIcs(await get(KR_ICS, "text"), y); if (g.lunar.seol && g.lunar.chuseok && g.lunar.buddha) { got = g; src = "구글 달력"; } } catch (e) { log.push(`  구글 달력 실패: ${e.message}`); }
    if (!got) { got = lunarFromNager(await get(`https://date.nager.at/api/v3/PublicHolidays/${y}/KR`)); src = "nager"; }
    const { lunar, extras } = got;
    if (!lunar.seol || !lunar.chuseok || !lunar.buddha) throw new Error("음력 날짜 못 찾음 " + JSON.stringify(lunar));
    const days = krxHolidays(y, lunar, extras);
    hol[y] = days;
    log.push(`휴장일 ${y}: ${days.length}일 계산 [${src}] (설 ${lunar.seol} · 추석 ${lunar.chuseok} · 부처님 ${lunar.buddha}${extras.length ? " · 임시 " + extras.map((e) => e.date + e.name).join(",") : ""})`);
    log.push("  " + days.map((h) => h.date.slice(5) + " " + h.name).join(" | "));
  } catch (e) { log.push(`휴장일 ${y}: 실패 ${e.message} (앱에 '휴장일 표 없음' 안내가 떠요)`); }
}

// ---- FOMC (연준 공식 일정표: 발표일 = 회의 마지막 날) ----
const hasYear = (key, y) => (ev[key] || []).some((d) => d.startsWith(y + "-"));
try {
  const need = YEARS.filter((y) => FORCE || !hasYear("fomc", y));
  if (need.length) {
    const html = await get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", "text");
    for (const y of need) { const ds = parseFomc(html, y); if (ds.length >= 6) { ev.fomc = [...new Set([...(ev.fomc || []).filter((d) => !d.startsWith(y + "-")), ...ds])].sort(); log.push(`FOMC ${y}: ${ds.join(", ")}`); } else log.push(`FOMC ${y}: 아직 발표 전이거나 못 읽음`); }
  } else log.push("FOMC: 이미 있음");
} catch (e) { log.push("FOMC: 실패 " + e.message); }

// ---- 미국 CPI·고용 (BLS 발표 일정 달력 .ics) ----
try {
  const need = YEARS.filter((y) => FORCE || !hasYear("cpi", y) || !hasYear("jobs", y));
  if (need.length) {
    const b = parseBlsIcs(await get("https://www.bls.gov/schedule/news_release/bls.ics", "text"));
    for (const key of ["cpi", "jobs"]) for (const y of need) {
      const ds = b[key].filter((d) => d.startsWith(y + "-"));
      if (ds.length && (FORCE || !hasYear(key, y))) { ev[key] = [...new Set([...(ev[key] || []).filter((d) => !d.startsWith(y + "-")), ...ds])].sort(); log.push(`${key} ${y}: ${ds.length}개`); }
      else if (!ds.length) log.push(`${key} ${y}: 아직 발표 전이거나 못 읽음`);
    }
  } else log.push("CPI·고용: 이미 있음");
} catch (e) { log.push("CPI·고용: 실패 " + e.message + " (BLS 가 막으면 손으로)"); }

console.log(log.join("\n"));
if (!DRY) { writeFileSync(HOL, JSON.stringify(hol, null, 2) + "\n"); writeFileSync(EV, JSON.stringify(ev, null, 2) + "\n"); console.log("저장했어요"); }
