// 주도 테마 적중 성적표 요약 — 앱 성적표 카드 「주도 테마 적중」 절과 시험이 같이 쓴다 (순수 모듈 · 브라우저·Node 공용 · 9.29-84 원장 [1597])
// 입력 = auto/observe/leaders-scorecard.json (server/scorecard.js 가 쌓음). 적중률 = 선정 슬롯 D+k 상승비율 − 그 평가일 전체 테마 종목 상승비율(기준율) 평균
export const LDS_UNITS = { a: "마감 확정", b: "장후 잠정", c: "장중 마지막", s: "옛 방식" };
export const LDS_REF_DAYS = 20; // 표본 20거래일(선정일 수) 전에는 「참고용」 고정 — 연구 R5 §5
export const LDS_UNIT_DESC = { a: "급등 묶음 · 9.29-100 전 기록은 옛 방식", b: "오후 4:20 잠정 · 새 방식엔 없음", c: "실시간 마지막 · 9.29-100부터 급등 묶음", s: "옛 대금 기준(L) 비교용 · 9.29-100 전 기록은 시험 방식" }; // 9.29-99 원장 [1823] 방식 이름 옆 짧은 설명
const r1 = (x) => Math.round(x * 10) / 10;
// ---- 같은 날 마감 확정 여러 번 → 그날 마지막 확정만 (9.29-99 원장 [1822][1823] · 라운드 5 ②) ----
// 마지막 확정 선정 = [{ name, codes:[슬롯 1~5 코드 | null] }] (날짜 파일 close.market.leaders.themes 또는 수집기 days[].a)
export function ldsLatestA(themes) {
  return (Array.isArray(themes) ? themes : []).slice(0, 3).map((t) => ({ name: String((t && t.name) || ""), codes: (t && Array.isArray(t.slots) ? t.slots : []).slice(0, 5).map((s) => (s && /^\d{6}$/.test(String(s.code || "")) ? String(s.code) : null)) }));
}
// 그 날 a 행 중 마지막 확정의 (순위·슬롯·코드) 에 맞는 것만 남기고 테마 이름도 그 선정 것으로 · 맞는 행이 하나도 없으면 손대지 않음(지어내기·통째 삭제 0)
export function ldsKeepA(rows, date, a) {
  const xs = Array.isArray(rows) ? rows : []; if (!Array.isArray(a) || !a.length) return xs;
  const want = new Map(); a.forEach((t, i) => (t && Array.isArray(t.codes) ? t.codes : []).forEach((c, j) => { if (c) want.set(i + 1 + "|" + (j + 1) + "|" + c, t.name); }));
  const isA = (r) => r && r.date === date && r.unit === "a", key = (r) => r.rank + "|" + r.slot + "|" + r.code;
  if (!xs.some((r) => isA(r) && want.has(key(r)))) return xs; // 같은 배열 그대로 돌려줌 = 「안 고침」 표시(scFixDays 가 씀)
  return xs.filter((r) => !isA(r) || want.has(key(r))).map((r) => (isA(r) ? Object.assign({}, r, { theme: want.get(key(r)) || r.theme }) : r));
}
// a 행이 같은 순위·슬롯에 두 개 이상인 날 (같은 날 확정이 두 번 돌아 섞인 날)
export function ldsDupDays(file) {
  const seen = new Set(), dup = new Set();
  for (const r of file && Array.isArray(file.rows) ? file.rows : []) { if (!r || r.unit !== "a") continue; const k = r.date + "|" + r.rank + "|" + r.slot; if (seen.has(k)) dup.add(r.date); else seen.add(k); }
  return [...dup].sort();
}
// days[].a 가 있는 날은 그날 마지막 확정만
export function ldsClean(file) {
  let rows = file && Array.isArray(file.rows) ? file.rows : [];
  for (const d of file && Array.isArray(file.days) ? file.days : []) if (d && Array.isArray(d.a)) rows = ldsKeepA(rows, d.date, d.a);
  return rows;
}
export function ldsSummary(file, today = null) {
  const rows = ldsClean(file).filter((r) => r && (!today || r.date <= today)); // 9.29-99: 같은 날 확정 두 벌 → 그날 마지막 확정만
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const units = {};
  for (const u of Object.keys(LDS_UNITS)) {
    const rs = rows.filter((r) => r.unit === u); if (!rs.length) continue;
    const k = {};
    for (const h of [1, 2, 3, 4]) {
      const xs = rs.filter((r) => r["d" + h] && typeof r["d" + h].ret === "number");
      const hit = xs.filter((r) => r["d" + h].up).length, bls = xs.map((r) => r["d" + h].bl).filter((b) => typeof b === "number");
      const hitPct = xs.length ? r1((hit / xs.length) * 100) : null, blAvg = bls.length ? r1(bls.reduce((a, b) => a + b, 0) / bls.length) : null;
      k[h] = { n: xs.length, hit, hitPct, blAvg, blN: bls.length, diff: hitPct !== null && blAvg !== null ? r1(hitPct - blAvg) : null };
    }
    units[u] = { n: rs.length, days: [...new Set(rs.map((r) => r.date))].length, k };
  }
  // 최근 선정(마지막 선정일) · 방식 a 가 있으면 a, 없으면 있는 방식 순서대로 — 테마·종목마다 D1~D4 ○ × −(대기)
  const last = dates[dates.length - 1] || null;
  const pick = last ? ["a", "s", "b", "c"].find((u) => rows.some((r) => r.date === last && r.unit === u)) : null;
  const recent = last ? rows.filter((r) => r.date === last && r.unit === pick).sort((a, b) => a.rank - b.rank || a.slot - b.slot).map((r) => ({ rank: r.rank, theme: r.theme, name: r.name, slot: r.slot, marks: [1, 2, 3, 4].map((h) => (r["d" + h] && typeof r["d" + h].ret === "number" ? (r["d" + h].up ? "○" : "×") : "-")), rets: [1, 2, 3, 4].map((h) => (r["d" + h] && typeof r["d" + h].ret === "number" ? r["d" + h].ret : null)) })) : [];
  return { days: dates.length, ref: dates.length < LDS_REF_DAYS, units, recent: { date: last, unit: pick, rows: recent } };
}
