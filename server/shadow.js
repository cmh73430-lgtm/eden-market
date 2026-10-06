// 주도 테마 「그림자(shadow)」 선정 V2 — 9.29-84 원장 [1597] (연구 루프 [1578]~[1596] 결론 · 디렉터 답 「핵심 3개 + 처리 순서·이름 안정화 + TOP10 제외 열」)
// 기존 selectThemes(현행 순위·화면)는 그대로 두고, 같은 응답으로 새 순위를 「같이」 계산해 live.json · 날짜 파일의 shadow 블록에 기록·표시한다. 2주 병행 뒤 교체는 디렉터 결정.
// 순수 함수만 (네트워크는 get(url) 로 주입). 요청은 memoGet 으로 현행 선정과 응답을 나눠 쓴다 → 추가 요청 = 게이트 통과 41~80위 상세 + RVOL 일봉 + F·C 중 현행이 안 받은 것.
//
//  ① L(자격 문턱): 슬롯 5개 중 「거래대금 ≥ T(그 종목 시장) 이고 등락률 ≥ 테마 등락률 또는 +3% 이상」 인 종목 수 ≥ V2_MIN_L(2) 이면 자격 (R4 1b 「+3%↑ 대금 종목」). 순위에는 안 쓴다.
//  ② 순위 = 표준화(z) 합성: 테마 등락률 · 상승 종목 비율 · 상한가/강세 종목 수 · 테마 거래대금(TOP10 제외분, log) · RVOL 테마 중앙값(log). 가중치 SHADOW_W.
//  ③ RVOL = 종목 당일 누적 거래대금 ÷ 장 경과율((지금 − 09:00) / 390분 · 마감 뒤 1) ÷ 20일 평균 거래대금(중계 /day 일봉 종가×거래량 근사 · 오늘 봉 제외 · 2026 날짜 검증 · 하루 1회 캐시) — 연구 R1 §7 · R6 2)
//  ④ T 시장별: 코스피 종목 = 코스피 거래대금 연동 T · 코스닥 종목 = 코스닥 거래대금 연동 T (같은 구간 식 thresholdFor). 초과수익 「기준 지수」 는 테마 구성(거래대금) 비율로 코스피/코스닥 가중 — 게이트는 현행 코스피 기준 그대로 (R6: 가중지수 게이트는 강한 코스닥 날 코스닥 테마를 역탈락시킴) · 상승비율도 현행 0.6(V2_MIN_RISE · [1600] 60% 확정 · 2주 뒤 재검토)
//  ⑤ 순서: 게이트 통과 전부(최대 V2_SCAN)에 L 계산 → 자격 → 합성 점수 → 중복 제거 → 이름 안정화 → F·C 요청은 병합 뒤 상위 6 (현행은 40컷 → L → F·C → 병합)
//  ⑥ 이름: 직전 run 과 같은 무리(대장주 같거나 구성 테마가 겹침)면 이전 이름 유지 · 연속 2 run 다른 대표가 나올 때만 교체
//  ⑦ TOP10 = shared/top10_kospi.json (marketValue 전수 · 고정 코드셋 · 갱신 주기는 그 파일 refresh 항목)
import TOP10 from "../shared/top10_kospi.json" with { type: "json" };
import { thresholdFor, compactThemes, breadthOf, dedupeThemes, gradeC, withToday, chartUrl, stockFlow, themeFlow, gradeF, kstDate, prevCloseOf, LEAD_MIN_RATE, LEAD_MIN_EXCESS, PREV_MIN_STOCKS, SLOT_N, FLOW_TOP, FLOW_STOCKS, CHART_TOP, CHART_STOCKS } from "./auto.js";

