// 9.29-177 주도주 선별기(검색기) — 계산만(네트워크 0 · 순수 함수). 근거 = 바탕화면 주도주선별기_인계서.md R1~R12 · 만쥬_매수종목_분석보고서 표 3번.
// 후보 표시 도구 · 자동 주문 0 · 투자 권유 아님. 받는 쪽(수집) = scripts/pick-leaders.mjs · 화면 = standalone/app.js 「검색기」 탭.
//
// 일봉 한 줄 = [날짜 "YYYY-MM-DD", 시가, 고가, 저가, 종가, 거래량] (네이버 siseJson 꼴 · 오래된 것 → 최근)
// 거래대금 = 종가 × 거래량(원) — 보고서와 같은 근사값(일봉에 거래대금 원값 없음). 장중 회차의 오늘 값은 priceTop 거래대금 원값으로 덮어 씀(todayValue).

export const PICK = {
  MULT_MIN: 3,        // R2 거래대금 배수(오늘 또는 전날) ≥ 3 — 보고서 개별주 10건 최솟값 3.7
  RATE_STRONG: 10,    // R3 오늘 또는 전날 +10% — 10건 중 9건(점수만 · 한진칼 +9.8 이 예외라 걸러내기 아님)
  AVG_DAYS: 20,       // 배수 분모 = 직전 20거래일 평균
  HIGH_DAYS: 60,      // R4 60일 신고가(자료가 60일보다 짧으면 상장 뒤 전부)
  PEAK_DAYS: 20,      // R9 전고점 = 직전 20거래일 고가 최댓값
  RECENT_DAYS: 5,     // R7 최근 5일 안 재급등
  LIMIT_RATE: 29.5,   // R12 상한가 묶임
  BIG_CAP: 20000,     // R10 대형주 = 시총 2조(억 단위)
  ORDERBOOK_MIN: 1e8, // R5 호가 10단계 합 1억(자료 받는 길 없음 → 「보류」)
  CRASH_RATE: -5,     // 지수관련주 급락일
  NEW_LIST_DAYS: 3,   // R11 상장 3거래일 안
  TOP_N: 100,         // R1 두 시장 거래대금 상위 100
  THEME_TOP: 5,
};

const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const pct = (a, b) => (a > 0 && b > 0 ? (a / b - 1) * 100 : null);
const valueOf = (b) => (b && b[4] > 0 && b[5] >= 0 ? b[4] * b[5] : null);
const avg = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

