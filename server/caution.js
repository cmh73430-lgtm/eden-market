// 9.29-101 원장 [1883][1884] (수급단타왕x만쥬 강의 학습 · 표시만 · 선정·순위 영향 0 · 런타임 LLM 0)
//  S4 「종배 피함」: 단기과열 예고·지정 종목 / 투자주의 종목(원장 [1937] ④ 전 종류 — 소수계좌·스팸 관여·특정계좌 관여·종가급변·투자경고 예고 …) — 종가배팅 숫자 칸 후보에 꼬리
//  S1 주포 연속 순매수 · S2 수급 변곡점 · S3 주포 이탈 — 네이버 종목 일별 수급 행(저녁 확정 run 이 이미 받는 주소 · pageSize 만 20 으로)
// 자료원 실측(2026-10-10): 네이버 종목 기본정보 marketAlertType 은 「투자주의」(01)·「투자경고」(02)만 주고 사유(소수계좌·스팸)와 단기과열(예고·지정)은 안 줌
//   (HLB생명과학·원일티엔아이 = 단기과열 지정 중인데 표시 없음) → 수집기가 이미 쓰는 거래소 공시 목록(KIND 당일 공시 · server/news2.js KIND_URL · 키 없음)의 「지난 거래일」 목록을 하루 1번 받아 씀
//   공시는 저녁 8시쯤 나오고 다음 거래일부터 적용: 투자주의 = 다음 1거래일 · 단기과열 지정 = 다음 3거래일(30분 단일가) · 지정예고 = 예고일부터 10거래일 안에 다시 조건이 맞으면 지정
import { kindItems, KIND_URL, kindBody } from "./news2.js";

export const CAUTION_FILE = "auto/observe/kind-cautions.json";
export const CAUTION_KEEP = 10;      // 지난 10거래일 보관 (지정예고 유효 기간)
export const CAUTION_FETCH_MAX = 3;  // 한 run 에 새로 받는 날 수 상한 (평소엔 하루 1번 · 처음엔 run 마다 3일씩 채움)
export const OVERHEAT_ON_DAYS = 3;   // 단기과열 지정 = 공시 다음 3거래일
export const KIND_GAP_MS = 300;             /* 게이트 [1943] ③: 거래소 공시 요청 사이 간격 */
export const KIND_FAIL_REST_MS = 3600e3;    /* 거래소 공시 실패 뒤 1시간은 다시 안 받음 (파일 failAt = 마지막 실패 시각) */
export const KIND_PAGE_FULL = 700;          /* 당일 공시 한 쪽 크기(news2.js kindBody) — 실측 2026-09-30: 764건 중 최신 700건(20:13~10:49)만 옴 · 시장조치 공시는 20:00~20:04(11거래일 413건 전부) → 잘리는 것은 아침 공시뿐 */
const norm = (s) => String(s || "").replace(/\s+/g, "");

