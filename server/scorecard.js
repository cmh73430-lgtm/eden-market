// 주도 테마 적중 성적표 — 9.29-84 원장 [1597] 「전체 테마 종목 상승비율 대비」 · [1585] · 연구 R5 보고 §6 설계 · 채움 구조는 [1556] 관찰 기록(observe)과 같은 꼴
// 기록만 한다 — 선정·판정에는 안 쓴다. 마감 확정 run(close.at ≥ 16:20) 이 auto/observe/leaders-scorecard.json 에 쌓고, 다음 날부터 D+1~D+4 종가를 채운다.
//  1행 = 선정일 × 방식(a 마감 확정 · b 장후 잠정 16:20 · c live 마지막 · s shadow) × 테마 순위(1~3) × 슬롯(1~5) · 중복 0(열쇠 date|unit|rank|slot|code)
//  base = 선정일 종가(일별 수급 행 종가 · 봉 날짜 < 오늘 또는 오늘이면서 close.at ≥ 16:20 인 것만 = 마감 봉 규칙 · R5 라운드2) · D+k = 선정일 뒤 k번째 「확정 거래일」 종가 (KODEX200 행 날짜 = 거래일력 · 휴장 저절로 건너뜀)
//  ○ = D+k 수익률 > 0 · 참고 = 그 평가일 전체 테마 종목 상승비율(close.themes rise/count 합 · 기준율) 병기 · 적중률(화면) = 선정 슬롯 상승비율 − 기준율
//  크기 상한: 행 SC_MAX_ROWS · 날 SC_MAX_DAYS (오래된 것부터 버림) · 30일 지나도 봉이 없으면 done+miss (계속 요청 안 함)
import { trendRows, obsTrendUrl, paced, AUTO_DIR } from "./auto.js";
import { addDays } from "../shared/calendar.js";
import { ldsLatestA, ldsKeepA } from "../shared/leaders-score.js";