export const TOP10_CODES = new Set((TOP10.adopted_top10 || []).map((x) => String(x.code)));
export const TOP10_ASOF = TOP10.snapshot_time;
export const SHADOW_V = 1;
// ---- 상수 (전부 여기) ----
export const V2_MIN_L = 2;        // 자격 문턱: 거래대금 ≥ T & 움직인(≥ 테마 등락률 또는 +3%) 슬롯 ≥ 2 — 원장 [1596] 권장안 ① · R4 1b
export const V2_SLOT_MOVE = 3;    // 「움직인」 기준 +3% (R4 analyze.mjs moved 열과 같음)
export const V2_MIN_RISE = 0.6;   // 게이트 상승비율 60% — 원장 [1600] 디렉터 답 「60% 그대로」 확정 · 2주 뒤 재검토 (R1 §4: 놓친 테마 자율주행차·IT대표주·소캠·CXL 은 상승비율 게이트 탈락이었음 — 재검토 자료) · 가중지수 게이트는 쓰지 않음
export const V2_SCAN = 80;        // 게이트 통과 전부에 L 계산 (10/6 10:51 게이트 통과 84 · 현행 40컷에서 반도체 장비 L5 가 43위로 잘림 → 누락 0 이 목적) · 상세 요청 상한
export const V2_POOL = 40;        // 자격 통과 후 합성 점수 상위 몇 개까지 후보로 (현행 LEAD_POOL 과 같은 수)
export const V2_TOP = 6;          // F·C 요청 범위 = 병합 뒤 상위 6 (현행 FLOW_TOP·CHART_TOP 과 같음)
export const RVOL_DAYS = 20, RVOL_MIN_N = 10, RVOL_MIN_ELAPSED_MIN = 15, SESSION_MIN = 390, RVOL_THEMES = 12, RVOL_MAX_CODES = 40;
//   RVOL: 직전 20봉 평균(오늘 제외 · 10봉 미만이면 없음) · 09:15 전엔 경과율 바닥 15/390 (개장 직후 몇 분으로 나누면 수십 배가 나와 순위를 망침) · 합성 점수용 RVOL 은 예비 순위 상위 12테마 슬롯만(하루 캐시) · 한 run 새 일봉 요청 최대 40
export const RVOL_BAR_COUNT = 30; // 중계 /day count (휴장 섞여도 20 거래일이 들어오게)
// 가중치 — 표준화(z) 점수의 합. 근거: 디렉터 결론([1596]) 「2·3위는 돈 몰린 순 48·51위」 → 거래대금(TOP10 제외) 을 가장 크게, 「RVOL 로는 보안주 1위」 → 쏠림을 따로,
// 「1위는 맞게 뽑힘」 → 등락률은 현행 게이트 순서(초과수익) 를 이어받되 단독으로 이기지 않게, 확산(상승비율·강세 수)은 B 단계(폭 P) 를 대신. 합 1.0. 2주 병행 기록 뒤 디렉터가 조정.
export const SHADOW_W = { rate: 0.25, rise: 0.15, strong: 0.15, value: 0.30, rvol: 0.15 };
export const NAME_SWITCH_RUNS = 2; // 이름 교체: 연속 2 run 다른 대표일 때만

const num = (s) => { if (s === null || s === undefined || s === "") return null; const n = Number(String(s).replace(/,/g, "").replace(/^\+/, "")); return Number.isFinite(n) ? n : null; };
const round2 = (x) => Number(x.toFixed(2));
const round3 = (x) => Number(x.toFixed(3));

// 요청 메모: 같은 주소는 한 번만 (현행 selectThemes 와 V2 가 같은 get 을 쓰면 상세 40개·일봉·수급을 나눠 쓴다). misses = 실제 요청 수
export function memoGet(get) {
  const cache = new Map(); let misses = 0;
  const g = async (u) => { if (!cache.has(u)) { misses++; cache.set(u, Promise.resolve().then(() => get(u))); } return cache.get(u); };
  g.count = () => misses; g.has = (u) => cache.has(u);
  return g;
}

