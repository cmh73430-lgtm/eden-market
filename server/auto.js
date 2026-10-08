// 자동 연동: GitHub Actions 가 평일 아침(미국 지표·미국 대응주)과 오후(코스피·코스닥 마감·수급)에 네이버 값을 모아
// 기록 저장소(cockpit-data 브랜치)의 auto/<날짜>.json 에 둔다. 앱은 그 파일을 읽어 빈 칸을 채운다 (손으로 고친 칸은 그대로).
// 여기는 순수 함수만 — 실제 실행은 scripts/collect-auto.mjs.
import { kstDate, kstTime, weekday, holidayGap, lastUsTradingDayBefore, usDateOf, addDays } from "../shared/calendar.js";
import { usKeyOf } from "../shared/us-themes.js";
import { collectAll, normalizeYield } from "./collect.js";
// 9.29-84 원장 [1597]: 그림자(shadow) 선정 V2 · 뉴스 v2 — 현행 선정·화면은 그대로, 옵션(shadow·news2)을 넘긴 run 만 같이 계산해 블록을 더한다 (server/shadow.js · server/news2.js)
import { selectThemesV2, memoGet, attachRvol } from "./shadow.js";
import { fetchNews2 } from "./news2.js";
export { selectThemesV2, memoGet, attachRvol, fetchNews2 };

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

// 장중 실시간(live) 실행 시각 판정 (9.29-81 원장 [1551]): 09:05~15:30 은 그 시각 값. 15:30 이 지나 늦게 도착한 실행
// (GitHub 예약 지연 — 10/2 15:40 칸이 15:44 에 도착해 버려짐)은 16:00 까지 「15:30 장 마감 값」으로 받는다. 16:00 뒤는 건너뜀 (16:20 잠정 · 19:45 확정 마감 수집과 안 겹침)
export const LIVE_OPEN = "09:05", LIVE_CLOSE = "15:30", LIVE_GRACE = "16:00";
export function liveSlot(hm) {
  if (!hm || hm < LIVE_OPEN || hm > LIVE_GRACE) return null;
  return hm > LIVE_CLOSE ? { at: LIVE_CLOSE, closed: true } : { at: hm, closed: false };
}
// 이미 저장된 오늘 「장 마감 값」(closed)을 장중 값이 덮지 않게: 덮어도 되면 true
export function liveOverwrite(cur, next) {
  return !(cur && next && cur.date === next.date && cur.closed && !next.closed);
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
  // 9.29-87 원장 [1652]: 연휴 누적일 때도 「값 ▲변동폭 (+%)」 용 수준값 — price = 최근 미국 종가 · prev = 누적 기준(직전 한국 거래일 전 미국 종가) · 야후 일봉 찌꺼기는 2자리
  const r2 = (x) => Number((k === "ust" ? normalizeYield(x) : x).toFixed(2));
  return { value, from: base.date, to: last.date, level: k === "ust" ? Number(normalizeYield(last.close).toFixed(2)) : undefined, price: r2(last.close), prev: r2(base.close) };
}
// 받아온 미국 값의 기준 날짜가 '기대하는 미국 거래일'보다 오래됐는지 (연휴·주말 뒤 묵은 값 방지). 선물·환율처럼 밤새 거래되는 값은 시각이 최신이라 걸리지 않는다
export const US_DATED = ["sox", "vix", "ust", "ustlvl", "dji", "ixic", "spx", "rut", "fut", "es", "ym", "rty", "oil", "mu", "skhy"]; // mu·skhy (9.29-97 원장 [1784]): 연휴 뒤 묵은 미국 종목 값 차단 · 연휴 누적(CUM_SYMBOLS)에는 안 넣음(야후 daily 당일 close null)
export function staleCheck(signals, expectedUs) {
  const out = {};
  US_DATED.forEach((k) => { const v = signals[k]; const d = v && usDateOf(v.time); if (d && d < expectedUs) out[k] = { date: d, expected: expectedUs }; });
  return out;
}

