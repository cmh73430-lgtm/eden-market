// 주도 테마 「급등 묶음」 선정 — 9.29-100 원장 [1845][1847][1848][1849][1850] (연구 lead_audit/주도테마_재연구.md 안 1 · 디렉터 결정)
// 순수 계산 + 주입한 get(url) 로만 네트워크 (런타임 LLM 0 · 규칙은 전부 숫자·목록).
//
//  ① 대상 = 그 시각 두 시장 거래대금 상위 약 10% — 네이버 priceTop(KOSPI·KOSDAQ, 거래대금 순) · ETF·ETN·우선주·스팩 제외 · 테마 구성표에 든 종목 중 순위
//     (10% 의 모수 = 테마 구성표 종목 수 — 연구 거꾸로 돌리기와 같은 방식)
//  ② 강한 종목 = +5%↑ · 테마 구성표(네이버 테마 전부 · 주 1회 갱신 저장)로 묶음
//  ③ 통과(0단계 엄격) = 강한 종목 3↑ & 그중 +10%↑ 2↑ & 강한 종목 외국인+기관 순매수 합 > 0 (값 없으면 보류 = 통과 + 「수급 확인 전」)
//  ④ 3개가 안 되면 완화 사다리(LADDER)를 한 단계씩 — 앞 단계 테마는 위에 그대로 · 새로 들어온 것만 아래 · 3개면 멈춤 · 테마마다 relax{step,keys,text} (선정완화 표시)
//  ⑤ 순위 = +10%↑ 수 → 강한 종목 거래대금 합 → 구성 종목 적은 테마 · 강한 종목 절반↑ 겹치면 합침 · 지주사·밸류업·대표주·신규상장 같은 포괄 이름 테마는 쓰지 않음
//  ⑥ 대장 = 강한 종목 거래대금 1위(상한가면 표시) · 외인·기관·미장·차트·며칠째 = 꼬리표(순위에 안 씀)
//  ⑦ 등락률 = 정규장 기준: 15:40 뒤(넥스트레이드 애프터마켓·시간외 단일가가 현재가를 바꿈) 실행이면 네이버 분봉 15:30 봉 가격 ÷ 기준가(전일 정규장 종가)로 다시 잼
//     (실측 2026-10-07: 15:30 봉 에이피알 379,000 · 삼성전자 268,500 = 다음 날 기준가 · 저녁 현재가 380,500 · 269,000 은 장 뒤 가격)
import { thresholdFor, gradeC, withToday, chartUrl, stockFlow, usOf, gradeU, prevCloseOf, compactThemes } from "./auto.js"; // auto.js 도 이 파일을 불러서(순환) 맨 위 계산에는 auto.js 값을 쓰지 않는다
import { addDays } from "../shared/calendar.js";
import { tvStockThresholds, TV_BIG2 } from "../shared/trade-value.js";
import { avg20FromBars, rvolOf } from "./shadow.js"; /* RVOL(거래대금 평소의 ×n) — 9.29-84 계산 그대로(20일 평균 거래대금 · 장 경과율) · 게이트 [1894] B */

export const SURGE_V = 2;
export const SURGE_RATE = 5, SURGE_N10 = 10, LIMIT_RATE = 29.5, SURGE_TOP = 0.10, SURGE_MIN_STRONG = 3, SURGE_MIN_N10 = 2, SURGE_N = 3, SURGE_SLOTS = 5;
export const SURGE_START = "09:30";            // 장중은 09:30 부터 같은 규칙 (홍인기 · 연구 1절)
export const REGULAR_AFTER = "15:40";          // 이 시각 뒤 실행은 정규장 값(15:30 봉)으로 다시 잼
export const GENERIC_RE = /지주사|밸류업|대표주|신규상장/; // 포괄 이름 (연구 03_backtest 와 같은 목록)
export const UNIV_URL = (mkt, page) => "https://m.stock.naver.com/api/stocks/priceTop/" + mkt + "?page=" + page + "&pageSize=100";
export const UNIV_PAGES = 3, UNIV_PAGES_MAX = 6; // 시장마다 3쪽(300줄)부터 · 기준선 아래로 내려갈 때까지 최대 6쪽
export const MINUTE_URL = (code, d8) => "https://api.stock.naver.com/chart/domestic/item/" + code + "/minute?startDateTime=" + d8 + "1500&endDateTime=" + d8 + "1531";
export const REG_MIN_RATE = 1.5, REG_MAX = 140;  // 정규장 다시 재기: 지금 등락률 +1.5%↑ 종목만 · 한 run 최대 140회
export const FLOW_MAX = 40;
export const MERGE_SAME_LEAD = true;            // 대장(강한 종목 거래대금 1위)이 같으면 같은 흐름으로 합침 (10/8 실측: 반도체 장비·OLED 둘 다 대장 주성엔지니어링 → 두 칸 차지 방지 · 옛 방식 dedupe 와 같은 규칙)                      // 수급(추정) 받을 강한 종목 수 상한 / run
// 완화 사다리 (원장 [1849] 기본안) — 각 단계는 앞 단계까지 푼 조건을 그대로 두고 하나씩 더 푼다
export const LADDER = [
  { step: 0, key: null, rate: 5, top: 0.10, minStrong: 3, minN10: 2, flow: true },
  { step: 1, key: "n10_1", rate: 5, top: 0.10, minStrong: 3, minN10: 1, flow: true },
  { step: 2, key: "flow_skip", rate: 5, top: 0.10, minStrong: 3, minN10: 1, flow: false },
  { step: 3, key: "strong_2", rate: 5, top: 0.10, minStrong: 2, minN10: 1, flow: false },
  { step: 4, key: "rate_4", rate: 4, top: 0.10, minStrong: 2, minN10: 1, flow: false },
  { step: 5, key: "rate_3", rate: 3, top: 0.10, minStrong: 2, minN10: 1, flow: false },
  { step: 6, key: "top_15", rate: 3, top: 0.15, minStrong: 2, minN10: 1, flow: false },
  { step: 7, key: "top_20", rate: 3, top: 0.20, minStrong: 2, minN10: 1, flow: false },
];
export const RELAX_TEXT = { n10_1: "+10% 1종목만", flow_skip: "외인·기관 순매도", strong_2: "강한 종목 2개", rate_4: "+4% 종목 포함", rate_3: "+3% 종목 포함", top_15: "거래대금 상위 15%까지", top_20: "거래대금 상위 20%까지" };
// 「참고」 한 줄 (원장 [1845] ④): +5% 묶음은 안 됐지만 돈이 크게 몰린 테마 — 대상(상위 10%) 안 구성 종목 4↑ · 오른 비율 ≥ 0.7 · 평균 +2%↑ · 오른 종목 거래대금 합(시총 TOP10 제외) ≥ 5,000억 · 선정 테마와 안 겹침 → 돈 합 1위 1개
//   근거: 연구 일봉 8/21~10/8 32거래일에서 이 기준이면 20일(63%)에 1개 (도구/t100/ref_stats.mjs) — TOP10 을 빼지 않으면 삼성전자·SK하이닉스 테마가 매일 1위
export const REF_MIN_N = 4, REF_MIN_UP = 0.7, REF_MIN_AVG = 2, REF_MIN_MONEY = 5000;
export const MAP_FILE = "auto/observe/theme-map.json", MAP_DAYS = 7, MAP_MIN_THEMES = 200, MAP_MAX_REQ = 320;

