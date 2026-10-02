// 자동 연동: GitHub Actions 가 평일 아침(미국 지표·미국 대응주)과 오후(코스피·코스닥 마감·수급)에 네이버 값을 모아
// 기록 저장소(cockpit-data 브랜치)의 auto/<날짜>.json 에 둔다. 앱은 그 파일을 읽어 빈 칸을 채운다 (손으로 고친 칸은 그대로).
// 여기는 순수 함수만 — 실제 실행은 scripts/collect-auto.mjs.
import { kstDate, kstTime, weekday, holidayGap, lastUsTradingDayBefore, usDateOf, addDays } from "../shared/calendar.js";
import { usKeyOf } from "../shared/us-themes.js";
import { collectAll, normalizeYield } from "./collect.js";

export const AUTO_DIR = "auto";
export const autoFile = (date) => AUTO_DIR + "/" + date + ".json";

const num = (s) => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(String(s).replace(/,/g, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
};

// 오늘이 장이 없는 날이면 그 이유, 아니면 null
export function skipReason(date, holidays = [], holidayNames = {}) {
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return "주말";
  if (holidays.includes(date)) return "휴장 · " + (holidayNames[date] || "휴장일");
  return null;
}

// 시각으로 구분: 9시 전 = 아침, 9:00~15:29 = 장중(재판정), 그 뒤 = 오후
export function whenOf(now = new Date()) {
  const t = kstTime(now).slice(0, 5);
  return t < "09:00" ? "morning" : t < "15:30" ? "intraday" : "close";
}

// 네이버 투자자 매매동향 응답 {bizdate, personalValue, foreignValue, institutionalValue} (억원) → 숫자
export function parseTrend(json) {
  if (!json || typeof json !== "object") throw new Error("trend: 응답 형식 이상");
  const out = { bizdate: json.bizdate || null, personal: num(json.personalValue), foreign: num(json.foreignValue), institution: num(json.institutionalValue) };
  if (out.foreign === null && out.institution === null) throw new Error("trend: 값 없음");
  return out;
}

const NV_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const eok = (v) => (v === null ? "—" : (v > 0 ? "+" : "") + v.toLocaleString("ko-KR") + "억");

// 프로그램 매매(억): 네이버 모바일 지수 종합 페이지(m.stock.naver.com/domestic/index/KOSPI/total) 안에 박힌
// "programTrendInfo":{"bizdate":"20260930","indexTotalReal":"-12,666","indexDifferenceReal":"+195","indexBiDifferenceReal":"-12,861"}
// 를 읽는다 (전용 JSON 주소는 없음 — 2026-09-30 probe 로 확인). total 전체 · arb 차익 · nonArb 비차익. 장중엔 누적, 마감 뒤엔 그날 확정값
export const PROGRAM_URL = (code = "KOSPI") => "https://m.stock.naver.com/domestic/index/" + code + "/total";
export function parseProgram(html) {
  const m = typeof html === "string" ? html.match(/"programTrendInfo"\s*:\s*(\{[^{}]*\})/) : null;
  if (!m) throw new Error("program: 값 없음");
  let j; try { j = JSON.parse(m[1]); } catch (e) { throw new Error("program: 형식 이상"); }
  const total = num(j.indexTotalReal), arb = num(j.indexDifferenceReal), nonArb = num(j.indexBiDifferenceReal);
  if (total === null) throw new Error("program: 값 없음");
  return { bizdate: j.bizdate ? String(j.bizdate) : null, total, arb, nonArb };
}
export async function fetchProgram(fetchImpl = fetch, { code = "KOSPI", timeoutMs = 10000 } = {}) {
  const r = await fetchImpl(PROGRAM_URL(code), { headers: { Accept: "text/html", Referer: "https://m.stock.naver.com/", "User-Agent": NV_UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return parseProgram(await r.text());
}
// 수급 한 줄: "코스피 외국인 -4,942억 · 기관 +3,189억 · 거래대금 123,456억 / 코스닥 외국인 +812억 · 기관 -95억 · 거래대금 …"
export function investText(inv) {
  return ["kospi", "kosdaq"].filter((k) => inv && inv[k]).map((k) => (k === "kospi" ? "코스피" : "코스닥") + " 외국인 " + eok(inv[k].foreign) + " · 기관 " + eok(inv[k].institution) + (inv[k].amount ? " · 거래대금 " + inv[k].amount.toLocaleString("ko-KR") + "억" : "")).join(" / ");
}

// 아침: 시장 신호 + 미국 대응주 (야간선물 k200 은 KIS 없이는 못 받으므로 실패해도 그대로 둔다)
// ---- 연휴 뒤 첫 거래일: 미국 신호를 '직전 한국 거래일 아침에 본 미국 종가 → 가장 최근 미국 종가' 누적 변화로 ----
// 예: 9/28(월, 추석 연휴 뒤) = 미국 9/22 종가 → 9/25 종가. 연휴 동안 미국이 여러 날 움직인 걸 하루치로만 보면 놓친다 (9/28 코스피 -2.7%).
export const CUM_SYMBOLS = { fut: "NQ=F", sox: "^SOX", ust: "^TNX", es: "ES=F", ym: "YM=F", rty: "RTY=F" };
export function cumChange(k, bars, prevKr, expectedUs) {
  const base = [...bars].filter((b) => b.date < prevKr).pop(), last = [...bars].filter((b) => b.date <= expectedUs).pop();
  if (!base || !last || last.date <= base.date) return null;
  const value = k === "ust" ? Number(((normalizeYield(last.close) - normalizeYield(base.close)) * 100).toFixed(1)) : Number(((last.close / base.close - 1) * 100).toFixed(2));
  return { value, from: base.date, to: last.date, level: k === "ust" ? Number(normalizeYield(last.close).toFixed(2)) : undefined };
}
// 받아온 미국 값의 기준 날짜가 '기대하는 미국 거래일'보다 오래됐는지 (연휴·주말 뒤 묵은 값 방지). 선물·환율처럼 밤새 거래되는 값은 시각이 최신이라 걸리지 않는다
export const US_DATED = ["sox", "vix", "ust", "ustlvl", "dji", "ixic", "spx", "rut", "fut", "es", "ym", "rty", "oil"];
export function staleCheck(signals, expectedUs) {
  const out = {};
  US_DATED.forEach((k) => { const v = signals[k]; const d = v && usDateOf(v.time); if (d && d < expectedUs) out[k] = { date: d, expected: expectedUs }; });
  return out;
}

export async function collectMorning({ sources, themes, adapters, now = new Date(), prevThemes = null, holidays = [], date = null }) {
  const got = await collectAll({ sources, themes, adapters, now });
  const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v.value, src: v.src, time: v.time || undefined, detail: v.detail }]));
  const out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), signals: strip(got.signals), us: strip(got.us), errors: got.errors.map((e) => e.key + ": " + e.error) };
  const today = date || kstDate(now), expectedUs = lastUsTradingDayBefore(today);
  out.expectedUs = expectedUs;
  // 연휴 뒤 첫 거래일이면 누적 변화로 바꾼다
  const gap = holidayGap(today, holidays);
  if (gap.skipped.length && adapters.yahoo && adapters.yahoo.daily) {
    out.gap = { prevKr: gap.prevKr, skipped: gap.skipped };
    for (const [k, sym] of Object.entries(CUM_SYMBOLS)) {
      try {
        const c = cumChange(k, await adapters.yahoo.daily(sym), gap.prevKr, expectedUs);
        if (!c) continue;
        const single = out.signals[k] ? out.signals[k].value : null;
        out.signals[k] = Object.assign({}, out.signals[k] || {}, { value: c.value, src: "yahoo", time: c.to, detail: Object.assign({}, (out.signals[k] || {}).detail || {}, { cum: { from: c.from, to: c.to, single } }) });
        out.gap.from = c.from; out.gap.to = c.to;
        if (k === "ust" && c.level !== undefined) out.signals.ustlvl = { value: c.level, src: "yahoo", time: c.to, detail: { asOf: c.to } }; // 금리 수준도 같은 날(최근 미국 종가) 기준
      } catch (e) { out.errors.push(k + " 연휴 누적: " + (e.message || e)); }
    }
  }
  const stale = staleCheck(out.signals, expectedUs);
  if (Object.keys(stale).length) out.stale = stale;
  if (prevThemes) {
    try { const p = await prevThemes(out); out.prev = p.themes; out.prevRaw = p.raw; } // out.us(방금 받은 미국 테마 값)으로 gapWarn 계산
    catch (e) { out.errors.push("prev: " + (e.message || e)); }
  }
  return out;
}

