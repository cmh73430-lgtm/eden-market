// 9.29-102 원장 [1905][1951]: 「자주 나온 테마(단골)」 참고 줄 + 그림자 기록 — 세기 · 곱셈만(런타임 LLM 0 · 네이버 요청 0 · GitHub 쓰기 하루 1회)
//  자료 = 라이브 확정 주도 3개(급등 묶음 · 날짜 파일 close.market.leaders) 가 날마다 쌓인 것 · 연구용으로 다시 만든 과거 주도는 안 섞음(1차 최종보고 3-3)
//  횟수·채점은 대표 이름만(설계2: 정답에서 합친 이름 alias 는 0) · 합친 이름은 「오늘 주도」 제외에만 씀
//  그림자 줄(화면 0): y 오늘 그대로 · f3 단골 3(최근 20거래일 횟수) · tw3 시간 가중 단골 P′(Σ0.5^(d/10) · 60거래일) · f5 쉬는 단골 5(오늘 제외 횟수) · m2l5 순위학습 M2-L 차기 5(계수 표 shared/forecast-m2l.json) · new5 새 얼굴(오늘 4~8위)
//  자동 채점: 다음 거래일 run 이 어제 줄을 채점(내일 3 = 다음 날 확정 3개와 겹친 수 · 차기 5 = 다음 5거래일 확정 합집합에 든 수) · 100거래일 뒤 1번 판정(최종보고2 6절) · 판정 전 성적 열람 0
//  파일 auto/observe/forecast-shadow.json: days{ 날짜: { at, src(run|history), names, alias, step, live[{at,names,step}], amt{테마:억}, pred{ y,f3,f5,tw3,m2l5,new5 }, score{ n1{y,f3,tw3}, n5{f5,m2l5,new5} } } }
import { themeStatsAll } from "./surge.js";
export { themeStatsAll };

