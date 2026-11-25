// 9.29-162 원장 [집2668] 장 초반 식별 시험 판정 — 사전 등록 docs/trial-162.md 그대로 (규칙 변경 0 · 조기 종료 0)
//  쓰는 법: node scripts/trial-162-judge.mjs [auto/trial 폴더 · 기본 ./auto/trial]   (eden-market 저장소를 받아 둔 폴더에서 · 읽기만)
//  · 기록 하나라도 시험 정의 해시가 지금 코드(server/trial162.js TRIAL_HASH)와 다르면 거부(종료 4) — 시험 중 규칙이 바뀐 것
//  · 쓸 수 있는 날이 36일 안 되면 「아직 n/36일」 한 줄만(종료 3 · 성적은 안 보여 줌)
//  · 36일 차면 처음 36일만으로 판정(종료 0) — 그 뒤 날짜는 안 씀
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { TRIAL_DEF, TRIAL_HASH, trialHash, dayLists, pairStat } from "../server/trial162.js";
/* gate [집2677] ①: 이 스크립트가 자기 글자를 직접 읽어 해시를 다시 만듦(시험 정의 + server/trial162.js 전체 + 이 파일 전체) · 수집기가 넣은 해시(TRIAL_HASH)와 다르거나 기록 해시와 다르면 거부 */
export const JUDGE_HASH = trialHash({ judgeSrc: readFileSync(fileURLToPath(import.meta.url), "utf8") });

