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
export const KW_HOST = "https://api.kiwoom.com";
export const KW_TOKEN_PATH = "/oauth2/token";
export const KW_TR = Object.freeze({ ka10063: "/api/dostk/mrkcond", ka90004: "/api/dostk/stkinfo" });
export const KW_GAP_MS = 250, KW_RETRY = 3, KW_RETRY_MS = 1000, KW_PAGES_INV = 5, KW_PAGES_PROG = 2, KW_TIMEOUT_MS = 10000, KW_BUDGET_MS = 40000;
export const KW_PROG_MKTS = ["P00101", "P10102"]; // 코스피 · 코스닥 (ka90004 명세)
const LIMIT_RC = new Set([1700, 1701, 1702]);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const round2 = (x) => Number(x.toFixed(2));

export function kwKeys(env) { const k = env && env.KIWOOM_APP_KEY, s = env && env.KIWOOM_APP_SECRET; return k && s ? { appkey: String(k), secretkey: String(s) } : null; }
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
    const rows = []; let cont = "N", nk = "", got = 0, cy = "N";
    for (let p = 1; p <= pages; p++) {
      const r = await post(KW_TR[api], body, { authorization: "Bearer " + token, "api-id": api, "cont-yn": cont, "next-key": nk });
      if (r.status !== 200 || !r.j || (r.rc !== null && r.rc !== 0)) throw new Error(api + " 실패 http " + r.status + (r.rc !== null ? " rc " + r.rc : "") + (r.limited ? " (요청 한도 · 재시도 " + retry + "회 넘음)" : ""));
      for (const v of Object.values(r.j)) if (Array.isArray(v)) rows.push(...v);
      got = p; cy = String(r.head("cont-yn") || "N");
      if (cy !== "Y") break; cont = "Y"; nk = String(r.head("next-key") || "");
    }
    return { rows, pages: got, cont: cy };
  }
  return { tr, stats };
}

// 장중 수급 한 번: ka10063 외국인·기관(연속조회) + ka90004 프로그램(코스피·코스닥 앞 KW_PAGES_PROG 쪽 · 실패해도 외인·기관은 그대로)
//  → { ok, src:"kiwoom", at, flows: { code: { code, foreign, inst, program?, at, src } } | null, n, both, rows:{frgn,orgn,prog}, requests, retries, why?, errors }
export async function kiwoomFlows({ env = process.env, fetchImpl = fetch, sleep = wait, now = () => Date.now(), date, hm = null, onToken = null, prog = true, gapMs = KW_GAP_MS, retry = KW_RETRY, retryMs = KW_RETRY_MS, budgetMs = KW_BUDGET_MS } = {}) {
  const base = { ok: false, src: "kiwoom", at: hm || null, flows: null, n: 0, both: 0, rows: { frgn: 0, orgn: 0, prog: 0 }, requests: 0, retries: 0, errors: [] };
  let kw = null;
  try { kw = makeKiwoom({ env, fetchImpl, sleep, now, gapMs, retry, retryMs, deadline: now() + budgetMs, onToken }); } catch (e) { return Object.assign(base, { why: "준비 실패" }); }
  if (!kw) return Object.assign(base, { why: "키 없음" }); // 네트워크 0
  const out = {}, put = (c, k, v) => { if (!c || v === null) return; (out[c] || (out[c] = { code: c }))[k] = v; };
  const fin = (o) => Object.assign(base, o, { requests: kw.stats.requests, retries: kw.stats.retries });
  try {
    const body = (invsr) => ({ mrkt_tp: "000", amt_qty_tp: "1", invsr, frgn_all: "0", smtm_netprps_tp: "0", stex_tp: "1" });
    const F = await kw.tr("ka10063", body("6"), { pages: KW_PAGES_INV }); base.rows.frgn = F.rows.length;
    for (const r of F.rows) put(codeOf(r && r.stk_cd), "foreign", eokOf(kwNum(r && r.netprps_amt)));
    const O = await kw.tr("ka10063", body("7"), { pages: KW_PAGES_INV }); base.rows.orgn = O.rows.length;
    for (const r of O.rows) put(codeOf(r && r.stk_cd), "inst", eokOf(kwNum(r && r.netprps_amt)));
  } catch (e) { return fin({ flows: null, why: String((e && e.message) || e).slice(0, 80) }); }
  if (prog) {
    const d8 = String(date || "").replace(/-/g, "");
    for (const mk of KW_PROG_MKTS) {
      try { const P = await kw.tr("ka90004", { dt: d8, mrkt_tp: mk, stex_tp: "1" }, { pages: KW_PAGES_PROG }); base.rows.prog += P.rows.length; for (const r of P.rows) put(codeOf(r && r.stk_cd), "program", eokOf(kwNum(r && r.netprps_prica))); }
      catch (e) { base.errors.push("프로그램 " + mk + ": " + String((e && e.message) || e).slice(0, 60)); }
    }
  }
  const flows = {}; let both = 0;
  for (const [c, x] of Object.entries(out)) {
    flows[c] = Object.assign({ code: c, foreign: typeof x.foreign === "number" ? x.foreign : null, inst: typeof x.inst === "number" ? x.inst : null }, typeof x.program === "number" ? { program: x.program } : {}, { at: hm || null, src: "kiwoom" });
    if (typeof x.foreign === "number" && typeof x.inst === "number") both++;
  }
  const n = Object.values(flows).filter((f) => f.foreign !== null || f.inst !== null).length;
  if (!n) return fin({ flows: null, why: "외인·기관 0행(장 시작 전·집계 전)" });
  return fin({ ok: true, flows, n, both });
}
// 한 줄 기록(로그용 · 토큰·키 0)
export const kwText = (k) => !k ? "키움: 안 돎" : k.ok ? `키움 장중 수급: 외인 ${k.rows.frgn}행 · 기관 ${k.rows.orgn}행 · 프로그램 ${k.rows.prog}행 → 종목 ${k.n}(외인·기관 둘 다 ${k.both}) · 요청 ${k.requests}회${k.retries ? " · 재시도 " + k.retries : ""}${k.errors.length ? " · 참고 " + k.errors.join(" / ") : ""}` : `키움 장중 수급 없음(${k.why || "?"}) · 요청 ${k.requests}회 — 지금 동작(네이버 · 「수급 확인 전」)`;
// 공개 저장소에 남길 꼴(정규화 메타만 · 종목별 원문 0)
export const kwMeta = (k) => (k ? Object.assign({ src: "kiwoom", ok: !!k.ok, at: k.at || null, n: k.n || 0, both: k.both || 0, rows: k.rows, requests: k.requests || 0 }, k.retries ? { retries: k.retries } : {}, k.why ? { why: k.why } : {}) : null);

export default { name: "kiwoom", kiwoomFlows, kwKeys };