// ---- SK하이닉스 ADR 환산 (9.29-97 원장 [1784]) ----
export const ADR_RATIO = 10, ADR_HIST = 20; // ADR 10주 = 보통주 1주 (2026-07-10 나스닥 상장 · 검증 보고 lead_audit/미국종목지표/검증.md 3-1)
export const KR_BASIC_URL = (code) => "https://m.stock.naver.com/api/stock/" + code + "/basic";
// 네이버 국내 종목 basic → 전일 종가: 오늘 장이 이미 열렸으면(localTradedAt 날짜 = 오늘) 종가 − 전일대비(부호는 compareToPreviousPrice) 로 역산, 아니면 closePrice 가 곧 마지막(전일) 종가
export function krPrevClose(j, today) {
  const close = num(j && j.closePrice), chg = num(j && j.compareToPreviousClosePrice), dir = j && j.compareToPreviousPrice, at = String((j && j.localTradedAt) || "");
  if (close === null || close <= 0) throw new Error("종가 없음");
  if (at.slice(0, 10) === today) { if (chg === null) throw new Error("전일대비 없음"); const falling = !!dir && (dir.name === "FALLING" || dir.name === "LOWER_LIMIT" || dir.code === "5" || dir.code === "4"); return { close: close - (falling && chg > 0 ? -chg : chg), how: "역산", date: today }; }
  return { close, how: "종가", date: at.slice(0, 10) || null };
}
export async function fetchKrClose(fetchImpl = fetch, code = "000660", today = kstDate(), { timeoutMs = 10000 } = {}) {
  const r = await fetchImpl(KR_BASIC_URL(code), { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return krPrevClose(await r.json(), today);
}
// 환산가(원/보통주 1주) = ADR × 10 × 원달러 · 괴리 % = 환산가 ÷ 한국 전일 종가 − 1 · hist = [[날짜, 괴리]] 최근 20개(같은 날은 이번 값으로) → 평균 · 개수
export function adrPremium({ adrPrice, fx, kr, hist = [], date, ratio = ADR_RATIO }) {
  const k = kr && typeof kr.close === "number" ? kr.close : null;
  if (!(adrPrice > 0) || !(fx > 0) || !(k > 0)) throw new Error("환산 값 부족");
  const krw = Math.round(adrPrice * ratio * fx), prem = round2((krw / k - 1) * 100);
  const h = [...(Array.isArray(hist) ? hist : []).filter((x) => Array.isArray(x) && x[0] !== date && typeof x[1] === "number"), [date, prem]].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-ADR_HIST);
  return { fx: round2(fx), krw, kr: k, krHow: kr.how, prem, hist: h, avg: round2(h.reduce((s, x) => s + x[1], 0) / h.length), n: h.length };
}
// SKHY 괴리 이력 합치기 (게이트 권고 ⑥): 앞 목록이 우선(같은 날짜는 앞 것) · 날짜순 · 최근 max 개
export function mergeHist(lists, max = ADR_HIST) { const m = new Map(); for (const l of lists || []) for (const x of l || []) if (Array.isArray(x) && typeof x[1] === "number" && !m.has(x[0])) m.set(x[0], x); return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-max); }
export async function collectMorning({ sources, themes, adapters, now = new Date(), prevThemes = null, holidays = [], date = null, listings = null, adr = null }) {
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
        out.signals[k] = Object.assign({}, out.signals[k] || {}, { value: c.value, src: "yahoo", time: c.to, detail: Object.assign({}, (out.signals[k] || {}).detail || {}, { cum: { from: c.from, to: c.to, single }, price: c.price, prev: c.prev }) }); // price/prev = 누적 기준 수준값 (9.29-87 원장 [1652])
        out.gap.from = c.from; out.gap.to = c.to;
        if (k === "ust" && c.level !== undefined) out.signals.ustlvl = { value: c.level, src: "yahoo", time: c.to, detail: { asOf: c.to } }; // 금리 수준도 같은 날(최근 미국 종가) 기준
      } catch (e) { out.errors.push(k + " 연휴 누적: " + (e.message || e)); }
    }
  }
  const stale = staleCheck(out.signals, expectedUs);
  if (Object.keys(stale).length) out.stale = stale;
  // SK하이닉스 ADR(SKHY) 환산·괴리 (9.29-97 원장 [1783][1784]): ADR 10주 = 보통주 1주 · 환율 = 방금 받은 fx 수준값 · 한국 SK하이닉스 전일 종가(요청 1) · 최근 20일 괴리 이력은 지난 파일에서 이어 받음(요청 0) · 실패하면 환산만 빠짐(등락률은 그대로)
  if (adr && out.signals.skhy && out.signals.skhy.detail && typeof out.signals.skhy.detail.price === "number") {
    try {
      const fx = out.signals.fx && out.signals.fx.detail && typeof out.signals.fx.detail.price === "number" ? out.signals.fx.detail.price : null;
      if (fx === null) throw new Error("환율 없음");
      const kr = await adr.krClose();
      Object.assign(out.signals.skhy.detail, adrPremium({ adrPrice: out.signals.skhy.detail.price, fx, kr, hist: adr.hist || [], date: today }));
    } catch (e) { out.errors.push("skhy 환산: " + (e.message || e)); }
  }
  if (prevThemes) {
    try { const p = await prevThemes(out); out.prev = p.themes; out.prevRaw = p.raw; } // out.us(방금 받은 미국 테마 값)으로 gapWarn 계산
    catch (e) { out.errors.push("prev: " + (e.message || e)); }
  }
  if (listings) { try { out.listings = await listings(); } catch (e) { out.errors.push("신규상장: " + (e.message || e)); } } // 다음 거래일 신규 상장 (9.29-76 원장 [1500]) · 실패해도 다른 값은 그대로
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
  try { const q = await adapters.naver.quote("domestic:KOSPI"); out.kospi = Number(((q.price / q.prevClose - 1) * 100).toFixed(2)); out.kospiLv = { close: round2(q.price), prev: round2(q.prevClose) }; } catch (e) { out.errors.push("코스피: " + (e.message || e)); } // kospiLv = 장중 지수·전일 종가 → 앱 「코스피 6,941.39 ▼62.35 (-0.89%)」 (9.29-87 원장 [1652]) · 2자리 반올림(9.29-96 원장 [1769]: 네이버 전일 종가 = 종가 − 전일대비 라 6941.389999999999 꼬리)
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
  return { code: x.itemCode, name: x.stockName, rate: num(x.fluctuationsRatio), value: raw === null ? null : round2(raw / 1e8), price: num(x.closePrice), prev: prevCloseOf(x) };
});
// 종목 전일 종가 = 현재가 − 전일 대비(네이버 compareToPreviousClosePrice 는 부호 없이 오고 방향은 compareToPreviousPrice) → 앱 「현재가 ▲전일대비 (+%)」 (9.29-87 원장 [1656]) · 못 구하면 null
export function prevCloseOf(x) {
  const price = num(x && x.closePrice), chg = num(x && x.compareToPreviousClosePrice), dir = x && x.compareToPreviousPrice;
  if (price === null || chg === null) return null;
  const falling = !!dir && (dir.name === "FALLING" || dir.name === "LOWER_LIMIT" || dir.code === "5" || dir.code === "4");
  return price - (falling && chg > 0 ? -chg : chg);
}
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
  const rawBars = {}; // 확정 run 에서 받은 일봉 원본 (종목코드 → 네이버 응답) — 앱 차트용 auto/candles 저장에 다시 씀 (9.29-76 원장 [1502])
  if (chart) {
    cands.sort(compareThemes);
    for (const t of cands.slice(0, CHART_TOP)) { // 일봉: 상위 6테마 × 대장·2등 = 12회
      const cs = [];
      for (const s of t.slots.slice(0, CHART_STOCKS)) {
        try { const raw = await get(chartUrl(s.code, today)); if (!provisional) rawBars[s.code] = raw;
          const c = gradeC(provisional ? withToday(raw, today, s.price) : raw, { vToday: s.value, T }); cs.push(c); if (c) s.chart = { grade: c.grade, tag: c.tag }; } catch (e) { cs.push(null); }
      }
      t.chart = { lead: cs[0] || null, second: cs[1] || null };
      if (cs[0]) chartReady = true;
      t.grades.C = cs[0] ? cs[0].grade : 1; t.score = scoreTheme(t.grades);
    }
  }
  cands.sort(compareThemes);
  const candidates = dedupeThemes(cands);
  return Object.defineProperty({ themes: candidates.slice(0, n), candidates, T, relaxed, flowReady, chartReady, provisional: !!provisional, kospiRate, amount, all }, "rawBars", { value: rawBars, enumerable: false });
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
    const sel = await selectThemes({ get, n: 3, bizdate, kospi, provisional: true }); // 아침 9시 전 = 어제 마감 기준 (수급·일봉 없이 잠정)
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
// kosdaq · shadow (9.29-84): shadow = { bars(code), rvolCache, prevNames, hm } 를 넘기면 같은 응답(memoGet)으로 그림자 선정 V2 를 같이 계산해 res.shadow 에 둔다. get 을 넘기면 그 요청 함수를 쓴다(collectLive 가 뉴스와 공유)
export async function collectLeaders({ fetchImpl = fetch, timeoutMs = 10000, now = new Date(), bizdate = null, kospi = null, kosdaq = null, us = null, history = [], provisional = false, chart = !provisional, date = null, n = 3, shadow = null, get = null } = {}) {
  const raw = get || (async (u) => { const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  const g = shadow ? (raw.count ? raw : memoGet(raw)) : raw;
  // 종목 수급은 그 날 값만. 네이버 종목별 외인·기관은 늦게(저녁~다음 날 아침) 올라와서, 16:20 잠정 run 은 요청을 생략하고 18:40 확정 run·다음 날 아침 백필이 채운다
  const day = date || kstDate(now);
  const sel = await selectThemes({ get: g, n, bizdate: bizdate || day.replace(/-/g, ""), kospi, us, history, provisional, chart, date: day });
  const themes = sel.themes.map(slim), candidates = sel.candidates.map(slim);
  // 관망(거래대금)과 주도 약함(1위 L ≤ 1)은 별개 배지 — 둘 다면 "관망·약함", weakLead 도 따로 둔다
  const weakLead = !!(themes[0] && themes[0].grades && themes[0].grades.L <= 1);
  const regime = [regimeOf(sel.amount, history), weakLead ? "약함" : ""].filter(Boolean).join("·");
  const res = { text: leadersText(sel.themes, sel.T), flowReady: sel.flowReady, chartReady: sel.chartReady, provisional: sel.provisional, T: sel.T, regime, weakLead: weakLead || undefined, relaxed: sel.relaxed || undefined, kospiRate: sel.kospiRate, decidedAt: now.getTime(), themes, candidates, all: sel.all };
  if (shadow) { // 그림자 V2 (실패해도 현행 결과는 그대로)
    const before = g.count();
    try {
      const v2 = await selectThemesV2({ get: g, n, kospi, kosdaq, hm: shadow.hm ?? null, date: day, bizdate: bizdate || day.replace(/-/g, ""), bars: shadow.bars || null, rvolCache: shadow.rvolCache || null, prevNames: shadow.prevNames || [], extraCodes: sel.themes.flatMap((t) => (t.slots || []).slice(0, 3).map((s) => s.code)), provisional, chart, pool: shadow.pool, scan: shadow.scan });
      v2.requests = Object.assign(v2.requests || {}, { naver: g.count() - before });
      res.shadow = v2;
    } catch (e) { res.shadow = { v: 1, error: String((e && e.message) || e) }; }
  }
  return Object.defineProperty(res, "rawBars", { value: sel.rawBars || {}, enumerable: false }); // 저장 파일에는 안 들어감 (숨은 속성)
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
// shadow · news2 (9.29-84 원장 [1597]): shadow = { bars, rvolCache, prevNames } → out.shadow(그림자 순위·RVOL·TOP10 제외) + 현행 3테마 슬롯에 rvol · news2 = { prevDate, cache, budget } → 테마마다 row.news2(검증 뉴스) + out.news2(캐시·상한). 둘 다 없으면 예전과 같다
export async function collectLive({ adapters, fetchImpl = fetch, now = new Date(), timeoutMs = 10000, us = null, history = [], date = null, n = 3, shadow = null, news2 = null } = {}) {
  const day = date || kstDate(now), out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), date: day, errors: [] };
  const get0 = async (u) => { const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
  const get = shadow || news2 ? memoGet(get0) : get0;
  const getText = async (u) => { const r = await fetchImpl(u, { headers: { Accept: "application/rss+xml, text/xml, text/html", "User-Agent": NV_HEAD["User-Agent"] }, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); };
  const post = async (u, body) => { const r = await fetchImpl(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html", "User-Agent": NV_HEAD["User-Agent"] }, body, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); };
  try { const q = await adapters.naver.quote("domestic:KOSPI"); out.kospi = { value: Number(((q.price / q.prevClose - 1) * 100).toFixed(2)), close: round2(q.price), prev: round2(q.prevClose), amount: q.amount || undefined, time: q.time || undefined }; } catch (e) { out.errors.push("코스피: " + (e.message || e)); } // prev = 전일 종가 (장중에 close 가 바뀌어도 그대로) → 앱 「코스피 6,941.39 ▼62.35 (-0.89%)」 (9.29-87 원장 [1652]) · close·prev 2자리 반올림(9.29-96 원장 [1769] 「6,803.900000000000」 꼬리)
  try { const k = parseTrend(await get("https://m.stock.naver.com/api/index/KOSPI/trend")); out.invest = { foreign: k.foreign, institution: k.institution, bizdate: k.bizdate }; } catch (e) { out.errors.push("현물 수급: " + (e.message || e)); }
  try { out.program = await fetchProgram(fetchImpl, { timeoutMs }); } catch (e) { out.errors.push("프로그램: " + (e.message || e)); }
  // 코스닥도 같은 방식 (9.29-69 사용자 요청): 등락·거래대금 · 외인/기관(장중 누적) · 프로그램
  try { const q = await adapters.naver.quote("domestic:KOSDAQ"); out.kosdaq = { value: Number(((q.price / q.prevClose - 1) * 100).toFixed(2)), close: round2(q.price), prev: round2(q.prevClose), amount: q.amount || undefined, time: q.time || undefined }; } catch (e) { out.errors.push("코스닥: " + (e.message || e)); }
  try { const k = parseTrend(await get("https://m.stock.naver.com/api/index/KOSDAQ/trend")); out.investQ = { foreign: k.foreign, institution: k.institution, bizdate: k.bizdate }; } catch (e) { out.errors.push("코스닥 수급: " + (e.message || e)); }
  try { out.programQ = await fetchProgram(fetchImpl, { code: "KOSDAQ", timeoutMs }); } catch (e) { out.errors.push("코스닥 프로그램: " + (e.message || e)); }
  try {
    const L = await collectLeaders({ fetchImpl, timeoutMs, now, date: day, kospi: out.kospi || null, kosdaq: out.kosdaq || null, us, history, provisional: true, chart: true, n, get, shadow: shadow ? Object.assign({ hm: out.at }, shadow) : null }); // 장중: 수급(F)만 빼고 C 차트 자리까지 사용자 규칙대로
    out.chartReady = !!L.chartReady; out.T = L.T; out.regime = L.regime; out.relaxed = L.relaxed; out.text = L.text; out.candidates = (L.candidates || []).map((t) => ({ name: t.name, score: t.score, alias: t.alias || [], stocks: (t.slots || []).map((s) => s.code) }));
    if (L.shadow) out.shadow = L.shadow;
    const bizdate = day.replace(/-/g, "");
    const n2 = news2 ? { cache: news2.cache || null, budget: news2.budget || null, shared: {}, requests: 0, errors: [] } : null;
    out.themes = [];
    for (const t of L.themes.slice(0, n)) {
      const row = { no: t.no, name: t.name, alias: t.alias || [], rate: t.rate, excess: t.excess, value: t.value, hot: t.hot, hotN: t.hotN, grades: t.grades, score: t.score, us: t.us, breadth: t.breadth, stocks: t.stocks, slots: (t.slots || []).slice(0, 3).map((s) => ({ code: s.code, name: s.name, rate: s.rate, value: s.value, price: s.price, ...(typeof s.prev === "number" ? { prev: s.prev } : {}), ...(s.chart ? { chart: s.chart } : {}) })), news: [] }; // prev = 종목 전일 종가 (9.29-87 원장 [1656])
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
      // 뉴스 v2 (9.29-84): 검증 뉴스 3건 — 종목뉴스는 위와 같은 주소(memoGet)라 추가 요청 0 · 검색 2 · 공시는 run 당 1회씩 공유. 실패해도 row.news 는 그대로
      if (n2) {
        try {
          let detail = null; try { detail = await get("https://m.stock.naver.com/api/stocks/theme/" + t.no + "?page=1&pageSize=100"); } catch (e) {}
          const r2 = await fetchNews2({ get, getText, post, theme: { no: t.no, name: t.name, alias: t.alias || [], slots: t.slots || [] }, detail, date: day, prevDate: news2.prevDate || null, hm: out.at, cache: n2.cache, shared: n2.shared, budget: n2.budget });
          n2.cache = r2.cache; n2.budget = r2.budget; n2.requests += r2.requests; n2.errors.push(...r2.errors);
          row.news2 = { v: r2.v, n: r2.n, label: r2.label, mismatch: r2.mismatch, reason: r2.reason, verified: r2.verified, candidates: r2.candidates, industry: r2.industry, words: r2.words, items: r2.items, signals: r2.signals || [] };
        } catch (e) { n2.errors.push(t.name + ": " + (e.message || e)); }
      }
      out.themes.push(row);
    }
    if (out.shadow) attachRvol(out.themes, out.shadow); // 현행 3테마 주요 종목에도 RVOL(평소 대비 배수) 병기 — 원장 [1596] 권장안 ⑧
    if (n2) out.news2 = { v: 1, cache: n2.cache, budget: n2.budget, requests: n2.requests, errors: n2.errors.slice(0, 12) };
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
  if (cur && cur.provisional && old.leaders && !old.leaders.provisional) { m.leaders = old.leaders; m.leadersProvisional = cur; if (oldClose.shadow) part.shadow = oldClose.shadow; } // 그림자도 확정 run 것 유지 (9.29-84)
  else if (old.leaders && old.leaders.provisional && cur && !cur.provisional) m.leadersProvisional = old.leaders;
  else if (old.leadersProvisional && !(cur && cur.provisional)) m.leadersProvisional = old.leadersProvisional;
  if (!part.themes && oldClose && oldClose.themes) part.themes = oldClose.themes;
  if (!part.watch && oldClose && oldClose.watch) part.watch = oldClose.watch; // 관심 후보(9.29-97 · 확정 run 만 계산)는 늦게 온 잠정 run 이 지우지 않게
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

// ---- 「오후 4시 기준」 묶음 (9.29-87 원장 [1662][1664][1665][1666]): 16:00 KST run(--when=close1600 · collect.yml cron "0 7 * * 1-5") 이 미국 선물 4종·코스피200 선물(주간 마감)·원달러 환율·WTI·비트코인의
//  값·전일 종가·전일 대비·등락률·기준 시각을 날짜 파일 「장마감_1600」 에 저장 → 앱·복사 글 ② 장 마감 「• 오후 4시 기준」 (없으면 「(4시 자료 없음)」 · 지어내기 0) ----
//  원천: 미국 선물·환율·WTI = config/sources.json 그대로(네이버 → 야후) · 코스피200 선물 = 네이버 domestic:FUT(주간 마감가 · 전일 대비 부호 포함 · 실측 10/6 1,103.00 ▼10.20) · 비트코인 = 업비트 KRW-BTC(전일 종가 = 업비트 기준 00:00 UTC)
export const CLOSE_SNAP_KEY = "장마감_1600";
export const CLOSE_SNAP_ITEMS = [["fut", "나스닥100 선물"], ["es", "S&P500 선물"], ["ym", "다우 선물"], ["rty", "러셀2000 선물"], ["k200d", "코스피200 선물"], ["fx", "원달러 환율"], ["oil", "WTI 유가"], ["btc", "비트코인"]];
export const CLOSE_SNAP_EXTRA = { k200d: [{ source: "naver", symbol: "domestic:FUT", kind: "pct" }], btc: [{ source: "upbit", symbol: "KRW-BTC", kind: "pct" }] };
export async function collectCloseSnap({ sources, adapters, now = new Date() }) {
  const signals = {};
  for (const [k] of CLOSE_SNAP_ITEMS) { const c = CLOSE_SNAP_EXTRA[k] || ((sources && sources.signals) || {})[k]; if (c) signals[k] = c; }
  const got = await collectAll({ sources: { signals, themeSource: [] }, themes: { themes: [] }, adapters, now });
  const out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), items: {}, errors: got.errors.map((e) => e.key + ": " + e.error) };
  for (const [k, v] of Object.entries(got.signals)) {
    const d = v.detail || {};
    if (typeof d.price !== "number" || typeof d.prev !== "number" || d.prev === 0) { out.errors.push(k + ": 수준값 없음"); continue; }
    out.items[k] = { price: d.price, prev: d.prev, change: Number((d.price - d.prev).toFixed(4)), pct: Number(((d.price / d.prev - 1) * 100).toFixed(2)), src: v.src, time: v.time || undefined };
  }
  for (const [k] of CLOSE_SNAP_ITEMS) if (!signals[k]) out.errors.push(k + ": 원천 없음");
  return out;
}

// 오후: 코스피·코스닥 마감 등락률 + 투자자별 수급 (네이버)
export async function collectClose({ adapters, fetchImpl = fetch, now = new Date(), timeoutMs = 10000, leaders = null, listings = null, candles = null, saveCandles = CANDLE_SAVE }) {
  const out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), market: {}, errors: [] };
  const inv = {};
  for (const k of ["kospi", "kosdaq"]) {
    const code = k.toUpperCase();
    try {
      const q = await adapters.naver.quote("domestic:" + code);
      out.market[k] = { value: Number(((q.price / q.prevClose - 1) * 100).toFixed(2)), close: q.price, change: Number((q.price - q.prevClose).toFixed(2)), amount: q.amount || undefined, src: "naver", time: q.time || undefined }; // change = 전일 대비(원) — 블로그 '코스피 7,003.74 ▲32.30 (+0.46%)' 용 (9.29-86 원장 [1624])
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
  try { out.market.programQ = await fetchProgram(fetchImpl, { code: "KOSDAQ", timeoutMs }); } catch (e) { out.errors.push("코스닥 프로그램: " + (e.message || e)); } // 블로그 수급 줄 (9.29-74)
  try { out.market.program = await fetchProgram(fetchImpl, { timeoutMs }); } catch (e) { out.errors.push("프로그램: " + (e.message || e)); } // 마감 프로그램 순매수(억) → 장 흐름 문장·프로그램 칸
  if (leaders) {
    try {
      const l = await leaders(out.market); // 코스피 등락률·거래대금(T·초과수익 게이트) 을 넘긴다
      if (l && l.all) { out.themes = l.all; delete l.all; } // 테마 100개 compact 는 close.themes 에 (지속일수 D · 다음 날 정답표)
      if (l && l.shadow) { out.shadow = l.shadow; delete l.shadow; } // 그림자 V2 (9.29-84) 는 close.shadow 에 — leaders 블록은 무변경
      if (l && l.text !== undefined) out.market.leaders = l;
      if (candles && saveCandles && l && l.text !== undefined && !l.provisional) { // 앱 차트용 일봉 (확정 run 만 · 9.29-76 원장 [1502] · 9.29-77 부터 기본 꺼짐 CANDLE_SAVE) — 날짜 파일에는 안 넣고 숨은 속성으로 넘김 → collect-auto 가 auto/candles/<코드>.json 으로 저장
        try { const c = await candles(l, l.rawBars || {}); Object.defineProperty(out, "candles", { value: c.candles || {}, enumerable: false }); (c.errors || []).forEach((e) => out.errors.push(e)); }
        catch (e) { out.errors.push("일봉 저장: " + (e.message || e)); }
      }
    } catch (e) { out.errors.push("주도 테마: " + (e.message || e)); }
  }
  if (listings) { try { out.listings = await listings(); } catch (e) { out.errors.push("신규상장: " + (e.message || e)); } } // 다음 거래일 신규 상장 (9.29-76 원장 [1500])
  return out;
}

// ---- 앱 차트용 일봉 (9.29-76 원장 [1502]): 오늘 주도 테마 슬롯 종목 + 아침 전일 주도 테마 종목 → auto/candles/<코드>.json { code, name, date, bars:[{ date, o, h, l, c, v }] } (최근 120봉)
// 확정 run 이 C 등급 계산에 이미 받은 일봉(rawBars)을 다시 쓰고, 없는 종목만 새로 받는다 (최대 CANDLE_MAX 종목)
export const CANDLE_N = 120, CANDLE_MAX = 30;
// 9.29-77 (원장 [1511] 디렉터 답 "중계 서버 생기면 끄기" · [1513]): 앱이 중계 서버(eden-chart.cmh-eden.workers.dev)에서 아무 종목 일봉을 직접 받으므로
// 마감 확정 수집의 주도주 일봉 따로 저장(auto/candles 쓰기)은 기본 꺼짐. 코드 경로는 남김(true 로 바꾸면 다시 저장) · C 등급 계산용 일봉 받기는 그대로 · 이미 저장된 candles 파일은 앱의 대체 경로로 그대로 둠
export const CANDLE_SAVE = false;
export const candleFile = (code) => AUTO_DIR + "/candles/" + code + ".json";
export function candleRows(raw, n = CANDLE_N) {
  const d8 = (s) => { const x = String(s || ""); return /^\d{8}$/.test(x) ? x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6, 8) : /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null; };
  const rows = (Array.isArray(raw) ? raw : []).map((b) => ({ date: d8(b && b.localDate), o: num(b && b.openPrice), h: num(b && b.highPrice), l: num(b && b.lowPrice), c: num(b && b.closePrice), v: num(b && b.accumulatedTradingVolume) }))
    .filter((r) => r.date && r.o !== null && r.h !== null && r.l !== null && r.c !== null).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const seen = new Set(), uniq = []; for (const r of rows) { if (seen.has(r.date)) continue; seen.add(r.date); uniq.push(r); }
  return uniq.slice(-n);
}
// 저장할 종목: 오늘 주도 테마(themes) 슬롯 코드 → 아침 전일 주도 테마(morning.prev) 종목 코드 순, 6자리 숫자만, 같은 종목 한 번
export function candleCodes(leaders, morning, max = CANDLE_MAX) {
  const out = new Map(), add = (code, name) => { const c = String(code || "").trim(); if (/^\d{6}$/.test(c) && !out.has(c) && out.size < max) out.set(c, String(name || "").trim()); };
  ((leaders && leaders.themes) || []).forEach((t) => ((t && t.slots) || []).forEach((s) => s && add(s.code, s.name)));
  ((morning && morning.prev) || []).forEach((t) => ((t && t.stocks) || []).forEach((s) => s && add(s.code, s.name)));
  return [...out].map(([code, name]) => ({ code, name }));
}
export async function collectCandles({ fetchImpl = fetch, timeoutMs = 10000, date, leaders = null, morning = null, cache = {} } = {}) {
  const get = async (u) => { const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
  const candles = {}, errors = []; let fetched = 0;
  for (const { code, name } of candleCodes(leaders, morning)) {
    try {
      const raw = cache[code] || (fetched++, await get(chartUrl(code, date)));
      const bars = candleRows(raw);
      if (bars.length) candles[code] = { code, name, date, bars }; else errors.push("일봉 " + code + ": 봉 없음");
    } catch (e) { errors.push("일봉 " + code + ": " + (e.message || e)); }
  }
  return { candles, errors, fetched };
}

// ---- 신규 상장 예정 (9.29-76 원장 [1500]): 네이버 증권 공모주 '상장대기'·'청약중' 목록 (로그인 없이 읽힘 · 같은 m.stock.naver.com 이라 Actions 에서도 다른 수집과 같은 길)
// 응답 ipoList[]: compName(종목명) · marketType(코스피/코스닥/코넥스) · fixPubPrice(확정 공모가, 없으면 null) · lcalDate(상장일 YYYY-MM-DD) · ipoCode("A179880")
export const IPO_URL = (type) => "https://m.stock.naver.com/front-api/ipo/progress?progressType=" + type + "&page=1&pageSize=50";
// 여러 응답을 합쳐 today 뒤에 상장하는 종목만 날짜순으로 (같은 종목은 한 번) — 공모가가 아직 없으면 지어내지 않고 null
export function parseListings(jsons, today = null) {
  const seen = new Set(), items = [];
  for (const j of jsons) {
    const list = (j && j.result && Array.isArray(j.result.ipoList)) ? j.result.ipoList : [];
    for (const x of list) {
      const d = String((x && x.lcalDate) || ""), name = String((x && x.compName) || "").trim();
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(d) || (today && d <= today)) continue;
      const key = x.ipoCode || name; if (seen.has(key)) continue; seen.add(key);
      items.push({ name, market: String(x.marketType || "").trim(), price: num(x.fixPubPrice), date: d, code: String(x.ipoCode || "").replace(/^A/, "") });
    }
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
export async function fetchListings(fetchImpl = fetch, { today = null, timeoutMs = 10000 } = {}) {
  const get = async (type) => {
    const res = await fetchImpl(IPO_URL(type), { headers: { Accept: "application/json", Referer: "https://m.stock.naver.com/ipo", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    if (!j || j.isSuccess === false || !j.result) throw new Error("응답 이상" + (j && j.message ? ": " + j.message : ""));
    return j;
  };
  const js = [await get("listing-upcoming")]; // 상장대기 (청약 끝 · 상장일 확정) — 이것이 못 오면 실패로
  const sub = []; // 청약중 · 청약예정 (9.29-97 원장 [1779]: 10/12~13 엠에스바이오 청약이 「없음」 으로 나오던 것 — subscribing-upcoming 미수집)
  try { const j = await get("subscribing"); js.push(j); sub.push(j); } catch (e) {} // 청약중 (보통 상장은 1주 뒤라 다음 거래일엔 거의 없음 · 못 와도 됨)
  try { const j = await get("subscribing-upcoming"); js.push(j); sub.push(j); } catch (e) {} // 청약예정 (청약 시작 전 · 상장일 확정) — 못 와도 다른 값은 그대로
  const out = { src: "naver", items: parseListings(js, today) };
  if (sub.length) out.subs = parseSubs(sub, today); // 청약 응답을 하나라도 받았을 때만 (둘 다 실패면 subs 없음 → 앱은 지난 값 유지)
  return out;
}
// 청약 일정: 청약 시작~끝(poStartDate·poEndDate)이 있고 끝이 today 이후인 종목만 · 시작일 순 · 같은 종목 한 번 · 공모가 없으면 null (지어내기 0)
export function parseSubs(jsons, today = null) {
  const seen = new Set(), items = [], ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  for (const j of jsons) {
    const list = (j && j.result && Array.isArray(j.result.ipoList)) ? j.result.ipoList : [];
    for (const x of list) {
      const name = String((x && x.compName) || "").trim(), from = x && x.poStartDate, to = x && x.poEndDate;
      if (!name || !ok(from) || !ok(to) || (today && to < today)) continue;
      const key = x.ipoCode || name; if (seen.has(key)) continue; seen.add(key);
      items.push({ name, market: String(x.marketType || "").trim(), price: num(x.fixPubPrice), from, to, list: ok(x.lcalDate) ? x.lcalDate : null, code: String(x.ipoCode || "").replace(/^A/, "") });
    }
  }
  return items.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
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
    if (m.listings) lines.push(`아침 ${m.at} 신규상장 예정 ${(m.listings.items || []).map((x) => x.date.slice(5) + " " + x.name + "(" + x.market + ")").join(" · ") || "없음"}`);
    (m.errors || []).forEach((e) => lines.push("아침 실패 " + e));
  }
  const it = rec.intraday;
  if (it) lines.push(`장중 ${it.at} 코스피 ${it.kospi ?? "—"}% · 외인 선물 ${it.fut ? it.fut.foreign : "—"} · 현물 외인 ${it.spot ? it.spot.foreign : "—"}억 · 기관 ${it.spot ? it.spot.institution : "—"}억`);
  if (c) {
    ["kospi", "kosdaq"].forEach((k) => { const v = c.market && c.market[k]; if (v) lines.push(`오후 ${c.at} ${k.padEnd(6)} ${String(v.value).padStart(7)}%  종가 ${v.close}`); });
    if (c.market && c.market.invest) lines.push(`오후 ${c.at} 수급 ${c.market.invest.text}`);
    if (c.market && c.market.leaders) { const L = c.market.leaders; lines.push(`오후 ${c.at} 주도 테마${L.provisional ? "(잠정)" : ""}${L.T ? " T=" + L.T + "억" : ""}${L.regime ? " · " + L.regime : ""}${L.relaxed ? " · 조건 미달·참고용" : ""} ${L.text || "없음"}`); }
    if (c.listings) lines.push(`오후 ${c.at} 신규상장 예정 ${(c.listings.items || []).map((x) => x.date.slice(5) + " " + x.name + "(" + x.market + ")").join(" · ") || "없음"}`);
    (c.errors || []).forEach((e) => lines.push("오후 실패 " + e));
  }
  return lines.join("\n");
}

// ---- 관찰 기록: 급락일 외국인·기관 동반 매수 (9.29-82 원장 [1556] "관찰 기록만 시작" · [1558] "400종목으로 넓히기" · docs/flow-research-2026-10-01.md 해석 3 · 형식 docs/observe-crash-cobuy.md) ----
// 기록만 한다 — 앱 화면·판정·점수·주도 테마 선정에는 안 쓴다 (날짜 파일 auto/<날짜>.json 도 그대로). 마감 확정 run(19:45 · 20:20)에서 collect-auto.mjs 가 auto/observe/ 에 쌓는다.
//  신호 = 그날 등락률 ≤ −3% (반올림 전 정수 비교) · 외국인 순매수 > 0 · 기관 순매수 > 0 (주식 수 기준)
//  대상 = 연구 R2 와 같은 400종목: 코스피 시총 상위 200 · 코스닥 시총 상위 150 · 코스닥 151~500위 중 최근 20거래일 평균 거래대금 상위 50 · 보통주만(ETF·ETN·우선주·리츠 제외)
//         목록은 auto/observe/universe.json 에 두고 7일마다 다시 만든다 (시총 순위 10회 + 코스닥 151~500위 거래대금 350회)
//  결과 = 신호일 종가 기준 다음날·3일·5일 종가 수익률 · 같은 날짜 KODEX200(069500) 수익률 · 초과 · 다음날 +3% 이상 — 네이버 거래일 행으로 세서 휴장일은 저절로 건너뜀
export const OBS_FILE = AUTO_DIR + "/observe/crash-cobuy.json", OBS_UNIVERSE_FILE = AUTO_DIR + "/observe/universe.json";
export const OBS_CRASH = -3, OBS_KODEX = "069500", OBS_PAGE = 20, OBS_DET_PAGE = 5, OBS_MAX_SIGNALS = 1500, OBS_MAX_DAYS = 260, OBS_EXPIRE_DAYS = 30, OBS_HORIZONS = [1, 3, 5];
export const OBS_UNIVERSE_DAYS = 7, OBS_N_KOSPI = 200, OBS_N_KOSDAQ = 150, OBS_POOL_END = 500, OBS_N_SMALL = 50, OBS_TURNOVER_DAYS = 20;
export const OBS_CONC = 2, OBS_GAP_MS = 150, OBS_BUDGET_MS = 240000, OBS_REBUILD_MS = 120000; // 동시 2개 · 요청 사이 0.15초 · 관찰 전체 4분(목록 다시 만들기는 그중 2분까지) — Actions 10분 제한 안
export const OBS_RULE = "등락률 <= -3% · 외국인 순매수 > 0 · 기관 순매수 > 0 (docs/flow-research-2026-10-01.md)";
export const OBS_UNIVERSE_RULE = "코스피 시총 상위 200 · 코스닥 시총 상위 150 · 코스닥 151~500위 중 20거래일 평균 거래대금 상위 50 · 보통주만(ETF·ETN·우선주·리츠 제외) — 연구 R2 08·10번";
export const obsTrendUrl = (code, n = OBS_PAGE) => "https://m.stock.naver.com/api/stock/" + code + "/trend?pageSize=" + n; // bizdate 를 붙이면 맨 앞 행 종가가 "-" 로 와서 안 씀 (10/5 실측)
export const obsRankUrl = (market, page) => "https://m.stock.naver.com/api/stocks/marketValue/" + market + "?page=" + page + "&pageSize=100";
const dashDate = (s) => { const t = String(s || ""); return /^\d{8}$/.test(t) ? t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6) : null; };
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
// 네이버 종목 일별 수급 행(최근 먼저) → 오래된 순 [{ date, close, rate %(반올림), crash(반올림 전 정수 비교), fq·oq 주식 수, foreign·inst 억, value 억 }] — 종가 없는 행은 뺌
export function trendRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const o = r || {}, date = dashDate(o.bizdate), close = num(o.closePrice), fq = num(o.foreignerPureBuyQuant), oq = num(o.organPureBuyQuant), vol = num(o.accumulatedTradingVolume);
    let cmp = num(o.compareToPreviousClosePrice); const dir = String((o.compareToPreviousPrice && o.compareToPreviousPrice.name) || "");
    if (cmp !== null && cmp > 0 && /FALL|LOWER/.test(dir)) cmp = -cmp; // 하락인데 부호 없이 오는 경우 대비
    const base = close !== null && cmp !== null ? close - cmp : null;
    return { date, close, rate: base > 0 ? round2((cmp / base) * 100) : null, crash: base > 0 ? cmp * 100 <= OBS_CRASH * base : null, // 100×(종가−전일) ≤ −3×전일 — 반올림·소수 오차 없이 −3.00% 포함
      fq, oq, foreign: fq !== null && close ? Math.round((fq * close) / 1e8) : null, inst: oq !== null && close ? Math.round((oq * close) / 1e8) : null, value: vol !== null && close ? round2((vol * close) / 1e8) : null, vol };
  }).filter((r) => r.date && r.close !== null && r.close > 0).sort(byDate);
}
// 신호 판정: crash(반올림 전) 가 있으면 그것, 없으면 rate. 수급은 주식 수 fq·oq 가 있으면 그것, 없으면 억 단위 foreign·inst
export function isCrashCobuy(r) {
  if (!r) return false;
  const down = typeof r.crash === "boolean" ? r.crash : typeof r.rate === "number" && r.rate <= OBS_CRASH;
  const f = typeof r.fq === "number" ? r.fq : r.foreign, o = typeof r.oq === "number" ? r.oq : r.inst;
  return down && typeof f === "number" && f > 0 && typeof o === "number" && o > 0;
}
// ---- 대상 400종목 목록 (주 1회) ----
const PREF_RE = /.+[0-9]?우(B)?$/; // 우선주 이름 (연구 R2 08번: 삼성전자우 · 현대차2우B …) — 보통주 "성우"(458650)도 걸려서 코드 끝자리(보통주 0 · 우선주 5·7·K …)도 같이 봄 (10/5 실측)
const REIT_RE = /(^|[^메])리츠/;     // 리츠 (SK리츠 · 이리츠코크렙 …) — 메리츠금융지주 · 메리츠증권 은 보통주라 뺌
export function obsExcluded(s) {
  if (!s || String(s.stockEndType || "") !== "stock") return "etf_etn";
  const name = String(s.stockName || "");
  if (PREF_RE.test(name) && !String(s.itemCode || "").endsWith("0")) return "preferred";
  if (REIT_RE.test(name)) return "reit";
  return null;
}
// 시총 순위 응답들(페이지 순) → 보통주만 순서 그대로 [{code, name}] + 뺀 목록
export function obsCommon(pages) {
  const out = [], excluded = { etf_etn: 0, preferred: [], reit: [] }, seen = new Set();
  for (const p of Array.isArray(pages) ? pages : []) for (const s of (p && Array.isArray(p.stocks) ? p.stocks : [])) {
    const code = String((s && s.itemCode) || ""); if (!code || seen.has(code)) continue; seen.add(code);
    const why = obsExcluded(s);
    if (why === "etf_etn") excluded.etf_etn++; else if (why) excluded[why].push(s.stockName); else out.push({ code, name: String(s.stockName || "") });
  }
  return { list: out, excluded };
}
// 20거래일 평균 거래대금(억) — trendRows 의 최근 20행 종가×거래량. 10행 미만이면 null (연구 R2 02번과 같음)
export function avgTurnover(rows, n = OBS_TURNOVER_DAYS) {
  const xs = (Array.isArray(rows) ? rows : []).filter((r) => typeof r.vol === "number" && r.close > 0).slice(-n);
  if (xs.length < 10) return null;
  return round2(xs.reduce((s, r) => s + (r.close * r.vol) / 1e8, 0) / xs.length);
}
// 목록 고르기: kospi·kosdaq = obsCommon().list · turnover = { code: 20일 평균 억 } → 400종목 [{code, name, market, bucket}]
export function obsPickUniverse(kospi, kosdaq, turnover = {}) {
  const k = (kospi || []).slice(0, OBS_N_KOSPI).map((s) => Object.assign({}, s, { market: "KOSPI", bucket: "KOSPI200" }));
  const q = (kosdaq || []).slice(0, OBS_N_KOSDAQ).map((s) => Object.assign({}, s, { market: "KOSDAQ", bucket: "KOSDAQ150" }));
  const pool = (kosdaq || []).slice(OBS_N_KOSDAQ, OBS_POOL_END).filter((s) => typeof turnover[s.code] === "number");
  const small = pool.sort((a, b) => turnover[b.code] - turnover[a.code]).slice(0, OBS_N_SMALL).map((s) => ({ code: s.code, name: s.name, market: "KOSDAQ", bucket: "KOSDAQ_SMALL", tv: turnover[s.code] }));
  return [...k, ...q, ...small];
}
export const obsUniverseStale = (u, date) => !(u && Array.isArray(u.stocks) && u.stocks.length && typeof u.builtAt === "string" && addDays(u.builtAt, OBS_UNIVERSE_DAYS) > date);
// 요청을 천천히: 동시 conc 개 · 한 요청 끝날 때마다 gapMs 쉼 · deadline(clock 기준) 넘으면 남은 것은 손대지 않고 돌려줌
export async function paced(items, fn, { conc = OBS_CONC, gapMs = OBS_GAP_MS, deadline = Infinity, clock = () => Date.now(), sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) } = {}) {
  const xs = Array.isArray(items) ? items : [], left = []; let i = 0;
  const worker = async () => { while (i < xs.length) { const it = xs[i++]; if (clock() > deadline) { left.push(it); continue; } await fn(it); if (gapMs > 0) await sleep(gapMs); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, xs.length)) }, worker));
  return left;
}
// 목록 다시 만들기: 시총 순위(코스피 3쪽 · 코스닥 7쪽 = 10회, 앞쪽 제외 종목 자리를 다음 순위로 채울 여유) → 코스닥 151~500위 350종목 20일 거래대금(350회).
// 코스피 200·코스닥 150 을 못 채우거나 거래대금을 300종목 넘게 못 받으면 실패(null) → 옛 목록 유지
export async function buildUniverse({ get, date, pace = {}, deadline = Infinity, clock = () => Date.now() }) {
  const errors = []; let requests = 0;
  const pages = async (market, n) => { const out = []; for (let p = 1; p <= n; p++) { if (clock() > deadline) { errors.push("시간 예산 넘음: 순위 " + market); break; } try { requests++; out.push(await get(obsRankUrl(market, p))); } catch (e) { errors.push("순위 " + market + " " + p + ": " + (e.message || e)); } if (pace.sleep && pace.gapMs) await pace.sleep(pace.gapMs); } return out; };
  const K = obsCommon(await pages("KOSPI", 3)), Q = obsCommon(await pages("KOSDAQ", 7));
  if (K.list.length < OBS_N_KOSPI || Q.list.length < OBS_N_KOSDAQ + 300) return { universe: null, requests, errors: [...errors, `순위 부족: 코스피 보통주 ${K.list.length} · 코스닥 ${Q.list.length}`] };
  const pool = Q.list.slice(OBS_N_KOSDAQ, OBS_POOL_END), turnover = {};
  const left = await paced(pool, async (s) => { try { requests++; const v = avgTurnover(trendRows(await get(obsTrendUrl(s.code, OBS_TURNOVER_DAYS)))); if (v !== null) turnover[s.code] = v; } catch (e) { errors.push("거래대금 " + s.code + ": " + (e.message || e)); } }, Object.assign({}, pace, { deadline, clock }));
  if (left.length) errors.push(`시간 예산 넘음: 거래대금 ${left.length}종목 못 받음`);
  const got = Object.keys(turnover).length;
  if (got < 300) return { universe: null, requests, errors: [...errors, `거래대금 부족: ${got}/${pool.length}`] };
  const stocks = obsPickUniverse(K.list, Q.list, turnover);
  return { universe: { app: "jangjeon-cockpit", kind: "observe-universe", v: 1, rule: OBS_UNIVERSE_RULE, builtAt: date, refreshDays: OBS_UNIVERSE_DAYS,
    counts: { KOSPI200: stocks.filter((s) => s.bucket === "KOSPI200").length, KOSDAQ150: stocks.filter((s) => s.bucket === "KOSDAQ150").length, KOSDAQ_SMALL: stocks.filter((s) => s.bucket === "KOSDAQ_SMALL").length, poolTurnover: got },
    excluded: { etf_etn: K.excluded.etf_etn + Q.excluded.etf_etn, preferred: [...K.excluded.preferred, ...Q.excluded.preferred], reit: [...K.excluded.reit, ...Q.excluded.reit] }, stocks }, requests, errors };
}
// ---- 그 날 판정 · 기록 합치기 · 결과 채우기 ----
// stocks = 이번에 볼 종목 [{code, name, bucket}] · rowsByCode[code] = trendRows() 결과(받기 실패면 null).
// 그 날 행이 없거나(휴장·아직 집계 전·거래정지) 수급 칸이 비거나 받기에 실패한 종목은 miss 로 돌려줌 → 같은 날 다음 run 이 그 종목만 다시
export function obsEvaluate(date, stocks, rowsByCode = {}) {
  let checked = 0, crashed = 0; const signals = [], crashList = [], miss = []; // crashList = 급락 종목 전부(출력용 · 기록 파일에는 안 넣음)
  for (const u of Array.isArray(stocks) ? stocks : []) {
    const rows = rowsByCode[u.code], r = Array.isArray(rows) ? rows.find((x) => x.date === date) : null;
    if (!r || r.fq === null || r.oq === null || typeof r.crash !== "boolean") { miss.push(u.code); continue; }
    checked++; if (r.crash) { crashed++; crashList.push({ code: u.code, name: u.name, rate: r.rate, foreign: r.foreign, inst: r.inst }); }
    if (!isCrashCobuy(r)) continue;
    const S = r.value > 0 && typeof r.foreign === "number" && typeof r.inst === "number" ? round2(((r.foreign + r.inst) / r.value) * 100) : null; // 참고: 강도 (외+기)/거래대금 % — 연구 표의 "이미 내림"은 S ≥ 1 도 걸었음
    signals.push({ date, code: u.code, name: u.name || "", bucket: u.bucket || "", close: r.close, rate: r.rate, foreign: r.foreign, inst: r.inst, S, d1: null, d3: null, d5: null, k1: null, k3: null, k5: null, x1: null, x3: null, x5: null, up3: null, dates: {}, done: false });
  }
  return { date, checked, crashed, signals, crashList, miss };
}
export const obsEmpty = () => ({ app: "jangjeon-cockpit", kind: "crash-cobuy", v: 2, rule: OBS_RULE, updatedAt: null, days: [], signals: [] });
const obsNorm = (f) => { const e = obsEmpty(); return f && typeof f === "object" ? Object.assign(e, f, { kind: e.kind, v: e.v, rule: OBS_RULE, days: Array.isArray(f.days) ? f.days.map((d) => Object.assign({}, d)) : [], signals: Array.isArray(f.signals) ? f.signals.slice() : [] }) : e; };
const OBS_OUT = ["close", "d1", "d3", "d5", "k1", "k3", "k5", "x1", "x3", "x5", "up3", "dates", "done", "miss"];
// 그 날 판정을 기록에 합친다 (target = 그날 대상 종목 수).
//  · 같은 날 처음: 날 줄 { date, at, target, checked, crashed, n, miss[] } 을 새로 만든다
//  · 같은 날 다음 run: 앞 run 이 못 받은 종목(miss)만 다시 본 결과를 더한다 — checked·crashed·n 은 더하고 miss 는 남은 것으로 바꿈. 이번에 하나도 못 셌으면 날 줄은 그대로(at 도 안 바뀜)
//  · 신호는 날짜+코드로 하나만 (이미 있는 코드는 앞 것 유지 · 채운 결과 칸 보존)
//  · 다른 날 줄의 miss 목록은 개수(missN)로 줄인다 — 파일 크기
export function obsMergeDay(file, ev, at = null, target = null) {
  const f = obsNorm(file);
  for (const d of f.days) if (d.date !== (ev && ev.date) && Array.isArray(d.miss)) { d.missN = d.miss.length; delete d.miss; }
  if (!ev) return f;
  const i = f.days.findIndex((d) => d.date === ev.date), cur = i >= 0 ? f.days[i] : null;
  if (!ev.checked) { if (cur) cur.miss = ev.miss.slice(); return f; } // 셈 0: 남은 목록만 (처음이면 날 줄도 안 만듦)
  const have = new Set(f.signals.filter((s) => s && s.date === ev.date).map((s) => s.code)), fresh = [];
  for (const s of ev.signals) if (!have.has(s.code)) { have.add(s.code); fresh.push(Object.assign({}, s)); }
  const day = cur ? Object.assign(cur, { at, checked: (cur.checked || 0) + ev.checked, crashed: (cur.crashed || 0) + ev.crashed, n: (cur.n || 0) + fresh.length, miss: ev.miss.slice() })
    : { date: ev.date, at, target: typeof target === "number" ? target : ev.checked + ev.miss.length, checked: ev.checked, crashed: ev.crashed, n: fresh.length, miss: ev.miss.slice() };
  if (!cur) f.days.push(day);
  f.days = f.days.sort(byDate).slice(-OBS_MAX_DAYS);
  f.signals = [...f.signals.filter(Boolean), ...fresh].sort((a, b) => byDate(a, b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)).slice(-OBS_MAX_SIGNALS);
  return f;
}
// 결과가 덜 찬 지난 신호 (오늘 신호는 다음 거래일부터)
export const obsPending = (file, date) => obsNorm(file).signals.filter((s) => s && !s.done && s.date < date);
// 한 신호의 결과 채우기: rows = 그 종목 trendRows · kodex = KODEX200 trendRows · today = 실행 날짜. 신호일 뒤 n번째 거래일 행 종가로 계산 (휴장일은 행이 없어 저절로 건너뜀)
//  5일까지 차고 KODEX 도 차면 done. 신호일이 받은 행 범위를 벗어난 채 OBS_EXPIRE_DAYS 가 지나면 done + miss (계속 요청하지 않게)
export function obsFill(sig, rows, kodex = null, today = null) {
  const s = Object.assign({}, sig, { dates: Object.assign({}, (sig && sig.dates) || {}) }), xs = Array.isArray(rows) ? rows : [], i = xs.findIndex((r) => r.date === s.date);
  const expired = !!(today && addDays(s.date, OBS_EXPIRE_DAYS) < today);
  if (i < 0) { if (expired && xs.length) { s.done = true; s.miss = "신호일 행 없음(기간 지남)"; } return s; }
  const base = typeof s.close === "number" && s.close > 0 ? s.close : xs[i].close; s.close = base;
  const ks = Array.isArray(kodex) ? kodex : [], ki = ks.findIndex((r) => r.date === s.date);
  for (const n of OBS_HORIZONS) {
    const r = xs[i + n]; if (!r) continue;
    if (typeof s["d" + n] !== "number") { s["d" + n] = round2((r.close / base - 1) * 100); s.dates["d" + n] = r.date; }
    const k = ki >= 0 ? ks.find((x) => x.date === r.date) : null; // 같은 날짜의 KODEX200 종가 (종목이 거래정지로 하루 빠져도 날짜로 맞춤)
    if (typeof s["k" + n] !== "number" && k) s["k" + n] = round2((k.close / ks[ki].close - 1) * 100);
    if (typeof s["d" + n] === "number" && typeof s["k" + n] === "number") s["x" + n] = round2(s["d" + n] - s["k" + n]);
  }
  if (typeof s.d1 === "number") s.up3 = s.d1 >= 3;
  if (typeof s.d5 === "number" && (typeof s.k5 === "number" || expired)) s.done = true;
  return s;
}
// 마감 확정 run 한 번:
//  ① 목록이 없거나 7일 지났으면 다시 만들기(최대 OBS_REBUILD_MS · 실패면 옛 목록 · 옛 목록도 없으면 이번엔 관찰 건너뜀)
//  ② 그날 수급: 오늘 날 줄이 없으면 목록 전부, 있으면 앞 run 이 못 받은 종목(miss)만 — 다 채운 날이면 요청 0
//  ③ 판정 → 기록에 합치기 → ④ 지난 신호 결과 채우기(덜 찬 종목마다 1회 + KODEX200 1회). 전체 OBS_BUDGET_MS 를 넘으면 남은 건 다음 run
export async function collectObserve({ fetchImpl = fetch, timeoutMs = 10000, date, universe = null, file = null, at = null, budgetMs = OBS_BUDGET_MS, rebuildMs = OBS_REBUILD_MS, conc = OBS_CONC, gapMs = OBS_GAP_MS, clock = () => Date.now(), sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) } = {}) {
  const get = async (u) => { const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
  const t0 = clock(), deadline = t0 + budgetMs, pace = { conc, gapMs, clock, sleep }, errors = [], cache = {}, req = { rebuild: 0, flow: 0, fill: 0 };
  let U = universe, rebuilt = null, msRebuild = 0;
  if (obsUniverseStale(universe, date)) {
    const b = await buildUniverse({ get, date, pace, deadline: Math.min(deadline, t0 + rebuildMs), clock });
    req.rebuild = b.requests; errors.push(...b.errors.slice(0, 5)); if (b.errors.length > 5) errors.push(`… ${b.errors.length - 5}건 더`);
    msRebuild = clock() - t0;
    if (b.universe) { U = b.universe; rebuilt = b.universe; } else errors.push("목록 다시 만들기 실패 — " + (universe ? "옛 목록(" + universe.builtAt + ") 그대로" : "목록 없음 · 이번 관찰 건너뜀"));
  }
  const f0 = obsNorm(file), stocks = U && Array.isArray(U.stocks) ? U.stocks : [];
  const day = f0.days.find((d) => d.date === date), byCode = new Map(stocks.map((s) => [s.code, s]));
  const todo = !stocks.length ? [] : day ? (Array.isArray(day.miss) ? day.miss : []).map((c) => byCode.get(c) || { code: c, name: "", bucket: "" }) : stocks;
  const rowsOf = async (code, n, kind) => {
    const key = code + ":" + n; if (key in cache) return cache[key];
    try { req[kind]++; cache[key] = trendRows(await get(obsTrendUrl(code, n))); } catch (e) { cache[key] = null; errors.push(code + ": " + (e.message || e)); }
    return cache[key];
  };
  const flowRows = {};
  const left = await paced(todo, async (s) => { flowRows[s.code] = await rowsOf(s.code, OBS_DET_PAGE, "flow"); }, Object.assign({}, pace, { deadline }));
  if (left.length) errors.push(`시간 예산 넘음: 수급 ${left.length}종목 다음 run 으로`);
  const ev = obsEvaluate(date, todo, flowRows);
  const f = obsMergeDay(f0, ev, at, stocks.length || null), pending = obsPending(f, date);
  let filled = 0;
  if (pending.length && clock() <= deadline) {
    const kodex = await rowsOf(OBS_KODEX, OBS_PAGE, "fill"), out = [];
    for (const s of f.signals) {
      if (!s || s.done || !(s.date < date) || clock() > deadline) { out.push(s); continue; }
      const rows = await rowsOf(s.code, OBS_PAGE, "fill"), n = rows ? obsFill(s, rows, kodex, date) : s;
      if (JSON.stringify(n) !== JSON.stringify(s)) filled++;
      out.push(n);
      if (gapMs > 0) await sleep(gapMs);
    }
    f.signals = out;
  }
  return { file: f, universe: rebuilt, used: U ? { builtAt: U.builtAt, n: stocks.length } : null, ev, todo: todo.length, skippedDay: !!(day && !todo.length), requests: req.rebuild + req.flow + req.fill, req, filled, pending: pending.length, errors, ms: clock() - t0, msRebuild };
}
export function obsText(res) {
  const ev = res.ev, u = res.used;
  const list = ev.signals.map((s) => `${s.name}(${s.code}) ${s.rate}% 외인 ${signed(s.foreign)} · 기관 ${signed(s.inst)}${s.S !== null ? " · S " + s.S + "%" : ""} [${s.bucket}]`);
  const nu = res.universe, made = nu ? ` [새 목록 코스피 ${nu.counts.KOSPI200} · 코스닥 ${nu.counts.KOSDAQ150} · 소형 ${nu.counts.KOSDAQ_SMALL} (거래대금 받은 ${nu.counts.poolTurnover}) · 뺌 ETF·ETN ${nu.excluded.etf_etn} · 우선주 ${nu.excluded.preferred.length} · 리츠 ${nu.excluded.reit.length}(${nu.excluded.reit.join("·")}) · ${(res.msRebuild / 1000).toFixed(1)}초]` : "";
  return `관찰(급락 ≤ -3% + 외인·기관 동반 매수) ${ev.date}: 목록 ${u ? u.n + "종목(" + u.builtAt + (nu ? " 새로 만듦" : "") + ")" : "없음"}${made}`
    + (res.skippedDay ? " · 오늘 이미 다 채움 — 수급 요청 0" : ` · 이번에 볼 ${res.todo} · 셈 ${ev.checked} · 못 받음 ${ev.miss.length} · 급락 ${ev.crashed} · 신호 ${ev.signals.length}`)
    + (list.length ? " — " + list.join(" / ") : "")
    + ((ev.crashList || []).length ? ` · 급락 종목 ${ev.crashList.length}: ${ev.crashList.slice(0, 40).map((c) => `${c.name} ${c.rate}% (외 ${signed(c.foreign)} 기 ${signed(c.inst)})`).join(" / ")}${ev.crashList.length > 40 ? " …" : ""}` : "")
    + ` · 결과 채움 ${res.filled}/${res.pending} · 요청 ${res.requests}회(목록 ${res.req.rebuild} · 수급 ${res.req.flow} · 결과 ${res.req.fill})${typeof res.ms === "number" ? " " + (res.ms / 1000).toFixed(1) + "초" : ""}`
    + (res.errors.length ? " · 실패·참고 " + res.errors.slice(0, 8).join(" / ") + (res.errors.length > 8 ? ` … 모두 ${res.errors.length}건` : "") : "");
}

export { kstDate };
