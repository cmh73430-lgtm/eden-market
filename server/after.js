// 저녁 애프터장 줄 「애프터_2000」 — 9.29-107 원장 [2198][2200][2205][2206] (설계 도구\설계_9.29-107_애프터장_20261016.md)
// 순수 계산 + 주입한 get(url) 로만 네트워크 (런타임 LLM 0 · 규칙은 전부 숫자·목록 · 지어내기 0 = 못 받은 칸은 비움)
//
//  값의 뜻: 정규 종가 P0 = 네이버 분봉 15:30~15:59 봉(종가 단일가 15:30 · VI 로 늘어나면 15:32 · 15:40~16:00 시간외 종가 = 같은 값) — 그 구간 마지막 봉
//           (레인 실제 호출 2026-10-16 20:06: 793 종목·일 모두 15:30~16:00 봉이 한 가격 · 안랩 10-16 은 15:30 봉 없이 15:32 봉(종가 단일가 연장) → 「15:30:59 이하」 규칙이면 못 잼)
//           저녁 가격 P1 = 16:00~19:59 KRX 애프터 봉의 마지막 가격 · 저녁 등락 = P1 ÷ P0 − 1
//           저녁 거래대금(KRX 만 · 「약」) = Σ(16:00~ 봉 거래량 × 봉 가격) — 네이버 분봉 accumulatedTradingVolume = 그 1분 거래량 (설계 3절 ②)
//           16:00 뒤 봉이 하나도 없으면 = 저녁 체결 없음 → 마지막 가격 = 정규 종가(0%) · n 0 으로 표시
//  ① 주도 테마 이어짐/꺾임: 그날 확정 주도 테마(close.market.leaders.themes · 최대 3) 종목(slots ≤5 → 최대 15) 저녁 등락 평균 · ±0.5% (auto.js PREV_FLAT 와 같은 문턱)
//  ② 저녁 강한 테마 상위 3: 저녁 거래대금 10억↑([2206]) 종목이 3개↑ 인 테마(테마 구성표 auto/observe/theme-map.json · 넓은 이름 제외 = surge.js GENERIC_RE)
//     순위 = 그 종목들 평균 등락 → 같으면 거래대금 합 · 종목 절반↑ 겹치는 테마는 한 칸(surge.js 와 같은 합침 규칙 · 다른 이름은 alias) · 테마마다 등락 높은 2종목
//  ③ +3%↑ · −3%↓ 종목 각 최대 5(저녁 거래대금 10억↑) + 「추격 금지 · 반등 매수 금지」 한 줄([2200]) · 공시 종목 항목은 안 넣음([2200])
//  후보 = 테마 구성표 종목 전부를 네이버 폴링(400개씩)으로 보고 그날 통합 누적 거래대금(KRX+NXT) 10억↑ 만 분봉 1회씩 (저녁 대금 10억↑ 이면 하루 누적도 10억↑ → 빠뜨림 0)
//  계산 조건(설계 6절): 지금 20:05 뒤(afterDue) + 받은 봉 중 마지막 봉 19:55 뒤(ok) — 아니면 「자료 미완」 · 20:20 실패면 다음 날 07:05 아침 run 이 분봉으로 보충(폴링 거래 시각 날짜가 그날인 종목만 후보)
import { GENERIC_RE } from "./surge.js"; // surge.js ↔ auto.js 순환이 있어 맨 위 계산에는 쓰지 않음(함수 안에서만)