const num = (s) => { if (s === null || s === undefined || s === "") return null; const n = Number(String(s).replace(/,/g, "").replace(/^\+/, "")); return Number.isFinite(n) ? n : null; };
const round2 = (x) => Number(x.toFixed(2));

// ---- 테마 구성표 (주 1회) ----
// 목록 3쪽(테마 약 264) + 테마마다 상세 1쪽(100개 넘으면 2쪽) ≈ 270회 · 간격 pace · 시간 예산 · 200개 미만이면 실패(옛 표 유지)
export const mapStale = (m, date) => !(m && Array.isArray(m.themes) && m.themes.length >= MAP_MIN_THEMES && typeof m.builtAt === "string" && addDays(m.builtAt, MAP_DAYS) > date);
export async function buildThemeMap({ get, date, sleep = null, gapMs = 0, deadline = Infinity, clock = () => Date.now(), maxReq = MAP_MAX_REQ }) {
  const errors = [], groups = []; let requests = 0;
  const req = async (u) => { if (requests >= maxReq) throw new Error("요청 상한 " + maxReq); if (clock() > deadline) throw new Error("시간 예산 넘음"); requests++; const j = await get(u); if (sleep && gapMs) await sleep(gapMs); return j; };
  for (let p = 1; p <= 4; p++) { try { const j = await req("https://m.stock.naver.com/api/stocks/theme?page=" + p + "&pageSize=100"); const g = j && Array.isArray(j.groups) ? j.groups : []; if (!g.length) break; groups.push(...g); if (g.length < 100) break; } catch (e) { errors.push("목록 " + p + ": " + (e.message || e)); break; } }
  const themes = [];
  for (const g of groups) {
    if (!g || g.no === undefined || !g.name) continue;
    const codes = [];
    try {
      const d = await req("https://m.stock.naver.com/api/stocks/theme/" + g.no + "?page=1&pageSize=100");
      for (const s of (d && d.stocks) || []) if (s && s.itemCode) codes.push(String(s.itemCode));
      if (num(d && d.totalCount) > 100) { const d2 = await req("https://m.stock.naver.com/api/stocks/theme/" + g.no + "?page=2&pageSize=100"); for (const s of (d2 && d2.stocks) || []) if (s && s.itemCode) codes.push(String(s.itemCode)); }
    } catch (e) { errors.push("테마 " + g.no + ": " + (e.message || e)); if (/상한|예산/.test(String(e.message))) break; continue; }
    if (codes.length) themes.push({ no: g.no, name: String(g.name).trim(), count: codes.length, codes: [...new Set(codes)] });
  }
  if (themes.length < MAP_MIN_THEMES) return { map: null, requests, errors: [...errors, "테마 " + themes.length + "개 — " + MAP_MIN_THEMES + "개 미만이라 저장 안 함"] };
  const all = new Set(themes.flatMap((t) => t.codes));
  return { map: { app: "jangjeon-cockpit", kind: "theme-map", v: 1, builtAt: date, refreshDays: MAP_DAYS, rule: "네이버 테마 전부 · 상세 1~2쪽 구성 종목 · 주 1회 (9.29-100)", themes, codes: all.size, listed: groups.length }, requests, errors };
}