// ④ 시장별 T: 코스닥 거래대금을 모르면 코스피 T 를 같이 쓴다 (아침·옛 파일)
export function marketT(kospiAmount, kosdaqAmount) {
  const KS = thresholdFor(kospiAmount);
  return { KS, KQ: typeof kosdaqAmount === "number" && kosdaqAmount > 0 ? thresholdFor(kosdaqAmount) : KS };
}
export const marketOf = (x) => { const c = x && x.stockExchangeType && x.stockExchangeType.code; return c === "KQ" ? "KQ" : c === "KS" ? "KS" : null; };
// 테마 상세 stocks[] → { code, name, rate, value(억), price, market, cap(억), top10 }
export function parseStocksV2(stocks) {
  return (Array.isArray(stocks) ? stocks : []).map((x) => {
    const raw = num(x.accumulatedTradingValueRaw) ?? num(x.accumulatedTradingValue), cap = num(x.marketValueRaw);
    return { code: x.itemCode, name: x.stockName, rate: num(x.fluctuationsRatio), value: raw === null ? null : round2(raw / 1e8), price: num(x.closePrice), prev: prevCloseOf(x), market: marketOf(x), cap: cap === null ? null : Math.round(cap / 1e8), top10: TOP10_CODES.has(String(x.itemCode)) }; // prev = 전일 종가 (9.29-87 원장 [1656])
  }).filter((x) => x.code);
}
const tOf = (T, s) => (s.market === "KQ" ? T.KQ : T.KS);
// 슬롯: 오른 종목 중 v ≥ T(그 시장)/5 인 것을 거래대금 순 5개 (현행 leadStocks 와 같되 시장별 T)
export function slotsV2(ps, T, n = SLOT_N) {
  return ps.filter((x) => x.rate !== null && x.rate > 0 && (x.value || 0) >= tOf(T, x) / 5).sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, n);
}
// ① L: 슬롯 중 v ≥ T(시장) & (등락률 ≥ 테마 등락률 또는 ≥ +3%) — 테마보다 덜 오른 대형주(삼성전자 +0.18% 8,881억이 OLED L 을 올린 10/6 09:59 사례)는 안 센다
export function gradeL2(slots, themeRate, T) {
  const r = typeof themeRate === "number" ? themeRate : 0;
  return (Array.isArray(slots) ? slots : []).filter((s) => (s.value || 0) >= tOf(T, s) && typeof s.rate === "number" && (s.rate >= r || s.rate >= V2_SLOT_MOVE)).length;
}
// ⑦ 테마 거래대금 · TOP10 제외분 · TOP10 몫 · 코스닥 비중(거래대금 가중)
export function valueSplit(ps) {
  const all = ps.reduce((a, x) => a + (x.value || 0), 0), top = ps.filter((x) => x.top10).reduce((a, x) => a + (x.value || 0), 0), kq = ps.filter((x) => x.market === "KQ").reduce((a, x) => a + (x.value || 0), 0);
  return { value: Math.round(all), valueExTop10: Math.round(all - top), top10Share: all > 0 ? round2((top / all) * 100) : 0, top10In: ps.filter((x) => x.top10).map((x) => x.name), wKQ: all > 0 ? round3(kq / all) : null };
}
// ④ 초과수익 기준 지수(V2 표시용): 코스닥 비중 w 로 가중 — 게이트에는 안 쓴다
export const excessMix = (rate, wKQ, kospiRate, kosdaqRate) => {
  if (typeof rate !== "number" || typeof kospiRate !== "number") return null;
  const w = typeof wKQ === "number" && typeof kosdaqRate === "number" ? wKQ : 0;
  return round2(rate - ((1 - w) * kospiRate + w * (typeof kosdaqRate === "number" ? kosdaqRate : kospiRate)));
};

// ---- ③ RVOL ----
// 장 경과율: hm "HH:MM" → (hm − 09:00)/390 · 09:15 전은 15/390 · 15:30 뒤는 1. hm 없으면 1 (마감 run)
export function elapsedRatio(hm) {
  if (!hm || !/^\d\d:\d\d/.test(hm)) return 1;
  const m = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) - 9 * 60;
  return Number(Math.min(1, Math.max(RVOL_MIN_ELAPSED_MIN, m) / SESSION_MIN).toFixed(4)); // 10:51 → 111/390 = 0.2846 (연구 R1 §7 · R6 2) 와 같은 자릿수)
}
// 중계 /day 응답 {bars:[{d:"YYYY-MM-DD", c, v}]} 또는 네이버 일봉 [{localDate, closePrice, accumulatedTradingVolume}] → 오래된 순 [{d, c, v}] (오늘 포함 전부)
export function barRows(raw) {
  const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.bars) ? raw.bars : [];
  const d8 = (s) => { const x = String(s || ""); return /^\d{8}$/.test(x) ? x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6, 8) : /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null; };
  return arr.map((b) => ({ d: d8(b.d ?? b.localDate), c: num(b.c ?? b.closePrice), v: num(b.v ?? b.accumulatedTradingVolume) })).filter((r) => r.d && r.c !== null && r.v !== null && r.c > 0).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