export const AFTER_KEY = "애프터_2000", AFTER_V = 1;
export const AFTER_MIN_EOK = 10;          // 종목 저녁 거래대금 하한(억) — 디렉터 [2206] 「10억 (권장)」 · 이상(≥)이면 듦
export const AFTER_FLAT = 0.5;            // 이어짐 ≥ +0.5% · 꺾임 ≤ −0.5% (auto.js PREV_FLAT 와 같음 · 시험이 같은지 확인)
export const AFTER_MOVE = 3;              // ③ 슈팅 +3%↑ · 급락 −3%↓
export const AFTER_TOP = 3, AFTER_PICK = 5, AFTER_THEME_MIN = 3, AFTER_THEME_STOCKS = 2, AFTER_LEAD_THEMES = 3, AFTER_LEAD_SLOTS = 5;
export const AFTER_FROM = "20:05", AFTER_LAST_MIN = "19:55", AFTER_MORNING_FROM = "07:00";
export const AFTER_POLL_BATCH = 400, AFTER_MAX_REQ = 1500, AFTER_BUDGET_MS = 150000;
// 게이트 [2231] ①: 실패 요청은 AFTER_RETRY_MS 쉬고 1번 더 · 요청 사이 AFTER_GAP_MS 간격(차단 위험 줄이기)
//  근거(실측 · 레인 실제 호출 2026-10-16 20:06): 간격 0 으로 799회 24.6초(1회 평균 약 31ms) · 받아 둔 응답 replay(네트워크 0)에서 간격 50ms 만 쉰 시간 48.5초(Windows 타이머)
//   → 20:20 실행 합 약 24.6 + 48.5 ≈ 73초(두 실측의 합) · 시간 상한 150초 · GitHub 작업 상한 10분 안
//  실패 판정: 폴링 묶음 실패 1건↑ 또는 분봉 요청 실패 비율 > AFTER_FAIL_MAX(2%) → ok 거짓 + 이유(어느 묶음 · 몇 건) → 다음 실행(afterDue · 아침 보충)이 다시 계산
export const AFTER_CONC = 4; // 분봉 동시 요청 수(워커) — 10-19 실측 순차 요청당 약 228ms · 658건 150초 → 동시 4개 · 요청 사이 gapMs 는 워커별
export const AFTER_GAP_MS = 50, AFTER_RETRY_MS = 300, AFTER_FAIL_MAX = 0.02;
export const AFTER_WARN = "슈팅 = 내일 시초가 추격 금지 · 급락 = 반등 매수 금지";
export const AFTER_URL = (code, d8) => "https://api.stock.naver.com/chart/domestic/item/" + code + "/minute?startDateTime=" + d8 + "1530&endDateTime=" + d8 + "2000";
export const AFTER_POLL_URL = (codes) => "https://polling.finance.naver.com/api/realtime/domestic/stock/" + codes.join(",");

const num = (s) => { if (s === null || s === undefined || s === "") return null; const n = Number(String(s).replace(/,/g, "").replace(/^\+/, "")); return Number.isFinite(n) ? n : null; };
const r2 = (x) => Number(x.toFixed(2)), r1 = (x) => Number(x.toFixed(1));
const avgOf = (xs) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
export const afterState = (pct) => (typeof pct !== "number" ? "" : pct >= AFTER_FLAT ? "up" : pct <= -AFTER_FLAT ? "down" : "flat");
export const AFTER_WORD = { up: "이어짐", flat: "보합", down: "꺾임" };

// 분봉 응답(배열) → { p0, p1, pct, won(원), v(억 · 소수 1), last("19:59" | null), n(16:00 뒤 봉 수) } · 15:30~16:00 봉이 없으면 null (못 잼 · 지어내기 0)
export function afterMove(bars, d8) {
  const lim = d8 + "155959", from = d8 + "160000", to = d8 + "195959";
  let t0 = null, p0 = null, t1 = null, p1 = null, won = 0, n = 0;
  for (const b of Array.isArray(bars) ? bars : []) {
    const t = String((b && b.localDateTime) || ""), p = num(b && b.currentPrice);
    if (t.slice(0, 8) !== d8 || p === null || !(p > 0)) continue;
    if (t >= d8 + "153000" && t <= lim) { if (t0 === null || t > t0) { t0 = t; p0 = p; } }
    else if (t >= from && t <= to) { won += (num(b.accumulatedTradingVolume) || 0) * p; n++; if (t1 === null || t > t1) { t1 = t; p1 = p; } }
  }
  if (p0 === null) return null;
  const p = p1 === null ? p0 : p1;
  return { p0, p1: p, pct: r2((p / p0 - 1) * 100), won: Math.round(won), v: r1(won / 1e8), last: t1 ? t1.slice(8, 10) + ":" + t1.slice(10, 12) : null, n };
}
// 하한: 원 단위 그대로 비교 (9.9억 = 990,000,000 원 → 빠짐 · 10억 = 1,000,000,000 원 → 듦)
export const afterPass = (m) => !!m && typeof m.won === "number" && m.won >= AFTER_MIN_EOK * 1e8;