const NAME = { h1: "H1 시가 갭(09:05)", h2: "H2 혼합 평균(10:00)", appA: "앱 A(10:00)", today: "오늘 상위 그대로(전날 정답표 위 3)", n20: "공식 N20" };
// 기록 파일들(날짜 파일 객체 배열 · open 파일 배열) → { status: "refuse" | "wait" | "done", ... }
export function judge(days, opens = []) {
  const bad = []; if (JUDGE_HASH !== TRIAL_HASH) bad.push(`판정 스크립트 해시 ${JUDGE_HASH} ≠ 수집기 해시 ${TRIAL_HASH}`);
  for (const f of days) {
    const hs = [["파일", f && f.hash], ...(f && f.gap ? [["시가 갭", f.gap.hash]] : []), ...(f && f.score ? [["채점", f.score.hash]] : []), ...((f && f.runs) || []).map((r) => ["회차 " + r.at, r.hash])];
    for (const [k, h] of hs) if (h !== JUDGE_HASH) bad.push(`${(f && f.date) || "?"} ${k} ${h || "없음"}`);
  }
  for (const o of opens) if (o.hash !== JUDGE_HASH) bad.push(`${o.date || "?"} 시가 파일 ${o.hash || "없음"}`);
  if (bad.length) return { status: "refuse", hash: JUDGE_HASH, bad };
  const ds = days.filter((f) => f && typeof f.date === "string").sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = ds.length ? ds[0].date : null; /* 시작일 = 첫 기록 날(배포 날) 다음 거래일 → 첫 기록 날은 표본에서 뺌 */
  const rows = ds.filter((f) => f.date > first).map((f) => Object.assign({ date: f.date }, dayLists(f)));
  const ok = rows.filter((r) => r.ok), sample = ok.slice(0, TRIAL_DEF.need);
  if (sample.length < TRIAL_DEF.need) return { status: "wait", n: sample.length, need: TRIAL_DEF.need };
  const res = {};
  for (const m of TRIAL_DEF.methods) {
    const pairs = TRIAL_DEF.compare.map((c) => pairStat(sample, m, c, TRIAL_DEF.K)), aux = TRIAL_DEF.compare.map((c) => pairStat(sample, m, c, TRIAL_DEF.K2));
    res[m] = { pass: pairs.every((p) => p.pass), pairs, aux };
  }
  /* 게이트 권고: 비교 상대(앱 A) 코드 = 그날 10:00 회차의 code.appA(server/surge.js+auto.js 글자 해시) · 바뀐 날 목록 + 바뀌기 전/후 구간별 앱 A 비교(참고 · 합격선은 위 36일 그대로) */
  const ids = sample.map((d) => (d.code && d.code.appA) || null), appChanges = [];
  for (let i = 1; i < ids.length; i++) if (ids[i] !== ids[i - 1]) appChanges.push({ date: sample[i].date, from: ids[i - 1], to: ids[i] });
  const segs = []; let s0 = 0;
  for (let i = 1; i <= ids.length; i++) if (i === ids.length || ids[i] !== ids[i - 1]) { const seg = sample.slice(s0, i); segs.push({ from: seg[0].date, to: seg[seg.length - 1].date, appA: ids[s0], n: seg.length, res: Object.fromEntries(TRIAL_DEF.methods.map((m) => [m, pairStat(seg, m, "appA", TRIAL_DEF.K)])) }); s0 = i; }
  /* 9.29-176 앱 A 빈칸(160 기준③ 테마 평균 ≤ 0 → 칸 비움 · 3개 미만) 규칙(docs/trial-162.md 3절 · 시작 전 등록): 판정 = 그대로(분모 = 하루 K=3 · 빈 칸 = 적중 0 · A 0개인 날 = A 비교에서만 뺌)
     참고(판정 안 씀): A 가 1~2개인 날 수 · 0개인 날 수 · 「같은 개수」 비교(방법 목록을 그날 A 개수만큼만 잘라 견줌) */
  const aLen = sample.map((d) => d.lists.appA.length), aShort = { short: aLen.filter((n) => n > 0 && n < TRIAL_DEF.K).length, empty: aLen.filter((n) => n === 0).length };
  const sameN = Object.fromEntries(TRIAL_DEF.methods.map((m) => [m, pairStat(sample.map((d) => Object.assign({}, d, { lists: Object.assign({}, d.lists, { [m]: d.lists[m].slice(0, Math.min(TRIAL_DEF.K, d.lists.appA.length)) }) })), m, "appA", TRIAL_DEF.K)]));
  return { status: "done", hash: JUDGE_HASH, aShort, sameN, start: sample[0].date, end: sample[sample.length - 1].date, n: sample.length, skipped: rows.filter((r) => !r.ok && r.date <= sample[sample.length - 1].date).map((r) => r.date + " " + r.why), res, appChanges, appSegs: appChanges.length ? segs : [] };
}
const f3 = (x) => (typeof x === "number" ? (x >= 0 ? "+" : "") + x.toFixed(3) : "—");
export function judgeText(r) {
  if (r.status === "refuse") return `거부: 시험 정의 해시가 지금 코드(${r.hash})와 다른 기록 ${r.bad.length}개 — 시험 중 규칙이 바뀜\n` + r.bad.slice(0, 20).join("\n");
  if (r.status === "wait") return `아직 ${r.n}/${r.need}일`;
  const L = [`판정 ${r.start} ~ ${r.end} · ${r.n}일 · 해시 ${r.hash} · 합격 = 정확 부호 뒤집기 p < ${TRIAL_DEF.alpha} 그리고 날짜 부트스트랩 95% 하한 > 0 (K=${TRIAL_DEF.K})`];
  for (const m of TRIAL_DEF.methods) {
    const x = r.res[m]; L.push(`■ ${NAME[m]}: ${x.pass ? "합격(세 비교 상대 모두)" : "불합격"}`);
    for (const p of x.pairs) L.push(`  vs ${NAME[p.b]}: ${p.n}일 · 하루 적중 ${p.n ? p.ma.toFixed(3) + " vs " + p.mb.toFixed(3) : "—"} · 차 ${f3(p.mean)} [${f3(p.lo)}, ${f3(p.hi)}] · p ${p.n ? p.p.toFixed(4) : "—"} · +${p.plus || 0}/0:${p.zero || 0}/−${p.minus || 0} · ${p.pass ? "통과" : "못 넘음"}`);
    L.push(`  (보조 K=${TRIAL_DEF.K2} · 판정 안 씀) ` + x.aux.map((p) => `vs ${p.b} 차 ${f3(p.mean)} [${f3(p.lo)}, ${f3(p.hi)}] p ${p.n ? p.p.toFixed(4) : "—"}`).join(" · "));
  }
  L.push(`비교 상대(앱 A) 코드 바뀜: ${r.appChanges.length ? r.appChanges.map((c) => `${c.date} (${c.from || "없음"} → ${c.to || "없음"})`).join(" · ") : "없음"}`);
  for (const g of r.appSegs) L.push(`  (참고 · 판정 안 씀) 앱 A 코드 ${g.appA || "없음"} 구간 ${g.from}~${g.to} ${g.n}일: ` + TRIAL_DEF.methods.map((m) => { const p = g.res[m]; return `${m} vs 앱 A 차 ${f3(p.mean)} [${f3(p.lo)}, ${f3(p.hi)}] p ${p.n ? p.p.toFixed(4) : "—"}`; }).join(" · "));
  L.push(`앱 A 3개 미만인 날(36일 안): 1~2개 ${r.aShort.short}일 · 0개 ${r.aShort.empty}일(0개 = 앱 A 비교에서만 뺌 · 1~2개 = 빈 칸 적중 0 으로 판정에 씀)`);
  L.push(`  (참고 · 판정 안 씀) 같은 개수 비교(방법 목록을 그날 앱 A 개수만큼): ` + TRIAL_DEF.methods.map((m) => { const p = r.sameN[m]; return `${m} vs 앱 A ${p.n}일 차 ${f3(p.mean)} [${f3(p.lo)}, ${f3(p.hi)}] p ${p.n ? p.p.toFixed(4) : "—"}`; }).join(" · "));
  L.push(`참고: 비교 6개 본페로니(0.05/6) 기준은 p < ${(TRIAL_DEF.alpha / 6).toFixed(4)} — 판정엔 안 씀`);
  if (r.skipped.length) L.push(`빠진 날 ${r.skipped.length}: ` + r.skipped.join(" · "));
  return L.join("\n");
}
export function readTrialDir(dir) {
  const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
  const days = readdirSync(dir).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort().map((f) => rd(join(dir, f)));
  const od = join(dir, "open"), opens = existsSync(od) ? readdirSync(od).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort().map((f) => rd(join(od, f))) : [];
  return { days, opens };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] || "auto/trial";
  if (!existsSync(dir)) { console.log(`아직 0/${TRIAL_DEF.need}일`); process.exit(3); }
  const { days, opens } = readTrialDir(dir), r = judge(days, opens);
  console.log(judgeText(r));
  process.exit(r.status === "refuse" ? 4 : r.status === "wait" ? 3 : 0);
}
