// 집 PC 키움 중계 — 9.29-148 원장 [집2601][집2602] 「집 PC 중계가 받기」
//   왜: 키움 REST 는 사전 등록 IP 에서만 접속(GitHub Actions 10-14 뒤 토큰 0/454 · 전부 rc 3 · 같은 키로 집 PC 고정 IP = rc 0)
//   무엇: 장중 5분마다(Windows 예약 · scripts/kiwoom-home-task.ps1) kiwoomFlows(ka10063 외인·기관 + ka90004 프로그램 · 조회 TR 만 · KW_GAP_MS 간격) 1번
//         → 정규화 값만 eden-market main auto/live-kiwoom.json 에 저장 → Actions live run 이 오늘·15분 안이면 그 값으로 C 순위 · ④ 테마 수급 · 주도주 수급
//   키 = 금고(keyring 서비스 eden_kiwoom_rest · 항목 app_key / app_secret · 파이썬 keyring 을 파이프로 읽어 메모리에만) · GitHub 토큰 = env GITHUB_TOKEN 또는 `gh auth token`(메모리에만)
//   출력·파일·로그에 키·토큰 0 (kiwoom.js 오류 글에도 0) · 실패 회차는 저장 안 함(지난 좋은 값 유지) · 런타임 LLM 0 · 주문 0
// 사용: node scripts/kiwoom-home.mjs [--dry(저장 안 함 · 건수만)] [--force(시간·휴장 무시)] [--check(연결 확인 = 토큰 발급 1회 + ka10063 외국인 1쪽 1회 · 건수만 · 저장 0)] [--noprog(프로그램 생략)]
// 종료 코드(규약 6종): 0 OK(저장 또는 시간 밖 건너뜀) · 1 FAIL(키움·저장 실패) · 5 CONFIG(키 또는 GitHub 토큰 없음)
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { kiwoomFlows, kwText, kwHomeRecord, makeKiwoom, KW_HOME_FILE } from "../server/sources/kiwoom.js";
import { kstDate, kstTime } from "../shared/calendar.js";

export const HOME_REPO = "cmh73430-lgtm/eden-market", HOME_BRANCH = "main", HOME_PATH = "auto/" + KW_HOME_FILE;
export const HOME_FROM = "09:25", HOME_TO = "15:45"; // Actions 는 09:30 부터 키움 값을 씀 · 15:30 마감 뒤 늦은 「장 마감 값」 run(~16:00)도 15분 안 값으로
export const homeWindow = (hm) => typeof hm === "string" && hm >= HOME_FROM && hm <= HOME_TO;
const KR_PY = "import keyring,sys; v=keyring.get_password('eden_kiwoom_rest', sys.argv[1]); sys.stdout.write((v or '').strip())";

// 금고 키 → { KIWOOM_APP_KEY, KIWOOM_APP_SECRET } | null · env 에 둘 다 있으면 그 값 · 값은 반환만(출력 0)
export function readKeys({ env = process.env, exec = execFileSync } = {}) {
  if (env.KIWOOM_APP_KEY && env.KIWOOM_APP_SECRET) return { KIWOOM_APP_KEY: env.KIWOOM_APP_KEY, KIWOOM_APP_SECRET: env.KIWOOM_APP_SECRET };
  const get = (name) => { try { return String(exec("python", ["-c", KR_PY, name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 20000, env: Object.assign({}, env, { PYTHONIOENCODING: "utf-8" }) }) || "").trim(); } catch (e) { return ""; } };
  const k = get("app_key"), s = k ? get("app_secret") : "";
  return k && s ? { KIWOOM_APP_KEY: k, KIWOOM_APP_SECRET: s } : null;
}
export function readGhToken({ env = process.env, exec = execFileSync } = {}) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try { return String(exec("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 20000 }) || "").trim() || null; } catch (e) { return null; }
}

// eden-market main 한 파일 덮어쓰기(contents API · sha 충돌이면 다시 · 오류 글에 토큰 0)
export function makeGhWrite({ token, fetchImpl = fetch, repo = HOME_REPO, branch = HOME_BRANCH, path = HOME_PATH, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) }) {
  const api = (p, opts = {}) => fetchImpl("https://api.github.com" + p, Object.assign({ signal: AbortSignal.timeout(20000) }, opts, { headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "eden-kiwoom-home" } }));
  return async (obj, message) => {
    for (let a = 0; a < 4; a++) {
      const g = await api(`/repos/${repo}/contents/${path}?ref=${branch}`);
      if (g.status !== 200 && g.status !== 404) throw new Error(path + " 읽기 실패 HTTP " + g.status);
      const sha = g.status === 200 ? (await g.json()).sha : null;
      const body = Object.assign({ message, branch, content: Buffer.from(JSON.stringify(obj), "utf8").toString("base64") }, sha ? { sha } : {});
      const r = await api(`/repos/${repo}/contents/${path}`, { method: "PUT", body: JSON.stringify(body) });
      if (r.status === 200 || r.status === 201) return true;
      if (r.status === 409 || r.status === 422) { await sleep(500 + a * 500); continue; }
      throw new Error(path + " 저장 실패 HTTP " + r.status);
    }
    throw new Error(path + " 저장 실패 (충돌 반복)");
  };
}

