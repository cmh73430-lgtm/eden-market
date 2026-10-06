// 주도 테마 적중 성적표 요약 — 앱 성적표 카드 「주도 테마 적중」 절과 시험이 같이 쓴다 (순수 모듈 · 브라우저·Node 공용 · 9.29-84 원장 [1597])
// 입력 = auto/observe/leaders-scorecard.json (server/scorecard.js 가 쌓음). 적중률 = 선정 슬롯 D+k 상승비율 − 그 평가일 전체 테마 종목 상승비율(기준율) 평균
export const LDS_UNITS = { a: "마감 확정", b: "장후 잠정", c: "장중 마지막", s: "그림자" };
export const LDS_REF_DAYS = 20; // 표본 20거래일(선정일 수) 전에는 「참고용」 고정 — 연구 R5 §5
const r1 = (x) => Math.round(x * 10) / 10;
export function ldsSummary(file, today = null) {
  const rows = file && Array.isArray(file.rows) ? file.rows.filter((r) => r && (!today || r.date <= today)) : [];
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