// ---- 장중 재판정 (09:30 · 10:30): 외인 코스피200 선물 순매수 + 외인·기관 코스피 현물 순매수 + 코스피 등락 ----
// 네이버 m.stock.naver.com/api/index/FUT/trend (선물 투자자별, 장중 누적) · /api/index/KOSPI/trend (현물, 억원)
export async function collectIntraday({ adapters, fetchImpl = fetch, now = new Date(), timeoutMs = 10000 }) {
  const out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), errors: [] };
  const get = async (code) => {
    const r = await fetchImpl("https://m.stock.naver.com/api/index/" + code + "/trend", { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return parseTrend(await r.json());
  };
  try { const f = await get("FUT"); out.fut = { foreign: f.foreign, institution: f.institution, personal: f.personal, bizdate: f.bizdate }; } catch (e) { out.errors.push("선물 수급: " + (e.message || e)); }
  try { const k = await get("KOSPI"); out.spot = { foreign: k.foreign, institution: k.institution, bizdate: k.bizdate }; } catch (e) { out.errors.push("현물 수급: " + (e.message || e)); }
  try { const q = await adapters.naver.quote("domestic:KOSPI"); out.kospi = Number(((q.price / q.prevClose - 1) * 100).toFixed(2)); } catch (e) { out.errors.push("코스피: " + (e.message || e)); }
  try { out.program = await fetchProgram(fetchImpl, { timeoutMs }); } catch (e) { out.errors.push("프로그램: " + (e.message || e)); } // 장중 누적 프로그램 순매수(억) → 앱 재판정·프로그램 칸
  return out;
}

// ---- 주도 테마 고르기 (오늘 주도 테마 · 다음 날 아침 전일 주도 테마 공통) — docs/leader-theme-research-2026-09-30.md 1절 ----
// 사용자 순서 그대로 다섯 번 거른다: L 거래대금 기준 종목 수 → F 외인·기관 수급 → U 미국장 방향 → B 상승 근거 → C 대장주 차트 자리.
//  게이트: 종목 수 ≥ 5 · 등락률 ≥ +1% · 오른 종목 비율 ≥ 0.6 · 초과수익(테마 − 코스피) ≥ +1%p → 초과수익 순 상위 40개(LEAD_POOL — 9.29-68: 12 → 40. 12개로 자르면 등락률은 낮아도 거래대금(L)이 큰 테마(예: 2026-10-02 장중 2차전지 L=4, 26위)를 아예 안 봐서 L 우선 규칙이 깨졌음). 후보 0 이면 등락률 순 relaxed 폴백.
//  T: 코스피 거래대금 연동 종목당 거래대금 기준(억). 슬롯 = 오른 종목 중 v ≥ T/5 인 것을 거래대금 순 5개. L = 슬롯 중 v ≥ T 인 수 (0 이면 탈락).
//  Score = L×10000 + F×1000 + U×100 + B×10 + C (앞자리가 크면 무조건 이김 → 사용자 순서 유지, 손으로 검산 가능).
//  16:20 잠정(provisional): 게이트·L·U·B 만 (F=1·C=1 중립) = 요청 1+12. 18:40 확정: + 수급 6테마×3종목 + 일봉 6테마×2종목 = 43.
const NV_HEAD = { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };
export const PREV_MIN_STOCKS = 5, PREV_FLAT = 0.5, LEAD_MIN_RATE = 1, LEAD_MIN_RISE = 0.6, LEAD_MIN_EXCESS = 1, LEAD_POOL = 40, HOT_RATE = 5, HOT_MIN = 2;
export const SLOT_N = 5, FLOW_TOP = 6, FLOW_STOCKS = 3, CHART_TOP = 6, CHART_STOCKS = 2, WEAK_AMOUNT = 70000, PERSIST_RANK = 20, PERSIST_MAX = 6;
const round2 = (x) => Number(x.toFixed(2));

// 거래대금 기준 T(억): 코스피 당일 거래대금 A(조 = amount억/10000)에 연동. 사용자 표(10조 미만 500 / 10조↑ 700 / 20조↑ 1000)의 세 점을 지나는 구간별 직선,
// 바닥 500 · 천장 1500, 50억 단위 반올림. amount 를 모르면 가장 느슨한 500 (아침 run 은 전날 close 의 amount 를 넘긴다)
export function thresholdFor(amountEok) {
  const A = typeof amountEok === "number" && amountEok > 0 ? amountEok / 10000 : null;
  if (A === null) return 500;
  const t = A <= 7 ? 500 : A < 10 ? 500 + ((A - 7) / 3) * 200 : A < 20 ? 700 + ((A - 10) / 10) * 300 : A < 30 ? 1000 + ((A - 20) / 10) * 500 : 1500;
  return Math.round(t / 50) * 50;
}

const themeRow = (g) => ({ no: g.no, name: String(g.name || "").trim(), count: num(g.totalCount), rate: num(g.changeRate), rise: num(g.totalCount) ? (num(g.riseCount) || 0) / num(g.totalCount) : 0 });
export function pickThemes(groups, n = 2) {
  return (Array.isArray(groups) ? groups : []).map(themeRow)
    .filter((g) => g.no !== undefined && g.name && g.rate !== null && (g.count || 0) >= PREV_MIN_STOCKS)
    .sort((a, b) => b.rate - a.rate).slice(0, n);
}
// 게이트 통과 후보: 종목 5개↑ · +1%↑ · 오른 종목 60%↑ · 초과수익(테마 − 코스피 등락률) +1%p↑ → 초과수익 큰 순 (동률: 상승비율 → 종목 수) 상위 pool 개
export function themeCandidates(groups, pool = LEAD_POOL, kospiRate = 0) {
  const k = typeof kospiRate === "number" ? kospiRate : 0;
  return (Array.isArray(groups) ? groups : []).map(themeRow)
    .filter((g) => g.no !== undefined && g.name && g.rate !== null && (g.count || 0) >= PREV_MIN_STOCKS && g.rate >= LEAD_MIN_RATE && g.rise >= LEAD_MIN_RISE && g.rate - k >= LEAD_MIN_EXCESS)
    .map((g) => Object.assign(g, { excess: round2(g.rate - k) }))
    .sort((a, b) => b.excess - a.excess || b.rise - a.rise || (b.count || 0) - (a.count || 0)).slice(0, pool);
}
// 테마 목록 100개 compact (매일 close.themes 에 저장 → 지속일수 D · 다음 날 정답표). rise 는 오른 종목 '수' (비율 = rise/count)
export function compactThemes(groups) {
  return (Array.isArray(groups) ? groups : []).filter((g) => g && g.no !== undefined && g.name).map((g) => ({ no: g.no, name: String(g.name).trim(), rate: num(g.changeRate), rise: num(g.riseCount) || 0, count: num(g.totalCount) || 0 }));
}
// 테마 상세 stocks[] → 오른 종목 중 거래대금 minValue(억) 이상을 거래대금 큰 순 n개 (슬롯). value 는 억 (9.29-56 부터 원 → 억)
export function leadStocks(stocks, n = SLOT_N, minValue = 0) {
  return parseStocks(stocks)
    .filter((x) => x.code && x.rate !== null && x.rate > 0 && (x.value || 0) >= minValue)
    .sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, n);
}
export const parseStocks = (stocks) => (Array.isArray(stocks) ? stocks : []).map((x) => {
  const raw = num(x.accumulatedTradingValueRaw) ?? num(x.accumulatedTradingValue);
  return { code: x.itemCode, name: x.stockName, rate: num(x.fluctuationsRatio), value: raw === null ? null : round2(raw / 1e8), price: num(x.closePrice) };
});
// 테마 전체 거래대금 (억원) · 강세 종목(+5% 이상) 거래대금과 개수
export const themeValue = (stocks) => Math.round((Array.isArray(stocks) ? stocks : []).reduce((s, x) => s + (num(x.accumulatedTradingValueRaw) || 0), 0) / 1e8);
export function hotValue(stocks) {
  const hot = (Array.isArray(stocks) ? stocks : []).filter((x) => (num(x.fluctuationsRatio) || 0) >= HOT_RATE);
  return { hot: Math.round(hot.reduce((s, x) => s + (num(x.accumulatedTradingValueRaw) || 0), 0) / 1e8), hotN: hot.length };
}