// 한 회차: 키 없음 = 네트워크 0 · rc 5 / 키움 실패 = 저장 0 · rc 1 / 정상 = 저장 · rc 0
export async function kiwoomHome({ keys, fetchImpl = fetch, write = null, date, hm, ts = Date.now(), log = console.log, sleep, now, gapMs, retryMs, prog = true } = {}) {
  if (!keys) { log("키움 중계: 금고 키 없음 — 건너뜀(네트워크 0)"); return { rc: 5, kw: null, rec: null, wrote: false }; }
  const kw = await kiwoomFlows(Object.assign({ env: keys, fetchImpl, date, hm, prog }, sleep ? { sleep } : {}, now ? { now } : {}, gapMs !== undefined ? { gapMs } : {}, retryMs !== undefined ? { retryMs } : {}));
  log("키움 중계(집 PC) " + date + " " + hm + " · " + kwText(kw));
  if (!kw.ok) return { rc: 1, kw, rec: null, wrote: false };
  const rec = kwHomeRecord(kw, { date, hm, ts });
  if (!write) { log(`저장 안 함(--dry) · 종목 ${Object.keys(rec.flows).length} · ${JSON.stringify(rec).length} 바이트`); return { rc: 0, kw, rec, wrote: false }; }
  try { await write(rec, `키움 수급(집 PC 중계) ${date} ${hm} · 종목 ${rec.n}`); } catch (e) { log("저장 실패: " + String((e && e.message) || e).slice(0, 80)); return { rc: 1, kw, rec, wrote: false }; }
  log(`저장: ${HOME_PATH} (${HOME_REPO} ${HOME_BRANCH}) · 종목 ${Object.keys(rec.flows).length}`);
  return { rc: 0, kw, rec, wrote: true };
}

async function main() {
  const has = (n) => process.argv.includes("--" + n), arg = (n) => { const a = process.argv.find((x) => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : null; };
  const now = new Date(), date = kstDate(now), hm = kstTime(now).slice(0, 5);
  if (!has("force")) {
    const { loadCollectConfig } = await import("../server/config.js"), { skipReason } = await import("../server/auto.js"), cfg = loadCollectConfig();
    const skip = skipReason(date, cfg.holidays, cfg.holidayNames); if (skip) { console.log(`${date} ${skip} — 건너뜀`); return 0; }
    if (!homeWindow(hm)) { console.log(`${hm} 장중 아님(${HOME_FROM}~${HOME_TO}) — 건너뜀`); return 0; }
  }
  const keys = readKeys();
  if (has("check")) { // 연결 확인: 토큰 1회 + ka10063 1쪽 1회(값·토큰 출력 0 · 건수만)
    if (!keys) { console.log("금고 키 없음"); return 5; }
    let got = false; const kw = makeKiwoom({ env: keys, onToken: () => { got = true; } });
    try { const r = await kw.tr("ka10063", { mrkt_tp: "000", amt_qty_tp: "1", invsr: "6", frgn_all: "0", smtm_netprps_tp: "0", stex_tp: "1" }, { pages: 1 }); console.log(`토큰 rc 0 · ka10063 외국인 1쪽 ${r.rows.length}행 · 요청 ${kw.stats.requests}회`); return 0; }
    catch (e) { console.log(`토큰 ${got ? "rc 0" : "실패"} · ${String((e && e.message) || e).slice(0, 80)} · 요청 ${kw.stats.requests}회`); return 1; }
  }
  let write = null;
  if (!has("dry")) { const token = readGhToken(); if (!token) { console.log("GitHub 토큰 없음(gh auth login 또는 env GITHUB_TOKEN) — 건너뜀"); return 5; } write = makeGhWrite({ token }); }
  const r = await kiwoomHome({ keys, write, date, hm, prog: !has("noprog") });
  return r.rc;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((rc) => process.exit(rc), (e) => { console.log("키움 중계 실패: " + String((e && e.message) || e).slice(0, 80)); process.exit(1); });