// 계산할 때인가: 강제(--after) · 이미 끝난 기록(ok) 있으면 안 함 · 지난 날짜는 언제든(분봉 약 7거래일 보관) · 오늘은 20:05 뒤만
export function afterDue({ date, today, hm, existing = null, force = false }) {
  if (force) return { due: true, why: "강제" };
  if (existing && existing.ok) return { due: false, why: "이미 있음(" + (existing.at || "?") + " · 마지막 봉 " + (existing.lastBar || "?") + ")" };
  if (date < today) return { due: true, why: "지난 날 보충" };
  if (String(hm || "") < AFTER_FROM) return { due: false, why: AFTER_FROM + " 전(" + hm + ") — 애프터장 20:00 마감 뒤에만" };
  return { due: true, why: "20:05 뒤" };
}

// 폴링 한 종목 → 그날 통합 누적 거래대금(원 · KRX+NXT · 없으면 KRX 누적)
export function pollValue(d) {
  const ip = d && d.integratedPriceInfo, a = num(ip && ip.accumulatedTradingValueRaw);
  return a !== null ? a : num(d && d.accumulatedTradingValueRaw);
}
const overlap = (a, b) => { const A = new Set(a); const inter = b.filter((x) => A.has(x)).length; return inter >= 1 && inter >= Math.ceil(Math.min(a.length, b.length) / 2); };
const row = (code, name, m) => ({ code, name: name || code, pct: m.pct, v: m.v, n: m.n });

// ② 강한 테마 (순수): rows = [{code,name,pct,v,won}] (하한 넘은 종목만) · map = 테마 구성표
export function strongThemes(rows, map, { top = AFTER_TOP, min = AFTER_THEME_MIN, per = AFTER_THEME_STOCKS } = {}) {
  const by = new Map(rows.map((r) => [r.code, r]));
  const cand = [];
  for (const t of (map && Array.isArray(map.themes) ? map.themes : [])) {
    if (!t || !t.name || GENERIC_RE.test(t.name)) continue;
    const xs = [...new Set(t.codes || [])].map((c) => by.get(String(c))).filter(Boolean);
    if (xs.length < min) continue;
    cand.push({ no: t.no, name: t.name, n: xs.length, avg: avgOf(xs.map((x) => x.pct)), v: r1(xs.reduce((a, x) => a + x.won, 0) / 1e8), won: xs.reduce((a, x) => a + x.won, 0), xs });
  }
  cand.sort((a, b) => b.avg - a.avg || b.won - a.won || a.n - b.n || (a.name < b.name ? -1 : 1));
  const picked = [];
  for (const t of cand) {
    const codes = t.xs.map((x) => x.code), same = picked.find((p) => overlap(p.codes, codes));
    if (same) { if (same.alias.length < 3) same.alias.push(t.name); continue; }
    if (picked.length >= top) continue;
    picked.push({ no: t.no, name: t.name, alias: [], n: t.n, avg: t.avg, state: afterState(t.avg), v: t.v, codes, stocks: t.xs.slice().sort((a, b) => b.pct - a.pct || b.won - a.won).slice(0, per).map((x) => ({ code: x.code, name: x.name, pct: x.pct, v: x.v })) });
  }
  return picked.map(({ codes, ...t }) => t);
}
// ③ 슈팅·급락 (순수)
export function bigMoves(rows, { lim = AFTER_MOVE, max = AFTER_PICK } = {}) {
  const pick = (x) => ({ code: x.code, name: x.name, pct: x.pct, v: x.v });
  return { up: rows.filter((x) => x.pct >= lim).sort((a, b) => b.pct - a.pct || b.won - a.won).slice(0, max).map(pick), down: rows.filter((x) => x.pct <= -lim).sort((a, b) => a.pct - b.pct || b.won - a.won).slice(0, max).map(pick) };
}