// L: 슬롯 5개 중 거래대금 v ≥ T 인 종목 수 (0~5). 대장주 = 슬롯 1번(거래대금 1위)
export const gradeL = (slots, T) => (Array.isArray(slots) ? slots : []).filter((s) => (s.value || 0) >= T).length;

// 종목 투자자 동향 응답(최근 날짜 먼저) → { foreign, inst } 억원. want(YYYYMMDD)를 주면 그 날 값만 (아직 집계 전이면 null)
export function stockFlow(rows, want) {
  const r = Array.isArray(rows) ? rows[0] : null; if (!r) return null;
  if (want && String(r.bizdate) !== want) return null;
  const px = num(r.closePrice), f = num(r.foreignerPureBuyQuant), o = num(r.organPureBuyQuant);
  if (!px || f === null || o === null) return null;
  return { foreign: Math.round((f * px) / 1e8), inst: Math.round((o * px) / 1e8), bizdate: String(r.bizdate) };
}
// 상위 3종목 수급 [{foreign, inst, bizdate, value(억)}] → 테마 수급 { foreign 외합, inst 기합, n, bizdate, S 강도(%) = (외합+기합)/V3×100, both 동시 순매수 종목 수 }
export function themeFlow(flows) {
  const fs = (Array.isArray(flows) ? flows : []).filter(Boolean);
  if (!fs.length) return null;
  const foreign = fs.reduce((x, f) => x + (f.foreign || 0), 0), inst = fs.reduce((x, f) => x + (f.inst || 0), 0), v3 = fs.reduce((x, f) => x + (f.value || 0), 0);
  return { foreign, inst, n: fs.length, bizdate: fs[0].bizdate, S: v3 > 0 ? round2(((foreign + inst) / v3) * 100) : null, both: fs.filter((f) => f.foreign > 0 && f.inst > 0).length };
}
// F: 3 = 외인·기관 동시 순매수 & 강도 S ≥ 1% · 2 = 그 외 합이 플러스 · 1 = 데이터 없음(중립) · 0 = 합이 0 이하('개인만 사는 테마')
export function gradeF(flow) {
  if (!flow || !flow.n) return 1;
  if (flow.foreign > 0 && flow.inst > 0 && flow.S !== null && flow.S >= 1) return 3;
  return flow.foreign + flow.inst > 0 ? 2 : 0;
}

// U: 테마 이름 → 미국 대응 테마 키(shared/us-themes.js) → 아침 기록 us[key].value (전날 밤 미국 대응 종목 평균 %)
export function usOf(name, us) {
  const key = usKeyOf(name), rec = key && us ? us[key] : null;
  const u = rec && typeof rec.value === "number" ? rec.value : rec && typeof rec === "number" ? rec : null;
  return { key, u };
}
// 2 = u ≥ +1 (같은 방향) · 1 = 그 사이 또는 대응 테마 없음(중립) · 0 = u ≤ −1 (반대 방향)
export const gradeU = (u) => (typeof u !== "number" ? 1 : u >= 1 ? 2 : u <= -1 ? 0 : 1);

// B 재료: 테마 상세 전체 종목의 폭 계층 P = 3×상한가(≥29.5) + 2×급등(10~29.5) + 1×강세(5~10), 동일가중 EW − 거래대금가중 VW (좁은 주도 = 1~2개 대형주만 끔)
export function breadthOf(stocks) {
  const xs = (Array.isArray(stocks) ? stocks : []).filter((x) => typeof x.rate === "number");
  const N30 = xs.filter((x) => x.rate >= 29.5).length, N10 = xs.filter((x) => x.rate >= 10 && x.rate < 29.5).length, N5 = xs.filter((x) => x.rate >= 5 && x.rate < 10).length;
  const sv = xs.reduce((s, x) => s + (x.value || 0), 0);
  const EW = xs.length ? round2(xs.reduce((s, x) => s + x.rate, 0) / xs.length) : null;
  const VW = sv > 0 ? round2(xs.reduce((s, x) => s + x.rate * (x.value || 0), 0) / sv) : null;
  return { P: 3 * N30 + 2 * N10 + N5, N30, N10, N5, EW, VW, gap: EW !== null && VW !== null ? round2(EW - VW) : null };
}
// B = 폭등급(2: P ≥ 6 또는 상한가 1개↑ & 상승비율 ≥ 0.8 / 1: P 3~5 / 0: P ≤ 2) − 좁은 주도(EW−VW < −3%p) − 지속일수 D ≥ 6 + 재료 등급(A +1 · C −1, 수동), 0~3
export function gradeB({ P = 0, N30 = 0, rise = 0, gap = null, D = null, material = null } = {}) {
  const tier = P >= 6 || (N30 >= 1 && rise >= 0.8) ? 2 : P >= 3 ? 1 : 0;
  const b = tier + (gap !== null && gap < -3 ? -1 : 0) + (typeof D === "number" && D >= PERSIST_MAX ? -1 : 0) + (material === "A" ? 1 : material === "C" ? -1 : 0);
  return Math.max(0, Math.min(3, b));
}
// 지속일수 D: days = [{ themes(compact 100), kospiRate }] 오늘부터 과거 순. '초과수익 > 0 & 등락률 순위 ≤ 20위'가 오늘까지 며칠 연속인지. 이력이 오늘뿐이면 null
// 목록이 빈 날(close.themes 없는 옛 파일)은 건너뛰지 않는다 — 건너뛰면 비연속 날짜를 연속으로 세므로, 연속이 아직 이어지는데 그날을 만나면 며칠인지 모르는 것(null)
export function persistDays(no, days) {
  const ds = (Array.isArray(days) ? days : []).filter(Boolean), has = (d) => Array.isArray(d.themes) && d.themes.length > 0;
  if (ds.length < 2 || !has(ds[0]) || !has(ds[1])) return null;
  let D = 0;
  for (const day of ds) {
    if (!has(day)) return null;
    const list = [...day.themes].filter((t) => typeof t.rate === "number").sort((a, b) => b.rate - a.rate);
    const i = list.findIndex((t) => String(t.no) === String(no));
    if (i < 0 || i >= PERSIST_RANK || list[i].rate - (typeof day.kospiRate === "number" ? day.kospiRate : 0) <= 0) break;
    D++;
  }
  return D;
}

