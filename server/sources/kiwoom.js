// 키움 REST 어댑터 — 9.29-111 원장 [2331][2333][2343] ②안: 장중 종목 수급(외인·기관·프로그램)만 보강 · 거래대금 순위·테마 구성·A·B 선정 원천(네이버)은 그대로
//
//  · 조회 TR 만: ka10063 장중투자자별매매(외국인 invsr 6 · 기관계 7 · 연속조회 cont-yn/next-key) · ka90004 종목별 프로그램매매(코스피·코스닥). 주문·매매·계좌 TR 0 (KW_TR 밖이면 throw)
//  · 키 = env KIWOOM_APP_KEY / KIWOOM_APP_SECRET 에서만 · 없으면 키움 길 전체 건너뜀(네트워크 0)
//  · 토큰 = POST /oauth2/token · 어디에도 출력 0 (결과·오류 글에 토큰·키 0) · GitHub Actions 면 kwMask 로 ::add-mask:: (호출부 collect-auto)
//  · 요청 간격 ≥ 0.25초(KW_GAP_MS · 공식 조회 초당 5회 · 실측 2026-10-20 무간격 11번째부터 http 429 「1700 허용된 API 요청 개수를 초과」)
//  · http 429 / return_code 1700·1701·1702 → 재시도(상한 KW_RETRY · 기다림 1초·2초·3초) · 실패하면 throw 하지 않고 「없음」({ ok:false, flows:null, why }) → 호출부 = 지금 동작(「수급 확인 전」)
//  · 결과 = 정규화한 값만 { code: { code, foreign, inst, program?, at, src:"kiwoom" } } (억원 · 키움 원문 응답 저장 0)
//    단위: ka10063 netprps_amt · ka90004 netprps_prica = 백만원(명세) → ÷100 = 억원 · 부호: 「--51092」 = −51092 (실측 2026-10-20 삼성전자 외국인 매수 125,504 · 매도 176,596 → 순 −51,092)
//    ka10063 은 그 투자자 잠정 집계에 든 종목만 줌(실측 10:03 외국인 1,470 · 기관 174 · 11:06 외국인 1,823 · 기관 336) → 목록에 없는 종목 = 값 없음(null · 0 으로 지어내지 않음)
//  9.29-152 원장 [집2619][집2620] 「모든 수급 = 정규+프리+애프터」 실측(2026-11-04 10:10 · work/도구/152 · NXT 프리·애프터 포함은 미실측 → 화면 「KRX+NXT 통합」):
//   · ka10051 stex_tp 1 = 네이버 index trend 와 같음(외인 = frgnr_netprps + native_trmt_frgnr_netprps · 코스피 -2,582+6 = -2,576 · 기관 +1,345 · 개인 +398 · 코스닥 -360 · -227 · +788) · 3 = 1+2(코스피 외인 -3,666 = -2,582-1,084 · 기관 +629 · 개인 +1,365 · 11/3·11/2 마감 값도 같음) · 단위 억원 · 코드 001/101(_NX·_AL)
//   · ka90004 tot_5(백만원) 1 = 네이버 프로그램 마감 값(10/23 -735,683 → -7,357억 · 10/26 -498,347 → -4,983억) · 3 = 1+2
//   · ka10063 은 stex_tp 1·2·3 값이 전 종목 같음(외국인 1,394행 · 기관 204행 다름 0 · 코드 꼬리만 _NX·_AL) = 거래소별로 안 나뉜 장중 잠정 → stex 3 으로 바꿔도 C·테마·종목 입력 무변
export const KW_HOST = "https://api.kiwoom.com";
export const KW_TOKEN_PATH = "/oauth2/token";
export const KW_TR = Object.freeze({ ka10063: "/api/dostk/mrkcond", ka90004: "/api/dostk/stkinfo", ka10051: "/api/dostk/sect" });
export const KW_GAP_MS = 250, KW_RETRY = 3, KW_RETRY_MS = 1000, KW_PAGES_INV = 5, KW_PAGES_PROG = 2, KW_TIMEOUT_MS = 10000, KW_BUDGET_MS = 40000;
export const KW_PROG_MKTS = ["P00101", "P10102"]; // 코스피 · 코스닥 (ka90004 명세)
export const KW_STEX = "3"; // 1:KRX 2:NXT 3:통합 (명세 · 9.29-152 [집2620])
export const KW_MKT_ROWS = Object.freeze({ kospi: { mrkt_tp: "0", cd: "001_AL", prog: "P00101" }, kosdaq: { mrkt_tp: "1", cd: "101_AL", prog: "P10102" } }); // ka10051 시장 전체 통합 행
const LIMIT_RC = new Set([1700, 1701, 1702]);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const round2 = (x) => Number(x.toFixed(2));