// 계산 (네트워크 = get 주입) · leaders = 그날 close.market.leaders · map = 테마 구성표 · src = "20:20" | "아침 보충"
//  candidates = false 면 ②③ 은 안 함(빈 칸 + 이유 · 시험·손 실행용)
//  폴링 값은 localTradedAt 날짜가 그 날(date)인 종목만 씀(아침 보충 때 폴링이 이미 다음 날 값이면 ②③ 은 이유 적고 비움 · 레인 실측 20:06 = "2026-10-16T20:00:00+09:00")
//  거래 시각이 그날 「뒤」 날짜인 종목(아침 보충 때 이미 다음 날 값이 섞임)이 하나라도 있으면 ok 거짓(게이트 [2231] ②) · 그날 「앞」 날짜(그날 거래 없음 · 정지)는 후보에서만 빠짐
export async function collectAfter({ get, date, leaders = null, map = null, at = null, now = Date.now(), src = "20:20", candidates = true, clock = () => Date.now(), deadline = Infinity, maxReq = AFTER_MAX_REQ, batch = AFTER_POLL_BATCH, gapMs = AFTER_GAP_MS, conc = AFTER_CONC, retryMs = AFTER_RETRY_MS, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) }) {
  const d8 = String(date).replace(/-/g, ""), t0 = clock(), errors = [], req = { polling: 0, minute: 0, retry: 0 };
  const memo = new Map(), fail = { poll: [], pollN: 0, minute: 0 }; let cut = "", sent = 0;
  const total = () => req.polling + req.minute;
  const call = async (u, wk = { n: 0 }) => { // 요청 사이 간격(워커별 · 전체 첫 요청만 면제) · 실패면 한 번 더(짧게 쉬고)
    if ((wk.n++ || sent) && gapMs > 0) await sleep(gapMs);
    sent++;
    try { return await get(u); } catch (e) { req.retry++; if (retryMs > 0) await sleep(retryMs); return await get(u); }
  };
  const pending = new Map();
  const move = (code, wk) => {
    if (memo.has(code)) return Promise.resolve(memo.get(code));
    if (pending.has(code)) return pending.get(code);
    if (total() >= maxReq) { cut = cut || "요청 상한 " + maxReq; return Promise.resolve(null); }
    if (clock() > deadline) { cut = cut || "시간 상한"; return Promise.resolve(null); }
    req.minute++; // 동기 구간에서 세므로 동시 실행이어도 상한 초과 0
    const pr = (async () => {
      let m = null;
      try { m = afterMove(await call(AFTER_URL(code, d8), wk), d8); if (!m) errors.push(code + ": 15:30~16:00 봉 없음"); } catch (e) { fail.minute++; errors.push(code + ": " + String((e && e.message) || e).slice(0, 40)); }
      memo.set(code, m); pending.delete(code); return m;
    })();
    pending.set(code, pr); return pr;
  };
  // 목록 순서대로 나눠 가져가는 동시 conc 개 워커 · 상한(cut)에 걸리면 더 안 집음 · 이미 보낸 요청은 끝까지 기다림
  const moveAll = async (codes) => {
    let i = 0;
    const worker = async () => { const wk = { n: 0 }; while (i < codes.length && !cut) { const c = codes[i++]; await move(c, wk); } };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, codes.length)) }, worker));
  };
  // ① 주도 테마
  const lead = [], leadThemes = [];
  for (const t of (leaders && Array.isArray(leaders.themes) ? leaders.themes : []).slice(0, AFTER_LEAD_THEMES)) {
    leadThemes.push([t, (t.slots || []).filter((s) => s && s.code).slice(0, AFTER_LEAD_SLOTS)]);
  }
  await moveAll([...new Set(leadThemes.flatMap(([, sl]) => sl.map((s) => String(s.code))))]);
  for (const [t, slots] of leadThemes) {
    const stocks = [];
    for (const s of slots) { const m = memo.get(String(s.code)) || null; stocks.push(m ? row(String(s.code), s.name, m) : { code: String(s.code), name: s.name || String(s.code), pct: null }); }
    const got = stocks.filter((x) => typeof x.pct === "number"), avg = avgOf(got.map((x) => x.pct));
    const lc = t.lead && t.lead.code ? String(t.lead.code) : slots[0] ? String(slots[0].code) : null, ls = stocks.find((x) => x.code === lc) || null;
    lead.push({ name: t.name, avg, state: afterState(avg), n: got.length, of: stocks.length, v: r1(got.reduce((a, x) => a + (memo.get(x.code) || { won: 0 }).won, 0) / 1e8), lead: ls && typeof ls.pct === "number" ? { name: ls.name, pct: ls.pct, v: ls.v } : null, stocks });
  }
  // ②③ 후보
  let rows = [], cand = null, why = "";
  if (!candidates) why = "②③ 안 함(candidates 끔)";
  else if (!map || !Array.isArray(map.themes) || !map.themes.length) why = "테마 구성표 없음";
  else {
    const codes = [...new Set(map.themes.flatMap((t) => (t.codes || []).map(String)))], val = new Map(), names = new Map(); let other = 0, newer = 0;
    fail.pollN = Math.ceil(codes.length / batch);
    for (let i = 0; i < codes.length; i += batch) {
      if (total() >= maxReq || clock() > deadline) { cut = cut || "폴링 상한"; break; }
      req.polling++;
      try { const j = await call(AFTER_POLL_URL(codes.slice(i, i + batch))); for (const d of (j && j.datas) || []) { const c = d && String(d.itemCode || ""); if (!c) continue; const dd = String(d.localTradedAt || "").slice(0, 10); if (dd !== date) { other++; if (dd > date) newer++; continue; } const w = pollValue(d); if (w !== null) val.set(c, w); if (d.stockName) names.set(c, String(d.stockName)); } }
      catch (e) { fail.poll.push(i / batch + 1); errors.push("폴링 " + (i / batch + 1) + ": " + String((e && e.message) || e).slice(0, 40)); }
    }
    const pool = [...val].filter(([, w]) => w >= AFTER_MIN_EOK * 1e8).sort((a, b) => b[1] - a[1]).map(([c]) => c); // 큰 것부터(상한에 걸려도 큰 종목은 잼)
    cand = { codes: codes.length, got: val.size, pool: pool.length, other, newer };
    await moveAll(pool);
    for (const c of pool) { if (!memo.has(c)) break; const m = memo.get(c); if (afterPass(m)) rows.push(Object.assign(row(c, names.get(c), m), { won: m.won })); }
    if (!val.size) why = other ? "폴링 값이 " + date + " 것이 아님(" + other + "종목 · 거래 시각 날짜 다름)" : "폴링 거래대금 못 받음";
    else if (!pool.length) why = "그날 거래대금 10억↑ 종목 0";
  }
  const strong = rows.length ? strongThemes(rows, map) : [], big = bigMoves(rows);
  const lasts = [...memo.values()].filter((m) => m && m.last).map((m) => m.last).sort();
  const lastBar = lasts.length ? lasts[lasts.length - 1] : null, complete = !!lastBar && lastBar >= AFTER_LAST_MIN;
  const candOk = !candidates || (!!cand && cand.got > 0 && cand.pool > 0);
  const mRate = req.minute ? fail.minute / req.minute : 0, failed = fail.poll.length > 0 || mRate > AFTER_FAIL_MAX, mixed = !!cand && cand.newer > 0;
  const ok = complete && !cut && candOk && !failed && !mixed;
  const failTxt = "자료 일부 실패 · 다음 실행 때 다시 (" + [fail.poll.length ? "폴링 " + fail.poll.length + "/" + fail.pollN + "묶음(" + fail.poll.join("·") + "번째)" : "", fail.minute ? "분봉 " + fail.minute + "/" + req.minute + "건" : ""].filter(Boolean).join(" · ") + ")";
  const reason = failed ? failTxt : !lastBar ? "16:00 뒤 봉 없음" : !complete ? "마지막 봉 " + lastBar + " (" + AFTER_LAST_MIN + " 전) — 자료 미완" : cut ? "일부만(" + cut + ")" : mixed ? "거래 시각이 " + date + " 뒤로 바뀐 종목 " + cand.newer + "개(다음 날 값 섞임) — 다음 실행 때 다시" : !candOk ? why || "후보 없음" : "";
  return {
    v: AFTER_V, date, at: at || null, ts: now, src, ok, ...(reason ? { reason } : {}), lastBar, floor: AFTER_MIN_EOK, flat: AFTER_FLAT, move: AFTER_MOVE,
    lead, strong, up: big.up, down: big.down, warn: AFTER_WARN,
    ...(why ? { skip: why } : {}),
    stat: cand ? { codes: cand.codes, got: cand.got, other: cand.other, newer: cand.newer, pool: cand.pool, n: rows.length, rise: rows.filter((x) => x.pct > 0).length, fall: rows.filter((x) => x.pct < 0).length } : null,
    fail: { poll: fail.poll, pollN: fail.pollN, minute: fail.minute, of: req.minute, max: AFTER_FAIL_MAX }, gapMs, requests: req, ms: clock() - t0, errors: errors.slice(0, 8), errorN: errors.length,
  };
}

