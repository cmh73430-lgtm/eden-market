// 9.29-162 원장 [집2668] 「장 초반 식별 시험」 — 사전 등록 문서 docs/trial-162.md (규칙 고정 · 시험 중 변경 0)
//  장중 실시간(live) 회차 중 09:05~10:30 회차마다: 전체 테마 그 시각 등락률·오른 종목 수·종목 수(네이버 테마 목록 · 요청 +3) · 하루 1번 전 종목 시가·전일 종가(네이버 폴링 300종목씩 · 요청 +8)
//  + 미리 계산한 선정(H1 시가 갭 · H2 혼합 평균 · 앱 A·B·C · 오늘 상위 그대로 · 공식 N20 · 참고 「그 시각 상위」)을 auto/trial/<날짜>.json 에 덧붙임 (live.json 무접촉 · 앱은 안 읽음)
//  다음 거래일 첫 기록이 그날 확정 정답표(날짜 파일 close.themes · 3종목 이하 제외 위 10)로 채점해 score 를 덧붙임 · 정답표는 auto/trial/answers.json 에 모음(공식 N20 · 오늘 상위 그대로의 원천)
//  규칙 고정(gate [집2677] ①): 이 파일 글자 전부(TRIAL_DEF 포함)(상수·num·trialStep·scoreOf·inTrialWindow·방법·검정 함수) + scripts/trial-162-judge.mjs 글자 전부의 해시(TRIAL_HASH)를 기록마다 넣음
//    → 판정 스크립트가 자기 글자를 읽어 같은 해시를 다시 만들고, 다른 기록이 하나라도 있으면 거부 · 주석 한 글자도 바뀌면 해시가 바뀜(시험 중 이 두 파일 잠금)
//  157 R2(D:\에덴콕핏\work\도구\157\R2\lib_r2.mjs) 정의 그대로 · 다른 점 2개만: ① big_move(당일 종가로 잰 ±30.5%) 거름 없음(당일 종가 누수 제거 · 갭 ±30.5% 거름은 그대로) ② 전일 종가 = 네이버 기준가(현재가 − 전일 대비 · 일봉 전 봉 종가 대신)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TRIAL_DIR = "auto/trial", TRIAL_ANS = TRIAL_DIR + "/answers.json";
export const trialFile = (d) => TRIAL_DIR + "/" + d + ".json";
export const trialOpenFile = (d) => TRIAL_DIR + "/open/" + d + ".json";
export const THEME_LIST_URL = (p) => "https://m.stock.naver.com/api/stocks/theme?page=" + p + "&pageSize=100";
export const POLL_URL = (codes) => "https://polling.finance.naver.com/api/realtime/domestic/stock/" + codes.join(",");
export const POLL_BATCH = 300, LIST_PAGES_MAX = 4, ANS_KEEP = 45, BOOT_SCAN = 30, PENDING_TRIES = 5, TRIAL_BUDGET_MS = 30000, OPEN_MIN_SHARE = 0.5;

// 시험 정의(사전 등록 · 바꾸면 해시가 바뀌어 판정 거부)
export const TRIAL_DEF = Object.freeze({
  id: "trial-162", v: 1,
  h1At: "09:05", h2At: "10:00", win: ["09:05", "10:30"], // H1 = 그날 시가 갭(09:05 회차에 받음) · H2 = 10:00 이하 마지막 회차 · 기록 창 = 09:05~10:30
  K: 3, K2: 5, // 주 K=3 · 보조 K=5
  gapMax: 30.5, minValid: 4, small: 3, // 종목 갭 |g| > 30.5% 뺌 · 유효 4종목↑ 테마만 · 구성 3종목 이하 테마 뺌
  ansK: 10, n20: 20, // 정답 = close.themes 3종목 이하 제외 위 10 · 공식 N20 = 직전 정답표 20일 위 10 등장 횟수
  need: 36, alpha: 0.05, boot: 2000, seed: 158, // 표본 36일 · 정확 부호 뒤집기 p < 0.05 + 날짜 부트스트랩 95% 하한 > 0
  methods: ["h1", "h2"], compare: ["appA", "today", "n20"],
});