// 20일 평균 거래대금(억): 오늘(today) 봉 제외 · 직전 RVOL_DAYS 봉 · 날짜 검증 = 전부 today 보다 이전이고 today 의 120일 안 (연도가 틀린 봉 — R1 §7 2025 사고 — 은 무효) · 10봉 미만이면 null
export function avg20FromBars(raw, today, n = RVOL_DAYS) {
  const rows = barRows(raw).filter((r) => r.d < today);
  if (!rows.length) return null;
  const last = rows[rows.length - 1].d, floor = shiftDays(today, -120);
  if (last < shiftDays(today, -14)) return { error: "최근 봉 아님 " + last }; // 2주 넘게 묵은 봉 = 다른 해·죽은 종목
  const use = rows.slice(-n).filter((r) => r.d >= floor);
  if (use.length < RVOL_MIN_N) return null;
  const avg = use.reduce((a, r) => a + (r.c * r.v) / 1e8, 0) / use.length;
  return { avg20: round2(avg), from: use[0].d, to: use[use.length - 1].d, n: use.length };
}
function shiftDays(d, k) { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); }
export const rvolOf = (valueToday, avg20, hm) => (typeof valueToday === "number" && typeof avg20 === "number" && avg20 > 0 ? round2(valueToday / elapsedRatio(hm) / avg20) : null);
export const median = (xs) => { const a = xs.filter((x) => typeof x === "number").sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return round2(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2); };
// 캐시 { date, codes: { code: { avg20, from, to, n } } } — 오늘 것만 쓴다 (날이 바뀌면 비움)
export const rvolCacheFor = (cache, date) => (cache && cache.date === date && cache.codes && typeof cache.codes === "object" ? { date, codes: Object.assign({}, cache.codes) } : { date, codes: {} });
// 종목들의 20일 평균을 채운다: 캐시에 없는 코드만 bars(code) 로 받는다 (최대 max 개). 실패는 errors 에만
export async function fillAvg20({ codes, cache, bars, today, max = RVOL_MAX_CODES }) {
  const errors = []; let requests = 0;
  for (const code of [...new Set(codes)].filter((c) => /^\d{6}$/.test(String(c)))) {
    if (cache.codes[code] !== undefined) continue;
    if (requests >= max) { errors.push("RVOL 일봉 상한 " + max); break; }
    try { requests++; const a = avg20FromBars(await bars(code), today); if (a && a.error) { cache.codes[code] = null; errors.push("RVOL " + code + ": " + a.error); } else cache.codes[code] = a; }
    catch (e) { cache.codes[code] = null; errors.push("RVOL " + code + ": " + (e.message || e)); }
  }
  return { requests, errors };
}

// ---- ② 합성 점수 ----
export function zScores(xs) {
  const v = xs.filter((x) => typeof x === "number");
  if (v.length < 2) return xs.map((x) => (typeof x === "number" ? 0 : 0));
  const mean = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return xs.map((x) => (typeof x !== "number" || sd === 0 ? 0 : round3((x - mean) / sd)));
}
// rows[i] = { rate, rise, strong(N30×2 + 강세 수), valueExTop10, rvolMed } → 각 row 에 z · score (가중합 ×100, 소수 1자리) 를 붙인다. 값이 없는 칸(RVOL 못 받음)은 z=0(중립)
export function compositeScore(rows, W = SHADOW_W) {
  const z = { rate: zScores(rows.map((r) => r.rate)), rise: zScores(rows.map((r) => r.rise)), strong: zScores(rows.map((r) => r.strong)), value: zScores(rows.map((r) => (typeof r.valueExTop10 === "number" ? Math.log1p(Math.max(0, r.valueExTop10)) : null))), rvol: zScores(rows.map((r) => (typeof r.rvolMed === "number" ? Math.log1p(Math.max(0, r.rvolMed)) : null))) };
  rows.forEach((r, i) => { r.z = { rate: z.rate[i], rise: z.rise[i], strong: z.strong[i], value: z.value[i], rvol: z.rvol[i] }; r.score = Number((Object.keys(W).reduce((a, k) => a + W[k] * r.z[k], 0) * 100).toFixed(1)); });
  return rows;
}
export const compareV2 = (a, b) => (b.score || 0) - (a.score || 0) || (b.valueExTop10 || 0) - (a.valueExTop10 || 0) || (b.rate || 0) - (a.rate || 0);