// 그날(date) 지표. bars 에 그날이 없으면 null. todayValue(원)·todayRate·todayHigh 를 주면 그날 값 대신 씀(장중 회차).
export function metricsOf(bars, date, { todayValue = null, todayRate = null, todayHigh = null, nxtPrice = null } = {}) {
  const B = Array.isArray(bars) ? bars.filter((b) => Array.isArray(b) && typeof b[0] === "string") : [];
  const i = B.findIndex((b) => b[0] === date);
  if (i < 0) return null;
  const t = B[i], p = B[i - 1] || null, pp = B[i - 2] || null;
  const rateOf = (k) => (k >= 1 ? pct(B[k][4], B[k - 1][4]) : null);
  const rate = todayRate !== null ? todayRate : rateOf(i), prevRate = rateOf(i - 1);
  const val = todayValue !== null ? todayValue : valueOf(t), pval = valueOf(p);
  const win = (end, n) => B.slice(Math.max(0, end - n), end);
  const a20 = avg(win(i, PICK.AVG_DAYS).map(valueOf)); // 전날 배수도 같은 분모(오늘 직전 20일 · 보고서 표 3번 「배수(그날/전날)」 9건 대조로 확인)
  const up10 = []; for (let k = Math.max(1, i - PICK.AVG_DAYS); k < i; k++) { const r = rateOf(k); if (r !== null && r >= PICK.RATE_STRONG) up10.push(B[k][0]); }
  const recent = up10.filter((d) => B.findIndex((b) => b[0] === d) >= i - PICK.RECENT_DAYS).length;
  const high = Math.max(todayHigh !== null ? todayHigh : t[2], nxtPrice > 0 ? nxtPrice : 0); // 19:30 회차 = NXT 가격도 고가로(전고점 돌파가 NXT 에서 나는 경우 · 한진칼 11-09)
  const h60 = win(i, PICK.HIGH_DAYS).map((b) => b[2]), h20 = win(i, PICK.PEAK_DAYS).map((b) => b[2]);
  const new60 = h60.length ? high > Math.max(...h60) : null;
  const peak20 = h20.length ? Math.max(...h20) : null;
  const next = B[i + 1] || null;
  return {
    date, close: t[4], rate: r1(rate), prevRate: r1(prevRate),
    valueEok: val === null ? null : Math.round(val / 1e8), prevValueEok: pval === null ? null : Math.round(pval / 1e8),
    mult: val !== null && a20 ? r1(val / a20) : null, prevMult: pval !== null && a20 ? r1(pval / a20) : null,
    up10N: up10.length, up10Recent: recent, new60, high60Days: h60.length,
    breakout: peak20 === null ? null : high > peak20, // R9 전고점(직전 20일 고가) 돌파
    listedDays: i + 1, // 받은 자료 안에서 몇 번째 거래일(자료 시작이 상장일일 때만 「상장 n일」 뜻)
    next: next ? { date: next[0], close: r1(pct(next[4], t[4])), high: r1(pct(next[2], t[4])), open: r1(pct(next[1], t[4])) } : null,
  };
}

// R7 급등 성격
export function natureOf(m) {
  if (!m) return null;
  // 이름 = 보고서 표 3번 「급등 성격」 칸과 같게(진에어 1회·전날 = 전날 첫 급등 · 미투온 1회·5일 안 = 5일 내 재급등 · 한진칼 2회·한라캐스트 4회 = 연속 급등)
  if (m.up10N === 0) return m.rate !== null && m.rate >= PICK.RATE_STRONG ? "첫 급등" : "급등 이력 없음";
  if (m.up10N === 1 && m.prevRate !== null && m.prevRate >= PICK.RATE_STRONG) return "전날 첫 급등";
  if (m.up10N >= 2) return "연속 급등";
  return m.up10Recent > 0 ? "5일 내 재급등" : "재급등";
}
const isFirst = (n) => n === "첫 급등" || n === "전날 첫 급등";
const isCont = (n) => n === "연속 급등" || n === "5일 내 재급등" || n === "재급등";

// R2 + 오늘 상승: 후보 자격. 보고서 개별주 10건 = 전부 배수(오늘/전날) ≥ 3.7 · 오늘 등락 > 0(최소 제주은행 +4.0·진에어 +2.8) → 이 두 조건만 걸러내기 · 나머지는 점수·표시
export const qualifies = (m) => !!m && ((m.mult ?? 0) >= PICK.MULT_MIN || (m.prevMult ?? 0) >= PICK.MULT_MIN) && (m.rate ?? 0) > 0;

// 수급 비율(그날 거래량 대비 순매수 % · 보고서 6절과 같은 자) — trend 한 줄 {date, frgn, inst, indi, vol}
export function flowOf(trend, date, vol) {
  const r = (Array.isArray(trend) ? trend : []).find((x) => x && x.date === date);
  const v = vol > 0 ? vol : r && r.vol > 0 ? r.vol : null;
  if (!r || !v) return null;
  const f = (x) => (typeof x === "number" ? r1((x / v) * 100) : null);
  return { frgn: f(r.frgn), inst: f(r.inst), indi: f(r.indi) };
}