// C: 일봉(1년치) → 대장주 차트 자리. 3 신고가(close ≥ 직전 250봉 고가) · 2 돌파(≥ 직전 60봉 고가, 또는 > 20봉 고가 & 당일 거래대금 ≥ T) · 1 눌림(> MA20 & ≥ 20봉 고가×0.9, 거래대금 없는 돌파도 여기) · 0 추세아래
// 봉 21개 미만이면 null(중립 1). 60봉 미만 신규 상장주는 H250/H60 생략
export const CHART_TAG = ["추세아래", "돌파직전", "돌파", "신고가"]; // 0 은 자리에 따라 "눌림"(MA20 위) 또는 "추세아래" 로 적는다 — 등급은 둘 다 0 (10년 검증: 둘 다 다음날 이어지는 힘이 없음)
export function gradeC(bars, { vToday = null, T = 500 } = {}) {
  const rows = (Array.isArray(bars) ? bars : []).map((b) => ({ d: String(b.localDate || ""), c: num(b.closePrice), h: num(b.highPrice) })).filter((r) => r.c !== null && r.h !== null).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  if (rows.length < 21) return null;
  const last = rows[rows.length - 1], prev = rows.slice(0, -1), hi = (n) => Math.max(...prev.slice(-n).map((r) => r.h));
  const H20 = hi(20), H60 = prev.length >= 60 ? hi(60) : null, H250 = prev.length >= 60 ? hi(250) : null;
  const MA20 = round2(rows.slice(-20).reduce((s, r) => s + r.c, 0) / 20), close = last.c;
  const grade = H250 !== null && close >= H250 ? 3
    : (H60 !== null && close >= H60) || (close > H20 && typeof vToday === "number" && vToday >= T) ? 2
    : close >= H20 * 0.97 ? 1 : 0; // 1 = 20봉 고가 3% 이내(돌파 직전) — 옛 '눌림'(MA20 위 & −10% 이내)은 검증에서 추세아래와 차이가 없어 0 으로 합침 (9.29-59)
  const tag = grade === 0 && close > MA20 ? "눌림" : CHART_TAG[grade];
  return { grade, tag, close, H20, H60, H250, MA20, offHigh: H250 ? round2(((H250 - close) / H250) * 100) : null, bars: rows.length, date: last.d };
}
// 장중에는 네이버 일봉에 오늘 봉이 아직 없을 수 있음 → 테마 상세의 현재가로 오늘 봉(종가=고가=현재가)을 붙인다. 이미 있으면 그대로
export function withToday(bars, date, price) {
  const rows = Array.isArray(bars) ? bars : [], d = String(date || "").replace(/-/g, "");
  if (!rows.length || typeof price !== "number" || !(price > 0) || d.length !== 8) return rows;
  const last = rows.reduce((m, b) => (String(b.localDate || "") > m ? String(b.localDate || "") : m), "");
  return last >= d ? rows : [...rows, { localDate: d, closePrice: price, highPrice: price }];
}
export const chartUrl = (code, date) => "https://api.stock.naver.com/chart/domestic/item/" + code + "/day?startDateTime=" + addDays(date, -365).replace(/-/g, "") + "0000&endDateTime=" + date.replace(/-/g, "") + "2359";

// 자릿수 점수: 앞 단계가 크면 무조건 이긴다 (L 0~5, F 0~3, U 0~2, B 0~3, C 0~3)
export const scoreTheme = (g) => (g.L || 0) * 10000 + (g.F || 0) * 1000 + (g.U || 0) * 100 + (g.B || 0) * 10 + (g.C || 0);
// 동점 처리: Score → L(강세 거래대금 hot → 대장주 거래대금) → F(강도 S → 2일 연속 → 동시 종목 수) → U(|u|) → B(D 2~3 → 1 → 4~5 → null → EW−VW → 상승비율) → C(2등주 → 고점 거리 → 대장주 등락) → 테마 거래대금 → 등락률
const dBucket = (D) => (D === 2 || D === 3 ? 0 : D === 1 ? 1 : D === 4 || D === 5 ? 2 : typeof D !== "number" ? 3 : 4);
const v1 = (t) => (t.slots && t.slots[0] ? t.slots[0].value || 0 : 0);
const S = (t) => (t.flow && t.flow.S !== null && t.flow.S !== undefined ? t.flow.S : -Infinity);
const second = (t) => (t.chart && t.chart.second ? t.chart.second.grade : -1);
const offHigh = (t) => (t.chart && t.chart.lead && t.chart.lead.offHigh !== null ? t.chart.lead.offHigh : Infinity);
export function compareThemes(a, b) {
  return (b.score || 0) - (a.score || 0)
    || (b.hot || 0) - (a.hot || 0) || v1(b) - v1(a)
    || S(b) - S(a) || (b.streak ? 1 : 0) - (a.streak ? 1 : 0) || ((b.flow && b.flow.both) || 0) - ((a.flow && a.flow.both) || 0)
    || Math.abs((b.us && b.us.u) || 0) - Math.abs((a.us && a.us.u) || 0)
    || dBucket(a.D) - dBucket(b.D) || ((b.breadth && b.breadth.gap) || 0) - ((a.breadth && a.breadth.gap) || 0) || (b.rise || 0) - (a.rise || 0)
    || second(b) - second(a) || offHigh(a) - offHigh(b) || (b.slots && b.slots[0] ? b.slots[0].rate : 0) - (a.slots && a.slots[0] ? a.slots[0].rate : 0)
    || (b.value || 0) - (a.value || 0) || (b.rate || 0) - (a.rate || 0);
}
// 중복 제거: 점수 순으로 보면서 슬롯 5종목 중 2개 이상 겹치거나 대장주가 같으면 낮은 쪽 이름을 alias 로 붙인다. 점수까지 같으면 종목 수 적은(더 좁은) 테마가 대표
// 한 번만 훑으면, 좁은 테마가 넓은 테마 자리를 대신 차지하며 대장주가 바뀔 때 이미 따로 남은 테마와 다시 겹칠 수 있다
// (2026-10-02 live: 시스템반도체 → HBM 으로 바뀐 뒤 온디바이스 AI 와 SK하이닉스·삼성전자가 겹쳤는데 둘 다 남음) → 더 합칠 게 없을 때까지 반복
// 보이는 이름: 합쳐진 무리 중 오늘 가장 많이 오른 테마(동률이면 테마 거래대금 큰 쪽) — 종목 수가 적은 쪽을 고르면 '온디바이스 AI' 처럼
// 덜 익숙한 이름이 나오고, 거래대금만 보면 '시스템반도체' 같은 넓은 테마가 늘 이겨서 (2026-10-02 사용자 요청). 슬롯·점수는 그대로, 이름·번호만 바꾼다
const memberOf = (t) => ({ name: t.name, no: t.no, score: typeof t.score === "number" ? t.score : null, rate: typeof t.rate === "number" ? t.rate : null, value: typeof t.value === "number" ? t.value : null });
export function dedupeThemes(sorted) {
  let cur = sorted, prevLen = -1;
  for (let k = 0; k < 6 && cur.length !== prevLen; k++) { prevLen = cur.length; cur = dedupeOnce(cur); }
  for (const t of cur) {
    const all = t._members || [memberOf(t)]; delete t._members;
    // 이름은 점수가 가장 높은(=대표와 같은 점수) 테마들 중에서만 — 점수 낮은 테마(예: L=1 윤활유)가 L=4 2차전지 무리의 이름이 되지 않게 (9.29-68)
    const sc = all.map((m) => m.score).filter((x) => typeof x === "number"), top = sc.length ? Math.max(...sc) : null;
    const ms = top === null ? all : all.filter((m) => m.score === null || m.score === top);
    let best = ms[0];
    for (const m of ms) if ((m.rate ?? -Infinity) > (best.rate ?? -Infinity) || ((m.rate ?? -Infinity) === (best.rate ?? -Infinity) && (m.value ?? -Infinity) > (best.value ?? -Infinity))) best = m;
    if (best.name !== t.name) { // 이름을 바꾸면 화면에 같이 나오는 등락률·테마 거래대금도 그 테마 값으로 (점수·슬롯·등급은 그대로)
      t.alias = [t.name, ...t.alias.filter((a) => a !== best.name)]; t.name = best.name; if (best.no !== undefined) t.no = best.no;
      if (best.rate !== null) t.rate = best.rate; if (best.value !== null) t.value = best.value;
    }
  }
  return cur;
}
function dedupeOnce(sorted) {
  const out = [];
  for (const t of sorted) {
    t.alias = t.alias || []; t._members = t._members || [memberOf(t)];
    const codes = new Set((t.slots || []).map((s) => s.code)), top = t.slots && t.slots[0] && t.slots[0].code;
    // 같은 흐름: 슬롯 2종목↑ 겹침 · 대장주 같음 · 아래 테마의 대장주가 위 테마의 주도주(슬롯) 안에 있음 (9.29-68: 5G 대장 대한광통신 = 광통신 2등주)
    const i = out.findIndex((o) => (o.slots || []).filter((s) => codes.has(s.code)).length >= 2 || (top && (o.slots || []).some((s) => s.code === top)));
    if (i < 0) { out.push(t); continue; }
    const o = out[i];
    if (o.score === t.score && (t.count || 0) < (o.count || 0)) { t.alias = [o.name, ...o.alias, ...t.alias]; t._members = [...t._members, ...o._members]; out[i] = t; } // 슬롯은 더 좁은 테마 것을 쓴다
    else { o.alias.push(t.name, ...t.alias); o._members = [...o._members, ...t._members]; }
  }
  return out;
}
// 시장 활력: 코스피 거래대금(억) < 7조 또는 최근 20거래일 평균(저장 파일)의 60% 미만이면 '관망'
export function regimeOf(amount, history = []) {
  if (typeof amount !== "number" || amount <= 0) return "";
  const past = (Array.isArray(history) ? history : []).map((h) => h && h.amount).filter((x) => typeof x === "number" && x > 0).slice(0, 20);
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
  return amount < WEAK_AMOUNT || (avg !== null && amount < avg * 0.6) ? "관망" : "";
}
// 저장된 auto/<date>.json 기록들(최근 먼저) → 이력 [{ date, amount, kospiRate, themes(compact), leaders }]
export function historyFrom(records) {
  return (Array.isArray(records) ? records : []).filter((r) => r && r.close).map((r) => {
    const m = r.close.market || {}, k = m.kospi || {};
    return { date: r.date, amount: typeof k.amount === "number" ? k.amount : null, kospiRate: typeof k.value === "number" ? k.value : null, themes: Array.isArray(r.close.themes) ? r.close.themes : [], leaders: m.leaders && Array.isArray(m.leaders.themes) ? m.leaders.themes : [] };
  });
}
const prevFlowOf = (name, history) => { const h = Array.isArray(history) ? history[0] : null; const t = h && Array.isArray(h.leaders) && h.leaders.find((x) => x && x.name === name); return !!(t && t.flow && t.flow.foreign + t.flow.inst > 0); };