// ---- 대상(거래대금 상위) ----
const PREF_RE = /.+[0-9]?우(B|C)?$/;
export function univExcluded(s) {
  if (!s || String(s.stockEndType || "") !== "stock") return "etf_etn";
  const name = String(s.stockName || ""), code = String(s.itemCode || "");
  if (PREF_RE.test(name) && !code.endsWith("0")) return "preferred"; // 보통주 「성우」 같은 이름은 코드 끝 0 이라 남김 (auto.js obsExcluded 와 같은 판별)
  if (/스팩|기업인수목적/.test(name)) return "spac";
  return null;
}
// priceTop 응답(쪽들) → 종목 [{ code, name, market, rate, value(억), price, prev }] (제외 종목 빼고 · 같은 코드 한 번)
export function parseUniverse(pages) {
  const out = [], seen = new Set(), excluded = { etf_etn: 0, preferred: 0, spac: 0 };
  for (const p of Array.isArray(pages) ? pages : []) for (const s of (p && Array.isArray(p.stocks) ? p.stocks : [])) {
    const code = String((s && s.itemCode) || ""); if (!code || seen.has(code)) continue; seen.add(code);
    const why = univExcluded(s); if (why) { excluded[why]++; continue; }
    const raw = num(s.accumulatedTradingValueRaw), mk = s.stockExchangeType && s.stockExchangeType.code;
    out.push({ code, name: String(s.stockName || ""), market: mk === "KQ" ? "KQ" : mk === "KS" ? "KS" : null, rate: num(s.fluctuationsRatio), value: raw === null ? null : round2(raw / 1e8), price: num(s.closePrice), prev: prevCloseOf(s) });
  }
  return { stocks: out, excluded };
}
// 상위 top 비율 기준선: 구성표에 든 종목만 거래대금 순 · 모수 M = 구성표 종목 수 · N = round(top × M) 번째 거래대금 = 기준선 (못 미치게 받았으면 complete=false)
export function cutOf(stocks, memberSet, M, top) {
  const mem = (stocks || []).filter((s) => memberSet.has(s.code) && typeof s.value === "number").sort((a, b) => b.value - a.value);
  const N = Math.max(1, Math.round(top * M));
  if (!mem.length) return { cut: Infinity, N, have: 0, complete: false };
  return mem.length >= N ? { cut: mem[N - 1].value, N, have: mem.length, complete: true } : { cut: mem[mem.length - 1].value, N, have: mem.length, complete: false };
}
// 두 시장 priceTop 받기: 시장마다 3쪽 → 기준선(top 의 최대값 maxTop) 아래로 내려갈 때까지 1쪽씩 (최대 6쪽)
export async function fetchUniverse({ get, memberSet, M, maxTop = SURGE_TOP, pages = UNIV_PAGES, maxPages = UNIV_PAGES_MAX }) {
  const got = { KOSPI: [], KOSDAQ: [] }, errors = []; let requests = 0;
  const one = async (mkt, p) => { try { requests++; const j = await get(UNIV_URL(mkt, p)); if (!j || !Array.isArray(j.stocks)) throw new Error("형식 이상"); got[mkt].push(j); return j.stocks.length; } catch (e) { errors.push(mkt + " " + p + ": " + (e.message || e)); return 0; } };
  for (const mkt of ["KOSPI", "KOSDAQ"]) for (let p = 1; p <= pages; p++) if (!(await one(mkt, p))) break;
  const lastVal = (mkt) => { const a = got[mkt]; const s = a.length ? a[a.length - 1].stocks : []; const v = s.length ? num(s[s.length - 1].accumulatedTradingValueRaw) : null; return v === null ? null : v / 1e8; };
  for (let k = 0; k < maxPages - pages; k++) {
    const u = parseUniverse([...got.KOSPI, ...got.KOSDAQ]), c = cutOf(u.stocks, memberSet, M, maxTop);
    const more = ["KOSPI", "KOSDAQ"].filter((mkt) => got[mkt].length === pages + k && got[mkt].length && (lastVal(mkt) === null || lastVal(mkt) >= c.cut || !c.complete));
    if (!more.length) break;
    for (const mkt of more) await one(mkt, pages + k + 1);
  }
  const u = parseUniverse([...got.KOSPI, ...got.KOSDAQ]);
  return { stocks: u.stocks, excluded: u.excluded, requests, errors, pages: { KOSPI: got.KOSPI.length, KOSDAQ: got.KOSDAQ.length } };
}

// ---- 정규장 값으로 다시 재기 (15:40 뒤 실행) ----
// 분봉 응답 [{localDateTime:"YYYYMMDDHHmmss", currentPrice}] → 15:30:59 이하 마지막 봉 가격 (없으면 null)
export function regularPrice(bars, d8) {
  const lim = d8 + "153059"; let best = null;
  for (const b of Array.isArray(bars) ? bars : []) { const t = String((b && b.localDateTime) || ""); const p = num(b && b.currentPrice); if (t.slice(0, 8) === d8 && t <= lim && p !== null && p > 0 && (!best || t > best.t)) best = { t, p }; }
  return best ? best.p : null;
}
// stocks 중 고칠 종목(지금 등락률 ≥ minRate · 거래대금 ≥ minValue · 거래대금 큰 순 max 개) → s.rate·s.price 를 정규장 값으로 · s.reg = true. 실패 종목은 s.reg = false (지금 값 그대로)
export async function regularize(stocks, { get, date, minRate = REG_MIN_RATE, minValue = 0, max = REG_MAX, done = new Set() }) {
  const d8 = String(date).replace(/-/g, ""), errors = []; let requests = 0;
  const todo = (stocks || []).filter((s) => !done.has(s.code) && typeof s.rate === "number" && s.rate >= minRate && (s.value || 0) >= minValue && typeof s.prev === "number" && s.prev > 0).sort((a, b) => (b.value || 0) - (a.value || 0));
  for (const s of todo) {
    if (requests >= max) { errors.push("정규장 다시 재기 상한 " + max); break; }
    done.add(s.code);
    try { requests++; const p = regularPrice(await get(MINUTE_URL(s.code, d8)), d8); if (p === null) { s.reg = false; errors.push(s.code + ": 15:30 봉 없음"); continue; } if (s.price !== p) s.after = { price: s.price, rate: s.rate }; s.price = p; s.rate = round2((p / s.prev - 1) * 100); s.reg = true; }
    catch (e) { s.reg = false; errors.push(s.code + ": " + (e.message || e)); }
  }
  return { requests, errors, done };
}