// 테마 정하기: 관심 테마(설정 · 먼저) → 네이버 테마 구성표(후보끼리 가장 많이 겹치는 테마 · 넓은 이름 제외) → 「미분류 급등」
export function assignThemes(cands, { interest = {}, map = null, generic = /지주사|밸류업|대표주|신규상장/ } = {}) {
  const byName = new Map(); for (const [th, names] of Object.entries(interest || {})) for (const n of names || []) if (!byName.has(n)) byName.set(n, th);
  const codeThemes = new Map();
  for (const t of (map && Array.isArray(map.themes) ? map.themes : [])) { if (generic.test(t.name)) continue; for (const c of t.codes || []) { if (!codeThemes.has(c)) codeThemes.set(c, []); codeThemes.get(c).push(t.name); } }
  const inPool = new Map(); for (const c of cands) for (const th of codeThemes.get(c.code) || []) inPool.set(th, (inPool.get(th) || 0) + 1);
  for (const c of cands) {
    if (byName.has(c.name)) { c.theme = byName.get(c.name); c.themeSrc = "관심"; continue; }
    const ths = (codeThemes.get(c.code) || []).slice().sort((a, b) => (inPool.get(b) || 0) - (inPool.get(a) || 0) || a.localeCompare(b));
    if (ths.length && (inPool.get(ths[0]) || 0) >= 2) { c.theme = ths[0]; c.themeSrc = "네이버"; } else { c.theme = "미분류 급등"; c.themeSrc = null; }
  }
  return cands;
}

// R6 대장·후속(테마 안 후보끼리 거래대금 순) · R12 짝꿍(테마 안 상한가 묶인 종목이 있으면 상한가 아닌 최고 상승 후보) · 점수 · 표시
export function rankAndScore(cands, { closing = false } = {}) {
  const groups = new Map();
  for (const c of cands) { if (!groups.has(c.theme)) groups.set(c.theme, []); groups.get(c.theme).push(c); }
  for (const [th, g] of groups) {
    const ok = g.filter((c) => c.ok).sort((a, b) => (b.m.valueEok ?? 0) - (a.m.valueEok ?? 0));
    ok.forEach((c, k) => { c.role = th === "미분류 급등" ? null : k === 0 ? "대장" : k <= 2 ? "후속" : null; c.rank = k + 1; });
    const limit = g.filter((c) => (c.m.rate ?? 0) >= PICK.LIMIT_RATE);
    if (limit.length && th !== "미분류 급등") {
      const mate = ok.filter((c) => (c.m.rate ?? 0) < PICK.LIMIT_RATE).sort((a, b) => (b.m.rate ?? 0) - (a.m.rate ?? 0) || (b.m.valueEok ?? 0) - (a.m.valueEok ?? 0))[0];
      if (mate) mate.mateOf = limit.map((x) => x.name);
    }
  }
  for (const c of cands) {
    if (!c.ok) continue;
    const m = c.m, n = c.nature, big = (c.cap ?? 0) >= PICK.BIG_CAP, f = c.flow;
    const cobuy = big && f && f.frgn > 0 && f.inst > 0;
    const strong = (m.rate ?? 0) >= PICK.RATE_STRONG || (m.prevRate ?? 0) >= PICK.RATE_STRONG;
    const star = isCont(n) && c.role === "대장" && (m.new60 === true || m.breakout === true);
    const warn = isFirst(n) && closing;
    const parts = {
      mult: Math.round(30 * Math.min(Math.max(m.mult ?? 0, m.prevMult ?? 0) / 10, 1)),
      strong: strong ? 20 : 0, new60: m.new60 ? 15 : 0,
      role: c.role === "대장" ? 15 : c.role === "후속" ? 8 : 0,
      star: star ? 10 : 0, cobuy: cobuy ? 10 : 0, warn: warn ? -10 : 0,
    };
    c.score = Object.values(parts).reduce((s, x) => s + x, 0); c.parts = parts;
    c.flags = [star && "★ 대장 돌파", warn && "⚠ 첫급등 종배 주의", c.mateOf && "짝꿍 후보"].filter(Boolean);
    c.flowScored = big; // R10 중소형은 표시만
  }
  return cands;
}

