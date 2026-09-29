// 자동 연동: GitHub Actions 가 평일 아침(미국 지표·미국 대응주)과 오후(코스피·코스닥 마감·수급)에 네이버 값을 모아
// 기록 저장소(cockpit-data 브랜치)의 auto/<날짜>.json 에 둔다. 앱은 그 파일을 읽어 빈 칸을 채운다 (손으로 고친 칸은 그대로).
// 여기는 순수 함수만 — 실제 실행은 scripts/collect-auto.mjs.
import { kstDate, kstTime, weekday, holidayGap, lastUsTradingDayBefore, usDateOf } from "../shared/calendar.js";
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

const eok = (v) => (v === null ? "—" : (v > 0 ? "+" : "") + v.toLocaleString("ko-KR") + "억");
// 수급 한 줄: "코스피 외국인 -4,942억 · 기관 +3,189억 / 코스닥 외국인 +812억 · 기관 -95억"
export function investText(inv) {
  return ["kospi", "kosdaq"].filter((k) => inv && inv[k]).map((k) => (k === "kospi" ? "코스피" : "코스닥") + " 외국인 " + eok(inv[k].foreign) + " · 기관 " + eok(inv[k].institution)).join(" / ");
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
    try { const p = await prevThemes(); out.prev = p.themes; out.prevRaw = p.raw; }
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
  return out;
}