// ---- 선정 ----
const coreOverlap = (a, b) => { const A = new Set(a); const inter = b.filter((x) => A.has(x)).length; return inter >= 1 && inter >= Math.ceil(Math.min(a.length, b.length) / 2); };
export function themeFlowOf(core, flows) {
  const xs = (core || []).map((c) => flows && flows[c]).filter((f) => f && typeof f.foreign === "number" && typeof f.inst === "number");
  if (!xs.length) return null;
  return { foreign: Math.round(xs.reduce((a, f) => a + f.foreign, 0)), inst: Math.round(xs.reduce((a, f) => a + f.inst, 0)), n: xs.length, of: core.length, est: xs.some((f) => f.est) || undefined, at: xs.map((f) => f.at).filter(Boolean).sort().pop() || undefined };
}
// 한 단계 평가: 통과 테마 [{ no, name, count, core(코드 · 거래대금 순), n10, money, flow, flowState }] 순위대로
export function evalStep(byCode, cuts, map, st, flows = null) {
  const cut = cuts[st.top]; if (!cut || !Number.isFinite(cut.cut)) return [];
  const res = [];
  for (const t of map.themes) {
    if (GENERIC_RE.test(t.name)) continue;
    const core = t.codes.filter((c) => { const s = byCode.get(c); return s && typeof s.rate === "number" && s.rate >= st.rate && (s.value || 0) >= cut.cut; });
    if (core.length < st.minStrong) continue;
    core.sort((a, b) => byCode.get(b).value - byCode.get(a).value);
    const n10 = core.filter((c) => byCode.get(c).rate >= SURGE_N10).length;
    if (n10 < st.minN10) continue;
    const flow = themeFlowOf(core, flows), flowState = !flow ? "pending" : flow.foreign + flow.inst > 0 ? "buy" : "sell";
    if (st.flow && flowState === "sell") continue;
    res.push({ no: t.no, name: t.name, count: t.count, core, n10, money: round2(core.reduce((a, c) => a + byCode.get(c).value, 0)), flow, flowState });
  }
  return res.sort((a, b) => b.n10 - a.n10 || b.money - a.money || a.count - b.count);
}
// 테마 하나가 엄격 기준에서 실제로 풀린 조건 (표시용 · 들어온 단계의 값으로 판정)
export function relaxKeys(t, byCode, cuts, st) {
  if (!st || st.step === 0) return [];
  const keys = [], strict = LADDER[0], cut0 = cuts[strict.top] ? cuts[strict.top].cut : Infinity;
  if (t.n10 < SURGE_MIN_N10) keys.push("n10_1");
  if (t.flowState === "sell") keys.push("flow_skip");
  const strong0 = t.core.filter((c) => { const s = byCode.get(c); return s.rate >= strict.rate && s.value >= cut0; });
  if (t.core.length < SURGE_MIN_STRONG) keys.push("strong_2");
  if (t.core.some((c) => byCode.get(c).rate < strict.rate)) keys.push(t.core.some((c) => byCode.get(c).rate < 4) ? "rate_3" : "rate_4");
  if (t.core.some((c) => byCode.get(c).value < cut0)) keys.push(t.core.some((c) => cuts[0.15] && byCode.get(c).value < cuts[0.15].cut) ? "top_20" : "top_15");
  if (!keys.length && strong0.length < SURGE_MIN_STRONG) keys.push("strong_2");
  return keys;
}
// 사다리: ensure(top) 는 그 범위 기준선까지 대상·정규장 값을 준비하는 비동기 함수(없으면 그냥 씀) · flowsFor(codes) 는 수급(추정) 받기(없으면 수급 보류)
export async function ladderSelect({ stocks, map, n = SURGE_N, flowsFor = null, ensure = null, ladder = LADDER, mergeLead = MERGE_SAME_LEAD }) {
  const byCode = new Map((stocks || []).map((s) => [s.code, s]));
  const memberSet = new Set(map.themes.flatMap((t) => t.codes)), M = map.codes || memberSet.size;
  const cuts = {}; const cutFor = (top) => (cuts[top] = cutOf([...byCode.values()], memberSet, M, top));
  let flows = null, flowAsked = false;
  const picked = [], used = []; let lastStep = null;
  for (const st of ladder) {
    if (ensure) await ensure(st.top, st.rate);
    for (const k of [0.1, st.top]) cutFor(k);
    cutFor(0.15);
    if (st.flow && !flowAsked && flowsFor) { // 수급(추정): 엄격·1단계 후보의 강한 종목만 · 상한 FLOW_MAX
      flowAsked = true;
      const pre = evalStep(byCode, cuts, map, Object.assign({}, st, { flow: false, minN10: 1 }), null);
      const codes = [...new Set(pre.flatMap((t) => t.core))].slice(0, FLOW_MAX);
      try { flows = codes.length ? await flowsFor(codes) : null; } catch (e) { flows = null; }
    }
    const res = evalStep(byCode, cuts, map, st, flows);
    used.push({ step: st.step, key: st.key, passed: res.length });
    for (const t of res) {
      if (picked.length >= n) break;
      if (picked.some((p) => p.no === t.no || p.alias.includes(t.name))) continue;
      // 합치기 = 대표 테마의 강한 종목과 비교(연구 dedupe 와 같음 · 합쳐진 테마 종목까지 넓히면 10/8 2차전지가 전기차를 거쳐 자동차부품까지 삼켜 연쇄로 커짐 — 실측) · 대장 같음도 합침
      const host = picked.find((p) => coreOverlap(p.core, t.core) || (mergeLead && p.core[0] === t.core[0]));
      if (host) { if (!host.alias.includes(t.name)) host.alias.push(t.name); continue; }
      const keys = relaxKeys(t, byCode, cuts, st);
      picked.push(Object.assign(t, { alias: [], step: st.step, relax: st.step === 0 ? null : { step: st.step, keys, text: keys.map((k) => RELAX_TEXT[k]).join(" · ") } }));
    }
    lastStep = st.step;
    if (picked.length >= n) break;
  }
  return { picked, byCode, cuts, used, lastStep, flows, M };
}
// 참고 한 줄: 선정 안 된 테마 중 대상(상위 10%) 안 구성 4↑ · 오른 비율 ≥ 0.7 · 평균 +2%↑ · 오른 종목 돈(TOP10 제외) ≥ 5,000억 · 선정과 안 겹침 → 1위
export function refTheme({ byCode, cut, map, picked = [], top10 = new Set() }) {
  let best = null;
  for (const t of map.themes) {
    if (GENERIC_RE.test(t.name) || picked.some((p) => p.no === t.no || p.alias.includes(t.name))) continue;
    const mem = t.codes.filter((c) => { const s = byCode.get(c); return s && typeof s.rate === "number" && (s.value || 0) >= cut; });
    if (mem.length < REF_MIN_N) continue;
    const up = mem.filter((c) => byCode.get(c).rate > 0), upR = up.length / mem.length, avg = mem.reduce((a, c) => a + byCode.get(c).rate, 0) / mem.length;
    const money = up.filter((c) => !top10.has(c)).reduce((a, c) => a + byCode.get(c).value, 0);
    if (upR < REF_MIN_UP || avg < REF_MIN_AVG || money < REF_MIN_MONEY) continue;
    const top = mem.sort((a, b) => byCode.get(b).value - byCode.get(a).value);
    if (picked.some((p) => top.slice(0, 3).filter((c) => p.core.includes(c)).length >= 2)) continue;
    if (!best || money > best.money) best = { no: t.no, name: t.name, count: t.count, n: mem.length, up: round2(upR), avg: round2(avg), money: Math.round(money), stocks: top.slice(0, 3).map((c) => { const s = byCode.get(c); return { code: c, name: s.name, rate: s.rate, value: s.value, price: s.price, prev: s.prev }; }) };
  }
  return best;
}