// 키 앞뒤 공백·CR·LF·BOM 제거(Actions Secrets 끝 줄끝 → rc 8001 실측 [집2440]) · 지운 뒤 빈 글 = 키 없음(네트워크 0)
const kwClean = (x) => (x === null || x === undefined ? "" : String(x).replace(/^[\s﻿]+|[\s﻿]+$/g, ""));
export function kwKeys(env) { const k = kwClean(env && env.KIWOOM_APP_KEY), s = kwClean(env && env.KIWOOM_APP_SECRET); return k && s ? { appkey: k, secretkey: s } : null; }
// 키움 숫자 글 → 수 (「+19」 「--51092」 「0」 · 빈 글 null) — 부호 글자에 「-」 가 하나라도 있으면 음수
export function kwNum(s) {
  if (s === null || s === undefined) return null; const t = String(s).trim(); if (!t) return null;
  const m = t.match(/^([+-]*)([0-9][0-9,]*(?:\.[0-9]+)?)$/); if (!m) return null;
  const n = Number(m[2].replace(/,/g, "")); if (!Number.isFinite(n)) return null;
  return m[1].includes("-") ? -n : n;
}
const eokOf = (mil) => (mil === null ? null : round2(mil / 100)); // 백만원 → 억원
const codeOf = (x) => { const c = String(x || "").trim().replace(/^A(?=[0-9]{6})/, "").replace(/_.*$/, ""); return /^[0-9A-Z]{6}$/.test(c) ? c : null; };
// Actions 로그 가리기: GITHUB_ACTIONS 일 때만 「::add-mask::값」 한 줄(Actions 가 그 줄을 지우고 뒤 로그의 같은 글을 *** 로) · 아니면 출력 0
export function kwMask(env, write = (s) => process.stdout.write(s)) { return (secret) => { if (env && env.GITHUB_ACTIONS === "true" && secret) write("::add-mask::" + secret + "\n"); }; }