export const SC_FILE = AUTO_DIR + "/observe/leaders-scorecard.json";
export const SC_V = 1, SC_UNITS = { a: "마감 확정(급등 묶음)", b: "장후 잠정(16:20)", c: "장중 마지막(live)", s: "옛 방식(T·L)" }, SC_HORIZONS = [1, 2, 3, 4];
export const SC_THEMES = 3, SC_SLOTS = 5, SC_MAX_ROWS = 2400, SC_MAX_DAYS = 260, SC_CLOSE_MIN = "16:20", SC_REF_DAYS = 20, SC_KODEX = "069500", SC_BAR_N = 20, SC_EXPIRE_DAYS = 30;
export const SC_CONC = 2, SC_GAP_MS = 150, SC_BUDGET_MS = 120000; // 요청 간격은 관찰 기록과 같음 · 전체 2분
export const SC_RULE = "○ = 선정일 종가 → D+k 종가 수익률 > 0 · 기준율 = 평가일 전체 테마 종목 상승비율(close.themes) · 마감 봉만(봉 날짜 < 오늘 또는 close.at ≥ 16:20) · 방식 a 마감 확정 · b 장후 잠정 · c live 마지막 · s shadow · 표본 20거래일 전 참고용 (원장 [1597] · 연구 R5)";
const round2 = (x) => Number(x.toFixed(2));
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export const scEmpty = () => ({ app: "jangjeon-cockpit", kind: "leaders-scorecard", v: SC_V, rule: SC_RULE, updatedAt: null, days: [], rows: [] });
const scNorm = (f) => { const e = scEmpty(); return f && typeof f === "object" ? Object.assign(e, f, { kind: e.kind, v: e.v, rule: SC_RULE, days: Array.isArray(f.days) ? f.days.map((d) => Object.assign({}, d)) : [], rows: Array.isArray(f.rows) ? f.rows.map((r) => Object.assign({}, r)) : [] }) : e; };
// 그 날 전체 테마 종목 상승비율(%) = Σrise / Σcount (close.themes compact 100개). 없으면 null
export function baselineOf(themes) {
  const xs = (Array.isArray(themes) ? themes : []).filter((t) => t && typeof t.count === "number" && t.count > 0);
  const rise = xs.reduce((a, t) => a + (typeof t.rise === "number" ? t.rise : 0), 0), count = xs.reduce((a, t) => a + t.count, 0);
  return count > 0 ? round2((rise / count) * 100) : null;
}
// 마감 봉 규칙: 봉 날짜 d 가 오늘보다 이전이거나, 오늘이면서 이 run 의 close.at 이 16:20 이후
export const isFinalized = (d, today, closeAt = null) => d < today || (d === today && typeof closeAt === "string" && closeAt >= SC_CLOSE_MIN);
export const scKey = (r) => [r.date, r.unit, r.rank, r.slot, r.code].join("|");
// 선정 결과(themes[].slots[]) → 행. 슬롯 코드 6자리만 · 테마 3개 · 슬롯 5개
export function scRowsFrom(date, unit, themes) {
  const out = [];
  (Array.isArray(themes) ? themes : []).slice(0, SC_THEMES).forEach((t, i) => (t && Array.isArray(t.slots) ? t.slots : []).slice(0, SC_SLOTS).forEach((s, j) => {
    if (!s || !/^\d{6}$/.test(String(s.code || ""))) return;
    out.push({ date, unit, rank: i + 1, theme: String(t.name || ""), slot: j + 1, code: String(s.code), name: String(s.name || ""), base: null, d1: null, d2: null, d3: null, d4: null, done: false });
  }));
  return out;
}
// 기록에 합치기: rows 는 열쇠로 하나만(이미 있는 행은 그대로 — 채운 칸 보존) · day = { date, closeAt, baseline, n:{a,b,c,s}, a } 는 같은 날이면 합침
//  9.29-99 원장 [1822][1823] (라운드 5 ②③): replace 에 든 방식(수집기는 a)은 같은 날 다시 돌면 그날 그 방식 행을 이번 결과로 통째 교체 — 같은 종목(코드)이면 이미 채운 칸(base·d1~d4·done·miss)은 이어 씀 · b·c·s 는 예전 그대로(열쇠 합치기)
//  기준율 = 그날 첫 확정 값 유지(이미 있으면 덮지 않음) · day.a = 그날 마지막 확정 선정(테마 이름·슬롯 코드) — 앱·다음 run 이 섞인 날을 정리하는 기준
const SC_CARRY = ["base", "d1", "d2", "d3", "d4", "done", "miss"];
const scFilled = (r) => SC_CARRY.filter((k) => r && r[k] !== null && r[k] !== undefined && r[k] !== false).length;
export function scMerge(file, rows = [], day = null, { replace = [] } = {}) {
  const f = scNorm(file), have = new Set(f.rows.map(scKey)), rep = new Set(replace); let added = 0;
  for (const u of rep) {
    const nu = rows.filter((r) => r && r.unit === u); if (!nu.length) continue;
    const D = nu[0].date, old = f.rows.filter((r) => r.date === D && r.unit === u), byCode = new Map();
    for (const o of old) { const p = byCode.get(o.code); if (!p || scFilled(o) > scFilled(p)) byCode.set(o.code, o); }
    f.rows = f.rows.filter((r) => !(r.date === D && r.unit === u));
    for (const r of nu) { const o = byCode.get(r.code), x = Object.assign({}, r); if (o) for (const k of SC_CARRY) if (k in o) x[k] = o[k]; if (!have.has(scKey(r))) added++; f.rows.push(x); }
  }
  for (const r of rows) { if (rep.has(r.unit)) continue; const k = scKey(r); if (have.has(k)) continue; have.add(k); f.rows.push(Object.assign({}, r)); added++; }
  if (day && day.date) {
    const i = f.days.findIndex((d) => d.date === day.date), cur = i >= 0 ? f.days[i] : null;
    const nd = Object.assign({}, cur || {}, { date: day.date, closeAt: day.closeAt ?? (cur && cur.closeAt) ?? null, baseline: cur && typeof cur.baseline === "number" ? cur.baseline : typeof day.baseline === "number" ? day.baseline : null, n: Object.assign({}, (cur && cur.n) || {}, day.n || {}) });
    if (Array.isArray(day.a)) nd.a = day.a;
    if (cur) f.days[i] = nd; else f.days.push(nd);
  }
  f.days = f.days.sort(byDate).slice(-SC_MAX_DAYS);
  f.rows = f.rows.sort((a, b) => byDate(a, b) || a.unit.localeCompare(b.unit) || a.rank - b.rank || a.slot - b.slot).slice(-SC_MAX_ROWS);
  return { file: f, added };
}
export const scPending = (file, today) => scNorm(file).rows.filter((r) => r && !r.done && r.date <= today);
// 확정 거래일력: KODEX200 행 날짜 중 마감 봉 규칙 통과만 (오래된 순)
export const tradingDaysOf = (kodexRows, today, closeAt) => (Array.isArray(kodexRows) ? kodexRows : []).map((r) => r.date).filter((d) => isFinalized(d, today, closeAt)).sort();
// 한 행 채우기: rows = 그 종목 trendRows(오래된 순) · days = 거래일력 · baselines = { date: 기준율 } · 봉은 마감 봉 규칙 통과만 쓴다
export function scFill(row, rows, days, baselines = {}, today, closeAt = null) {
  const r = Object.assign({}, row), xs = (Array.isArray(rows) ? rows : []).filter((x) => x && x.date && x.close > 0 && isFinalized(x.date, today, closeAt));
  const at = (d) => xs.find((x) => x.date === d);
  const expired = addDays(r.date, SC_EXPIRE_DAYS) < today;
  const b = at(r.date);
  if (!b) { if (expired && xs.length) { r.done = true; r.miss = "선정일 봉 없음(기간 지남)"; } return r; }
  if (typeof r.base !== "number") r.base = b.close;
  const i = days.indexOf(r.date);
  if (i < 0) return r; // 거래일력에 선정일이 없음(KODEX 못 받음) → 다음 run
  let all = true;
  for (const k of SC_HORIZONS) {
    if (r["d" + k] && typeof r["d" + k].ret === "number") { if (typeof r["d" + k].bl !== "number" && typeof baselines[r["d" + k].date] === "number") r["d" + k].bl = baselines[r["d" + k].date]; continue; }
    const td = days[i + k]; if (!td) { all = false; continue; }
    const x = at(td); if (!x) { all = false; continue; }
    const ret = round2((x.close / r.base - 1) * 100);
    r["d" + k] = { date: td, close: x.close, ret, up: ret > 0, bl: typeof baselines[td] === "number" ? baselines[td] : null };
  }
  if (all || (expired && xs.length)) r.done = true;
  return r;
}
// 마감 확정 run 한 번: ① 오늘 행 추가(a·b·c·s) + 오늘 기준율 ② 덜 찬 지난 행 채우기(KODEX 1회 + 종목마다 1회 · 시간 예산 안)
//  units = { a: themes, b: themes, c: themes, s: themes } (없는 방식은 건너뜀) · allThemes = 오늘 close.themes compact(기준율)
//  fixA = { 날짜: 그날 마지막 확정 선정(ldsLatestA) } — 예전에 같은 날 확정 두 벌이 섞인 지난 날을 정리(그 날짜 파일 close.market.leaders 로 · 9.29-99) · days[].a 에도 적어 둠
export function scFixDays(file, fixA = {}) {
  const f = scNorm(file); let fixed = 0;
  for (const [d, a] of Object.entries(fixA || {})) {
    if (!Array.isArray(a) || !a.length) continue; const i = f.days.findIndex((x) => x.date === d); if (i < 0 || Array.isArray(f.days[i].a)) continue;
    const before = f.rows.length, kept = ldsKeepA(f.rows, d, a); if (kept === f.rows) continue; // 맞는 행 0(또는 기준 없음) → 손대지 않고 days[].a 도 안 적음 → 다음 run 이 다시 정리 (게이트 [1826] 권고 ①)
    f.rows = kept; f.days[i] = Object.assign({}, f.days[i], { a }); fixed += before - f.rows.length;
  }
  return { file: f, fixed };
}
export async function collectScorecard({ fetchImpl = fetch, timeoutMs = 10000, get = null, date, closeAt, file = null, units = {}, allThemes = null, fixA = null, budgetMs = SC_BUDGET_MS, conc = SC_CONC, gapMs = SC_GAP_MS, clock = () => Date.now(), sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) } = {}) {
  const NV_HEAD = { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };
  const g = get || (async (u) => { const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  const t0 = clock(), deadline = t0 + budgetMs, errors = []; let requests = 0;
  if (!(typeof closeAt === "string" && closeAt >= SC_CLOSE_MIN)) return { file: scNorm(file), skipped: "close.at " + closeAt + " < " + SC_CLOSE_MIN + " — 마감 봉 규칙", added: 0, filled: 0, requests: 0, errors, ms: 0 };
  const rows = []; const n = {};
  for (const u of Object.keys(SC_UNITS)) if (units[u]) { const rs = scRowsFrom(date, u, units[u]); n[u] = rs.length; rows.push(...rs); }
  const fx = fixA ? scFixDays(file, fixA) : { file, fixed: 0 };
  const { file: f, added } = scMerge(fx.file, rows, Object.assign({ date, closeAt, baseline: baselineOf(allThemes), n }, units.a ? { a: ldsLatestA(units.a) } : {}), { replace: ["a"] });
  const pending = scPending(f, date); let filled = 0;
  if (pending.length) {
    let kodex = null;
    try { requests++; kodex = trendRows(await g(obsTrendUrl(SC_KODEX, SC_BAR_N))); } catch (e) { errors.push("KODEX200: " + (e.message || e)); }
    const days = tradingDaysOf(kodex, date, closeAt), baselines = Object.fromEntries(f.days.filter((d) => typeof d.baseline === "number").map((d) => [d.date, d.baseline]));
    if (days.length) {
      const codes = [...new Set(pending.map((r) => r.code))], bars = {};
      const left = await paced(codes, async (code) => { try { requests++; bars[code] = trendRows(await g(obsTrendUrl(code, SC_BAR_N))); } catch (e) { bars[code] = null; errors.push(code + ": " + (e.message || e)); } }, { conc, gapMs, deadline, clock, sleep });
      if (left.length) errors.push(`시간 예산 넘음: ${left.length}종목 다음 run 으로`);
      f.rows = f.rows.map((r) => { if (r.done || r.date > date || !bars[r.code]) return r; const x = scFill(r, bars[r.code], days, baselines, date, closeAt); if (JSON.stringify(x) !== JSON.stringify(r)) filled++; return x; });
    }
  }
  return { file: f, added, filled, pending: pending.length, requests, errors, ms: clock() - t0, n, fixed: fx.fixed };
}
export function scText(res) {
  if (res.skipped) return "성적표 건너뜀: " + res.skipped;
  const n = res.n || {};
  return `성적표 ${Object.keys(n).map((u) => u + " " + n[u]).join(" · ") || "행 없음"} · 새 행 ${res.added}${res.fixed ? " · 지난 날 중복 정리 " + res.fixed + "행" : ""} · 채움 ${res.filled}/${res.pending || 0} · 요청 ${res.requests}회${typeof res.ms === "number" ? " " + (res.ms / 1000).toFixed(1) + "초" : ""}${res.errors && res.errors.length ? " · 실패 " + res.errors.slice(0, 5).join(" / ") : ""}`;
}