// 테마 상세(구성 전부) → 표시용 테마 등락률(단순평균 · 정규장 값 고친 종목은 고친 값)·오른 비율·테마 거래대금·강세 수(+5%↑)
export function detailNums(stocks, byCode) {
  const xs = (Array.isArray(stocks) ? stocks : []).map((x) => { const s = byCode && byCode.get(String(x.itemCode)); return { rate: s && s.reg ? s.rate : num(x.fluctuationsRatio), value: num(x.accumulatedTradingValueRaw) }; }).filter((x) => typeof x.rate === "number");
  if (!xs.length) return null;
  const hot = xs.filter((x) => x.rate >= SURGE_RATE);
  return { rate: round2(xs.reduce((a, x) => a + x.rate, 0) / xs.length), rise: round2(xs.filter((x) => x.rate > 0).length / xs.length), value: Math.round(xs.reduce((a, x) => a + (x.value || 0), 0) / 1e8), hot: Math.round(hot.reduce((a, x) => a + (x.value || 0), 0) / 1e8), hotN: hot.length };
}
// 일봉 오늘 봉 종가를 정규장 종가로 (장 뒤 가격이 섞인 봉 방지) · 오늘 봉이 없으면 붙임
export function withRegular(bars, date, price) {
  const rows = Array.isArray(bars) ? bars : [], d = String(date || "").replace(/-/g, "");
  if (!rows.length || typeof price !== "number" || !(price > 0)) return rows;
  if (!rows.some((b) => String(b.localDate || "") === d)) return withToday(rows, date, price);
  return rows.map((b) => (String(b.localDate || "") === d ? Object.assign({}, b, { closePrice: price, highPrice: Math.max(num(b.highPrice) || 0, price) }) : b));
}
// 며칠째: history(오늘 제외 · 최근 먼저)의 확정 주도 테마 3개에 같은 번호·이름(합친 이름 포함)이 연속으로 든 날 + 오늘
export function daysInRow(t, history = []) {
  let D = 1;
  for (const h of Array.isArray(history) ? history : []) {
    const hit = ((h && h.leaders) || []).slice(0, 3).some((x) => x && (String(x.no) === String(t.no) || x.name === t.name || (Array.isArray(x.alias) && x.alias.includes(t.name)) || (t.alias || []).includes(x.name)));
    if (!hit) break; D++;
  }
  return D;
}

const slotOf = (s) => Object.assign({ code: s.code, name: s.name, rate: s.rate, value: s.value, price: s.price, market: s.market || undefined }, typeof s.prev === "number" ? { prev: s.prev } : {}, s.rate >= LIMIT_RATE ? { limit: true } : {}, s.reg === false ? { regMiss: true } : {});
// 한 줄 글 (앱 parseLeaders 가 읽는 꼴 유지: "이름 +x% · 강세 N종목 X억 · … · 외인 … · 기관 … (대장·2등)")
const eokText = (v) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조" : Math.round(v).toLocaleString("ko-KR") + "억");
const signedEok = (v) => (v > 0 ? "+" : v < 0 ? "-" : "") + eokText(Math.abs(v));
export function surgeText(themes) {
  return (themes || []).map((t) => t.name + " " + (t.rate > 0 ? "+" : "") + (t.rate ?? 0) + "%"
    + " · 강세 " + t.strongN + "종목 " + eokText(t.money) + " · +10% " + t.n10 + "종목"
    + (t.lead ? " · 대장 " + t.lead.name + (t.lead.limit ? "(상한가)" : "") : "")
    + (t.flow ? " · 외인 " + signedEok(t.flow.foreign) + " · 기관 " + signedEok(t.flow.inst) : t.flowState === "pending" ? " · 수급 확인 전" : "")
    + (t.relax ? " · 선정완화(" + t.relax.text + ")" : "")
    + " (" + (t.slots || []).slice(0, 2).map((s) => s.name).join("·") + ")").join(" / ");
}

