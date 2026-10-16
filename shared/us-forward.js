// 미국장 테마 전진 기록(전진 검증) — 9.29-105 원장 [2132] ③ "매일 신호·다음 날 한국 결과 자동 누적" (순수 모듈 · 브라우저·Node 공용 · 빌드가 앱에 붙임)
// 근거 = E:/에덴_cockpit/work/연구_미국테마/보고_20261016.md §5-1 「매일 신호·다음 날 시가 갭·시가→종가를 자동 누적 · 3~6개월 누적이 마지막 신뢰 단계」
// 파일 = auto/observe/us-forward.json { v, updatedAt, rows: [{ date: 한국 거래일, us: 미국 날짜, at: 아침 수집 시각, spx: S&P500 %, themes: [{ k, v: 테마 평균 %, ex: v − spx, st: "up"|"dn"|"", g: 그 방향 등급, kr: { gap, o2c, n } | null }] }] }
//   신호(st) = 앱 판정과 같은 기준(shared/rules.js 160~161행: v ≥ th → up · v ≤ −thDn → dn) · 한국 결과 = 연구 대표 종목(KR_CORE = validate-themes.mjs KR) 시가 갭(시가 ÷ 전일 종가)·시가→종가 평균
//   적중 = 시가 갭 방향이 신호 방향과 같음(연구 「갭 적중」과 같은 셈) · 런타임 LLM 0
export const FWD_V = 1, FWD_KEEP = 400, FWD_DAYS = 20;
// 한국 대표 종목 6자리 (연구_미국테마/universe.mjs 32~38행 KR_CORE · .KS/.KQ 꼬리만 뗌)
export const FWD_KR = {
  semi: ["005930", "000660"], power: ["267260", "010120", "298040"], nuke: ["034020", "052690"], batt: ["373220", "006400", "247540"],
  def: ["012450", "064350", "009540"], btc: ["041190"], gold: ["010130"], cu: ["001440", "006260"], bio: ["128940", "196170", "207940"],
  robot: ["277810", "454910"], space: ["099320", "012450"], solar: ["009830", "010060"], equip: ["042700", "240810", "036930"],
  auto: ["005380", "000270"], ship: ["011200", "028670"], bank: ["105560", "055550"], steel: ["005490", "004020"], h2: ["336260", "288620"],
  build: ["000720", "375500"], fintech: ["377300", "064260"], aisw: ["402030", "304100", "041020"], cyber: ["053800", "263860", "042510", "356890"],
  lng: ["036460"], vaccine: ["302440", "096530"],
};
const fwdR2 = (x) => Math.round(x * 100) / 100;
const fwdNum = (x) => (typeof x === "number" && isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && isFinite(Number(x)) ? Number(x) : null);
// 아침 수집 블록(morning) + config/themes.json → 그 날 신호 한 줄 (S&P 값이나 테마 값이 하나도 없으면 null)
export function fwdSignals(date, morning, themesCfg) {
  const m = morning || {}, sig = m.signals || {}, us = m.us || {};
  const spx = fwdNum(sig.spx && sig.spx.value);
  const list = Array.isArray(themesCfg) ? themesCfg : (themesCfg && themesCfg.themes) || [], dth = (themesCfg && themesCfg.defaultThreshold) || 3;
  const themes = list.map((t) => { const v = fwdNum(us[t.key] && us[t.key].value); if (v === null) return null;
    const th = t.th ?? dth, thDn = t.thDn ?? th, st = v >= th ? "up" : v <= -thDn ? "dn" : "", g = String(t.grade || "");
    return { k: t.key, v: fwdR2(v), ex: spx === null ? null : fwdR2(v - spx), st, g: st === "up" ? g[0] || "" : st === "dn" ? g[1] || "" : "", kr: null };
  }).filter(Boolean);
  if (!themes.length) return null;
  return { date, us: m.expectedUs || null, at: m.at || null, spx, themes };
}
// 네이버 일봉 줄([{ date, o, c }] 날짜 오름차순) → 그 날 시가 갭 · 시가→종가 (그 날 봉이나 전날 봉이 없으면 null)
export function fwdBar(rows, date) {
  const xs = Array.isArray(rows) ? rows : [], i = xs.findIndex((r) => r && r.date === date);
  if (i < 1) return null; const p = xs[i - 1], b = xs[i];
  if (!(p.c > 0) || !(b.o > 0) || !(b.c > 0)) return null;
  return { gap: fwdR2((b.o / p.c - 1) * 100), o2c: fwdR2((b.c / b.o - 1) * 100) };
}
// 한 테마의 한국 결과 = 대표 종목 평균 (bars: 코드 → fwdBar 결과 | null)
export function fwdKr(key, bars) {
  const got = (FWD_KR[key] || []).map((c) => bars[c]).filter(Boolean);
  if (!got.length) return null;
  const avg = (f) => fwdR2(got.reduce((s, x) => s + x[f], 0) / got.length);
  return { gap: avg("gap"), o2c: avg("o2c"), n: got.length };
}
// 파일에 오늘 신호 넣기(같은 날짜는 한 줄 · 이미 있으면 신호는 그대로 두고 한국 결과만 채움) → 새 파일 객체 (원본 무변경)
export function fwdAddRow(file, row) {
  const f = file && Array.isArray(file.rows) ? { v: FWD_V, updatedAt: file.updatedAt || 0, rows: file.rows.slice() } : { v: FWD_V, updatedAt: 0, rows: [] };
  if (!row) return { file: f, added: 0 };
  if (f.rows.some((r) => r && r.date === row.date)) return { file: f, added: 0 };
  f.rows.push(row); f.rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (f.rows.length > FWD_KEEP) f.rows = f.rows.slice(-FWD_KEEP);
  return { file: f, added: 1 };
}
// 한국 결과가 아직 빈 신호 칸 (신호 있는 테마만 · 최근 maxRows 줄) → [{ date, k }]
export function fwdPending(file, maxRows = 5) {
  const rows = (file && Array.isArray(file.rows) ? file.rows : []).slice(-maxRows);
  return rows.flatMap((r) => (r.themes || []).filter((t) => t && t.st && !t.kr).map((t) => ({ date: r.date, k: t.k })));
}
// 최근 days 줄 적중 요약: 신호 있고 한국 결과가 채워진 칸만 · 적중 = 시가 갭이 신호 방향 · A등급만 따로
export function fwdSummary(file, days = FWD_DAYS) {
  const rows = (file && Array.isArray(file.rows) ? file.rows : []).slice(-days);
  const s = { days: rows.length, from: rows.length ? rows[0].date : null, to: rows.length ? rows[rows.length - 1].date : null, up: { n: 0, hit: 0 }, dn: { n: 0, hit: 0 }, a: { n: 0, hit: 0 }, wait: 0 };
  for (const r of rows) for (const t of r.themes || []) {
    if (!t || !t.st) continue; if (!t.kr || typeof t.kr.gap !== "number") { s.wait++; continue; }
    const hit = t.st === "up" ? t.kr.gap > 0 : t.kr.gap < 0, b = s[t.st];
    b.n++; if (hit) b.hit++; if (t.g === "A") { s.a.n++; if (hit) s.a.hit++; }
  }
  return s;
}
// 화면 한 줄 (기록 없으면 빈 글자)
export function fwdLine(s) {
  if (!s || !s.days) return "";
  const p = (b) => (b.n ? `${b.hit}/${b.n}` : "0");
  return `최근 ${s.days}거래일 적중(시가 방향): 오를 때 ${p(s.up)} · 내릴 때 ${p(s.dn)} · A등급 ${p(s.a)}` + (s.wait ? ` · 결과 기다림 ${s.wait}` : "");
}