// ---- ⑥ 이름 안정화 ----
// prev = 직전 run 의 shadow.names [{ name, no, members:[no…], lead(대장주 코드), pending:{ name, no, runs } }]
// 같은 무리 = 대장주 코드가 같거나 구성 테마 번호가 하나라도 겹침. 이전 이름이 지금 무리 안에 있으면 그 이름 유지. 지금 대표가 다르면 pending 에 세고, NAME_SWITCH_RUNS 연속이면 교체
export function stabilizeNames(themes, prev = []) {
  const names = [];
  for (const t of themes) {
    const members = [t.no, ...((t._memberNos) || [])].filter((x) => x !== undefined).map(String), lead = t.slots && t.slots[0] ? String(t.slots[0].code) : null;
    const memberNames = new Map([[String(t.no), { name: t.name, rate: t.rate, value: t.value }], ...(t._memberRows || []).map((m) => [String(m.no), m])]);
    const p = (Array.isArray(prev) ? prev : []).find((x) => x && ((lead && x.lead === lead) || (Array.isArray(x.members) && x.members.some((m) => members.includes(String(m))))));
    const rec = { name: t.name, no: t.no, members, lead, pending: null };
    if (p && p.name !== t.name && memberNames.has(String(p.no))) {
      const want = { name: t.name, no: t.no }, pend = p.pending && p.pending.name === want.name ? { name: want.name, no: want.no, runs: (p.pending.runs || 0) + 1 } : { name: want.name, no: want.no, runs: 1 };
      if (pend.runs >= NAME_SWITCH_RUNS) { rec.pending = null; t.nameSwitched = p.name; } // 연속 2 run 같은 새 대표 → 교체
      else { const keep = memberNames.get(String(p.no)); t.alias = [t.name, ...(t.alias || []).filter((a) => a !== p.name)]; t.name = p.name; t.no = p.no; if (keep && typeof keep.rate === "number") t.rate = keep.rate; if (keep && typeof keep.value === "number") t.value = keep.value; t.nameKept = true; rec.name = p.name; rec.no = p.no; rec.pending = pend; }
    } else if (p && p.name === t.name && p.pending) rec.pending = null;
    names.push(rec);
  }
  return names;
}