// 주도 테마 선정 (게이트 → L → [F] → U → B → [C] → 점수·중복 제거 → 상위 n). provisional 이면 수급·일봉 요청 생략 (F=1·C=1 중립)
//  chart: true 면 provisional 이어도 C(대장주 차트 자리)는 매긴다 — 장중 실시간 (9.29-67). 수급(F)은 장중엔 네이버에 없어서 중립 그대로
//  kospi: { value: 등락률 %, amount: 거래대금 억 } (collectClose 가 받은 market.kospi 또는 전날 파일) · us: 아침 기록 morning.us · history: historyFrom() (오늘 제외, 최근 먼저)
export async function selectThemes({ get, n = 3, bizdate = null, kospi = null, us = null, history = [], provisional = false, chart = !provisional, date = null, pool = LEAD_POOL, material = {} }) {
  const list = await get("https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100");
  const kospiRate = kospi && typeof kospi.value === "number" ? kospi.value : null, amount = kospi && typeof kospi.amount === "number" ? kospi.amount : null;
  const groups = list && Array.isArray(list.groups) ? list.groups : []; // 응답이 null·문자열·groups 없음이면 빈 목록 → '테마 순위 없음'
  const T = thresholdFor(amount), all = compactThemes(groups), today = date || kstDate();
  let cands = themeCandidates(groups, pool, kospiRate ?? 0), relaxed = false;
  if (!cands.length) { cands = pickThemes(groups, Math.max(n, 3)); relaxed = true; }
  if (!cands.length) throw new Error("테마 순위 없음");
  const days = [{ themes: all, kospiRate }, ...(history || []).map((h) => ({ themes: h.themes, kospiRate: h.kospiRate }))];
  for (const t of cands) {
    let stocks = []; t.warn = [];
    // 상세 응답이 객체가 아니거나(문자열·null) stocks 배열이 없으면 '상세 실패' 로 적고 빈 슬롯으로 이어 간다 (죽지 않게 — L=0 이라 대개 탈락)
    try { const d = await get("https://m.stock.naver.com/api/stocks/theme/" + t.no + "?page=1&pageSize=100"); if (!d || typeof d !== "object" || !Array.isArray(d.stocks)) throw new Error("형식 이상"); stocks = d.stocks; } catch (e) { t.warn.push("상세 실패"); }
    t.value = themeValue(stocks); Object.assign(t, hotValue(stocks));
    t.slots = leadStocks(stocks, SLOT_N, T / 5);
    if (t.excess === undefined) t.excess = kospiRate === null ? null : round2(t.rate - kospiRate);
    const br = breadthOf(parseStocks(stocks)); t.breadth = { P: br.P, N30: br.N30, N10: br.N10, N5: br.N5, gap: br.gap };
    t.D = persistDays(t.no, days);
    t.us = usOf(t.name, us);
    t.prevBuy = prevFlowOf(t.name, history); t.streak = false; // 2일 연속 순매수 = 어제도(prevBuy) 오늘도(확정 run 수급) 외인+기관 합 > 0 — 오늘 수급을 본 뒤에만 참
    t.grades = { L: gradeL(t.slots, T), F: 1, U: gradeU(t.us.u), B: gradeB({ P: br.P, N30: br.N30, rise: t.rise, gap: br.gap, D: t.D, material: material[t.name] || null }), C: 1 };
    if (t.slots[0] && t.slots[0].value >= 2 * T) t.warn.push("대장주 확실");
    if (typeof t.us.u === "number" && t.us.u >= 5 && t.rate < 2) t.warn.push("미국 재료 이미 반영"); // 아침 us 와 오늘 테마 등락률만 있으면 되므로 16:20 잠정에도 붙는다
    t.score = scoreTheme(t.grades);
  }
  if (!relaxed) cands = cands.filter((t) => t.grades.L > 0); // L = 0 은 탈락 (모두 0 이면 '주요 테마 없음')
  let flowReady = false, chartReady = false;
  if (!provisional) {
    cands.sort(compareThemes);
    for (const t of cands.slice(0, FLOW_TOP)) { // 수급: 상위 6테마 × 슬롯 3종목 = 18회
      const flows = [];
      for (const s of t.slots.slice(0, FLOW_STOCKS)) {
        try { const f = stockFlow(await get("https://m.stock.naver.com/api/stock/" + s.code + "/trend?pageSize=1"), bizdate); if (f) { flows.push(Object.assign({ value: s.value }, f)); s.flow = { foreign: f.foreign, inst: f.inst }; } } catch (e) {}
      }
      t.flow = themeFlow(flows) || undefined;
      t.streak = !!(t.prevBuy && t.flow && t.flow.foreign + t.flow.inst > 0);
      if (t.flow) { flowReady = true; if (t.streak) t.warn.push("2일 연속 순매수"); }
      t.grades.F = gradeF(t.flow); t.score = scoreTheme(t.grades);
    }
  }
  if (chart) {
    cands.sort(compareThemes);
    for (const t of cands.slice(0, CHART_TOP)) { // 일봉: 상위 6테마 × 대장·2등 = 12회
      const cs = [];
      for (const s of t.slots.slice(0, CHART_STOCKS)) {
        try { const c = gradeC(provisional ? withToday(await get(chartUrl(s.code, today)), today, s.price) : await get(chartUrl(s.code, today)), { vToday: s.value, T }); cs.push(c); if (c) s.chart = { grade: c.grade, tag: c.tag }; } catch (e) { cs.push(null); }
      }
      t.chart = { lead: cs[0] || null, second: cs[1] || null };
      if (cs[0]) chartReady = true;
      t.grades.C = cs[0] ? cs[0].grade : 1; t.score = scoreTheme(t.grades);
    }
  }
  cands.sort(compareThemes);
  const candidates = dedupeThemes(cands);
  return { themes: candidates.slice(0, n), candidates, T, relaxed, flowReady, chartReady, provisional: !!provisional, kospiRate, amount, all };
}