export const FC_FILE = "auto/observe/forecast-shadow.json";
export const FC_V = 1, FC_WIN = 20, FC_WIN5 = 5, FC_TW_H = 10, FC_TW_WIN = 60, FC_MIN_DAYS = 5, FC_TOP = 3, FC_NEXT = 5, FC_NEW_FROM = 4, FC_NEW_TO = 8;
export const FC_MAX_DAYS = 260, FC_AMT_DAYS = 25, FC_AMT_MIN = 10, FC_LIVE_MAX = 40;
export const FC_RULE = "단골 = 최근 20거래일 확정 주도(대표·합친 이름) 횟수 · P′ = Σ0.5^(d/10)(60거래일) · M2-L = 계수 표 z점수 합(라이브 상위 10% 종목 값 · 뉴스·공시 0) · 새 얼굴 = 오늘 강한 종목 순위 4~8위 · 채점 = 내일 3(겹친 수) · 차기 5(다음 5거래일 합집합) · 기록 5일 미만 화면 숨김 · 매매 신호 아님";
const round2 = (x) => Number(x.toFixed(2)), round4 = (x) => Number(x.toFixed(4));
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export const fcEmpty = () => ({ app: "jangjeon-cockpit", kind: "forecast-shadow", v: FC_V, rule: FC_RULE, updatedAt: null, days: {} });
export function fcNorm(file) { const e = fcEmpty(); return file && typeof file === "object" && file.days && typeof file.days === "object" ? Object.assign(e, file, { kind: e.kind, v: e.v, rule: FC_RULE, days: Object.fromEntries(Object.entries(file.days).map(([k, v]) => [k, Object.assign({}, v)])) }) : e; }
export const fcDates = (file) => Object.keys(file.days).filter((d) => Array.isArray(file.days[d].names)).sort();
const setOf = (d) => new Set(d.names || []); /* 횟수·채점 = 대표 이름만(설계2: 정답에서 합친 이름 alias 는 0) */
const allOf = (d) => new Set([...(d.names || []), ...(d.alias || [])]); /* 「오늘 주도」 제외에는 합친 이름까지 */
// 확정 주도 테마 목록(close.market.leaders.themes) → 대표 이름 · 합친 이름(alias)
export function leaderNames(themes) { const xs = (Array.isArray(themes) ? themes : []).filter((t) => t && t.name).slice(0, FC_TOP); return { names: xs.map((t) => t.name), alias: [...new Set(xs.flatMap((t) => (Array.isArray(t.alias) ? t.alias : [])))] }; }
// 날짜 date 를 기준으로 그날 포함 최근 n개 기록(가까운 날 먼저 · d = 거래일 거리 · 오늘 0) — 파일에 있는 날만(빠진 날은 건너뜀 = 기록 n일 표기)
export function recent(file, date, n = FC_TW_WIN) { return fcDates(file).filter((d) => d <= date).reverse().slice(0, n).map((d, i) => ({ date: d, d: i, set: setOf(file.days[d]), all: allOf(file.days[d]) })); }
export function countFreq(list) { const m = new Map(); for (const x of list) for (const nm of x.set) m.set(nm, (m.get(nm) || 0) + 1); return m; }
export function twMap(list, h = FC_TW_H) { const m = new Map(); for (const x of list) for (const nm of x.set) m.set(nm, (m.get(nm) || 0) + Math.pow(0.5, x.d / h)); return m; }
const topBy = (m, k, exclude = new Set(), key = "n", rnd = (v) => v) => [...m.entries()].filter(([nm]) => !exclude.has(nm)).map(([name, v]) => ({ name, [key]: rnd(v) })).sort((a, b) => b[key] - a[key] || byName(a, b)).slice(0, k);
// 단골 3 · 오늘 제외 단골 5 · P′ 3 (기록 n일 = 20거래일 창 안에 실제로 있는 날 수)
export function regularsOf(file, date) {
  const r20 = recent(file, date, FC_WIN), r60 = recent(file, date, FC_TW_WIN), today = r20.length && r20[0].date === date ? r20[0].all : new Set();
  const f = countFreq(r20), tw = twMap(r60);
  return { n: r20.length, f3: topBy(f, FC_TOP), f5: topBy(f, FC_NEXT, today), tw3: topBy(tw, FC_TOP, new Set(), "w", round4), tw5: topBy(tw, FC_NEXT, today, "w", round4), today: [...today] };
}
// 새 얼굴 = 오늘 강한 종목 순위(n10 → 강한 종목 돈 · 사다리 evalStep 과 같은 순서) 에서 오늘 주도(대표·합친 이름) 를 뺀 4~8위(= 뺀 뒤 1~5번째) · 강한 종목 0 이면 후보 아님
export function newFaces(stats, todaySet) {
  return Object.entries(stats || {}).filter(([nm, s]) => s.ns > 0 && !todaySet.has(nm)).sort(([a, x], [b, y]) => y.n10 - x.n10 || y.ms - x.ms || (a < b ? -1 : 1)).slice(0, FC_NEW_TO - FC_NEW_FROM + 1).map(([nm]) => nm);
}
// ---- M2-L 차기 5: 계수 표(shared/forecast-m2l.json · 연구 CSV 그대로) · 점수 = Σ w × (x − μ) ÷ σ · 뉴스·공시 4칸은 라이브에 없어 0(최종보고2 4-2) · 시장 4칸·오늘 순위·연속·pool1 은 w = 0 ----
export function m2lFeatures(name, { r20, r60, stats, amtHist }) {
  const s = (stats || {})[name] || {}, f5 = r20.slice(0, FC_WIN5), inDays = (list) => list.filter((x) => x.set.has(name));
  const cnt5 = inDays(f5).length, cnt20 = inDays(r20).length, tw10 = inDays(r60).reduce((a, x) => a + Math.pow(0.5, x.d / FC_TW_H), 0);
  const hit = inDays(r60); const days_since = hit.length ? Math.min(60, hit[0].d) : 99;
  const past = (amtHist || []).filter((v) => typeof v === "number" && v > 0); const amt_ratio20 = past.length >= FC_AMT_MIN && s.amt ? s.amt / (past.reduce((a, v) => a + v, 0) / past.length) : 1;
  return { today_rank: 0, streak: 0, cnt5, cnt20, tw10, days_since, n_strong: s.ns || 0, n10: s.n10 || 0, n_limit: s.nl || 0, n_data: s.nd || 0, mean_chg: s.mc || 0, rise_ratio: s.rr || 0, money_strong: s.ms || 0, amt_ratio20, top_share: s.ts || 0,
    news_pre: 0, disc_pos: 0, disc_neg: 0, disc_warn: 0, mkt_n10: 0, mkt_limit: 0, mkt_ew: 0, last_step: 0, pool1: 0, pool2: cnt20 > 0 ? 1 : 0 };
}
export function m2lScore(feat, table) { let s = 0; for (const r of (table && table.rows) || []) { const x = feat[r.feature]; if (typeof x !== "number" || !r.w) continue; s += r.w * ((x - r.mu) / (r.sd || 1e-9)); } return round4(s); }
export function m2lRank(file, date, stats, table, todaySet) {
  const r20 = recent(file, date, FC_WIN), r60 = recent(file, date, FC_TW_WIN), amtDays = fcDates(file).filter((d) => d < date).slice(-FC_AMT_DAYS).map((d) => file.days[d].amt || {});
  return Object.keys(stats || {}).filter((nm) => !todaySet.has(nm)).map((name) => ({ name, s: m2lScore(m2lFeatures(name, { r20, r60, stats, amtHist: amtDays.map((a) => a[name]) }), table) })).sort((a, b) => b.s - a.s || byName(a, b)).slice(0, FC_NEXT);
}
// ---- 기록 쌓기 ----
// 지난 날짜 파일(historyFrom · 최근 먼저)에서 파일에 없는 날을 이름만 채움(src history · 그림자 줄 없음) — 처음 20일 · 수집이 빠진 날
export function fcBootstrap(file, history) {
  let n = 0;
  for (const h of Array.isArray(history) ? history : []) { if (!h || !h.date || file.days[h.date] || !Array.isArray(h.leaders) || !h.leaders.length) continue; const L = leaderNames(h.leaders); if (!L.names.length) continue; file.days[h.date] = { src: "history", names: L.names, alias: L.alias }; n++; }
  return n;
}
// 오늘 줄: 확정 3개 이름 + 그림자 줄(stats 가 있을 때만 m2l5·new5 · 없으면 빈 목록 = 그 run 이 고르지 않았음) · 같은 날 두 번째 run 은 이름이 같으면 덮지 않음(live·amt 만 보충)
export function fcAddDay(file, { date, at, themes, step = null, live = null, stats = null, table = null }) {
  const L = leaderNames(themes); if (!L.names.length) return false;
  const cur = file.days[date], same = cur && cur.src === "run" && JSON.stringify(cur.names) === JSON.stringify(L.names) && cur.pred;
  const day = same ? cur : { src: "run", at, names: L.names, alias: L.alias, step };
  if (Array.isArray(live) && live.length) day.live = live.slice(-FC_LIVE_MAX);
  if (stats && Object.keys(stats).length) day.amt = Object.fromEntries(Object.entries(stats).filter(([, s]) => s.amt > 0).map(([nm, s]) => [nm, s.amt]));
  if (!same) {
    file.days[date] = day; const todaySet = allOf(day), R = regularsOf(file, date);
    day.pred = { y: L.names.slice(0, FC_TOP), f3: R.f3.map((x) => x.name), f5: R.f5.map((x) => x.name), tw3: R.tw3.map((x) => x.name), m2l5: stats && table ? m2lRank(file, date, stats, table, todaySet).map((x) => x.name) : [], new5: stats ? newFaces(stats, todaySet) : [] };
    day.n = R.n;
  }
  return true;
}
// 자동 채점: 파일에 든 거래일 순서로 다음 날(n1)·다음 5일(n5) 확정 이름과 맞춤 — 한 번 채점된 칸은 다시 안 함
export function fcScore(file) {
  const ds = fcDates(file); let filled = 0;
  const hits = (pred, set) => (Array.isArray(pred) ? pred.filter((nm) => set.has(nm)).length : null);
  for (let i = 0; i < ds.length; i++) { const d = file.days[ds[i]]; if (!d.pred) continue; d.score = d.score || {};
    if (!d.score.n1 && ds[i + 1]) { const s = setOf(file.days[ds[i + 1]]); d.score.n1 = { on: ds[i + 1], y: hits(d.pred.y, s), f3: hits(d.pred.f3, s), tw3: hits(d.pred.tw3, s) }; filled++; }
    if (!d.score.n5 && ds[i + FC_NEXT]) { const u = new Set(); for (let k = 1; k <= FC_NEXT; k++) for (const nm of setOf(file.days[ds[i + k]])) u.add(nm); d.score.n5 = { to: ds[i + FC_NEXT], f5: hits(d.pred.f5, u), m2l5: hits(d.pred.m2l5, u), new5: hits(d.pred.new5, u) }; filled++; }
    if (!Object.keys(d.score).length) delete d.score; }
  return filled;
}
export function fcTrim(file, max = FC_MAX_DAYS) { const ds = fcDates(file); let n = 0; for (const d of ds.slice(0, Math.max(0, ds.length - max))) { delete file.days[d]; n++; }
  for (const d of ds.slice(0, Math.max(0, ds.length - FC_AMT_DAYS))) if (file.days[d] && file.days[d].amt) delete file.days[d].amt; /* 테마별 돈은 20일 평균용 · 최근 25일만(파일 크기) */
  return n; }
// 날짜 파일에 넣는 화면용 값(close.forecast): 기록 n일 · 단골 3 · 쉬는 단골 5 (5일 미만이면 앱이 숨김)
export function fcSummary(file, date) { const R = regularsOf(file, date); return { n: R.n, f3: R.f3, f5: R.f5 }; }
export function fcText(file, date) { const d = file.days[date], R = regularsOf(file, date), p = d && d.pred; const nm = (xs) => (xs && xs.length ? xs.map((x) => (typeof x === "string" ? x : x.name + x.n + "회")).join("·") : "없음");
  return `단골(기록 ${R.n}일): ${nm(R.f3)} · 쉬는 단골 ${nm(R.f5)}` + (p ? ` · 그림자 P′ ${nm(p.tw3)} · M2-L ${nm(p.m2l5)} · 새 얼굴 ${nm(p.new5)}` : " · 그림자 줄 없음") + (d && d.live ? ` · 장중 ${d.live.length}회` : ""); }