// 본체: 대상 받기 → (15:40 뒤면 정규장 값) → 사다리 → 꼬리표(테마 상세·대장 차트·미장·며칠째·수급) → 참고 한 줄
//  get = memoGet 으로 싼 요청 함수 · map = 테마 구성표 · hm = 실제 시각 "HH:MM" · regular = 정규장 다시 재기 · flowsFor(codes) = 수급(추정) · us = 아침 미국 테마 · history = historyFrom()
export async function selectSurge({ get, map, date, hm = null, regular = false, flowsFor = null, us = null, history = [], kospiAmount = null, kosdaqAmount = null, top10 = new Set(), n = SURGE_N, chart = true }) {
  const t0 = Date.now(), errors = []; const req = { universe: 0, regular: 0, detail: 0, chart: 0 };
  if (!map || !Array.isArray(map.themes) || !map.themes.length) throw new Error("테마 구성표 없음");
  const memberSet = new Set(map.themes.flatMap((t) => t.codes)), M = map.codes || memberSet.size;
  const maxTop = Math.max(...LADDER.map((s) => s.top));
  const U = await fetchUniverse({ get, memberSet, M, maxTop: SURGE_TOP }); req.universe = U.requests; errors.push(...U.errors);
  if (!U.stocks.length) throw new Error("거래대금 순위 못 받음");
  let stocks = U.stocks; const done = new Set(); let widened = false;
  const ensure = async (top, rate) => {
    if (top > SURGE_TOP && !widened) { widened = true; const W = await fetchUniverse({ get, memberSet, M, maxTop: maxTop }); req.universe += W.requests - U.requests > 0 ? W.requests - U.requests : 0; const have = new Set(stocks.map((s) => s.code)); for (const s of W.stocks) if (!have.has(s.code)) stocks.push(s); }
    if (regular) { const c = cutOf(stocks, memberSet, M, top); const r = await regularize(stocks, { get, date, minValue: c.cut, done, minRate: Math.min(REG_MIN_RATE, rate - 3.5) }); req.regular += r.requests; errors.push(...r.errors.slice(0, 6)); }
  };
  const L = await ladderSelect({ stocks, map, n, flowsFor, ensure });
  const themes = [];
  for (const p of L.picked) {
    const by = L.byCode, slots = p.core.slice(0, SURGE_SLOTS).map((c) => slotOf(by.get(c))), lead = slots[0];
    const row = { no: p.no, name: p.name, alias: p.alias, count: p.count, strongN: p.core.length, strongAvg: round2(p.core.reduce((a, c) => a + by.get(c).rate, 0) / p.core.length), n10: p.n10, /* strongAvg = 강한 종목 평균(테마 rate 는 구성 전체 평균 · 게이트 [1887]) */ limitN: p.core.filter((c) => by.get(c).rate >= LIMIT_RATE).length, money: Math.round(p.money),
      lead: lead ? { code: lead.code, name: lead.name, rate: lead.rate, value: lead.value, limit: lead.limit || undefined } : null, slots, stocks: slots.slice(0, 2).map((s) => s.name), core: p.core,
      flow: p.flow || undefined, flowState: p.flowState, step: p.step, relax: p.relax, warn: [] };
    try { // 테마 상세 1쪽(100개 넘으면 2쪽까지 — 1쪽만 평균 내면 10/8 2차전지(143종목) 2.93% vs 네이버 1.33% 로 틀어짐 · 실측)
      req.detail++; const d = await get("https://m.stock.naver.com/api/stocks/theme/" + p.no + "?page=1&pageSize=100"); let xs = (d && d.stocks) || [];
      if (num(d && d.totalCount) > 100) { req.detail++; const d2 = await get("https://m.stock.naver.com/api/stocks/theme/" + p.no + "?page=2&pageSize=100"); xs = xs.concat((d2 && d2.stocks) || []); }
      const dn = detailNums(xs, by); if (dn) Object.assign(row, dn);
    } catch (e) { errors.push("상세 " + p.no + ": " + (e.message || e)); }
    if (typeof row.rate !== "number") row.rate = round2(p.core.reduce((a, c) => a + by.get(c).rate, 0) / p.core.length);
    row.us = usOf(row.name, us); row.tags = { U: gradeU(row.us.u), days: daysInRow(row, history) };
    if (chart && lead) { try { req.chart++; const raw = await get(chartUrl(lead.code, date)); const c = gradeC(regular ? withRegular(raw, date, lead.price) : withToday(raw, date, lead.price), { vToday: lead.value, T: thresholdFor(kospiAmount) }); if (c) { row.chart = { lead: { grade: c.grade, tag: c.tag, offHigh: c.offHigh } }; slots[0].chart = { grade: c.grade, tag: c.tag }; } } catch (e) { errors.push("차트 " + lead.code + ": " + (e.message || e)); } }
    themes.push(row);
  }
  const ref = refTheme({ byCode: L.byCode, cut: L.cuts[SURGE_TOP] ? L.cuts[SURGE_TOP].cut : Infinity, map, picked: L.picked, top10 });
  const c10 = L.cuts[SURGE_TOP] || {};
  // 종가배팅 숫자 기준 후보 (9.29-100 원장 [1864] ③ · 표시만) · 거래대금 기준 = 매매수칙 권장안 표(원장 [1880]): 코스피 종목 = 코스피 − 삼성전자 − SK하이닉스(두 종목 그날 거래대금 = 이미 받은 거래대금 순위 응답 · 추가 요청 0) · 코스닥 종목 = 코스닥
  const big2 = TV_BIG2.map((c) => L.byCode.get(c)).filter((s) => s && typeof s.value === "number"), big2v = big2.length === TV_BIG2.length ? big2.reduce((a, s) => a + s.value, 0) : null;
  const closing = closingPicks(L.byCode, { T: tvStockThresholds({ kospi: kospiAmount, kosdaq: kosdaqAmount, big2: big2v }), flows: L.flows });
  const short = themes.length < n ? (themes.length ? "완화 끝까지 가도 " + themes.length + "개뿐" : "완화 끝까지 가도 0개") + " — +10% 종목이 있는 테마 묶음 부족(시장 전체 약세 등)" : undefined;
  return {
    v: SURGE_V, method: "surge", basis: regular ? "regular" : "live", hm, date, themes, ref: ref || undefined, short, closing,
    universe: { n: c10.N, have: c10.have, cut: Number.isFinite(c10.cut) ? Math.round(c10.cut) : null, complete: !!c10.complete, M: L.M, pages: U.pages, excluded: U.excluded, cuts: Object.fromEntries(Object.entries(L.cuts).map(([k, v]) => [k, Number.isFinite(v.cut) ? Math.round(v.cut) : null])) },
    ladder: { used: L.used, lastStep: L.lastStep, steps: LADDER.map((s) => ({ step: s.step, key: s.key, text: s.key ? RELAX_TEXT[s.key] : "엄격" })) },
    flowSrc: L.flows ? Object.keys(L.flows).length : 0, requests: req, ms: Date.now() - t0, errors: errors.slice(0, 20),
  };
}

// 저녁(또는 다음 날 아침) 확정 수급: 이미 고른 테마는 그대로 · 슬롯 종목 그날 외인·기관(네이버 일별 · bizdate 맞을 때만)만 채움 · flow 를 확정값으로 바꿈 (재선정 0)
export async function fillFinalFlows(leaders, { get, bizdate }) {
  const L = JSON.parse(JSON.stringify(leaders || {})); let requests = 0, got = 0; const errors = [];
  for (const t of L.themes || []) {
    const flows = [];
    for (const s of t.slots || []) {
      try { requests++; const f = stockFlow(await get("https://m.stock.naver.com/api/stock/" + s.code + "/trend?pageSize=1"), bizdate); if (f) { s.flow = { foreign: f.foreign, inst: f.inst }; flows.push(f); got++; } } catch (e) { errors.push(s.code + ": " + (e.message || e)); }
    }
    if (flows.length) { t.flowFinal = { foreign: flows.reduce((a, f) => a + f.foreign, 0), inst: flows.reduce((a, f) => a + f.inst, 0), n: flows.length, of: (t.slots || []).length, bizdate }; t.flow = { foreign: t.flowFinal.foreign, inst: t.flowFinal.inst, n: flows.length, of: t.flowFinal.of }; }
  }
  if (L.closing && Array.isArray(L.closing.items)) { // 종가배팅 후보도 확정 수급으로 (최대 CLOSING_MAX)
    for (const x of L.closing.items) { try { requests++; const f = stockFlow(await get("https://m.stock.naver.com/api/stock/" + x.code + "/trend?pageSize=1"), bizdate); if (f) x.flow = { foreign: f.foreign, inst: f.inst }; } catch (e) { errors.push(x.code + ": " + (e.message || e)); } }
    L.closing.flowFinal = true;
  }
  L.flowReady = got > 0; L.flowAt = Date.now();
  L.text = surgeText(L.themes || []);
  return { leaders: L, requests, got, errors };
}
export { compactThemes };