// 로그 한 줄
const pc = (x) => (typeof x !== "number" ? "—" : (x > 0 ? "+" : "") + x + "%");
export function afterText(r) {
  if (!r) return "저녁 애프터 없음";
  const L = (r.lead || []).map((t) => `${t.name} ${AFTER_WORD[t.state] || "?"} ${pc(t.avg)}(${t.n}/${t.of})`).join(" / ");
  const S = (r.strong || []).map((t) => `${t.name}${t.alias.length ? "=" + t.alias.join("=") : ""} ${pc(t.avg)} ${t.v}억 [${t.stocks.map((x) => x.name + " " + pc(x.pct)).join(", ")}]`).join(" / ");
  const B = (xs) => xs.map((x) => `${x.name} ${pc(x.pct)} ${x.v}억`).join(", ");
  return `저녁 애프터(${r.src}) ${r.ok ? "확정" : "미완: " + (r.reason || "?")} · 마지막 봉 ${r.lastBar || "—"} · ① ${L || "없음"} · ② ${S || (r.skip || "없음")} · ③ 슈팅 ${B(r.up || []) || "없음"} · 급락 ${B(r.down || []) || "없음"}`
    + (r.stat ? ` · 후보 ${r.stat.pool}(폴링 ${r.stat.got}/${r.stat.codes}) → 10억↑ ${r.stat.n}(오름 ${r.stat.rise} · 내림 ${r.stat.fall})` : "") + ` · 요청 폴링 ${r.requests.polling} · 분봉 ${r.requests.minute} · 다시 ${r.requests.retry || 0} · 실패 폴링 ${r.fail ? r.fail.poll.length : 0} · 분봉 ${r.fail ? r.fail.minute : 0} · 간격 ${r.gapMs ?? "?"}ms · ${(r.ms / 1000).toFixed(1)}초${r.errorN ? " · 참고 " + r.errorN + "건 " + r.errors.slice(0, 2).join(" / ") : ""}`;
}
// 그날 기록의 ① 종목 저녁 등락 → 코드 → { pct, n } (아침 「어제 저녁 애프터마켓」 이 같은 값을 다시 씀 · 요청 0)
export function afterLeadMap(rec) {
  const m = new Map();
  for (const t of (rec && Array.isArray(rec.lead) ? rec.lead : [])) for (const s of t.stocks || []) if (s && s.code && typeof s.pct === "number") m.set(String(s.code), { pct: s.pct, n: s.n });
  return m;
}