// 종목 실시간 응답 → { session: "after"|"pre"|null, pct } (NXT 가격 ÷ 어제 KRX 종가)
export function nxtMove(d) {
  const o = d && d.overMarketPriceInfo; if (!o) return { session: null, pct: null, raw: "NXT 없음" };
  const type = String(o.tradingSessionType || ""), status = String(o.overMarketStatus || "");
  const price = num(o.overPrice), close = num(d.closePrice);
  // 8시 전(프리마켓 시작 전)에는 세션 이름이 비고 상태가 PREOPEN → NXT 마지막 가격 = 어제 저녁 애프터마켓 마지막 값
  const session = /AFTER/i.test(type) ? "after" : /PRE/i.test(type) && /^OPEN$/i.test(status) ? "pre" : /PREOPEN/i.test(status) && !/REGULAR/i.test(type) ? "after" : null;
  const pct = session && price && close ? Number(((price / close - 1) * 100).toFixed(2)) : null;
  return { session: pct === null ? null : session, pct, raw: type + "/" + status };
}
export const moveState = (pct) => (pct === null || pct === undefined ? "" : pct >= PREV_FLAT ? "up" : pct <= -PREV_FLAT ? "down" : "flat");
const avg = (a) => (a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)) : null);

// 저장된 주도 테마(확정 결과)를 아침 전일 테마 모양으로: 슬롯 5종목이 NXT 확인 대상
const fromLeader = (t, T) => ({ no: t.no, name: t.name, rate: t.rate, value: t.value, flow: t.flow, grades: t.grades, score: t.score, us: t.us, T, stocks: (t.slots || t.stocks || []).filter((s) => s && s.code) });
// keep: 같은 날 앞선 아침 수집의 prev (8:05 수집은 7:05에 고른 테마와 애프터마켓 값을 그대로 이어 쓴다)
// leaders: 전날 18:40 확정 결과(close.market.leaders) — 아침엔 다시 뽑지 않고 그 상위 3개를 이어 쓴다. 없으면(장애) 예전처럼 n=2 잠정 재선정
//  슬롯(code 있는 종목)이 있는 테마가 하나도 없으면 — 옛 형식(9.29-55 이전: stocks 가 이름 문자열, slots 없음)이나 relaxed·L=0 으로 슬롯이 다 빈 확정 결과 — NXT 를 볼 종목이 없으니 이어 쓰지 않고 재선정
// us: 방금 받은 아침 미국 테마 값 → u ≥ +3 & 대장주 프리마켓 ≥ +3 이면 gapWarn(추격 대신 눌림 대기)
export async function collectPrevThemes({ fetchImpl = fetch, timeoutMs = 10000, keep = null, bizdate = null, leaders = null, us = null, kospi = null } = {}) {
  const get = async (u) => {
    const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  let themes = Array.isArray(keep) && keep.length ? keep.map((t) => ({ no: t.no, name: t.name, rate: t.rate, value: t.value, flow: t.flow, grades: t.grades, score: t.score, us: t.us, T: t.T, stocks: t.stocks || [], after: t.after, gapWarn: t.gapWarn })) : null;
  const hasSlots = (t) => !!t && Array.isArray(t.slots) && t.slots.some((s) => s && s.code);
  if (!themes && leaders && Array.isArray(leaders.themes) && leaders.themes.some(hasSlots)) themes = leaders.themes.map((t) => fromLeader(t, leaders.T));
  if (!themes) {
    const sel = await selectThemes({ get, n: 2, bizdate, kospi, provisional: true }); // 아침 9시 전 = 어제 마감 기준 (수급·일봉 없이 잠정)
    themes = sel.themes.map((t) => fromLeader(t, sel.T));
  }
  const raws = [];
  for (const t of themes) {
    const moves = { after: [], pre: [] }; let leadPre = null;
    for (const s of t.stocks) {
      try {
        const j = await get("https://polling.finance.naver.com/api/realtime/domestic/stock/" + s.code);
        const m = nxtMove(j && j.datas && j.datas[0]);
        raws.push(s.code + " " + m.raw);
        if (m.session) { moves[m.session].push(m.pct); if (m.session === "pre" && s === t.stocks[0]) leadPre = m.pct; }
      } catch (e) { raws.push(s.code + " " + (e.message || e)); }
    }
    const a = avg(moves.after), p = avg(moves.pre);
    if (a !== null) t.after = { pct: a, state: moveState(a), n: moves.after.length };
    if (p !== null) t.pre = { pct: p, state: moveState(p), n: moves.pre.length };
    const c = t.pre || t.after; if (c) t.confirm = c.state; // 이어짐 확인 라벨 (순위는 안 바뀜)
    const u = usOf(t.name, us).u;
    if (typeof u === "number" && u >= 3 && leadPre !== null && leadPre >= 3) t.gapWarn = true;
  }
  return { themes, raw: raws.join(", ") };
}

// 오늘 주도 테마 (장 마감 뒤): 상위 3개 · 한 줄 텍스트(앱 parseLeaders 가 읽음) · 후보 전부(≤12, 검증용)
const eokText = (v) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조" : v.toLocaleString("ko-KR") + "억");
const signed = (v) => (v > 0 ? "+" : v < 0 ? "-" : "") + eokText(Math.abs(v));
export function flowText(flow) { return flow ? "외인 " + signed(flow.foreign) + " · 기관 " + signed(flow.inst) : ""; }
// "이름 +x% · 대금 T억↑ L종목 · 강세 N종목 X억 · 외인 +…억 · 기관 +…억 · 미장 ✓|✗|— · 차트 신고가|돌파|돌파직전|눌림|추세아래 (대장·2등)" 를 " / " 로 이어 붙인다
export function leadersText(themes, T = null) {
  return themes.map((t) => {
    const g = t.grades, names = (t.stocks && t.stocks.length ? t.stocks : t.slots || []).slice(0, 2).map((x) => (typeof x === "string" ? x : x.name)), th = t.T || T;
    return t.name + " " + (t.rate > 0 ? "+" : "") + t.rate + "%"
      + (g && th ? " · 대금 " + th.toLocaleString("ko-KR") + "억↑ " + g.L + "종목" : "")
      + (t.hotN ? " · 강세 " + t.hotN + "종목 " + eokText(t.hot) : !g && t.value ? " · 대금 " + eokText(t.value) : "")
      + (t.flow ? " · " + flowText(t.flow) : "")
      + (g ? " · 미장 " + (g.U === 2 ? "✓" : g.U === 0 ? "✗" : "—") : "")
      + (t.chart && t.chart.lead ? " · 차트 " + t.chart.lead.tag : "")
      + (names.length ? " (" + names.join("·") + ")" : "");
  }).join(" / ");
}
const slim = (t) => ({
  no: t.no, name: t.name, rate: t.rate, excess: t.excess ?? null, value: t.value, hot: t.hot, hotN: t.hotN, flow: t.flow, us: t.us, D: t.D ?? null, breadth: t.breadth,
  stocks: (t.slots || []).slice(0, 2).map((x) => x.name), grades: t.grades, score: t.score, slots: (t.slots || []).slice(0, SLOT_N), alias: t.alias || [], warn: t.warn || [],
  chart: t.chart ? { lead: t.chart.lead && { grade: t.chart.lead.grade, tag: t.chart.lead.tag, offHigh: t.chart.lead.offHigh }, second: t.chart.second && { grade: t.chart.second.grade, tag: t.chart.second.tag } } : undefined,
});
export async function collectLeaders({ fetchImpl = fetch, timeoutMs = 10000, now = new Date(), bizdate = null, kospi = null, us = null, history = [], provisional = false, chart = !provisional, date = null, n = 3 } = {}) {
  const get = async (u) => { const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
  // 종목 수급은 그 날 값만. 네이버 종목별 외인·기관은 늦게(저녁~다음 날 아침) 올라와서, 16:20 잠정 run 은 요청을 생략하고 18:40 확정 run·다음 날 아침 백필이 채운다
  const day = date || kstDate(now);
  const sel = await selectThemes({ get, n, bizdate: bizdate || day.replace(/-/g, ""), kospi, us, history, provisional, chart, date: day });
  const themes = sel.themes.map(slim), candidates = sel.candidates.map(slim);
  // 관망(거래대금)과 주도 약함(1위 L ≤ 1)은 별개 배지 — 둘 다면 "관망·약함", weakLead 도 따로 둔다
  const weakLead = !!(themes[0] && themes[0].grades && themes[0].grades.L <= 1);
  const regime = [regimeOf(sel.amount, history), weakLead ? "약함" : ""].filter(Boolean).join("·");
  return { text: leadersText(sel.themes, sel.T), flowReady: sel.flowReady, chartReady: sel.chartReady, provisional: sel.provisional, T: sel.T, regime, weakLead: weakLead || undefined, relaxed: sel.relaxed || undefined, kospiRate: sel.kospiRate, decidedAt: now.getTime(), themes, candidates, all: sel.all };
}

// ---- 장중 실시간 주도 테마 (--when=live, 09:05~15:35 20분마다) ----
// 네이버 종목 뉴스: /api/news/stock/{code}?pageSize=n → [{total, items:[{title, datetime(YYYYMMDDHHmm), officeName, mobileNewsUrl}]}]
const unent = (x) => String(x).replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&middot;/g, "·").replace(/&hellip;/g, "…").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
export function parseNews(json, n = 2) {
  const items = (Array.isArray(json) ? json : []).flatMap((g) => (g && Array.isArray(g.items) ? g.items : []));
  return items.filter((x) => x && x.title).slice(0, n).map((x) => { const d = String(x.datetime || ""); return { title: unent(x.titleFull || x.title).trim(), at: d.length >= 12 ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) + " " + d.slice(8, 10) + ":" + d.slice(10, 12) : null, office: x.officeName || null, url: x.mobileNewsUrl || null }; });
}
// 테마 낱말: 테마 이름·합쳐진 이름에서 괄호·구분자로 자른 조각 (2글자↑, 일반어 제외) + 슬롯 종목명. 영문 약어(HBM·MLCC)는 대문자 그대로
const NEWS_STOP = new Set(["관련", "관련주", "테마", "등", "기타", "대표", "수혜", "개선", "양적", "질적", "부품", "소재", "장비", "산업"]);
export function themeWords(names = [], stocks = []) {
  const w = new Set();
  for (const nm of names) {
    const head = String(nm || "").split(/[(（]/)[0].trim(); if (head.length >= 2 && !NEWS_STOP.has(head)) w.add(head); // 괄호 앞 전체 이름 (예: "반도체 기판")
    for (const p of String(nm || "").split(/[()（）/·,\s]+/)) { const x = p.trim(); if (x.length >= 2 && !NEWS_STOP.has(x)) w.add(x); }
  }
  for (const s of stocks) if (s && String(s).length >= 2) w.add(String(s));
  return [...w];
}
// 뉴스 고르기: 제목에 테마 낱말이 든 기사를 먼저(낱말이 많이 든 순 → 최신 순), 모자라면 남은 최신 기사로 채운다. 각 기사에 match(맞은 낱말) 표시
export function pickNews(items, words = [], n = 2) {
  const list = (Array.isArray(items) ? items : []).map((x, i) => { const t = String(x.title || ""); const hit = words.filter((w) => t.includes(w)); return { x, i, hit }; });
  const rel = list.filter((a) => a.hit.length).sort((a, b) => b.hit.length - a.hit.length || a.i - b.i), rest = list.filter((a) => !a.hit.length);
  return [...rel, ...rest].slice(0, n).map((a) => Object.assign({}, a.x, a.hit.length ? { match: a.hit.slice(0, 3) } : {}));
}
export async function fetchNews(fetchImpl, code, { n = 2, timeoutMs = 10000, words = [] } = {}) {
  const r = await fetchImpl("https://m.stock.naver.com/api/news/stock/" + code + "?pageSize=" + (words.length ? 15 : Math.max(n, 3)), { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const all = parseNews(await r.json(), 15);
  return words.length ? pickNews(all, words, n) : all.slice(0, n);
}
// 장중 한 번: 코스피(등락·거래대금) · 코스피 외인/기관(장중 누적) · 프로그램 · 잠정 규칙으로 고른 주도 테마 3개(테마 거래대금·대장주 등락·거래대금) + 대장주 뉴스 2개 + 종목별 외인/기관(그 날 값이 이미 있을 때만 — 보통 장 마감 뒤)
// 결과는 auto/live.json 하나에 덮어쓴다 (날짜 파일에는 안 넣음). 실패한 조각은 errors 에 적고 나머지는 남긴다
export async function collectLive({ adapters, fetchImpl = fetch, now = new Date(), timeoutMs = 10000, us = null, history = [], date = null, n = 3 } = {}) {
  const day = date || kstDate(now), out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), date: day, errors: [] };
  const get = async (u) => { const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
  try { const q = await adapters.naver.quote("domestic:KOSPI"); out.kospi = { value: Number(((q.price / q.prevClose - 1) * 100).toFixed(2)), close: q.price, amount: q.amount || undefined, time: q.time || undefined }; } catch (e) { out.errors.push("코스피: " + (e.message || e)); }
  try { const k = parseTrend(await get("https://m.stock.naver.com/api/index/KOSPI/trend")); out.invest = { foreign: k.foreign, institution: k.institution, bizdate: k.bizdate }; } catch (e) { out.errors.push("현물 수급: " + (e.message || e)); }
  try { out.program = await fetchProgram(fetchImpl, { timeoutMs }); } catch (e) { out.errors.push("프로그램: " + (e.message || e)); }
  try {
    const L = await collectLeaders({ fetchImpl, timeoutMs, now, date: day, kospi: out.kospi || null, us, history, provisional: true, chart: true, n }); // 장중: 수급(F)만 빼고 C 차트 자리까지 사용자 규칙대로
    out.chartReady = !!L.chartReady; out.T = L.T; out.regime = L.regime; out.relaxed = L.relaxed; out.text = L.text; out.candidates = (L.candidates || []).map((t) => ({ name: t.name, score: t.score, alias: t.alias || [], stocks: (t.slots || []).map((s) => s.code) }));
    const bizdate = day.replace(/-/g, "");
    out.themes = [];
    for (const t of L.themes.slice(0, n)) {
      const row = { no: t.no, name: t.name, alias: t.alias || [], rate: t.rate, excess: t.excess, value: t.value, hot: t.hot, hotN: t.hotN, grades: t.grades, score: t.score, us: t.us, breadth: t.breadth, stocks: t.stocks, slots: (t.slots || []).slice(0, 3).map((s) => ({ code: s.code, name: s.name, rate: s.rate, value: s.value, price: s.price, ...(s.chart ? { chart: s.chart } : {}) })), news: [] };
      for (const s of row.slots.slice(0, 2)) { // 종목별 외인·기관: 오늘 bizdate 가 있을 때만 (장중엔 보통 없음)
        try { const f = stockFlow(await get("https://m.stock.naver.com/api/stock/" + s.code + "/trend?pageSize=1"), bizdate); if (f) s.flow = { foreign: f.foreign, inst: f.inst }; } catch (e) {}
      }
      // 뉴스: 대장주 기사 15개 중 제목에 테마 낱말(테마 이름·합쳐진 이름·대장주 3종목)이 든 것을 먼저 → 대장주 하나에 맞는 기사가 없으면 2등주 기사에서 다시
      const words = themeWords([t.name, ...(t.alias || [])], row.slots.map((s) => s.name)), nameOnly = themeWords([t.name, ...(t.alias || [])]);
      for (const s of row.slots.slice(0, 2)) {
        try { const got = await fetchNews(fetchImpl, s.code, { n: 2, timeoutMs, words }); const themed = got.filter((x) => x.match && x.match.some((m) => nameOnly.includes(m)));
          if (themed.length || !row.news.length) row.news = themed.length ? [...themed, ...got.filter((x) => !themed.includes(x))].slice(0, 2) : got;
          if (themed.length) break; } catch (e) { out.errors.push("뉴스 " + s.name + ": " + (e.message || e)); }
      }
      out.themes.push(row);
    }
  } catch (e) { out.errors.push("주도 테마: " + (e.message || e)); }
  return out;
}

// 같은 날 close run 을 두 번 돌릴 때(16:20 잠정 → 18:40 확정, 또는 확정 뒤 잠정이 늦게 옴) 주도 테마를 합친다 — scripts/collect-auto.mjs 가 쓴다
//  · 이번 선정이 통째로 실패(cur 없음)면 앞선 결과라도 남긴다
//  · 잠정 → 확정: 잠정은 leadersProvisional 로 보관 (잠정/확정 일치율 검증용)
//  · 확정 → 잠정(재실행·지연): 확정을 유지하고 늦게 온 잠정은 leadersProvisional 에 보관 (잠정이 확정을 덮지 않게)
//  · close.themes(테마 100개 compact)는 이번에 못 받았으면 앞선 것 유지
export function mergeCloseLeaders(oldClose, part) {
  const old = (oldClose && oldClose.market) || {}, m = part.market || (part.market = {}), cur = m.leaders;
  if (!cur && old.leaders) m.leaders = old.leaders;
  if (cur && cur.provisional && old.leaders && !old.leaders.provisional) { m.leaders = old.leaders; m.leadersProvisional = cur; }
  else if (old.leaders && old.leaders.provisional && cur && !cur.provisional) m.leadersProvisional = old.leaders;
  else if (old.leadersProvisional && !(cur && cur.provisional)) m.leadersProvisional = old.leadersProvisional;
  if (!part.themes && oldClose && oldClose.themes) part.themes = oldClose.themes;
  return part;
}

// 미국장 테마 값만 다시 받아 그날 아침 기록(morning)에 채워 넣는다 — 테마를 새로 추가한 날 아침 수집이 이미 지난 뒤에 쓴다.
// 다른 아침 값(야간선물·미국 지표·전일 테마)은 그대로 두고, 아침에 없던 테마만 채운다.
export async function collectThemesOnly({ themes, sources, adapters, now = new Date(), morning = null }) {
  const got = await collectAll({ sources: { themeSource: sources.themeSource }, themes, adapters, now });
  const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v.value, src: v.src, time: v.time || undefined, detail: v.detail }]));
  const base = morning ? JSON.parse(JSON.stringify(morning)) : { at: kstTime(now).slice(0, 5), ts: now.getTime(), signals: {}, errors: [] };
  base.us = Object.assign({}, strip(got.us), base.us || {}); // 이미 있던 테마는 아침 값 유지 (금·구리·코인은 장중에도 움직여서 지금 값으로 바꾸면 안 됨), 없던 테마만 채움
  base.themesAt = kstTime(now).slice(0, 5);
  base.errors = [...(base.errors || []).filter((e) => !e.startsWith("us.")), ...got.errors.map((e) => e.key + ": " + e.error)];
  return base;
}