// 요청기: 키 없으면 null · tr(api, body, {pages}) → { rows, pages, cont } · 실패 throw(글에 토큰·키 0) — kiwoomFlows 가 잡아서 「없음」
export function makeKiwoom({ env = process.env, fetchImpl = fetch, sleep = wait, now = () => Date.now(), gapMs = KW_GAP_MS, retry = KW_RETRY, retryMs = KW_RETRY_MS, timeoutMs = KW_TIMEOUT_MS, deadline = Infinity, onToken = null } = {}) {
  const keys = kwKeys(env); if (!keys) return null;
  let token = null, last = -Infinity; const stats = { requests: 0, retries: 0 };
  const pace = async () => { const w = last + gapMs - now(); if (w > 0) await sleep(w); last = now(); };
  async function post(path, body, headers) {
    for (let a = 0; ; a++) {
      if (now() > deadline) throw new Error("시간 예산 넘음");
      await pace(); stats.requests++;
      const r = await fetchImpl(KW_HOST + path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json;charset=UTF-8" }, headers), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      let j = null; try { j = await r.json(); } catch (e) {}
      const rc = j && j.return_code !== undefined && j.return_code !== null ? Number(j.return_code) : null, msg = j && typeof j.return_msg === "string" ? j.return_msg : "";
      const limited = r.status === 429 || LIMIT_RC.has(rc) || /^\s*170[012]\b/.test(msg);
      if (limited && a < retry) { stats.retries++; await sleep(retryMs * (a + 1)); last = now(); continue; }
      return { status: r.status, head: (k) => (r.headers && typeof r.headers.get === "function" ? r.headers.get(k) : null), j, rc, limited };
    }
  }
  async function auth() {
    const r = await post(KW_TOKEN_PATH, { grant_type: "client_credentials", appkey: keys.appkey, secretkey: keys.secretkey }, {});
    if (r.status !== 200 || !r.j || typeof r.j.token !== "string" || !r.j.token || (r.rc !== null && r.rc !== 0)) throw new Error("토큰 발급 실패 http " + r.status + (r.rc !== null ? " rc " + r.rc : "") + (r.limited ? " (요청 한도)" : ""));
    token = r.j.token; if (onToken) onToken(token);
  }
  async function tr(api, body, { pages = 1 } = {}) {
    if (!Object.prototype.hasOwnProperty.call(KW_TR, api)) throw new Error("허용 안 된 TR " + String(api).slice(0, 10)); // 조회 TR 만
    if (!token) await auth();
    const rows = [], top = {}; let cont = "N", nk = "", got = 0, cy = "N";
    for (let p = 1; p <= pages; p++) {
      const r = await post(KW_TR[api], body, { authorization: "Bearer " + token, "api-id": api, "cont-yn": cont, "next-key": nk });
      if (r.status !== 200 || !r.j || (r.rc !== null && r.rc !== 0)) throw new Error(api + " 실패 http " + r.status + (r.rc !== null ? " rc " + r.rc : "") + (r.limited ? " (요청 한도 · 재시도 " + retry + "회 넘음)" : ""));
      for (const [k, v] of Object.entries(r.j)) { if (Array.isArray(v)) rows.push(...v); else if (p === 1 && /^tot_[0-9]$/.test(k)) top[k] = v; } // tot_N = 첫 쪽 합계 칸(ka90004 순매수대금합계 tot_5 · 9.29-152)
      got = p; cy = String(r.head("cont-yn") || "N");
      if (cy !== "Y") break; cont = "Y"; nk = String(r.head("next-key") || "");
    }
    return { rows, top, pages: got, cont: cy };
  }
  return { tr, stats };
}

// 장중 수급 한 번: ka10063 외국인·기관(연속조회) + ka90004 프로그램(코스피·코스닥 앞 KW_PAGES_PROG 쪽 · 실패해도 외인·기관은 그대로)
//  → { ok, src:"kiwoom", at, flows: { code: { code, foreign, inst, program?, at, src } } | null, n, both, rows:{frgn,orgn,prog}, requests, retries, why?, errors }
export async function kiwoomFlows({ env = process.env, fetchImpl = fetch, sleep = wait, now = () => Date.now(), date, hm = null, onToken = null, prog = true, market = false, gapMs = KW_GAP_MS, retry = KW_RETRY, retryMs = KW_RETRY_MS, budgetMs = KW_BUDGET_MS } = {}) {
  const base = { ok: false, src: "kiwoom", at: hm || null, flows: null, n: 0, both: 0, rows: { frgn: 0, orgn: 0, prog: 0 }, requests: 0, retries: 0, errors: [] };
  let kw = null;
  try { kw = makeKiwoom({ env, fetchImpl, sleep, now, gapMs, retry, retryMs, deadline: now() + budgetMs, onToken }); } catch (e) { return Object.assign(base, { why: "준비 실패" }); }
  if (!kw) return Object.assign(base, { why: "키 없음" }); // 네트워크 0
  const out = {}, progTot = {}, put = (c, k, v) => { if (!c || v === null) return; (out[c] || (out[c] = { code: c }))[k] = v; };
  const fin = (o) => Object.assign(base, o, { requests: kw.stats.requests, retries: kw.stats.retries });
  try {
    const body = (invsr) => ({ mrkt_tp: "000", amt_qty_tp: "1", invsr, frgn_all: "0", smtm_netprps_tp: "0", stex_tp: KW_STEX });
    const F = await kw.tr("ka10063", body("6"), { pages: KW_PAGES_INV }); base.rows.frgn = F.rows.length;
    for (const r of F.rows) put(codeOf(r && r.stk_cd), "foreign", eokOf(kwNum(r && r.netprps_amt)));
    const O = await kw.tr("ka10063", body("7"), { pages: KW_PAGES_INV }); base.rows.orgn = O.rows.length;
    for (const r of O.rows) put(codeOf(r && r.stk_cd), "inst", eokOf(kwNum(r && r.netprps_amt)));
  } catch (e) { return fin({ flows: null, why: String((e && e.message) || e).slice(0, 80) }); }
  if (prog) {
    const d8 = String(date || "").replace(/-/g, "");
    for (const mk of KW_PROG_MKTS) {
      try { const P = await kw.tr("ka90004", { dt: d8, mrkt_tp: mk, stex_tp: KW_STEX }, { pages: KW_PAGES_PROG }); base.rows.prog += P.rows.length; progTot[mk] = P.top.tot_5; for (const r of P.rows) put(codeOf(r && r.stk_cd), "program", eokOf(kwNum(r && r.netprps_prica))); }
      catch (e) { base.errors.push("프로그램 " + mk + ": " + String((e && e.message) || e).slice(0, 60)); }
    }
  }
  if (market) { const m = await kwMarketOf(kw, { date, hm, ts: now(), progTot, errors: base.errors }); if (m) base.market = m; } // 9.29-152 시장 전체 통합 (실패해도 종목 값 그대로)
  const flows = {}; let both = 0;
  for (const [c, x] of Object.entries(out)) {
    flows[c] = Object.assign({ code: c, foreign: typeof x.foreign === "number" ? x.foreign : null, inst: typeof x.inst === "number" ? x.inst : null }, typeof x.program === "number" ? { program: x.program } : {}, { at: hm || null, src: "kiwoom" });
    if (typeof x.foreign === "number" && typeof x.inst === "number") both++;
  }
  const n = Object.values(flows).filter((f) => f.foreign !== null || f.inst !== null).length;
  if (!n) return fin({ flows: null, why: "외인·기관 0행(장 시작 전·집계 전)" });
  return fin({ ok: true, flows, n, both });
}
// 9.29-152 [집2620] 시장 전체 통합(ka10051 stex 3 · 종합 행 · 억원) + 프로그램(ka90004 tot_5 · 백만원 ÷100 · progTot 없으면 1쪽 요청) → { at, ts, kospi:{foreign,institution,personal,program}, kosdaq } · 한 시장도 못 받으면 null · 지어내기 0
const mktRow = (rows, cd) => (Array.isArray(rows) ? rows.find((r) => r && r.inds_cd === cd) : null) || null;
async function kwMarketOf(kw, { date, hm, ts, progTot = null, errors = [] } = {}) {
  const d8 = String(date || "").replace(/-/g, ""), m = { at: hm || null, ts }; let got = 0;
  for (const [k, q] of Object.entries(KW_MKT_ROWS)) {
    try {
      const R = await kw.tr("ka10051", { mrkt_tp: q.mrkt_tp, amt_qty_tp: "0", base_dt: d8, stex_tp: KW_STEX }, { pages: 1 }), r = mktRow(R.rows, q.cd);
      if (!r) { errors.push("시장 전체 " + k + ": 통합 행 없음"); continue; }
      const f = kwNum(r.frgnr_netprps), nf = kwNum(r.native_trmt_frgnr_netprps), o = kwNum(r.orgn_netprps), p = kwNum(r.ind_netprps);
      const foreign = f === null ? null : f + (nf || 0); // 네이버 「외국인」 = 외국인 + 내국인대우외국인(실측 일치)
      if (![foreign, o, p].some((v) => v !== null && v !== 0)) { errors.push("시장 전체 " + k + ": 값 없음(집계 전)"); continue; }
      let tot = progTot && progTot[q.prog] !== undefined ? progTot[q.prog] : null;
      if (tot === null) { try { tot = (await kw.tr("ka90004", { dt: d8, mrkt_tp: q.prog, stex_tp: KW_STEX }, { pages: 1 })).top.tot_5; } catch (e) { errors.push("시장 프로그램 " + k + ": " + String((e && e.message) || e).slice(0, 60)); } }
      const tv = kwNum(tot);
      m[k] = { foreign, institution: o, personal: p, program: tv === null ? null : Math.round(tv / 100) }; got++;
    } catch (e) { errors.push("시장 전체 " + k + ": " + String((e && e.message) || e).slice(0, 60)); }
  }
  return got ? m : null;
}
// 장중 창 밖(08:00~09:25 · 15:45~20:05)용: 시장 전체만 → { ok, market, requests, retries, errors, why? }
export async function kiwoomMarket({ env = process.env, fetchImpl = fetch, sleep = wait, now = () => Date.now(), date, hm = null, onToken = null, gapMs = KW_GAP_MS, retry = KW_RETRY, retryMs = KW_RETRY_MS, budgetMs = KW_BUDGET_MS } = {}) {
  const base = { ok: false, market: null, requests: 0, retries: 0, errors: [] };
  let kw = null;
  try { kw = makeKiwoom({ env, fetchImpl, sleep, now, gapMs, retry, retryMs, deadline: now() + budgetMs, onToken }); } catch (e) { return Object.assign(base, { why: "준비 실패" }); }
  if (!kw) return Object.assign(base, { why: "키 없음" }); // 네트워크 0
  const m = await kwMarketOf(kw, { date, hm, ts: now(), errors: base.errors });
  return Object.assign(base, { ok: !!m, market: m, requests: kw.stats.requests, retries: kw.stats.retries }, m ? {} : { why: (base.errors[0] || "시장 전체 없음").slice(0, 80) });
}
export const kwMarketText = (m) => !m ? "시장 전체 통합 없음" : "시장 전체 통합 " + ["kospi", "kosdaq"].filter((k) => m[k]).map((k) => (k === "kospi" ? "코스피" : "코스닥") + " 외인 " + m[k].foreign + " · 기관 " + m[k].institution + " · 개인 " + m[k].personal + " · 프로그램 " + m[k].program).join(" / ");
// 한 줄 기록(로그용 · 토큰·키 0)
export const kwText = (k) => !k ? "키움: 안 돎" : k.ok ? `키움 장중 수급: 외인 ${k.rows.frgn}행 · 기관 ${k.rows.orgn}행 · 프로그램 ${k.rows.prog}행 → 종목 ${k.n}(외인·기관 둘 다 ${k.both}) · 요청 ${k.requests}회${k.retries ? " · 재시도 " + k.retries : ""}${k.errors.length ? " · 참고 " + k.errors.join(" / ") : ""}` : `키움 장중 수급 없음(${k.why || "?"}) · 요청 ${k.requests}회 — 지금 동작(네이버 · 「수급 확인 전」)`;
// 공개 저장소에 남길 꼴(정규화 메타만 · 종목별 원문 0)
export const kwMeta = (k) => (k ? Object.assign({ src: "kiwoom", ok: !!k.ok, at: k.at || null, n: k.n || 0, both: k.both || 0, rows: k.rows, requests: k.requests || 0 }, k.retries ? { retries: k.retries } : {}, k.why ? { why: k.why } : {}) : null);

// 9.29-148 원장 [집2601][집2602] 「집 PC 중계가 받기」: 키움 REST = 사전 등록 IP 에서만(Actions 10-14 뒤 0/454 rc 3 · 집 PC 고정 IP rc 0)
//  → 집 PC(scripts/kiwoom-home.mjs · 장중 5분마다)가 kiwoomFlows 를 돌려 정규화 값만 eden-market auto/live-kiwoom.json 에 · Actions live run 은 그 파일이 오늘·15분 안이면 그 값(자기 키움 시도 0)
//  · 파일 = { v, src, via:"home", date, at, ts, n, both, rows, requests, flows:{ 코드: [외인, 기관, 프로그램] } } (억원 · null = 값 없음) · 토큰·키·키움 원문 0 · 실패 회차는 안 씀(지난 좋은 값 유지 → 15분 넘으면 Actions 가 안 씀)
export const KW_HOME_FILE = "live-kiwoom.json", KW_HOME_MAX_MS = 15 * 60 * 1000;
const numOrNull = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
export function kwHomeRecord(k, { date, hm, ts, market = null } = {}) {
  if (!k || !k.ok || !k.flows || typeof date !== "string" || typeof ts !== "number") return null;
  const flows = {};
  for (const [c, f] of Object.entries(k.flows)) { if (!/^[0-9A-Z]{6}$/.test(c) || !f) continue; const a = [numOrNull(f.foreign), numOrNull(f.inst)], p = numOrNull(f.program); if (p !== null) a.push(p); if (a[0] !== null || a[1] !== null || p !== null) flows[c] = a; }
  return Object.assign({ v: 1, src: "kiwoom", via: "home", date, at: hm || k.at || null, ts, n: k.n || 0, both: k.both || 0, rows: k.rows || null, requests: k.requests || 0 }, k.retries ? { retries: k.retries } : {}, k.errors && k.errors.length ? { errors: k.errors.slice(0, 4).map((e) => String(e).slice(0, 80)) } : {}, { flows }, market ? { market } : {});
}
// 9.29-152 종목 값 없는 회차(창 밖 · 종목 실패): 시장 전체만 새로 · keep = 같은 날 지난 종목 값·시각(ts) 유지 → kwFromHome 15분 규칙 그대로 · 아니면 종목 비움(공개 저장소 커밋 크기 ↓) · ts 0 = kwFromHome null
export function kwHomeMarketOnly(prev, { date, hm, market = null, keep = false } = {}) {
  const old = keep && prev && prev.v === 1 && prev.via === "home" && prev.date === date && prev.flows && typeof prev.flows === "object" ? prev : null;
  return Object.assign(old ? Object.assign({}, old) : { v: 1, src: "kiwoom", via: "home", date, at: hm || null, ts: 0, n: 0, both: 0, rows: null, requests: 0, flows: {} }, market ? { market } : {});
}
// 9.29-152 집 PC 파일의 시장 전체 → 화면용 { src, scope:"all", at, ts, kospi, kosdaq } · 오늘 날짜·maxMs 안(장중 live 와 같은 15분)일 때만 · final = 마감 run: 20:00 뒤 값(애프터 끝 · 더 안 바뀜)은 오래돼도 그날 값 · 아니면 null(→ 네이버 값 + 「정규만」)
export function kwMarketFromHome(rec, { date, nowMs, maxMs = KW_HOME_MAX_MS, final = false } = {}) {
  const m = rec && typeof rec === "object" && rec.v === 1 && rec.via === "home" && rec.date === date ? rec.market : null;
  if (!m || typeof m !== "object" || typeof m.ts !== "number") return null;
  const at = typeof m.at === "string" ? m.at : null, age = nowMs - m.ts;
  if (!(age >= -60000 && (age <= maxMs || (final && at !== null && at >= "20:00")))) return null;
  const one = (x) => { if (!x || typeof x !== "object") return null; const r = { foreign: numOrNull(x.foreign), institution: numOrNull(x.institution), personal: numOrNull(x.personal), program: numOrNull(x.program) }; return r.foreign === null && r.institution === null && r.personal === null ? null : r; };
  const kospi = one(m.kospi), kosdaq = one(m.kosdaq);
  if (!kospi && !kosdaq) return null;
  return { src: "kiwoom", scope: "all", at, ts: m.ts, kospi, kosdaq };
}
// 집 PC 파일 → kiwoomFlows 와 같은 모양(ok·flows·n·both·rows) · 오늘 날짜·ts 가 maxMs 안·모양 맞을 때만 · 아니면 null(→ 호출부 = 지금 동작)
export function kwFromHome(rec, { date, nowMs, maxMs = KW_HOME_MAX_MS } = {}) {
  if (!rec || typeof rec !== "object" || rec.v !== 1 || rec.via !== "home" || rec.date !== date || typeof rec.ts !== "number" || !rec.flows || typeof rec.flows !== "object") return null;
  const age = nowMs - rec.ts; if (!(age >= -60000 && age <= maxMs)) return null; // 시계 차 1분까지
  const at = typeof rec.at === "string" ? rec.at : null, flows = {}; let n = 0, both = 0;
  for (const [c, a] of Object.entries(rec.flows)) {
    if (!/^[0-9A-Z]{6}$/.test(c) || !Array.isArray(a)) continue; const fo = numOrNull(a[0]), ins = numOrNull(a[1]), p = numOrNull(a[2]);
    if (fo === null && ins === null && p === null) continue;
    flows[c] = Object.assign({ code: c, foreign: fo, inst: ins }, p !== null ? { program: p } : {}, { at, src: "kiwoom" });
    if (fo !== null || ins !== null) n++; if (fo !== null && ins !== null) both++;
  }
  if (!n) return null;
  return { ok: true, src: "kiwoom", via: "home", at, flows, n, both, rows: rec.rows && typeof rec.rows === "object" ? rec.rows : { frgn: 0, orgn: 0, prog: 0 }, requests: 0, retries: 0, errors: [], homeTs: rec.ts, homeRequests: typeof rec.requests === "number" ? rec.requests : 0 };
}

export default { name: "kiwoom", kiwoomFlows, kiwoomMarket, kwKeys };