// 원장 [1937] ④ 「다 넣기」: 투자주의는 종류를 가리지 않고 다 「종배 피함」 — 제목이 「[투자주의]」 로 시작하는 공시 전부 · 표시 글은 짧은 낱말 꼴(「종배 피함 · 종가급변」)
//  제목 낱말 → 표시 글 (위에서부터 처음 맞는 것) · 표본 = test/fixtures/kind-titles-2026-10.json (2026-09-21~10-08 11거래일 실제 제목 · 투자주의 355건 = 아래 8종류 중 스팸 뺀 7종류)
//  「스팸관여과다종목」 은 표본에 없어 낱말(스팸)로만 잡음 · 아래 낱말에 없는 새 종류는 종류 이름 없이 「투자주의」 로만 (지어내기 0)
export const CAUTION_WORDS = [
  [/스팸/, "스팸 관여"],
  [/투자경고.*해제.*재지정\s*예고/, "투자경고 재지정 예고"], /* 「[투자주의]투자경고종목 지정해제 및 재지정 예고」 */
  [/투자경고.*지정\s*예고/, "투자경고 예고"],               /* 「[투자주의]투자경고종목 지정예고」 */
  [/특정\s*계좌/, "특정계좌 관여"],                         /* 「[투자주의]특정계좌(군) 매매관여 과다종목」 */
  [/종가\s*급변/, "종가급변"],                              /* 「[투자주의]종가급변종목」 · 「[투자주의]종가급변 종목」 */
  [/단일\s*계좌/, "단일계좌 거래량"],                       /* 「[투자주의]단일계좌 거래량 상위종목」 */
  [/상한가\s*잔량/, "상한가 잔량"],                         /* 「[투자주의]상한가잔량 상위종목」 */
  [/소수\s*(계좌|지점)/, "소수계좌"],                       /* 「[투자주의]소수계좌 거래집중 종목」 · 「[투자주의]15일간 상승종목의 당일 소수계좌 매수관여 과다종목」 */
];
export const CAUTION_ETC = "투자주의";
const CAUTION_ORDER = ["투자경고 예고", "투자경고 재지정 예고", "스팸 관여", "소수계좌", "특정계좌 관여", "종가급변", "단일계좌 거래량", "상한가 잔량", CAUTION_ETC];
// 공시 제목 → { kind: "oh_pre"(단기과열 지정예고) | "oh_on"(단기과열 지정·연장) | "caution"(투자주의 · 종류마다 reason 이 다름), reason } 또는 null
//  실제 제목: 「(예고)단기과열종목 지정예고」 · 「단기과열종목(3거래일 단일가매매) 지정」 · 「단기과열종목(가격괴리율, 3거래일 단일가매매) 지정 연장(○○우)」
//  투자주의는 제목 맨 앞 「[투자주의]」 머리표로만 잡음 (표본 355건 전부 이 머리표 · 「투자경고종목지정」·「투자위험종목 지정해제」·「매매거래정지」 는 머리표가 없어 안 잡음 — 투자경고·거래정지는 네이버 종목 정보 표시가 따로 있음)
export function cautionKind(title) {
  const t = String(title || "");
  if (/단기과열/.test(t)) { if (/지정\s*예고/.test(t)) return { kind: "oh_pre", reason: "단기과열 예고" }; if (/해제/.test(t)) return null; if (/지정/.test(t)) return { kind: "oh_on", reason: "단기과열 지정" }; return null; }
  const m = t.match(/^\s*\[\s*투자주의\s*\]\s*(.*)$/);
  if (m) { const w = CAUTION_WORDS.find(([re]) => re.test(m[1])); return { kind: "caution", reason: w ? w[1] : CAUTION_ETC }; }
  return null;
}
// 대상 종목 이름: 제목 끝 괄호가 종목 이름(우선주 등 · 「지정 연장(대상홀딩스우)」)이면 그것, 아니면 회사 이름
export function cautionTarget(company, title) {
  const m = String(title || "").match(/\(([^()]+)\)\s*$/), co = norm(company);
  return m && co && norm(m[1]) !== co && norm(m[1]).startsWith(co.slice(0, Math.min(2, co.length))) ? norm(m[1]) : co;
}
// 하루 공시 목록(kindItems) → [{ name, kind, reason }] (같은 종목·같은 사유 한 번 · 한 종목이 같은 날 투자주의 여러 종류면 사유마다 한 줄 — 표본: 소수계좌 + 특정계좌 관여가 하루 5건 안팎)
export function cautionsOf(items) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(items) ? items : []) {
    const k = cautionKind(x && x.title); if (!k) continue;
    const name = cautionTarget(x.company, x.title); if (!name) continue;
    const key = name + "|" + k.kind + "|" + k.reason; if (seen.has(key)) continue; seen.add(key);
    out.push({ name, kind: k.kind, reason: k.reason });
  }
  return out;
}
export const CAUTION_V = 2; /* v2 = 투자주의 전 종류 · 짧은 낱말 사유([1937] ④) — 옛 v1 파일(소수계좌·스팸만)은 버리고 다시 받음 */
export const cautionEmpty = () => ({ app: "jangjeon-cockpit", kind: "kind-cautions", v: CAUTION_V, updatedAt: null, days: {} });
// 지난 거래일 목록 채우기: prevDays = 오늘 앞 거래일들(가까운 날 먼저 · YYYY-MM-DD) 중 파일에 없는 날을 가까운 날부터 max 개 받아 넣는다 · 지난 날 목록은 바뀌지 않으므로 한 번만
//  post(url, body) = 글자(HTML) · 실패한 날은 비워 두고 다음 run 이 다시 · 보관은 prevDays 앞 CAUTION_KEEP 일만
//  게이트 [1943] ③ 요청 예절: 요청 사이 gapMs(300ms) 쉼 · 한 번 실패하면 그 run 은 거기서 그만 + 파일에 failAt(실패 시각) → 그 뒤 1시간 안의 run 은 요청 0(쉬는 중) · 다시 받기에 성공하면 failAt 지움
//   now·sleep 은 시험에서 바꿔 끼움 · 꽉 찬 쪽(700건)인데 맨 끝 줄이 저녁(17시 뒤)이면 저녁 공시가 잘렸을 수 있다고 참고에 적음(자료는 그대로 씀)
export async function loadCautions({ post, file = null, prevDays = [], max = CAUTION_FETCH_MAX, now = Date.now(), gapMs = KIND_GAP_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const f = file && typeof file === "object" && file.v === CAUTION_V && file.days && typeof file.days === "object" ? { ...cautionEmpty(), ...file, days: { ...file.days } } : cautionEmpty();
  const want = prevDays.slice(0, CAUTION_KEEP), errors = []; let requests = 0, changed = false, failed = false;
  const missing = () => want.filter((d) => !Array.isArray(f.days[d]));
  const resting = typeof f.failAt === "number" && now >= f.failAt && now - f.failAt < KIND_FAIL_REST_MS && missing().length > 0;
  if (resting) errors.push("거래소 공시 실패 뒤 쉬는 중(" + Math.ceil((KIND_FAIL_REST_MS - (now - f.failAt)) / 60000) + "분 뒤 다시)");
  else for (const d of want) {
    if (Array.isArray(f.days[d])) continue;
    if (requests >= max) break;
    const d8 = d.replace(/-/g, "");
    try {
      if (requests > 0 && gapMs > 0) await sleep(gapMs);
      requests++; const items = kindItems(await post(KIND_URL, kindBody(d8)), d8); if (!items.length) throw new Error("공시 0건");
      if (items.length >= KIND_PAGE_FULL && String(items[items.length - 1].dt || "").slice(8, 12) >= "1700") errors.push(d + ": 공시가 " + KIND_PAGE_FULL + "건을 넘어 저녁 공시가 잘렸을 수 있음");
      f.days[d] = cautionsOf(items); changed = true;
    } catch (e) { errors.push(d + ": " + String((e && e.message) || e).slice(0, 40)); f.failAt = now; failed = true; changed = true; break; }
  }
  if (!resting && !failed && requests > 0 && f.failAt !== undefined) { delete f.failAt; changed = true; }
  for (const d of Object.keys(f.days)) if (!want.includes(d)) { delete f.days[d]; changed = true; }
  return { file: f, requests, changed, errors, resting, have: want.filter((d) => Array.isArray(f.days[d])).length, want: want.length };
}
// 한 종목(이름)의 「종배 피함」 사유들: 투자주의 = 바로 앞 거래일 공시(종류마다 하나씩 · 정해진 순서) · 단기과열 지정 = 앞 3거래일 · 지정예고 = 앞 10거래일(파일에 있는 날만) · 자료가 없으면 [] (지어내기 0)
export function avoidReasons(name, file, prevDays = []) {
  const n = norm(name), days = (file && file.days) || {}, out = [];
  const has = (ds, kind) => ds.some((d) => Array.isArray(days[d]) && days[d].some((x) => x.kind === kind && x.name === n));
  if (!n) return out;
  if (has(prevDays.slice(0, OVERHEAT_ON_DAYS), "oh_on")) out.push("단기과열 지정");
  else if (has(prevDays.slice(0, CAUTION_KEEP), "oh_pre")) out.push("단기과열 예고");
  const cs = [];
  for (const x of (prevDays.length && Array.isArray(days[prevDays[0]]) ? days[prevDays[0]] : [])) if (x && x.kind === "caution" && x.name === n && x.reason && !cs.includes(x.reason)) cs.push(x.reason);
  const rank = (r) => { const i = CAUTION_ORDER.indexOf(r); return i < 0 ? CAUTION_ORDER.length : i; };
  cs.sort((a, b) => rank(a) - rank(b));
  return out.concat(cs);
}
// 후보 목록(items[{ name }])에 avoid[] 붙이기 (있을 때만)
export function tagAvoid(items, file, prevDays) {
  for (const x of Array.isArray(items) ? items : []) { const a = avoidReasons(x && x.name, file, prevDays); if (a.length) x.avoid = a; else if (x) delete x.avoid; }
  return items;
}
// 테마 종목(슬롯)과 종가배팅 후보에 한 번에 붙이기 — 장중(collectLive)·마감(collect-auto closeLeaders)이 같은 함수를 씀 (게이트 [1943] ②: 후보가 0개인 날에도 테마 종목에는 붙음)
//  cautions = { file, prevDays } · 자료가 없으면 아무것도 안 하고 false
export function tagAvoidAll({ themes = null, closing = null } = {}, cautions = null) {
  if (!cautions || !cautions.file) return false;
  const pd = cautions.prevDays || [];
  tagAvoid(closing, cautions.file, pd);
  for (const t of Array.isArray(themes) ? themes : []) tagAvoid(t && t.slots, cautions.file, pd);
  return true;
}
// 붙은 표시 한 줄(로그·시험용): 「테마 종목 2개(피노=소수계좌 · 삼기=단기과열 예고·종가급변) · 후보 0개」
export function avoidText({ themes = null, closing = null } = {}) {
  const one = (xs) => (Array.isArray(xs) ? xs : []).filter((x) => x && Array.isArray(x.avoid) && x.avoid.length).map((x) => x.name + "=" + x.avoid.join("·"));
  const seen = new Set(), sl = []; for (const t of Array.isArray(themes) ? themes : []) for (const r of one(t && t.slots)) if (!seen.has(r)) { seen.add(r); sl.push(r); }
  const cl = one(closing);
  return "테마 종목 " + sl.length + "개" + (sl.length ? "(" + sl.join(" · ") + ")" : "") + " · 후보 " + cl.length + "개" + (cl.length ? "(" + cl.join(" · ") + ")" : "");
}

// ---- 수급 꼬리 S1~S3 (rows = trendRows() 오래된 순 [{ date, fq 외국인 순매수 수량, oq 기관 순매수 수량, vol 거래량 }] · date = 그날 YYYY-MM-DD) ----
//  S1 주포 = 그날까지 최근 10거래일 순매수 수량 합이 큰 쪽(기관/외인 · 합이 0 이하면 없음) · days = 주포가 그날까지 연속 순매수한 날 수 (2일↑만 표시 · daysMore = 받은 행 끝까지 다 순매수라 더 길 수 있음)
//  S2 수급 변곡점 = 그날 거래량 ≥ 전날 × 2 & 기관이 전날 순매도 → 그날 순매수
//  S3 주포 이탈 = 전날까지 주포(전날 기준 최근 10일)가 2일↑ 연속 순매수했고, 그날 주포 순매도 수량 ≥ 그 연속 순매수 합의 50%
//  그날 행이 없거나(아직 집계 전) 수급 칸이 비면 null
export const SUPPLY_WIN = 10, SUPPLY_MIN_DAYS = 2, SUPPLY_VOL_X = 2, SUPPLY_EXIT = 0.5;
export function supplyTags(rows, date) {
  const xs = (Array.isArray(rows) ? rows : []).filter((r) => r && r.date && typeof r.fq === "number" && typeof r.oq === "number");
  const i = xs.findIndex((r) => r.date === date); if (i < 0) return null;
  const mainOf = (end) => { const w = xs.slice(Math.max(0, end - SUPPLY_WIN + 1), end + 1); if (!w.length) return null; const f = w.reduce((a, r) => a + r.fq, 0), o = w.reduce((a, r) => a + r.oq, 0); return Math.max(f, o) <= 0 ? null : o >= f ? "oq" : "fq"; };
  const streak = (key, end) => { let n = 0, sum = 0, k = end; for (; k >= 0 && xs[k][key] > 0; k--) { n++; sum += xs[k][key]; } return { n, sum, more: k < 0 }; }; /* more = 받은 행(20거래일) 맨 앞까지 내내 순매수 → 실제는 더 길 수 있음(「20일↑」) */
  const out = {}, T = xs[i], P = i > 0 ? xs[i - 1] : null, nm = (k) => (k === "oq" ? "기관" : "외인");
  const m = mainOf(i);
  if (m) { const s = streak(m, i); if (s.n >= SUPPLY_MIN_DAYS) { out.lead = nm(m); out.days = s.n; if (s.more) out.daysMore = true; } }
  if (P && typeof T.vol === "number" && typeof P.vol === "number" && P.vol > 0 && T.vol >= P.vol * SUPPLY_VOL_X && P.oq < 0 && T.oq > 0) out.turn = true;
  if (P) { const pm = mainOf(i - 1); if (pm) { const s = streak(pm, i - 1); if (s.n >= SUPPLY_MIN_DAYS && T[pm] < 0 && -T[pm] >= s.sum * SUPPLY_EXIT) { out.exit = nm(pm); out.exitDays = s.n; } } }
  return Object.keys(out).length ? out : null;
}
