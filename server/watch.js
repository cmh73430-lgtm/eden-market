// 관심 후보 종목 (9.29-97 범위 확장 · 원장 [1802][1803]) — 「주도 테마 사이클을 이루는 테마들」 안 종목 중 최근 20일 수급 좋음 · 차트 정배열 · 눌림에서 바닥 다지기 또는 상승 전환
// 저녁 확정 close run(종목 수급이 들어온 뒤 · 19:45·20:20)이 계산해 날짜 파일 close.watch 에 둔다 → 다음 날 아침 brief ④ 가 이 이름으로 뉴스를 찾는다 (아침 추가 요청 = 후보 종목 뉴스 최대 WATCH_NEWS_N)
// 런타임 LLM 0 · 규칙으로만 · 값 지어내기 0 (못 받은 종목은 빼고 errors 에 적음)
//
// 규칙 (기본값 · 쉬운 말은 HANDOVER · 앱 「관심 후보」 설명):
//  사이클 테마 = 오늘 확정 주도 테마 1~3위 + 최근 20거래일 날짜 파일(close.market.leaders) 주도 테마 1~3위에 WATCH_MIN_TIMES(3)번 이상 든 테마 · 많이 든 순 · 최대 WATCH_THEMES(6)
//  테마 안 종목 = 네이버 테마 상세에서 오늘 거래대금 큰 순 WATCH_PER_THEME(8)개 (같은 종목 한 번)
//  종목마다 네이버 일별 수급 60행(trend?pageSize=60 · 종가·외국인·기관 순매수 주식 수) 1회 → server/auto.js trendRows 와 같은 계산(금액 = 주식 수 × 그날 종가 · stockFlow 와 같은 식)
//   · 수급20일+ : 최근 20거래일 (외국인 + 기관) 순매수 금액 합 > 0
//   · 정배열     : 종가 > 5일선 > 20일선 > 60일선 (종가 이동평균)
//   · 눌림바닥   : 20일선 > 60일선(중기 위) · 최근 20일 최고 종가 대비 -5% ~ -15% 눌림 · 종가 ≥ 20일선 × 0.97(20일선 근처·위) · 최근 5일 최저 종가 ≥ 그 앞 5일 최저 종가(저점 안 깨짐)
//   · 상승전환   : 20일선 > 60일선 · 어제 종가 ≤ 어제 5일선 → 오늘 종가 > 오늘 5일선(5일선 회복) · 오늘 종가 > 어제 종가 · 최근 20일 최고 종가보다 3% 이상 아래(아직 눌린 자리)
//   · 후보 = 수급20일+ 이고 (정배열 또는 눌림바닥 또는 상승전환)
//  차트 자리 꼬리 = server/auto.js gradeC(신고가·돌파·돌파직전·눌림·추세아래)를 종가 봉(고가 = 종가)으로 같은 식 계산 → 참고로 같이 저장
import { parseStocks, trendRows, gradeC } from "./auto.js";

export const WATCH_V = 1, WATCH_DAYS = 20, WATCH_MIN_TIMES = 3, WATCH_THEMES = 6, WATCH_PER_THEME = 8, WATCH_MAX = 12, WATCH_TREND_N = 60, WATCH_NEWS_N = 5;
export const WATCH_RULE = "사이클 테마 = 오늘 주도 1~3위 + 최근 20거래일 주도 1~3위에 3번↑ · 테마마다 거래대금 상위 8종목 · 수급20일+ = 20일 외국인+기관 순매수 합 > 0 · 정배열 = 종가>5일선>20일선>60일선 · 눌림바닥 = 20일선>60일선 · 20일 최고 종가 대비 -5~-15% · 종가 ≥ 20일선×0.97 · 최근 5일 최저 ≥ 앞 5일 최저 · 상승전환 = 20일선>60일선 · 5일선 회복(어제 ≤ → 오늘 >) · 오늘 상승 · 20일 최고보다 3%↓ · 후보 = 수급20일+ 이고 (정배열 또는 눌림바닥 또는 상승전환)";
export const trendUrl = (code, n = WATCH_TREND_N) => "https://m.stock.naver.com/api/stock/" + code + "/trend?pageSize=" + n;
export const themeUrl = (no) => "https://m.stock.naver.com/api/stocks/theme/" + no + "?page=1&pageSize=100";
const r2 = (x) => Number(x.toFixed(2));