// 오후: 코스피·코스닥 마감 등락률 + 투자자별 수급 (네이버)
export async function collectClose({ adapters, fetchImpl = fetch, now = new Date(), timeoutMs = 10000, leaders = null }) {
  const out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), market: {}, errors: [] };
  const inv = {};
  for (const k of ["kospi", "kosdaq"]) {
    const code = k.toUpperCase();
    try {
      const q = await adapters.naver.quote("domestic:" + code);
      out.market[k] = { value: Number(((q.price / q.prevClose - 1) * 100).toFixed(2)), close: q.price, amount: q.amount || undefined, src: "naver", time: q.time || undefined };
    } catch (e) { out.errors.push(k + ": " + (e.message || e)); }
    try {
      const res = await fetchImpl("https://m.stock.naver.com/api/index/" + code + "/trend", {
        headers: { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      inv[k] = parseTrend(await res.json());
      if (out.market[k] && out.market[k].amount) inv[k].amount = out.market[k].amount;
    } catch (e) { out.errors.push(k + " 수급: " + (e.message || e)); }
  }
  if (Object.keys(inv).length) out.market.invest = Object.assign({ text: investText(inv) }, inv);
  try { out.market.program = await fetchProgram(fetchImpl, { timeoutMs }); } catch (e) { out.errors.push("프로그램: " + (e.message || e)); } // 마감 프로그램 순매수(억) → 장 흐름 문장·프로그램 칸
  if (leaders) {
    try {
      const l = await leaders(out.market); // 코스피 등락률·거래대금(T·초과수익 게이트) 을 넘긴다
      if (l && l.all) { out.themes = l.all; delete l.all; } // 테마 100개 compact 는 close.themes 에 (지속일수 D · 다음 날 정답표)
      if (l && l.text !== undefined) out.market.leaders = l;
    } catch (e) { out.errors.push("주도 테마: " + (e.message || e)); }
  }
  return out;
}

// 그 날 파일에 이번 결과를 합친다 (아침·오후 따로 두고, 같은 시점은 최신으로 덮는다)
export function mergeAuto(prev, date, when, part) {
  const rec = Object.assign({ app: "jangjeon-cockpit", date }, prev && prev.date === date ? prev : {});
  rec[when] = part;
  rec.updatedAt = part.ts || Date.now();
  return rec;
}

export function summarize(rec) {
  const lines = [];
  const m = rec.morning, c = rec.close;
  if (m) {
    Object.entries(m.signals || {}).forEach(([k, v]) => lines.push(`아침 ${m.at} 신호 ${k.padEnd(5)} ${String(v.value).padStart(8)}  ${v.src}`));
    Object.entries(m.us || {}).forEach(([k, v]) => lines.push(`아침 ${m.at} 테마 ${k.padEnd(5)} ${String(v.value).padStart(8)}  ${v.src}`));
    if (m.gap) lines.push(`아침 ${m.at} 연휴 뒤 첫 거래일 (직전 한국 거래일 ${m.gap.prevKr}) · 미국 신호 누적 ${m.gap.from || "?"} → ${m.gap.to || "?"}`);
    Object.entries(m.stale || {}).forEach(([k, v]) => lines.push(`아침 ${m.at} ⚠ ${k} 값 기준일 ${v.date} (기대 ${v.expected}) — 오래된 값`));
    (m.prev || []).forEach((t) => lines.push(`아침 ${m.at} 전일테마 ${t.name} ${t.rate}%${t.score !== undefined ? " · 점수 " + t.score : ""} · 애프터 ${t.after ? t.after.pct + "% " + t.after.state : "—"} · 프리 ${t.pre ? t.pre.pct + "% " + t.pre.state : "—"}${t.gapWarn ? " · ⚠ 갭 추격 금지" : ""} (${(t.stocks || []).map((x) => x.name).join("·")})`));
    if (m.prevRaw) lines.push("아침 NXT 세션 " + m.prevRaw);
    (m.errors || []).forEach((e) => lines.push("아침 실패 " + e));
  }
  const it = rec.intraday;
  if (it) lines.push(`장중 ${it.at} 코스피 ${it.kospi ?? "—"}% · 외인 선물 ${it.fut ? it.fut.foreign : "—"} · 현물 외인 ${it.spot ? it.spot.foreign : "—"}억 · 기관 ${it.spot ? it.spot.institution : "—"}억`);
  if (c) {
    ["kospi", "kosdaq"].forEach((k) => { const v = c.market && c.market[k]; if (v) lines.push(`오후 ${c.at} ${k.padEnd(6)} ${String(v.value).padStart(7)}%  종가 ${v.close}`); });
    if (c.market && c.market.invest) lines.push(`오후 ${c.at} 수급 ${c.market.invest.text}`);
    if (c.market && c.market.leaders) { const L = c.market.leaders; lines.push(`오후 ${c.at} 주도 테마${L.provisional ? "(잠정)" : ""}${L.T ? " T=" + L.T + "억" : ""}${L.regime ? " · " + L.regime : ""}${L.relaxed ? " · 조건 미달·참고용" : ""} ${L.text || "없음"}`); }
    (c.errors || []).forEach((e) => lines.push("오후 실패 " + e));
  }
  return lines.join("\n");
}

export { kstDate };