// 수급(추정) 받기 (원장 [1848]): 키·로그인 없이 장중 종목별 외국인·기관 잠정값을 주는 곳은 아직 확인 못 함(조사 2026-10-09 · KRX 는 로그인 필요 · 네이버 PC 외국계 추정 화면 폐지)
//  → 네이버 종목 일별 수급(trend)의 「오늘 날짜 행」 이 있을 때만 쓴다. 먼저 1종목만 물어보고(오늘 행 없음 = 아직 발표 전) 없으면 나머지 요청 0 → 모두 「수급 확인 전」(탈락 안 함)
//  est = 저녁 확정 전(18:00 전) 값이면 true · 반환 { code: { foreign, inst, est, at } } 또는 null
export function makeFlowsFor(get, bizdate, { hm = null, max = FLOW_MAX } = {}) {
  return async (codes) => {
    const out = {}, xs = (codes || []).slice(0, max); if (!xs.length) return null;
    const one = async (c) => { const f = stockFlow(await get("https://m.stock.naver.com/api/stock/" + c + "/trend?pageSize=1"), bizdate); if (f) out[c] = { foreign: f.foreign, inst: f.inst, est: !hm || hm < "18:00" ? true : undefined, at: hm || undefined }; return !!f; };
    try { if (!(await one(xs[0]))) return null; } catch (e) { return null; }
    for (const c of xs.slice(1)) { try { await one(c); } catch (e) {} }
    return Object.keys(out).length ? out : null;
  };
}
// 마감 run 의 주도 테마 (원장 [1845] ③): 오늘 확정이 아직 없으면 「정규장 값(15:30 봉)」으로 한 번 고름 · 이미 있으면 다시 고르지 않고 확정 수급만 채움(18:00 뒤)
//  prev = 같은 날 앞선 run 의 close.market.leaders · final = 확정 수급 채울 시각(18:00 뒤 또는 지난 날 백필)
export async function collectSurgeLeaders({ get, map, date, hm, us = null, history = [], kospi = null, kosdaq = null, top10 = new Set(), prev = null, final = false, n = SURGE_N, regimeOf = null }) {
  const bizdate = String(date).replace(/-/g, "");
  if (prev && prev.v === SURGE_V && prev.method === "surge" && Array.isArray(prev.themes)) { // 다시 고르지 않음
    if (!final || prev.flowReady) return Object.assign({}, prev, { kept: true, keptAt: hm });
    const r = await fillFinalFlows(prev, { get, bizdate });
    return Object.assign(r.leaders, { kept: true, keptAt: hm, flowReq: r.requests });
  }
  const sel = await selectSurge({ get, map, date, hm, regular: true, flowsFor: makeFlowsFor(get, bizdate, { hm }), us, history, kospiAmount: kospi && kospi.amount, kosdaqAmount: kosdaq && kosdaq.amount, top10, n });
  let L = { v: SURGE_V, method: "surge", provisional: false, confirmed: true, basis: sel.basis, text: surgeText(sel.themes), themes: sel.themes, candidates: sel.themes, ref: sel.ref, short: sel.short, closing: sel.closing, universe: sel.universe, ladder: sel.ladder,
    regime: regimeOf && kospi ? regimeOf(kospi.amount, history) : "", kospiRate: kospi && typeof kospi.value === "number" ? kospi.value : null, decidedAt: Date.now(), decidedHm: hm, flowReady: false, chartReady: sel.themes.some((t) => t.chart), requests: sel.requests, errors: sel.errors };
  if (final) { const r = await fillFinalFlows(L, { get, bizdate }); L = Object.assign(r.leaders, { flowReq: r.requests }); }
  return L;
}

// 시장경보 꼬리표 자료 (9.29-100 원장 [1872] K7 · 네이버만 · 키 없음): 네이버 종목 기본정보 /api/stock/{코드}/basic 의 marketAlertType{code,text}(실측 2026-10-09: SH에너지화학 {"02","투자경고"} · KIND 투자경고 목록과 일치) ·
//  tradeStopType(TRADING 아니면 거래정지) · isManagement(관리종목) · newlyListed(신규 상장) — 목록·테마 응답에는 이 칸이 없어서(실측) 종목마다 1회 · 하루 캐시(같은 날 받은 종목은 다시 안 물음) · run 당 상한 ALERT_MAX
//  화면 글은 네이버 text 그대로(투자주의·투자경고·투자위험 등 · 코드 표는 아직 02 하나만 실측) · 단기과열은 이 칸에 오는지 미확인
export const ALERT_MAX = 20;
export const ALERT_URL = (code) => "https://m.stock.naver.com/api/stock/" + code + "/basic";
export function parseAlert(j) {
  if (!j || typeof j !== "object") return null;
  const a = j.marketAlertType && j.marketAlertType.text ? String(j.marketAlertType.text) : null, ts = j.tradeStopType && j.tradeStopType.name;
  return Object.assign({}, a ? { alert: a, alertCode: String((j.marketAlertType && j.marketAlertType.code) || "") } : {}, ts && ts !== "TRADING" ? { stop: true } : {}, j.isManagement ? { mgmt: true } : {}, j.newlyListed ? { newly: true } : {});
}
// themes[].slots[] 에 s.alert·s.stop·s.mgmt·s.newly 를 붙인다 · cache = { date, codes: { 코드: 결과 } } (직전 live.json 의 alerts) · 돌려줌 = 이번 캐시(저장용)
export async function attachAlerts(themes, { get, date, cache = null, max = ALERT_MAX }) {
  const codes = cache && cache.date === date && cache.codes ? Object.assign({}, cache.codes) : {}; let requests = 0; const errors = [];
  for (const t of Array.isArray(themes) ? themes : []) for (const s of (t && t.slots) || []) {
    const c = String((s && s.code) || ""); if (!/^[0-9A-Z]{6}$/.test(c)) continue;
    if (!(c in codes)) { if (requests >= max) continue; try { requests++; codes[c] = parseAlert(await get(ALERT_URL(c))) || {}; } catch (e) { errors.push(c + ": " + String((e && e.message) || e).slice(0, 30)); continue; } }
    Object.assign(s, codes[c]);
  }
  return { date, codes, requests, errors: errors.slice(0, 5) };
}