// 사이클 테마: today = 오늘 확정 leaders.themes · history = historyFrom() (오늘 제외 · 최근 먼저) — 이름으로 셈(합쳐진 이름 alias 도 같은 테마로)
export function cycleThemes(today = [], history = [], { days = WATCH_DAYS, min = WATCH_MIN_TIMES, max = WATCH_THEMES } = {}) {
  const m = new Map(), key = (t) => String((t && t.name) || "").trim();
  const add = (t, isToday) => { const k = key(t); if (!k) return; const x = m.get(k) || { name: k, no: t.no, times: 0, today: false }; x.times++; if (isToday) x.today = true; if (x.no === undefined && t.no !== undefined) x.no = t.no; m.set(k, x); };
  (today || []).slice(0, 3).forEach((t) => add(t, true));
  (history || []).slice(0, days - 1).forEach((h) => ((h && h.leaders) || []).slice(0, 3).forEach((t) => add(t, false)));
  return [...m.values()].filter((x) => x.today || x.times >= min).sort((a, b) => b.times - a.times || (b.today ? 1 : 0) - (a.today ? 1 : 0)).slice(0, max);
}
const ma = (xs, n, end = xs.length) => (end >= n ? xs.slice(end - n, end).reduce((s, x) => s + x, 0) / n : null);
// 한 종목 판정: rows = trendRows() (오래된 순 · close·foreign·inst 억)
export function watchSignals(rows) {
  const xs = (Array.isArray(rows) ? rows : []).filter((r) => typeof r.close === "number" && r.close > 0);
  if (xs.length < 21) return null;
  const c = xs.map((r) => r.close), n = c.length, close = c[n - 1], prev = c[n - 2];
  const m5 = ma(c, 5), m20 = ma(c, 20), m60 = ma(c, 60), m5y = ma(c, 5, n - 1);
  const f20 = xs.slice(-20), fl = f20.filter((r) => typeof r.foreign === "number" && typeof r.inst === "number");
  const flow20 = fl.length >= 15 ? Math.round(fl.reduce((s, r) => s + r.foreign + r.inst, 0)) : null; // 수급 칸 비면(15일 미만) 판정 안 함
  const hi20 = Math.max(...c.slice(-20)), off20 = r2(((hi20 - close) / hi20) * 100);
  const mid = m20 !== null && m60 !== null && m20 > m60;
  const low5 = Math.min(...c.slice(-5)), low5b = n >= 10 ? Math.min(...c.slice(-10, -5)) : null;
  const flowGood = flow20 !== null && flow20 > 0;
  const align = m60 !== null && close > m5 && m5 > m20 && m20 > m60;
  const pullBase = mid && off20 >= 5 && off20 <= 15 && close >= m20 * 0.97 && low5b !== null && low5 >= low5b;
  const turnUp = mid && m5y !== null && prev <= m5y && close > m5 && close > prev && off20 >= 3;
  const g = gradeC(xs.map((r) => ({ localDate: r.date.replace(/-/g, ""), closePrice: r.close, highPrice: r.close }))); // 종가 봉 기준 차트 자리 (참고)
  return { close, flow20, off20, ma5: r2(m5), ma20: r2(m20), ma60: m60 === null ? null : r2(m60), flowGood, align, pullBase, turnUp, chart: g ? g.tag : null, days: n, date: xs[n - 1].date };
}
export const watchTags = (s) => (s ? [s.flowGood ? "수급20일+" : null, s.align ? "정배열" : null, s.pullBase ? "눌림바닥" : null, s.turnUp ? "상승전환" : null].filter(Boolean) : []);
export const isWatch = (s) => !!(s && s.flowGood && (s.align || s.pullBase || s.turnUp));