const num = (x) => { if (x === null || x === undefined || x === "") return null; const v = typeof x === "number" ? x : Number(String(x).replace(/,/g, "")); return Number.isFinite(v) ? v : null; };
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---- 방법 코드(해시 대상) ----
// 폴링 한 줄 → [시가, 전일 종가] · 전일 종가 = 현재가 − 전일 대비(auto.js prevCloseOf 와 같은 부호 규칙) · 거래 시각 날짜 ≠ 그 거래일(정지 등 지난 값) · 시가 0(아직 체결 없음·정지) = null
export function quoteOf(q, date) {
  if (!q || !q.itemCode) return null;
  if (date && String(q.localTradedAt || "").slice(0, 10) !== date) return null;
  const open = num(q.openPriceRaw ?? q.openPrice), price = num(q.closePriceRaw ?? q.closePrice), chg = num(q.compareToPreviousClosePriceRaw ?? q.compareToPreviousClosePrice), dir = q.compareToPreviousPrice;
  if (open === null || price === null || chg === null) return null;
  const falling = !!dir && (dir.name === "FALLING" || dir.name === "LOWER_LIMIT" || dir.code === "5" || dir.code === "4");
  const prev = price - (falling && chg > 0 ? -chg : chg);
  return open > 0 && prev > 0 ? [open, prev] : null;
}
// 종목 시가 갭(%) = 시가 ÷ 전일 종가 − 1 · |갭| > 30.5% 뺌(권리락 등 · 당일 종가는 안 씀)
export function gapOf(q) { if (!Array.isArray(q) || !(q[0] > 0) || !(q[1] > 0)) return null; const g = (q[0] / q[1] - 1) * 100; return Math.abs(g) > TRIAL_DEF.gapMax ? null : g; }
export function gapsOf(quotes) { const g = {}; for (const [c, q] of Object.entries(quotes || {})) { const x = gapOf(q); if (x !== null) g[c] = x; } return g; }
// 테마 특징(R2 themeFeats 그대로): G = 갭 평균 · Bg = 갭 > 0 비율 · Hm = 그 시각 알려진 종목 등락률(없으면 갭)의 평균 · 구성 3종목 이하·유효 4종목 미만 뺌
export function themeFeats(map, gaps, known = {}) {
  const out = [], mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  for (const t of (map && map.themes) || []) {
    const cnt = typeof t.count === "number" ? t.count : (t.codes || []).length; if (cnt <= TRIAL_DEF.small) continue;
    const gs = [], hs = [];
    for (const c of t.codes || []) { if (gaps[c] === undefined) continue; gs.push(gaps[c]); hs.push(known[c] !== undefined ? known[c] : gaps[c]); }
    if (gs.length < TRIAL_DEF.minValid) continue;
    out.push({ no: t.no, G: mean(gs), Bg: gs.filter((x) => x > 0).length / gs.length, Hm: mean(hs), n: gs.length });
  }
  return out;
}
export const pickH1 = (feats, K) => feats.slice().sort((a, b) => b.G - a.G || a.no - b.no).slice(0, K).map((x) => x.no);
export const pickH2 = (feats, K) => feats.slice().sort((a, b) => b.Hm - a.Hm || a.no - b.no).slice(0, K).map((x) => x.no);
// 그 회차가 본 종목 등락률(R2 knownRates 그대로): A 슬롯 → 거래대금 위 50(rankB.top) 순으로 덮음
export function knownOf(live) {
  const k = {};
  for (const t of (live && live.themes) || []) for (const s of (t && t.slots) || []) if (s && s.code && typeof s.rate === "number") k[s.code] = s.rate;
  const top = live && live.rankB && live.rankB.top; for (const s of Array.isArray(top) ? top : []) if (s && s.code && typeof s.rate === "number") k[s.code] = s.rate;
  return k;
}
// 정답표: 테마 목록(close.themes 꼴 { no, name, rate, count }) → 3종목 이하 제외 · 등락률 큰 순(같으면 받은 순) 위 10 (surge.js abNeutralTop 과 같은 규칙 + 번호)
export function answerTop(themes, k = TRIAL_DEF.ansK) {
  const xs = (Array.isArray(themes) ? themes : []).map((t, i) => ({ t, i })).filter(({ t }) => t && t.name && t.no !== undefined && typeof t.rate === "number" && isFinite(t.rate) && !(typeof t.count === "number" && t.count <= TRIAL_DEF.small));
  xs.sort((a, b) => b.t.rate - a.t.rate || a.i - b.i);
  return xs.slice(0, k).map(({ t }, i) => ({ rk: i + 1, no: t.no, rate: t.rate }));
}
// 오늘 상위 그대로(당일 지평 = 직전 정답표 위 K) · 공식 N20(직전 정답표 20일 위 10 등장 횟수 → 최근 등장 → 순위 합 → 번호 · 20일 안 되면 빈 목록) — 157 G/g_base_intraday.mjs 그대로
export function pickToday(ans, d, K) { const ds = Object.keys(ans || {}).filter((x) => x < d).sort(), p = ds[ds.length - 1]; return p ? ans[p].top.slice(0, K).map((t) => t.no) : []; }
export function pickN20(ans, d, K, n = TRIAL_DEF.n20) {
  const ds = Object.keys(ans || {}).filter((x) => x < d).sort(); if (ds.length < n) return [];
  const c = new Map(); ds.slice(-n).forEach((x, i) => { for (const t of ans[x].top) { const o = c.get(t.no) || { no: t.no, n: 0, last: -1, rk: 0 }; o.n++; o.last = i; o.rk += t.rk; c.set(t.no, o); } });
  return [...c.values()].sort((a, b) => b.n - a.n || b.last - a.last || a.rk - b.rk || a.no - b.no).slice(0, K).map((o) => o.no);
}
// 참고(판정 안 함): 그 시각 테마 등락률 위 K(정답표와 같은 규칙)
export const pickNow = (rows, K) => answerTop(rows, K).map((t) => t.no);
export function hitsOf(list, top, K) { const s = new Set(top || []); return (list || []).slice(0, K).filter((x) => s.has(x)).length; }
// 그날 판정 입력: 10:00 이하(09:05↑) 회차 중 H2 가 있는 마지막 회차 · 시가 갭 H1 · 정답표 — 하나라도 없으면 빠진 날
export function dayLists(f) {
  if (!f || typeof f.date !== "string") return { ok: false, why: "파일 이상" };
  const rs = (Array.isArray(f.runs) ? f.runs : []).filter((r) => r && typeof r.at === "string" && r.at >= TRIAL_DEF.win[0] && r.at <= TRIAL_DEF.h2At && !r.closed && Array.isArray(r.h2) && r.h2.length).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (!f.gap || !Array.isArray(f.gap.h1) || !f.gap.h1.length) return { ok: false, why: "시가 갭 없음" };
  if (!rs.length) return { ok: false, why: "10:00 전 회차 없음" };
  if (!f.score || !Array.isArray(f.score.top) || !f.score.top.length) return { ok: false, why: "정답표 없음(채점 전)" };
  const last = rs[rs.length - 1];
  return { ok: true, at: last.at, code: last.code || null, top: f.score.top, lists: { h1: f.gap.h1, h2: last.h2, appA: Array.isArray(last.a) ? last.a : [], today: (f.base && f.base.today) || [], n20: (f.base && f.base.n20) || [] } };
}
export function rng(seed) { let s = seed >>> 0; return () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 날짜 부트스트랩 95% 구간(157 x_gate_pair.mjs 와 같은 난수·같은 자리: 2,000번 중 51번째·1,950번째)
export function bootCI(v, B = TRIAL_DEF.boot, seed = TRIAL_DEF.seed) {
  const R = rng(seed), ms = [], n = v.length; if (!n) return null;
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += v[Math.floor(R() * n)]; ms.push(s / n); }
  ms.sort((x, y) => x - y); return [ms[Math.floor(B * 0.025)], ms[Math.ceil(B * 0.975) - 1]];
}
// 정확 부호 뒤집기 p(양쪽 · 0 인 날 포함 2^n 가지 전부 · x_gate_pair.mjs 와 같은 값) — 하루 적중 차는 정수라 합의 분포를 세어서(36일도 바로)
export function signFlipP(v) {
  if (!v.length) return null; if (!v.every((x) => Number.isInteger(x))) throw new Error("정수 차만");
  let dist = new Map([[0, 1]]);
  for (const x of v) { const nd = new Map(); for (const [s, c] of dist) { nd.set(s + x, (nd.get(s + x) || 0) + c); nd.set(s - x, (nd.get(s - x) || 0) + c); } dist = nd; }
  const obs = Math.abs(v.reduce((a, b) => a + b, 0)); let hit = 0, all = 0; for (const [s, c] of dist) { all += c; if (Math.abs(s) >= obs) hit += c; }
  return hit / all;
}
// 짝 비교(같은 날 하루 적중 차 · 한쪽 목록이 빈 날은 뺌 = 157 g_pair.mjs) → 합격 = p < 0.05 그리고 하한 > 0
export function pairStat(days, a, b, K = TRIAL_DEF.K) {
  const use = days.filter((d) => d.lists[a].length && d.lists[b].length), v = use.map((d) => hitsOf(d.lists[a], d.top, K) - hitsOf(d.lists[b], d.top, K));
  if (!v.length) return { a, b, K, n: 0, pass: false };
  const mean = v.reduce((x, y) => x + y, 0) / v.length, ci = bootCI(v), p = signFlipP(v);
  return { a, b, K, n: v.length, ma: use.reduce((s, d) => s + hitsOf(d.lists[a], d.top, K), 0) / v.length, mb: use.reduce((s, d) => s + hitsOf(d.lists[b], d.top, K), 0) / v.length, mean, lo: ci[0], hi: ci[1], p, plus: v.filter((x) => x > 0).length, zero: v.filter((x) => x === 0).length, minus: v.filter((x) => x < 0).length, pass: p < TRIAL_DEF.alpha && ci[0] > 0 };
}
// 해시 대상 = 이 파일 전체 + 판정 스크립트 전체(줄 끝 LF 로 맞춤) · 판정 스크립트가 없으면(동기화 빠짐) 「없음」 글자로 → 해시가 달라져 판정이 거부(수집은 안 죽음)
const norm = (t) => String(t).replace(/\r\n/g, "\n");
export const TRIAL_SRC_URL = new URL(import.meta.url), TRIAL_JUDGE_URL = new URL("../scripts/trial-162-judge.mjs", import.meta.url);
export const readSrc = (u) => { try { return norm(readFileSync(fileURLToPath(u), "utf8")); } catch (e) { return "(없음 " + String(u).split("/").pop() + ")"; } };
//  코드 밖 대조(docs/trial-162.md 9절): ( cat server/trial162.js; printf '\n'; cat scripts/trial-162-judge.mjs ) | sha256sum | cut -c1-16  = 같은 값
export function trialHash({ trialSrc = readSrc(TRIAL_SRC_URL), judgeSrc = readSrc(TRIAL_JUDGE_URL) } = {}) { return createHash("sha256").update(norm(trialSrc) + "\n" + norm(judgeSrc)).digest("hex").slice(0, 16); }
export const TRIAL_HASH = trialHash();
// 회차를 만든 코드(게이트 권고 · 시험 시작 전): 수집기 저장소 커밋(GITHUB_SHA · 없으면 null · eden-market 은 자료 커밋마다 바뀜 = 추적용) + 앱 A 선정 코드 식별(판정 스크립트가 바뀐 날을 찍음)
//  9.29-176 게이트 잔여 권고: 앱 A 코드 범위 = server/surge.js 와 그 파일이 import 하는 파일 전부(재귀 · 상대 경로의 정적 import / export … from / import("…") · 런타임에 실제 읽히는 모듈과 같음 — 2026-11-24 로더 실측 12개)
//  식별 = 파일을 저장소 기준 경로 사전 순으로 「경로 + 줄바꿈 + 글자(줄 끝 LF) + 줄바꿈」 이어 붙인 sha256 앞 16 · 파일 목록도 회차마다 적음(appAFiles)
//  코드 밖 대조(docs/trial-162.md 6절): for f in <appAFiles 순서>; do printf '%s\n' "$f"; cat "$f"; printf '\n'; done | sha256sum | cut -c1-16
export const APP_A_ROOT = new URL("./surge.js", import.meta.url), REPO_URL = new URL("../", import.meta.url);
const IMPORT_RE = /(?:^|[\n;])\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|[\n;])\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
export function appAFiles(root = APP_A_ROOT) {
  const seen = new Map(), q = [root];
  while (q.length) { const u = q.shift(), k = u.href; if (seen.has(k)) continue; const src = readSrc(u); seen.set(k, { rel: decodeURIComponent(k.slice(REPO_URL.href.length)), src });
    if (!/\.m?js$/.test(u.pathname)) continue; IMPORT_RE.lastIndex = 0; let m; while ((m = IMPORT_RE.exec(src))) { const s = m[1] || m[2] || m[3]; if (s && s.startsWith(".")) q.push(new URL(s, u)); } }
  return [...seen.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}
export const appCodeOf = (files = appAFiles()) => ({ appA: createHash("sha256").update(files.map((f) => f.rel + "\n" + f.src + "\n").join("")).digest("hex").slice(0, 16), appAFiles: files.map((f) => f.rel) });
export const appCodeId = () => appCodeOf().appA;

// ---- 기록(입출력은 받아서 씀 · 시험 가능) ----
export const inTrialWindow = (live) => !!(live && typeof live.at === "string" && !live.closed && live.at >= TRIAL_DEF.win[0] && live.at <= TRIAL_DEF.win[1]);
// 채점 블록 = 그날 정답표(위 10 번호·등락률)만 · 하루 적중 수는 저장 안 함(gate [집2677] ② · 판정 스크립트가 36일 뒤 예측 목록과 정답표로 계산)
//  원자료(예측 목록·정답표)는 공개 저장소에 있어 누구나 계산할 수 있음 → 통제는 규칙(중간에 봐도 규칙 변경 0 · 조기 종료 없음)으로
export function scoreOf(f, top, { at = null, src = null } = {}) { return { at, hash: TRIAL_HASH, src, top: top.map((t) => t.no), rate: top.map((t) => t.rate) }; }
const themeRows = (groups) => groups.map((g) => ({ no: g.no, name: String(g.name || "").trim(), rate: num(g.changeRate), rise: num(g.riseCount), count: num(g.totalCount) }));
// 한 회차 기록: { live(이번 실시간 결과) · date · map(테마 구성표) · get(네이버 GET → JSON) · rd(경로 → JSON | 없으면 null · 실패는 throw) · wr(경로, 객체, 글) · prevDays(d, n → 직전 거래일 n개 최근 먼저) · ranAt · force(창 무시) }
export async function trialStep({ live, date, map, get, rd, wr, prevDays, code = Object.assign({ sha: process.env.GITHUB_SHA || null }, appCodeOf()), ranAt = null, force = false, nowIso = new Date().toISOString(), log = () => {}, budgetMs = TRIAL_BUDGET_MS, clock = () => Date.now() }) {
  const t0 = clock(), req = { naver: 0, poll: 0, list: 0, ghRead: 0, ghWrite: 0 }, H = TRIAL_HASH, D = TRIAL_DEF;
  if (!force && !inTrialWindow(live)) return { skip: "시험 기록 창(" + D.win.join("~") + ") 밖 " + (live && live.at) };
  if (!map || !Array.isArray(map.themes) || !map.themes.length) return { skip: "테마 구성표 없음" };
  const R = async (p) => { req.ghRead++; return rd(p); }, W = async (p, o, m) => { req.ghWrite++; await wr(p, o, m); return Buffer.byteLength(JSON.stringify(o)); };
  const G = async (u, k) => { req.naver++; req[k]++; return get(u); }, late = () => clock() - t0 > budgetMs;
  const sizes = {}, notes = [], graded = [];
  let day = await R(trialFile(date)); if (day && day.date !== date) throw new Error(trialFile(date) + " 날짜 다름 " + day.date);
  // 그날 첫 기록: 정답표 모음(answers.json) 채우기 → 지난 시험일 채점 → 오늘 상위 그대로·공식 N20
  if (!day) {
    const ans = (await R(TRIAL_ANS)) || { v: 1, kind: "trial-162-answers", rule: "close.themes 3종목 이하 제외 위 10 (score 와 같은 규칙)", days: {}, trialDays: [], pending: {} };
    ans.days = ans.days || {}; ans.trialDays = ans.trialDays || []; ans.pending = ans.pending || {};
    const have = Object.keys(ans.days).filter((x) => x < date).sort(), last = have[have.length - 1] || null, boot = !ans.boot; /* 처음 1번만 지난 30거래일을 거슬러 20일 채움 · 그 뒤로는 마지막 정답표 뒤 날짜 + 못 받은 날(최대 5번) */
    const want = prevDays(date, BOOT_SCAN).filter((p) => !ans.days[p] && (boot || (last && p > last) || ans.pending[p] !== undefined));
    let found = have.length;
    for (const p of want) {
      if (late()) { notes.push("시간 예산 넘어 정답표 일부만"); break; }
      if (boot && found >= D.n20) break;
      const f = await R("auto/" + p + ".json"), th = f && f.date === p && f.close && Array.isArray(f.close.themes) ? f.close.themes : null, top = answerTop(th);
      if (top.length) {
        ans.days[p] = { top, at: (f.close && f.close.at) || null }; delete ans.pending[p]; found++;
        if (ans.trialDays.includes(p)) { const tf = await R(trialFile(p)); if (tf && tf.date === p && !tf.score) { tf.score = scoreOf(tf, top, { at: nowIso, src: "auto/" + p + ".json close.themes" }); sizes[trialFile(p)] = await W(trialFile(p), tf, `시험 162 ${p} 채점`); graded.push(p); } }
      } else { ans.pending[p] = (ans.pending[p] || 0) + 1; if (ans.pending[p] > PENDING_TRIES) delete ans.pending[p]; }
    }
    if (boot && !late()) ans.boot = date;
    const keep = Object.keys(ans.days).sort().slice(-ANS_KEEP); ans.days = Object.fromEntries(keep.map((x) => [x, ans.days[x]]));
    if (!ans.trialDays.includes(date)) ans.trialDays = [...ans.trialDays, date].sort().slice(-60);
    const prior = Object.keys(ans.days).filter((x) => x < date).sort();
    day = { v: 1, kind: "trial-162", def: "docs/trial-162.md", date, hash: H, base: { today: pickToday(ans.days, date, D.K2), n20: pickN20(ans.days, date, D.K2), ansDays: prior.length, from: prior[prior.length - 1] || null }, names: {}, order: [], cnt: [], runs: [] };
    sizes[TRIAL_ANS] = await W(TRIAL_ANS, ans, `시험 162 정답표 ${prior[prior.length - 1] || "-"} (${prior.length}일)`);
  }
  // 시가 갭: 하루 1번(그날 첫 성공) · 실패·부족이면 다음 회차에 다시
  let gaps = null;
  if (!day.gap) {
    try {
      const codes = [...new Set(map.themes.flatMap((t) => t.codes || []))].sort(), quotes = {}; let rows = 0, batches = 0;
      for (let i = 0; i < codes.length; i += POLL_BATCH) { if (late()) throw new Error("시간 예산"); batches++; const j = await G(POLL_URL(codes.slice(i, i + POLL_BATCH)), "poll"); for (const q of (j && j.datas) || []) { rows++; const x = quoteOf(q, date); if (x) quotes[String(q.itemCode)] = x; } }
      const n = Object.keys(quotes).length;
      if (n < codes.length * OPEN_MIN_SHARE) notes.push(`시가 자료 ${n}/${codes.length}(받은 ${rows}) — 그날 값 아님·부족 → 다음 회차에 다시`);
      else {
        sizes[trialOpenFile(date)] = await W(trialOpenFile(date), { v: 1, kind: "trial-162-open", date, at: live.at, ranAt, hash: H, src: "네이버 폴링 openPrice · 전일 종가 = 현재가 − 전일 대비", n, codes: quotes }, `시험 162 ${date} 시가 ${n}종목`);
        gaps = gapsOf(quotes); const f0 = themeFeats(map, gaps);
        day.gap = { at: live.at, ranAt, hash: H, file: trialOpenFile(date), codes: codes.length, have: n, valid: Object.keys(gaps).length, req: batches, themes: f0.map((x) => [x.no, r3(x.G), r3(x.Bg), x.n]), h1: pickH1(f0, D.K2) };
      }
    } catch (e) { notes.push("시가 갭 실패: " + ((e && e.message) || e)); }
  } else { const o = await R(trialOpenFile(date)); if (o && o.date === date && o.codes) gaps = gapsOf(o.codes); else notes.push("시가 파일 못 읽음"); }
  // 전체 테마 그 시각 등락률·오른 수·종목 수 (네이버 테마 목록 · 보통 3쪽)
  let rows = []; const run = { at: live.at, ranAt, hash: H };
  try {
    const seen = new Set(), groups = [];
    for (let p = 1; p <= LIST_PAGES_MAX; p++) { const j = await G(THEME_LIST_URL(p), "list"), g = j && Array.isArray(j.groups) ? j.groups : []; let add = 0; for (const x of g) if (x && x.no !== undefined && !seen.has(x.no)) { seen.add(x.no); groups.push(x); add++; } if (g.length < 100 || !add) break; }
    rows = themeRows(groups);
  } catch (e) { run.listErr = String((e && e.message) || e).slice(0, 80); }
  if (rows.length) {
    const idx = new Map(day.order.map((no, i) => [no, i])); run.r = new Array(day.order.length).fill(null); run.u = new Array(day.order.length).fill(null);
    for (const t of rows) { let i = idx.get(t.no); if (i === undefined) { i = day.order.length; day.order.push(t.no); day.cnt.push(t.count); idx.set(t.no, i); for (const r0 of day.runs) if (r0.r) { r0.r.push(null); r0.u.push(null); } run.r.push(null); run.u.push(null); }
      run.r[i] = t.rate; run.u[i] = t.rise; if (t.count !== day.cnt[i]) (run.cx ||= {})[t.no] = t.count; }
  }
  const known = knownOf(live), feats = gaps ? themeFeats(map, gaps, known) : null;
  Object.assign(run, { code: { sha: (code && code.sha) || null, appA: (code && code.appA) || null, appAFiles: code && Array.isArray(code.appAFiles) ? code.appAFiles : null }, h1: feats ? pickH1(feats, D.K2) : [], h2: feats ? pickH2(feats, D.K2) : [], kn: Object.keys(known).length,
    a: (live.themes || []).map((t) => t && t.no).filter((x) => x !== undefined).slice(0, 3), b: live.rankB && Array.isArray(live.rankB.themesB) ? live.rankB.themesB.map((t) => t.no).slice(0, 3) : [],
    ...(live.rankC && Array.isArray(live.rankC.themesC) ? { c: live.rankC.themesC.map((t) => t.no).slice(0, 3) } : {}), now: rows.length ? pickNow(rows, D.K2) : [], ...(live.wait ? { wait: live.wait } : {}), req: { poll: req.poll, list: req.list } });
  day.runs = day.runs.filter((r) => r.at !== run.at).concat([run]).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const nm = new Map([...(map.themes || []).map((t) => [t.no, t.name]), ...rows.map((t) => [t.no, t.name])]);
  for (const no of [...run.h1, ...run.h2, ...run.a, ...run.b, ...(run.c || []), ...run.now, ...day.base.today, ...day.base.n20]) if (!day.names[no] && nm.get(no)) day.names[no] = nm.get(no);
  if (live.themes) for (const t of live.themes) if (t && t.no !== undefined && t.name) day.names[t.no] = day.names[t.no] || t.name;
  if (day.hash !== H) notes.push(`그날 첫 기록 해시 ${day.hash} ≠ 지금 ${H} (판정 스크립트가 거부함)`);
  sizes[trialFile(date)] = await W(trialFile(date), day, `시험 162 ${date} ${live.at}`);
  return { ok: true, date, at: live.at, runs: day.runs.length, gap: !!day.gap, h1: run.h1.slice(0, D.K), h2: run.h2.slice(0, D.K), themes: rows.length, graded, req, sizes, notes, ms: clock() - t0, hash: H };
}
export const trialText = (r) => !r ? "시험 162: 결과 없음" : r.skip ? "시험 162: 건너뜀 — " + r.skip : `시험 162 기록 ${r.date} ${r.at} · 회차 ${r.runs} · 시가 갭 ${r.gap ? "있음" : "없음"} · H1 ${r.h1.join(",") || "-"} · H2 ${r.h2.join(",") || "-"} · 전체 테마 ${r.themes} · 요청 네이버 ${r.req.naver}(폴링 ${r.req.poll} · 목록 ${r.req.list}) · GitHub 읽기 ${r.req.ghRead} 쓰기 ${r.req.ghWrite}${r.graded.length ? " · 채점 " + r.graded.join(",") : ""} · 크기 ${Object.entries(r.sizes).map(([p, b]) => p.replace(TRIAL_DIR + "/", "") + " " + (b / 1024).toFixed(1) + "KB").join(" · ")} · ${r.ms}ms · 해시 ${r.hash}${r.notes.length ? " · 참고 " + r.notes.join(" / ") : ""}`;