// ---- 주도 테마 고르기 (오늘 주도 테마 · 다음 날 아침 전일 주도 테마 공통) ----
// "돈이 몰린 테마" 우선: ① 네이버 테마 순위에서 종목 5개 이상 · 테마 등락률 +1% 이상 · 오른 종목 60% 이상인 후보(등락률 상위 12개)
// ② 후보마다 '강하게 오른 종목(+5% 이상)'에 몰린 거래대금(억)을 더한다 — 여러 테마에 걸친 대형주(예: LG화학 +2%)가
//    넓은 테마의 거래대금을 부풀리지 않게. 강세 종목이 2개 이상인 테마만 (한 종목만 튄 건 테마가 아님)
// ③ 거래대금 큰 상승 종목 3개의 외국인·기관 순매수(억)를 본다
// ④ 점수 = 강세 거래대금 × (외인+기관 순매수면 1.3 · 순매도면 0.7 · 모르면 1) → 높은 순, 대장주가 같은 테마는 하나만
// 조건에 맞는 테마가 없는 날(약세장)은 예전처럼 등락률 순으로 고른다.
const NV_HEAD = { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };
export const PREV_MIN_STOCKS = 5, PREV_FLAT = 0.5, LEAD_MIN_RATE = 1, LEAD_MIN_RISE = 0.6, LEAD_POOL = 12, HOT_RATE = 5, HOT_MIN = 2;
const themeRow = (g) => ({ no: g.no, name: String(g.name || "").trim(), count: num(g.totalCount), rate: num(g.changeRate), rise: num(g.totalCount) ? (num(g.riseCount) || 0) / num(g.totalCount) : 0 });
export function pickThemes(groups, n = 2) {
  return (Array.isArray(groups) ? groups : []).map(themeRow)
    .filter((g) => g.no !== undefined && g.name && g.rate !== null && (g.count || 0) >= PREV_MIN_STOCKS)
    .sort((a, b) => b.rate - a.rate).slice(0, n);
}
export function themeCandidates(groups, pool = LEAD_POOL) {
  return (Array.isArray(groups) ? groups : []).map(themeRow)
    .filter((g) => g.no !== undefined && g.name && g.rate !== null && (g.count || 0) >= PREV_MIN_STOCKS && g.rate >= LEAD_MIN_RATE && g.rise >= LEAD_MIN_RISE)
    .sort((a, b) => b.rate - a.rate).slice(0, pool);
}
export function leadStocks(stocks, n = 5) {
  return (Array.isArray(stocks) ? stocks : [])
    .map((x) => ({ code: x.itemCode, name: x.stockName, rate: num(x.fluctuationsRatio), value: num(x.accumulatedTradingValueRaw) ?? num(x.accumulatedTradingValue), price: num(x.closePrice) }))
    .filter((x) => x.code && x.rate !== null && x.rate > 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, n);
}
// 테마 전체 거래대금 (억원) · 강세 종목(+5% 이상) 거래대금과 개수
export const themeValue = (stocks) => Math.round((Array.isArray(stocks) ? stocks : []).reduce((s, x) => s + (num(x.accumulatedTradingValueRaw) || 0), 0) / 1e8);
export function hotValue(stocks) {
  const hot = (Array.isArray(stocks) ? stocks : []).filter((x) => (num(x.fluctuationsRatio) || 0) >= HOT_RATE);
  return { hot: Math.round(hot.reduce((s, x) => s + (num(x.accumulatedTradingValueRaw) || 0), 0) / 1e8), hotN: hot.length };
}
// 종목 투자자 동향 응답(최근 날짜 먼저) → { foreign, inst } 억원. want(YYYYMMDD)를 주면 그 날 값만 (아직 집계 전이면 null)
export function stockFlow(rows, want) {
  const r = Array.isArray(rows) ? rows[0] : null; if (!r) return null;
  if (want && String(r.bizdate) !== want) return null;
  const px = num(r.closePrice), f = num(r.foreignerPureBuyQuant), o = num(r.organPureBuyQuant);
  if (!px || f === null || o === null) return null;
  return { foreign: Math.round((f * px) / 1e8), inst: Math.round((o * px) / 1e8), bizdate: String(r.bizdate) };
}
export function rankThemes(themes, n) {
  const score = (t) => (t.hot ?? t.value ?? 0) * (t.flow ? (t.flow.foreign + t.flow.inst > 0 ? 1.3 : t.flow.foreign + t.flow.inst < 0 ? 0.7 : 1) : 1);
  const out = [], tops = new Set();
  [...themes].sort((a, b) => score(b) - score(a)).forEach((t) => {
    const top = t.stocks && t.stocks[0] && t.stocks[0].code;
    if (out.length >= n || (top && tops.has(top))) return;
    if (top) tops.add(top); out.push(t);
  });
  return out;
}
export async function selectThemes({ get, n = 3, bizdate = null }) {
  const list = await get("https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100");
  let cands = themeCandidates(list.groups), relaxed = false;
  if (!cands.length) { cands = pickThemes(list.groups, n); relaxed = true; }
  if (!cands.length) throw new Error("테마 순위 없음");
  for (const t of cands) {
    try { const d = await get("https://m.stock.naver.com/api/stocks/theme/" + t.no + "?page=1&pageSize=100"); t.value = themeValue(d.stocks); Object.assign(t, hotValue(d.stocks)); t.stocks = leadStocks(d.stocks); }
    catch (e) { t.value = 0; t.hot = 0; t.hotN = 0; t.stocks = []; }
  }
  const strong = cands.filter((t) => t.hotN >= HOT_MIN);
  if (!relaxed && strong.length) cands = strong; // 강세 종목 2개 이상인 테마가 없는 날은 조건 없이
  // 수급은 강세 거래대금 상위 후보만 (요청 수 줄이기): 상위 6개 × 주도주 3개
  const byValue = [...cands].sort((a, b) => (b.hot || 0) - (a.hot || 0) || (b.value || 0) - (a.value || 0)).slice(0, Math.max(n * 2, 6));
  for (const t of byValue) {
    const flows = [];
    for (const s of t.stocks.slice(0, 3)) { try { const f = stockFlow(await get("https://m.stock.naver.com/api/stock/" + s.code + "/trend?pageSize=1"), bizdate); if (f) flows.push(f); } catch (e) {} }
    if (flows.length) t.flow = { foreign: flows.reduce((x, f) => x + f.foreign, 0), inst: flows.reduce((x, f) => x + f.inst, 0), n: flows.length, bizdate: flows[0].bizdate };
  }
  const picked = rankThemes(relaxed ? cands : byValue, n);
  picked.forEach((t) => (t.relaxed = relaxed || undefined));
  return picked;
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

// keep: 같은 날 앞선 아침 수집의 prev (8:05 수집은 7:05에 고른 테마와 애프터마켓 값을 그대로 이어 쓴다)
export async function collectPrevThemes({ fetchImpl = fetch, timeoutMs = 10000, keep = null, bizdate = null } = {}) {
  const get = async (u) => {
    const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  let themes = Array.isArray(keep) && keep.length ? keep.map((t) => ({ no: t.no, name: t.name, rate: t.rate, value: t.value, flow: t.flow, stocks: t.stocks || [], after: t.after })) : null;
  if (!themes) {
    themes = await selectThemes({ get, n: 2, bizdate }); // 아침 9시 전 = 어제 마감 기준 (수급은 어제 날짜 값만)
  }
  const raws = [];
  for (const t of themes) {
    const moves = { after: [], pre: [] };
    for (const s of t.stocks) {
      try {
        const j = await get("https://polling.finance.naver.com/api/realtime/domestic/stock/" + s.code);
        const m = nxtMove(j && j.datas && j.datas[0]);
        raws.push(s.code + " " + m.raw);
        if (m.session) moves[m.session].push(m.pct);
      } catch (e) { raws.push(s.code + " " + (e.message || e)); }
    }
    const a = avg(moves.after), p = avg(moves.pre);
    if (a !== null) t.after = { pct: a, state: moveState(a), n: moves.after.length };
    if (p !== null) t.pre = { pct: p, state: moveState(p), n: moves.pre.length };
  }
  return { themes, raw: raws.join(", ") };
}

// 오늘 주도 테마 (장 마감 뒤): 돈이 몰린 테마 상위 3개 · 거래대금 · 외인/기관 · 주도주 2개
const eokText = (v) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조" : v.toLocaleString("ko-KR") + "억");
const signed = (v) => (v > 0 ? "+" : v < 0 ? "-" : "") + eokText(Math.abs(v));
export function flowText(flow) { return flow ? "외인 " + signed(flow.foreign) + " · 기관 " + signed(flow.inst) : ""; }
export function leadersText(themes) {
  return themes.map((t) => t.name + " " + (t.rate > 0 ? "+" : "") + t.rate + "%"
    + (t.hotN ? " · 강세 " + t.hotN + "종목 " + eokText(t.hot) : t.value ? " · 대금 " + eokText(t.value) : "") + (t.flow ? " · " + flowText(t.flow) : "")
    + (t.stocks && t.stocks.length ? " (" + t.stocks.slice(0, 2).map((x) => x.name).join("·") + ")" : "")).join(" / ");
}
export async function collectLeaders({ fetchImpl = fetch, timeoutMs = 10000, now = new Date(), bizdate = null } = {}) {
  const get = async (u) => { const r = await fetchImpl(u, { headers: NV_HEAD, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
  // 종목 수급은 그 날 값만. 네이버 종목별 외인·기관은 늦게(저녁~다음 날 아침) 올라와서, 없으면 다음 날 아침 수집이 어제 파일에 채운다
  const themes = await selectThemes({ get, n: 3, bizdate: bizdate || kstDate(now).replace(/-/g, "") });
  return { text: leadersText(themes), flowReady: themes.some((t) => t.flow), themes: themes.map((t) => ({ name: t.name, rate: t.rate, value: t.value, hot: t.hot, hotN: t.hotN, flow: t.flow, stocks: t.stocks.slice(0, 2).map((x) => x.name) })) };
}

// 오후: 코스피·코스닥 마감 등락률 + 투자자별 수급 (네이버)
export async function collectClose({ adapters, fetchImpl = fetch, now = new Date(), timeoutMs = 10000, leaders = null }) {
  const out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), market: {}, errors: [] };
  const inv = {};
  for (const k of ["kospi", "kosdaq"]) {
    const code = k.toUpperCase();
    try {
      const q = await adapters.naver.quote("domestic:" + code);
      out.market[k] = { value: Number(((q.price / q.prevClose - 1) * 100).toFixed(2)), close: q.price, src: "naver", time: q.time || undefined };
    } catch (e) { out.errors.push(k + ": " + (e.message || e)); }
    try {
      const res = await fetchImpl("https://m.stock.naver.com/api/index/" + code + "/trend", {
        headers: { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      inv[k] = parseTrend(await res.json());
    } catch (e) { out.errors.push(k + " 수급: " + (e.message || e)); }
  }
  if (Object.keys(inv).length) out.market.invest = Object.assign({ text: investText(inv) }, inv);
  if (leaders) {
    try { const l = await leaders(); if (l.text) out.market.leaders = l; }
    catch (e) { out.errors.push("주도 테마: " + (e.message || e)); }
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
    (m.prev || []).forEach((t) => lines.push(`아침 ${m.at} 전일테마 ${t.name} ${t.rate}% · 애프터 ${t.after ? t.after.pct + "% " + t.after.state : "—"} · 프리 ${t.pre ? t.pre.pct + "% " + t.pre.state : "—"} (${(t.stocks || []).map((x) => x.name).join("·")})`));
    if (m.prevRaw) lines.push("아침 NXT 세션 " + m.prevRaw);
    (m.errors || []).forEach((e) => lines.push("아침 실패 " + e));
  }
  const it = rec.intraday;
  if (it) lines.push(`장중 ${it.at} 코스피 ${it.kospi ?? "—"}% · 외인 선물 ${it.fut ? it.fut.foreign : "—"} · 현물 외인 ${it.spot ? it.spot.foreign : "—"}억 · 기관 ${it.spot ? it.spot.institution : "—"}억`);
  if (c) {
    ["kospi", "kosdaq"].forEach((k) => { const v = c.market && c.market[k]; if (v) lines.push(`오후 ${c.at} ${k.padEnd(6)} ${String(v.value).padStart(7)}%  종가 ${v.close}`); });
    if (c.market && c.market.invest) lines.push(`오후 ${c.at} 수급 ${c.market.invest.text}`);
    if (c.market && c.market.leaders) lines.push(`오후 ${c.at} 주도 테마 ${c.market.leaders.text}`);
    (c.errors || []).forEach((e) => lines.push("오후 실패 " + e));
  }
  return lines.join("\n");
}

export { kstDate };