// ---- 애프터 실시간 (--when=afterlive · 10-19 저녁 「일부만」 대응) : 16:00~20:05 평일 5~15분마다 auto/live-after.json 한 파일에만 저장 ----
export const AFTERLIVE_FILE = "live-after.json", AFTERLIVE_OPEN = "16:00", AFTERLIVE_LAST = "20:05", AFTERLIVE_BUDGET_MS = 110000, AFTERLIVE_SCAN_EVERY = 15, AFTERLIVE_SCAN_WINDOW = 5, RECENT_MS = 180000;
// 돌 시각인가: 16:00 ≤ hm ≤ 20:05 (20:05 뒤 도착 = 건너뜀 · 평일·휴장은 수집기 skipReason 이 먼저 거름)
export const afterLiveWindow = (hm) => !!hm && String(hm) >= AFTERLIVE_OPEN && String(hm) <= AFTERLIVE_LAST;
// 후보 스캔(②③) 돌릴 때인가: 분 % 15 < 5 (:00~:04 :15~:19 :30~:34 :45~:49) 이거나 이전 기록이 오늘 것이 아닐 때
export function afterLiveScan(hm, prev, date) {
  if (!prev || prev.date !== date) return true;
  const mm = Number(String(hm).slice(3, 5));
  return Number.isFinite(mm) && mm % AFTERLIVE_SCAN_EVERY < AFTERLIVE_SCAN_WINDOW;
}
// 직전 저장이 3분 안인가 (중복 실행 방지 · live.json 의 ts / live-after.json 의 ts)
export const savedRecently = (rec, nowMs, ms = RECENT_MS) => !!rec && typeof rec.ts === "number" && nowMs - rec.ts >= 0 && nowMs - rec.ts < ms;
// collectAfter 결과 + 이전 기록 → 저장 객체 · 스캔 안 한 회차는 strong·up·down·stat 을 이전 값 그대로(asOfScan = 그 값의 시각)
export function afterLiveRecord(res, prev, { date, hm, ts, scan }) {
  const out = Object.assign({}, res, { date, at: hm, ts });
  delete out.skip;
  if (scan) { out.scanAt = hm; if (res.skip) out.skip = res.skip; return out; }
  const p = prev && prev.date === date ? prev : null;
  out.strong = p && Array.isArray(p.strong) ? p.strong : []; out.up = p && Array.isArray(p.up) ? p.up : []; out.down = p && Array.isArray(p.down) ? p.down : [];
  out.stat = p && p.stat ? p.stat : null;
  out.scanAt = p && p.scanAt ? p.scanAt : null; out.asOfScan = out.scanAt;
  return out;
}