// 저녁 확정 run 한 번: get(url)=json · leaders = 오늘 확정 close.market.leaders · history = historyFrom (오늘 제외) · date = 오늘
export const WATCH_BUDGET_MS = 120000; // 저녁 관심 후보 전체 시간 예산 (Actions 10분 안 · 관찰 기록 4분과 따로)
// 같은 날 지난 값(prev)이 있고 사이클 테마 이름이 같으면 다시 계산 안 함(요청 0 · 20:20 run) · 시간 예산 넘으면 남은 요청 안 함(errors)
export async function collectWatch({ get, date, leaders = null, history = [], now = new Date(), prev = null, budgetMs = WATCH_BUDGET_MS, clock = () => Date.now() } = {}) {
  const errors = []; let requests = 0; const deadline = clock() + budgetMs;
  const req = async (u) => { if (clock() > deadline) throw new Error("시간 예산 넘음"); requests++; return get(u); };
  const themes = cycleThemes((leaders && leaders.themes) || [], history);
  const names = (ts) => (ts || []).map((t) => t.name).join("|");
  if (prev && prev.date === date && prev.checked > 0 && !prev.err && names(prev.themes) === names(themes)) return Object.assign({}, prev, { reused: new Date(now.getTime() + 9 * 3600e3).toISOString().slice(11, 16), requests: 0 });
  const pool = new Map();
  for (const t of themes) {
    if (t.no === undefined || t.no === null) { errors.push("테마 번호 없음 " + t.name); continue; }
    try {
      const d = await req(themeUrl(t.no)); const st = parseStocks(d && d.stocks).filter((x) => /^[0-9A-Z]{6}$/.test(String(x.code || "")) && typeof x.value === "number").sort((a, b) => b.value - a.value).slice(0, WATCH_PER_THEME);
      t.n = st.length; for (const x of st) if (!pool.has(x.code)) pool.set(x.code, { code: x.code, name: x.name, theme: t.name });
    } catch (e) { errors.push("테마 " + t.name + ": " + (e.message || e)); }
  }
  const all = [];
  for (const s of pool.values()) {
    try { const sig = watchSignals(trendRows(await req(trendUrl(s.code)))); if (!sig) { errors.push(s.code + ": 일별 행 부족"); continue; } all.push(Object.assign({}, s, sig)); }
    catch (e) { errors.push(s.code + ": " + (e.message || e)); }
  }
  const score = (x) => (x.align ? 1 : 0) + (x.pullBase ? 1 : 0) + (x.turnUp ? 1 : 0);
  const stocks = all.filter(isWatch).sort((a, b) => score(b) - score(a) || b.flow20 - a.flow20).slice(0, WATCH_MAX)
    .map((x) => ({ code: x.code, name: x.name, theme: x.theme, tags: watchTags(x), flow20: x.flow20, off20: x.off20, chart: x.chart, date: x.date }));
  return { v: WATCH_V, date, at: new Date(now.getTime() + 9 * 3600e3).toISOString().slice(11, 16), rule: WATCH_RULE, themes: themes.map((t) => ({ name: t.name, no: t.no, times: t.times, today: t.today || undefined, n: t.n })), checked: all.length, pool: pool.size, stocks, requests, errors: errors.slice(0, 12) };
}
// 저장 합치기: 이번 결과가 하나도 판정 못 했으면(checked 0 · 요청 전부 실패) 같은 날 지난 값 유지 + 시도 시각·오류만 (20:20 run 이 19:45 후보를 빈 목록으로 덮지 않게 · 원장 [1809] 필수 ②)
export function mergeWatch(old, fresh, date) {
  if (fresh && fresh.checked > 0) return fresh;
  if (old && old.date === date && old.checked > 0) { const o = Object.assign({}, old, { tryAt: fresh ? fresh.at : null, err: fresh ? (fresh.errors || []).slice(0, 3).join(" / ") || "판정 0" : "실패" }); return o; }
  return fresh || old || null;
}
export function watchText(w) {
  if (!w) return "관심 후보 없음";
  if (w.reused) return `관심 후보 ${w.date} ${w.at} 그대로 (${w.reused} · 같은 사이클 테마 · 요청 0) · 후보 ${w.stocks.length}`;
  return `관심 후보 ${w.date} ${w.at}${w.err ? ` · ⚠ ${w.tryAt} 다시 계산 실패(${w.err}) → 지난 값 유지` : ""} · 사이클 테마 ${w.themes.map((t) => t.name + "(" + t.times + "회" + (t.today ? "·오늘" : "") + ")").join(" / ") || "없음"} · 종목 ${w.pool} 중 판정 ${w.checked} → 후보 ${w.stocks.length}: ${w.stocks.map((s) => `${s.name}[${s.tags.join("·")}]`).join(" / ") || "없음"} · 요청 ${w.requests}회${w.errors.length ? " · 참고 " + w.errors.slice(0, 4).join(" / ") : ""}`;
}