// 한 회차 전부: stocks = [{ code, name, cap(억|null), bars, trend, live?:{value원, rate, high, nxtRate} }]
export function pick(stocks, { date, slot = null, interest = {}, map = null, indexNames = ["SK하이닉스", "삼성전자", "삼성전기"], nasdaq = null } = {}) {
  const closing = slot === "15:20" || slot === "19:30";
  const idx = new Set(indexNames);
  const all = [];
  for (const s of stocks || []) {
    const lv = s.live || {};
    const m = metricsOf(s.bars, date, { todayValue: lv.value ?? null, todayRate: lv.rate ?? null, todayHigh: lv.high ?? null, nxtPrice: lv.nxtPrice ?? null });
    if (!m) continue;
    const vol = (s.bars.find((b) => b[0] === date) || [])[5];
    all.push({ code: s.code, name: s.name, cap: s.cap ?? null, m, nature: natureOf(m), flow: flowOf(s.trend, date, vol), nxtRate: lv.nxtRate ?? null, ok: !idx.has(s.name) && qualifies(m), isIndex: idx.has(s.name), firstBar: (s.bars[0] || [])[0] || null });
  }
  const pool = all.filter((c) => c.ok);
  assignThemes(pool, { interest, map }); rankAndScore(pool, { closing });
  pool.sort((a, b) => b.score - a.score || (b.m.valueEok ?? 0) - (a.m.valueEok ?? 0));
  const themes = new Map();
  for (const c of pool) if (c.theme !== "미분류 급등") { const t = themes.get(c.theme) || { name: c.theme, value: 0, rates: [], n: 0 }; t.value += c.m.valueEok ?? 0; if (c.m.rate !== null) t.rates.push(c.m.rate); t.n++; themes.set(c.theme, t); }
  const topThemes = [...themes.values()].map((t) => ({ name: t.name, valueEok: t.value, rate: r1(avg(t.rates)), n: t.n })).sort((a, b) => b.valueEok - a.valueEok).slice(0, PICK.THEME_TOP);
  const index = all.filter((c) => c.isIndex).map((c) => ({ code: c.code, name: c.name, rate: c.m.rate, crash: (c.m.rate ?? 0) <= PICK.CRASH_RATE, flow: c.flow, valueEok: c.m.valueEok, mult: c.m.mult }));
  // R11: 받은 일봉이 상장일부터 시작(첫 줄이 받은 범위 시작보다 늦음)하고 그날이 상장 3거래일 안
  const newList = all.filter((c) => c.m.listedDays <= PICK.NEW_LIST_DAYS && c.firstBar && c.firstBar > (stocks.find((s) => s.code === c.code).from || "")).map((c) => ({ code: c.code, name: c.name, day: c.m.listedDays, rate: c.m.rate, valueEok: c.m.valueEok }));
  const card = (c) => ({ code: c.code, name: c.name, theme: c.theme, themeSrc: c.themeSrc, role: c.role, score: c.score, parts: c.parts, flags: c.flags,
    rate: c.m.rate, prevRate: c.m.prevRate, nxtRate: c.nxtRate, valueEok: c.m.valueEok, mult: c.m.mult, prevMult: c.m.prevMult, new60: c.m.new60, breakout: c.m.breakout,
    nature: c.nature, up10N: c.m.up10N, cap: c.cap, flow: c.flow, flowScored: c.flowScored, mateOf: c.mateOf || null, close: c.m.close, orderbook: "보류" });
  return { date, slot, picks: pool.map(card), topThemes, index, nasdaq, newList, scanned: all.length };
}

// 성과 기록: 지난 회차 picks 에 다음 거래일 시가·고가·종가(그날 종가 대비 %) 붙이기 — bars 는 코드별 일봉
export function fillNext(logRows, barsByCode) {
  let filled = 0;
  for (const row of Array.isArray(logRows) ? logRows : []) for (const p of row.picks || []) {
    if (p.next) continue;
    const m = metricsOf(barsByCode[p.code], row.date);
    if (m && m.next) { p.next = m.next; filled++; }
  }
  return filled;
}