// ---- 본체 ----
// get: memoGet 으로 싼 요청 함수 · kospi/kosdaq: { value, amount } · hm: "HH:MM" 장중 시각(마감 run 은 null → 경과율 1) · bars(code): RVOL 일봉 · rvolCache: 직전 run 캐시 · prevNames: 직전 run shadow.names
// extraCodes: 현행 화면 3테마 슬롯 등 RVOL 을 같이 받을 종목 · provisional/chart: 현행과 같은 뜻 (F 는 확정 run · C 는 chart=true)
export async function selectThemesV2({ get, n = 3, kospi = null, kosdaq = null, hm = null, date = null, bizdate = null, bars = null, rvolCache = null, prevNames = [], extraCodes = [], provisional = false, chart = !provisional, pool = V2_POOL, scan = V2_SCAN } = {}) {
  const today = date || kstDate(), errors = [], t0 = Date.now();
  const list = await get("https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100");
  const groups = list && Array.isArray(list.groups) ? list.groups : [];
  const kospiRate = kospi && typeof kospi.value === "number" ? kospi.value : null, kosdaqRate = kosdaq && typeof kosdaq.value === "number" ? kosdaq.value : null;
  const T = marketT(kospi && kospi.amount, kosdaq && kosdaq.amount);
  const k = kospiRate ?? 0;
  // 게이트(현행과 같되 상승비율만 완화) → 초과수익 순 → 상위 scan 개 전부 상세
  const gate = compactThemes(groups).map((g) => Object.assign(g, { rise: g.count ? g.rise / g.count : 0, riseN: g.rise }))
    .filter((g) => (g.count || 0) >= PREV_MIN_STOCKS && typeof g.rate === "number" && g.rate >= LEAD_MIN_RATE && g.rise >= V2_MIN_RISE && g.rate - k >= LEAD_MIN_EXCESS)
    .map((g) => Object.assign(g, { excess: round2(g.rate - k) })).sort((a, b) => b.excess - a.excess || b.rise - a.rise || (b.count || 0) - (a.count || 0));
  const scanned = gate.slice(0, scan);
  const rows = [];
  for (const g of scanned) {
    let stocks = [];
    try { const d = await get("https://m.stock.naver.com/api/stocks/theme/" + g.no + "?page=1&pageSize=100"); if (!d || typeof d !== "object" || !Array.isArray(d.stocks)) throw new Error("형식 이상"); stocks = d.stocks; } catch (e) { errors.push("상세 " + g.no + ": " + (e.message || e)); }
    const ps = parseStocksV2(stocks), slots = slotsV2(ps, T), L = gradeL2(slots, g.rate, T), vs = valueSplit(ps), br = breadthOf(ps);
    rows.push(Object.assign(g, vs, { slots, L, N30: br.N30, hotN: ps.filter((x) => typeof x.rate === "number" && x.rate >= 5).length, strong: 2 * br.N30 + ps.filter((x) => typeof x.rate === "number" && x.rate >= 5).length, breadth: { P: br.P, N30: br.N30, N10: br.N10, N5: br.N5, gap: br.gap }, excessMix: excessMix(g.rate, vs.wKQ, kospiRate, kosdaqRate), qualified: L >= V2_MIN_L, detailOk: stocks.length > 0 }));
  }
  const pass = rows.filter((r) => r.qualified);
  // RVOL: 예비 순위(RVOL 없이) 상위 RVOL_THEMES 테마의 슬롯 + extraCodes. 캐시는 오늘 것만
  const cache = rvolCacheFor(rvolCache, today);
  compositeScore(pass); pass.sort(compareV2);
  const want = [...extraCodes, ...pass.slice(0, RVOL_THEMES).flatMap((r) => r.slots.map((s) => s.code))];
  let rvolReq = 0;
  if (bars) { const f = await fillAvg20({ codes: want, cache, bars, today }); rvolReq = f.requests; errors.push(...f.errors); }
  const rv = (s) => { const a = cache.codes[s.code]; return a && typeof a.avg20 === "number" ? rvolOf(s.value, a.avg20, hm) : null; };
  for (const r of pass) { r.slots.forEach((s) => { const x = rv(s); if (x !== null) s.rvol = x; }); r.rvolMed = median(r.slots.map((s) => s.rvol)); }
  compositeScore(pass); pass.sort(compareV2);
  const cands = pass.slice(0, pool).map((r) => Object.assign(r, { alias: [] }));
  // 중복 제거(현행 dedupeThemes 재사용 · 점수는 합성 점수) → 무리 구성원 번호 보존 → 이름 안정화
  const before = new Map(cands.map((c) => [String(c.no), { no: c.no, name: c.name, rate: c.rate, value: c.value }]));
  const merged = dedupeThemes(cands);
  for (const t of merged) { const nos = [t.no, ...(t.alias || []).map((a) => { const f = [...before.values()].find((x) => x.name === a); return f ? f.no : undefined; })].filter((x) => x !== undefined); t._memberNos = nos.filter((x) => String(x) !== String(t.no)); t._memberRows = nos.map((x) => before.get(String(x))).filter(Boolean); }
  const names = stabilizeNames(merged, prevNames);
  merged.forEach((t) => { delete t._memberNos; delete t._memberRows; });
  // F·C: 병합 뒤 상위 V2_TOP 만 (요청은 memoGet 이라 현행이 이미 받은 종목은 0)
  let flowReady = false, chartReady = false;
  for (const t of merged.slice(0, V2_TOP)) {
    t.grades = { F: 1, C: 1 };
    if (!provisional) {
      const flows = [];
      for (const s of t.slots.slice(0, FLOW_STOCKS)) { try { const f = stockFlow(await get("https://m.stock.naver.com/api/stock/" + s.code + "/trend?pageSize=1"), bizdate || today.replace(/-/g, "")); if (f) { flows.push(Object.assign({ value: s.value }, f)); s.flow = { foreign: f.foreign, inst: f.inst }; } } catch (e) {} }
      t.flow = themeFlow(flows) || undefined; if (t.flow) flowReady = true; t.grades.F = gradeF(t.flow);
    }
    if (chart) {
      const cs = [];
      for (const s of t.slots.slice(0, CHART_STOCKS)) { try { const raw = await get(chartUrl(s.code, today)); const c = gradeC(provisional ? withToday(raw, today, s.price) : raw, { vToday: s.value, T: tOf(T, s) }); cs.push(c); if (c) s.chart = { grade: c.grade, tag: c.tag }; } catch (e) { cs.push(null); } }
      t.chart = { lead: cs[0] ? { grade: cs[0].grade, tag: cs[0].tag, offHigh: cs[0].offHigh } : null, second: cs[1] ? { grade: cs[1].grade, tag: cs[1].tag } : null };
      if (cs[0]) { chartReady = true; t.grades.C = cs[0].grade; }
    }
  }
  const slimSlot = (s) => Object.assign({ code: s.code, name: s.name, rate: s.rate, value: s.value, price: s.price, market: s.market, top10: s.top10 || undefined, rvol: s.rvol ?? null }, typeof s.prev === "number" ? { prev: s.prev } : {}, s.flow ? { flow: s.flow } : {}, s.chart ? { chart: s.chart } : {}); // prev = 전일 종가 (9.29-87 원장 [1656])
  const slim = (t) => ({ no: t.no, name: t.name, alias: t.alias || [], rate: t.rate, rise: round2(t.rise), count: t.count, excess: t.excess, excessMix: t.excessMix, wKQ: t.wKQ, value: t.value, valueExTop10: t.valueExTop10, top10Share: t.top10Share, top10In: t.top10In,
    L: t.L, N30: t.N30, hotN: t.hotN, rvolMed: t.rvolMed ?? null, z: t.z, score: t.score, grades: t.grades, flow: t.flow, chart: t.chart, nameKept: t.nameKept || undefined, nameSwitched: t.nameSwitched || undefined, slots: t.slots.map(slimSlot) });
  const extra = {}; for (const c of extraCodes) { const a = cache.codes[c]; if (a && typeof a.avg20 === "number") extra[c] = a.avg20; }
  return {
    v: SHADOW_V, at: hm, date: today, T, elapsed: elapsedRatio(hm), kospiRate, kosdaqRate, top10AsOf: TOP10_ASOF, weights: SHADOW_W, minL: V2_MIN_L, minRise: V2_MIN_RISE,
    gatePassed: gate.length, scanned: scanned.length, qualified: pass.length, flowReady, chartReady, provisional: !!provisional,
    themes: merged.slice(0, n).map(slim), candidates: merged.map(slim),
    pool: rows.map((r) => ({ no: r.no, name: r.name, rate: r.rate, rise: round2(r.rise), excess: r.excess, L: r.L, qualified: r.qualified, valueExTop10: r.valueExTop10, score: r.qualified ? r.score : null })),
    names, rvolCache: cache, avg20: extra, requests: { rvol: rvolReq }, ms: Date.now() - t0, errors,
  };
}

// 현행 화면 테마(live.themes / leaders.themes)의 슬롯에 RVOL 을 붙여 주는 보조: shadow.rvolCache 의 20일 평균 × 경과율
export function attachRvol(themes, shadow) {
  if (!shadow || !shadow.rvolCache || !Array.isArray(themes)) return themes;
  for (const t of themes) for (const s of t.slots || []) { const a = shadow.rvolCache.codes[s.code]; if (a && typeof a.avg20 === "number") { const x = rvolOf(s.value, a.avg20, shadow.at); if (x !== null) s.rvol = x; } }
  return themes;
}