// ---- 종가배팅 숫자 기준 후보 (원장 [1864] ③ · 표시만 · 선정·순위 영향 0) ----
//  당일 +10%↑ · 거래대금 ≥ T(코스피 거래대금 연동 기준 — 사용자 표 10조 미만 500억 · 10조 700억 · 20조 1,000억 · thresholdFor) · 외인+기관 (확정·오늘 행) 순매수 > 0 이면 ok · 수급 없으면 「수급 확인 전」
//  매도 = 다음 날 시가~장 초반(김수경·변영태 2011 · 전날 외인·기관 순매수 → 다음 날 시가까지 +) · 대상 = 이미 받은 거래대금 상위 종목(추가 요청 0)
export const CLOSING_RATE = 10, CLOSING_MAX = 10;
export function closingPicks(byCode, { T = 500, flows = null, max = CLOSING_MAX } = {}) {
  const TT = typeof T === "number" ? { KS: T, KQ: T } : T, tOf = (s) => (s.market === "KQ" ? TT.KQ : TT.KS); // 시장별 기준 (원장 [1880])
  const items = [...(byCode ? byCode.values() : [])].filter((s) => typeof s.rate === "number" && s.rate >= CLOSING_RATE && (s.value || 0) >= tOf(s))
    .sort((a, b) => b.value - a.value).slice(0, max).map((s) => Object.assign({ code: s.code, name: s.name, market: s.market || undefined, rate: s.rate, value: Math.round(s.value) }, flows && flows[s.code] ? { flow: { foreign: flows[s.code].foreign, inst: flows[s.code].inst } } : {}));
  return { rule: "+" + CLOSING_RATE + "%↑ · 거래대금 코스피 종목 " + TT.KS + "억↑ · 코스닥 종목 " + TT.KQ + "억↑ · 외인+기관 순매수 > 0 · 다음 날 시가~장 초반 매도", T: { KS: TT.KS, KQ: TT.KQ }, base: TT.base || undefined, items };
}

// ---- 과열 꼬리표 3종 (원장 [1864] ② · 표시만 · 선정·순위·탈락 영향 0) ----
//  갭 과열 = 시가 ÷ 전일 종가 −1 ≥ +6%(불개미 · 장 전엔 앱이 NXT 프리 등락률로) · 이격 과열 = 지금가 ÷ 20일선 −1 ≥ +10%(부자회사원 · 20일선 = 직전 19 종가 + 지금가) · 시장경보 근접 = 5거래일 전 종가 대비 +45%↑
//  (투자경고 요건 5일 +60%↑ 근처 · 아주경제 2024-01-17 · 기본값) · 자료 = 일봉(종목마다 하루 1회 · 오늘 봉 뺌) + 시가(polling 여러 종목 1회) · 하루 캐시(live.json heat)
export const HEAT_GAP = 6, HEAT_DISP = 10, HEAT_RUN5 = 45, HEAT_MAX = 15;
export function heatBase(bars, date) {
  const d8 = String(date).replace(/-/g, "");
  const rows = (Array.isArray(bars) ? bars : []).map((b) => ({ d: String(b.localDate || ""), c: num(b.closePrice) })).filter((r) => r.c && r.d && r.d < d8).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (rows.length < 19) return null;
  const last19 = rows.slice(-19);
  return { s19: last19.reduce((a, r) => a + r.c, 0), c5: rows.length >= 5 ? rows[rows.length - 5].c : null, d: rows[rows.length - 1].d };
}
export function heatOf({ price, prev, open, base }) {
  const out = {}; const tags = [];
  if (typeof open === "number" && open > 0 && typeof prev === "number" && prev > 0) { out.gap = round2((open / prev - 1) * 100); if (out.gap >= HEAT_GAP) tags.push("갭 과열"); }
  if (base && typeof price === "number" && price > 0) {
    out.disp = round2((price / ((base.s19 + price) / 20) - 1) * 100); if (out.disp >= HEAT_DISP) tags.push("이격 과열");
    if (base.c5) { out.r5 = round2((price / base.c5 - 1) * 100); if (out.r5 >= HEAT_RUN5) tags.push("시장경보 근접"); }
  }
  return tags.length ? Object.assign(out, { tags }) : Object.keys(out).length ? out : null;
}
/* 게이트 [1894] B: 같은 일봉 응답으로 20일 평균 거래대금(a20 · shadow.js avg20FromBars)도 같이 → hm 을 주면 슬롯에 s.rvol(평소 대비 배수 · rvolOf) — 추가 요청 0(일봉은 과열 꼬리표가 이미 받음) */
export async function attachHeat(themes, { get, date, cache = null, max = HEAT_MAX, wantOpen = true, hm = undefined }) {
  const c = cache && cache.date === date && cache.codes ? { date, codes: Object.assign({}, cache.codes), open: Object.assign({}, cache.open || {}), a20: Object.assign({}, cache.a20 || {}) } : { date, codes: {}, open: {}, a20: {} };
  let requests = 0; const errors = [];
  const slots = (Array.isArray(themes) ? themes : []).flatMap((t) => (t && t.slots) || []).filter((s) => s && /^[0-9A-Z]{6}$/.test(String(s.code || "")));
  for (const s of slots) { if (s.code in c.codes && s.code in c.a20) continue; if (requests >= max) break; try { requests++; const raw = await get(chartUrl(s.code, date)); c.codes[s.code] = heatBase(raw, date); const a = avg20FromBars(raw, date); c.a20[s.code] = a && typeof a.avg20 === "number" ? a.avg20 : null; } catch (e) { errors.push(s.code + ": " + String((e && e.message) || e).slice(0, 30)); } }
  const needOpen = wantOpen ? [...new Set(slots.map((s) => s.code))].filter((k) => !(c.open[k] > 0)) : [];
  if (needOpen.length) { try { requests++; const j = await get("https://polling.finance.naver.com/api/realtime/domestic/stock/" + needOpen.slice(0, 20).join(",")); for (const d of (j && j.datas) || []) { const o = num(d && (d.openPriceRaw ?? d.openPrice)); if (d && d.itemCode && o > 0) c.open[String(d.itemCode)] = o; } } catch (e) { errors.push("시가: " + String((e && e.message) || e).slice(0, 30)); } }
  for (const s of slots) { const h = heatOf({ price: s.price, prev: s.prev, open: c.open[s.code], base: c.codes[s.code] }); if (h) s.heat = h; if (hm !== undefined) { const x = rvolOf(s.value, c.a20[s.code], hm); if (x !== null) s.rvol = x; } }
  return { date, codes: c.codes, open: c.open, a20: c.a20, requests, errors: errors.slice(0, 5) };
}
