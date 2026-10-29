// 자동 연동 수집기 — GitHub Actions(.github/workflows/auto.yml)가 평일 아침·오후에 실행한다.
//   아침(KST 12시 전): 미국 선물·환율·SOX·VIX·유가·금리 + 미국 대응주 (네이버 → 야후 순) + 전일 주도 테마(애프터·프리마켓)
//   오후:             코스피·코스닥 마감 등락률 + 투자자별 수급 + 오늘 주도 테마 (네이버) — 16:20 첫 마감 run 이 정규장 값으로 고르고, 19:45·20:20 run 은 확정 수급만 채움 (9.29-107: 옛 주석 「18:40」 = 지금은 없는 예약 시각)
//   아침 전일 테마는 전날 마감 확정 결과(close.market.leaders)를 이어 쓰고 어제 저녁 애프터(전날 분봉 · 9.29-107)·NXT 프리마켓만 붙인다 (재선정 안 함, 없으면 n=2 잠정 선정). 전날 결과가 아직 잠정·수급 없음이면 아침 수집 전에 먼저 확정(백필)한다
// 저녁 애프터장 줄 (9.29-107 원장 [2198][2200][2205][2206] · server/after.js): 20:05 뒤 마감 run(예약 20:20 · 실제 20:34~20:52)이 날짜 파일 최상위 「애프터_2000」 을 계산해 다시 저장(새 예약 0 — 같은 concurrency 묶음 대기 취소 위험)
//   ① 주도 테마 이어짐/꺾임 ② 저녁 강한 테마 상위 3 ③ ±3% 종목 각 5 (저녁 거래대금 10억↑) · 마지막 봉 19:55 전이면 「자료 미완」 · 확정(ok) 있으면 다시 안 함 · 못 했으면 다음 날 07:00 뒤 아침 run 이 어제 분봉으로 보충
//   옵션: --after (시각·기존 기록과 관계없이 계산) · --afterout=파일 (--dry 결과 저장)
// 결과는 GITHUB_REPOSITORY 의 AUTO_BRANCH(기본 cockpit-data, 공개 저장소 eden-market 은 main) 브랜치 auto/<날짜>.json 과 auto/latest.json 에 둔다.
// 옵션: --when=morning|intraday|close|themes|live|afterlive (afterlive = 16:00~20:05 애프터 실시간 → auto/live-after.json 만 · 기본: 지금 시각으로 판단 · live = 장중 실시간 주도 테마 → auto/live.json 만 · themes = 미국장 테마 값만 아침 기록에 채워 넣기, 새 테마를 추가한 날) --date=YYYY-MM-DD (기본: 오늘 KST) --dry (저장 안 함) --force (주말·휴장도 실행)
//       --final (close: 실행 시각과 관계없이 확정 run — 수급·일봉 포함). 오늘이 아닌 --date 로 손으로 백필하는 close run 도 확정으로 돈다 (잠정 결과가 확정을 덮지 않게)
// 관찰 기록 (9.29-82 원장 [1556] · [1558]): 마감 확정 run 이 400종목 중 「급락일 외국인·기관 동반 매수」 종목과 그 뒤 결과를 auto/observe/crash-cobuy.json 에 쌓는다
//   (대상 목록 auto/observe/universe.json 은 7일마다 다시 만듦 · 기록만 · 날짜 파일·앱 무변경 · --dry 는 목록만 출력)
// 그림자(shadow) 선정 V2 · 뉴스 v2 · 성적표 (9.29-84 원장 [1597]): live run 과 close run 이 현행 결과 옆에 shadow 블록(live.json · 날짜 파일 close.shadow)과 테마별 news2 를 더한다 · 기존 블록 무변경
//   RVOL 20일 평균은 중계 /day 일봉(실패하면 네이버 일봉) · 직전 live.json 의 shadow.rvolCache(하루 1회) 를 이어 쓴다 · 뉴스 캐시·하루 상한도 live.json 의 news2 에서 이어 씀
//   성적표: 확정 close run(close.at ≥ 16:20) 이 auto/observe/leaders-scorecard.json 에 오늘 선정(a 확정 · b 잠정 · c live 마지막 · s shadow)을 적고 지난 행 D+1~D+4 를 채운다
// 옵션 추가: --trace (요청 수·걸린 시간 출력 · 재현용)
// 아침 브리핑 (9.29-97 원장 [1775][1779][1780] t일정뉴스 · server/brief.js): 07:00 뒤 아침 run(07:05·08:05) 이 ① IR 실적 ② 공시 ③ 미국 큰 폭 ④ 국내 종목 뉴스를 받아 날짜 파일 최상위 brief 에 둔다 (morning 블록 밖)
//   09:32·10:02 장중 run(10:20 전 시작 · 9.29-108 부터 장중은 09:32~14:32 30분마다)은 ② 공시만 한 번 더 · 섹션마다 받은 것만 덮고 실패하면 지난 값 유지 · 하루 요청 상한 BRIEF_DAILY_MAX · --brief 면 시각과 관계없이 4묶음
//   SK하이닉스 ADR(SKHY) 환산 (원장 [1784]): 아침 run 이 한국 SK하이닉스 전일 종가 1회 + 지난 파일의 괴리 이력(요청 0)
// 9.29-100 (원장 [1845]~[1850]): 주도 테마 = 급등 묶음(server/surge.js) — 테마 구성표 auto/observe/theme-map.json(아침 run 이 7일마다 다시 만듦 · 없으면 아무 run 이나 만듦 · 실패면 옛 표)
//   장중 live = 09:30 부터 급등 묶음 · 마감: 오늘 확정이 없는 첫 close run(16:20) 이 정규장 값(15:30 봉)으로 한 번 고름 · 19:45·20:20 은 다시 고르지 않고 확정 수급만 채움
//   옛 방식(T·L)은 close.shadow(kind old-TL) 에 비교용으로 계속 계산(성적표 s) · 그림자 V2 는 끔 · --map=파일 (--dry 에서 구성표를 로컬 파일로) · --mapout=파일 (--dry 에서 새로 만든 표 저장)
import { readFileSync, writeFileSync } from "node:fs";
import { loadCollectConfig } from "../server/config.js";
import { prevBusinessDay, kstTime, nextBusinessDays } from "../shared/calendar.js";
import { collectBrief, mergeBrief, briefText, BRIEF_SECTIONS } from "../server/brief.js";
import { collectWatch, watchText, mergeWatch } from "../server/watch.js"; // 관심 후보 (9.29-97 범위 확장 · 확정 close run → close.watch → 다음 아침 brief ④)
import { autoFile, AUTO_DIR, collectLive, collectClose, collectMorning, collectPrevThemes, collectLeaders, collectIntraday, kstDate, mergeAuto, mergeCloseLeaders, skipReason, summarize, whenOf, collectThemesOnly, historyFrom, fetchListings, collectCandles, candleFile, liveSlot, liveOverwrite, collectObserve, obsText, OBS_FILE, OBS_UNIVERSE_FILE, chartUrl, collectCloseSnap, CLOSE_SNAP_KEY, CLOSE_SNAP_ITEMS, fetchKrClose, mergeHist, regimeOf as regimeOfAmt, keepLiveExtra } from "../server/auto.js";
import { memoGet, TOP10_CODES } from "../server/shadow.js";
import { MAP_FILE, mapStale, buildThemeMap, collectSurgeLeaders, fillFinalFlows, SURGE_V, REGULAR_AFTER, attachAlerts, attachHeat, AB_FILE, AB_RUNS_MAX, abRunOf, abScore, abUpsert, abNext, abSummary, abNeutralDay, abNeutralNext } from "../server/surge.js"; // 9.29-100 급등 묶음 선정 (원장 [1845]~[1850])
import { collectScorecard, scText, SC_FILE } from "../server/scorecard.js";
import { ldsDupDays, ldsLatestA } from "../shared/leaders-score.js";
import { CAUTION_FILE, CAUTION_KEEP, loadCautions, tagAvoidAll, avoidText } from "../server/caution.js";
import { collectForward, fwdText, fwdShouldSave, FWD_FILE, FWD_BUDGET_MS } from "../server/usforward.js"; /* 9.29-105 원장 [2132] ③ 미국장 테마 전진 기록 */
import { collectAfter, afterText, afterDue, afterLeadMap, AFTER_KEY, AFTER_BUDGET_MS, AFTER_MORNING_FROM, AFTERLIVE_FILE, AFTERLIVE_BUDGET_MS, afterLiveWindow, afterLiveScan, afterLiveRecord, savedRecently } from "../server/after.js"; /* 9.29-107 저녁 애프터장 줄 */
import { regularsOf, fcText } from "../server/forecast.js"; /* 9.29-102 원장 [1905] 단골 참고 줄 · 9.29-103 원장 [2003] 그림자 기록은 뺌(세기만 남김) */ /* 9.29-101 원장 [1884] S4 종배 피함 (거래소 공시 지난 거래일 목록 · 하루 1번) */
import naver from "../server/sources/naver.js";
import yahoo from "../server/sources/yahoo.js";
import upbit from "../server/sources/upbit.js";
import kis from "../server/sources/kis.js";
import { kiwoomFlows, kwMask, kwText, kwKeys } from "../server/sources/kiwoom.js"; /* 9.29-111 원장 [2343] ②안 키움 장중 수급(키 = env KIWOOM_APP_KEY·KIWOOM_APP_SECRET · 없으면 건너뜀 · 토큰 출력 0 · Actions 면 ::add-mask::) */
import tradingview from "../server/sources/tradingview.js";

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith("--" + name + "=")); return a ? a.slice(name.length + 3) : def; };
const has = (name) => process.argv.includes("--" + name);
// --trace: 바깥 요청 수·걸린 시간 (fetch 전부 · 재현 보고용)
const T0 = Date.now(); let FETCH_N = 0;
if (has("trace")) { const f0 = globalThis.fetch; globalThis.fetch = (...a) => { FETCH_N++; return f0(...a); }; process.on("exit", () => console.log(`[trace] 요청 ${FETCH_N}회 · ${((Date.now() - T0) / 1000).toFixed(1)}초`)); }
const BRANCH = process.env.AUTO_BRANCH || "cockpit-data"; // 공개 저장소 eden-market 은 main
const now = new Date();
const date = arg("date", kstDate(now));
const when = arg("when", whenOf(now));
const cfg = loadCollectConfig();

const skip = skipReason(date, cfg.holidays, cfg.holidayNames);
if (skip && !has("force")) { console.log(`${date} ${skip} — 건너뜀`); process.exit(0); }

// ---- GitHub 저장 (contents API) ----
const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
const api = async (path, opts = {}) => {
  const res = await fetch("https://api.github.com" + path, Object.assign({ signal: AbortSignal.timeout(20000) }, opts, {
    headers: Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" }, opts.headers || {}),
  }));
  return res;
};
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
// --dry(토큰 없음)일 때 관찰 기록 재현용: 공개 저장소 eden-market main 의 파일을 읽기만 한다 (토큰 안 씀 · 없으면 null)
const PUBLIC_REPO = "cmh73430-lgtm/eden-market";
async function readPublic(path) {
  try { const r = await fetch(`https://raw.githubusercontent.com/${PUBLIC_REPO}/main/${path}`, { signal: AbortSignal.timeout(15000) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function ensureBranch() {
  let r = await api(`/repos/${repo}/branches/${BRANCH}`);
  if (r.ok) return;
  if (r.status !== 404) throw new Error("브랜치 확인 실패 HTTP " + r.status);
  r = await api(`/repos/${repo}`); if (!r.ok) throw new Error("저장소 확인 실패 HTTP " + r.status);
  const base = (await r.json()).default_branch;
  r = await api(`/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`); if (!r.ok) throw new Error("기본 브랜치 확인 실패 HTTP " + r.status);
  const sha = (await r.json()).object.sha;
  r = await api(`/repos/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: "refs/heads/" + BRANCH, sha }) });
  if (!r.ok && r.status !== 422) throw new Error("브랜치 만들기 실패 HTTP " + r.status);
}
async function readFile(path) {
  const r = await api(`/repos/${repo}/contents/${path}?ref=${BRANCH}`);
  if (r.status === 404) return { json: null, sha: null };
  if (!r.ok) throw new Error(path + " 읽기 실패 HTTP " + r.status);
  const j = await r.json();
  let json = null; try { json = JSON.parse(Buffer.from(j.content || "", "base64").toString("utf8")); } catch {}
  return { json, sha: j.sha };
}
// 공개 저장소면 jsDelivr 캐시를 비운다 (claude.ai 링크판 앱이 jsDelivr로 읽음). 실패해도 괜찮다.
async function purgeCdn(path) {
  if (BRANCH !== "main") return;
  try { await fetch(`https://purge.jsdelivr.net/gh/${repo}@${BRANCH}/${path}`, { signal: AbortSignal.timeout(10000) }); } catch (e) {}
}
async function writeFile(path, obj, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readFile(path);
    const body = { message, branch: BRANCH, content: b64(JSON.stringify(obj)) };
    if (cur.sha) body.sha = cur.sha;
    const r = await api(`/repos/${repo}/contents/${path}`, { method: "PUT", body: JSON.stringify(body) });
    if (r.ok) { await purgeCdn(path); return; }
    if (r.status === 409 || r.status === 422) { await new Promise((ok) => setTimeout(ok, 500 + attempt * 500)); continue; }
    throw new Error(path + " 저장 실패 HTTP " + r.status + " " + (await r.text()).slice(0, 200));
  }
  throw new Error(path + " 저장 실패 (충돌 반복)");
}

const save = !has("dry") && token && repo;
// ---- 그림자 V2 · 뉴스 v2 입력 (9.29-84) ----
// RVOL 20일 평균용 일봉: 중계 /day(종가×거래량 근사 · 앱과 같은 길) → 못 받으면 네이버 일봉(C 등급 계산과 같은 주소). server/shadow.js barRows 가 두 모양 다 읽는다
const RELAY = "https://eden-chart.cmh-eden.workers.dev", NV_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const nvGet = async (u) => { const r = await fetch(u, { headers: { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": NV_UA }, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
/* 9.29-101 종배 피함(S4) 자료: 지난 10거래일 거래소 공시 목록에서 단기과열 예고·지정 · 투자주의(원장 [1937] ④ 전 종류 · 「[투자주의]」 머리표)만 뽑아 auto/observe/kind-cautions.json 에 보관 — 파일에 없는 날만 받음(한 run 최대 3일 · 평소 하루 1번 · 실패하면 그날은 표시 없음) */
const kindPost = async (u, body) => { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html", "User-Agent": NV_UA }, body, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); };
function prevTradingDays(n = CAUTION_KEEP) { const out = []; let d = date; for (let i = 0; i < n; i++) { d = prevBusinessDay(d, cfg.holidays); out.push(d); } return out; }
async function loadCautionFile() {
  const prevDays = prevTradingDays();
  try {
    let old = null; try { old = arg("cautions") ? JSON.parse(readFileSync(arg("cautions"), "utf8")) : save ? (await readFile(CAUTION_FILE)).json : await readPublic(CAUTION_FILE); } catch (e) {}
    const r = await loadCautions({ post: kindPost, file: old, prevDays });
    console.log(`종배 피함 자료 ${r.have}/${r.want}일 · 새로 받음 ${r.requests}회${r.errors.length ? " · 참고 " + r.errors.slice(0, 2).join(" / ") : ""}`);
    if (r.changed) { r.file.updatedAt = Date.now(); if (save) { try { await writeFile(CAUTION_FILE, r.file, `종배 피함 자료 ${date}`); } catch (e) { console.log("종배 피함 자료 저장 실패:", e.message || e); } } else if (arg("cautionsout")) writeFileSync(arg("cautionsout"), JSON.stringify(r.file)); }
    return { file: r.file, prevDays };
  } catch (e) { console.log("종배 피함 자료 실패:", e.message || e); return { file: null, prevDays }; }
}
// 테마 구성표 (9.29-100): 저장소(또는 --map 로컬 · --dry 면 공개 저장소) 에서 읽고 · rebuild=true(아침) 면 7일 지났을 때, 아니면 아예 없을 때만 다시 만든다(약 270회 · 0.2초 간격 · 2분 30초 예산) · 실패면 옛 표
async function loadThemeMap({ rebuild = false } = {}) {
  let m = null;
  try { m = arg("map") ? JSON.parse(readFileSync(arg("map"), "utf8")) : save ? (await readFile(MAP_FILE)).json : await readPublic(MAP_FILE); } catch (e) {}
  if (m && !(rebuild && mapStale(m, date))) return { map: m, built: false };
  const b = await buildThemeMap({ get: nvGet, date, sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), gapMs: 200, deadline: Date.now() + 150000 });
  console.log(`테마 구성표 ${b.map ? "새로 만듦 " + b.map.themes.length + "개 · 종목 " + b.map.codes : "만들기 실패(" + (m ? "옛 표 " + m.builtAt + " 그대로" : "표 없음") + ")"} · 요청 ${b.requests}회${b.errors.length ? " · 참고 " + b.errors.slice(0, 3).join(" / ") : ""}`);
  if (!b.map) return { map: m, built: false, requests: b.requests };
  if (save) { try { await writeFile(MAP_FILE, b.map, `테마 구성표 ${date} ${b.map.themes.length}개`); } catch (e) { console.log("테마 구성표 저장 실패:", e.message || e); } }
  else if (arg("mapout")) writeFileSync(arg("mapout"), JSON.stringify(b.map));
  return { map: b.map, built: true, requests: b.requests };
}
// 직전 live.json(오늘 것) = RVOL 캐시 · 이름 안정화 · 뉴스 캐시·하루 상한의 원천. 저장 모드면 저장소, --dry 면 공개 저장소를 읽기만 한다 (없으면 null → 캐시 없이)
async function prevLive() { try { const j = save ? (await readFile(AUTO_DIR + "/live.json")).json : await readPublic(AUTO_DIR + "/live.json"); return j && j.date === date ? j : null; } catch (e) { return null; } }
const news2Opts = (pl) => ({ prevDate: prevBusinessDay(date, cfg.holidays), cache: pl && pl.news2 ? pl.news2.cache : null, budget: pl && pl.news2 ? pl.news2.budget : null });
const shadowText = (sh) => !sh ? "그림자 없음" : sh.error ? "그림자 실패: " + sh.error : sh.kind === "old-TL" ? `옛 방식(T·L · 비교용) T=${sh.T}억: ${sh.text || "없음"}` : `그림자 V2 T 코스피 ${sh.T.KS}·코스닥 ${sh.T.KQ} · 게이트 ${sh.gatePassed} → 상세 ${sh.scanned} → 자격(L≥${sh.minL}) ${sh.qualified} · 요청 네이버 +${(sh.requests || {}).naver ?? "?"} · 일봉 ${(sh.requests || {}).rvol ?? 0} · ${sh.ms}ms: `
  + (sh.themes || []).map((t, i) => `${i + 1}.${t.name}${t.nameKept ? "(이름 유지)" : ""} ${t.score} L${t.L} RVOL ${t.rvolMed ?? "—"} 대금 ${t.valueExTop10}억(TOP10 제외${t.top10Share ? " · TOP10 " + t.top10Share + "%" : ""})`).join(" / ") + (sh.errors && sh.errors.length ? ` · 참고 ${sh.errors.length}건` : "");
const news2Text = (live) => (live.themes || []).map((t) => t.news2 ? `${t.name}: ${t.news2.label}${t.news2.items.length ? " — " + t.news2.items.slice(0, 3).map((x) => `[${x.grade}] ${x.title.slice(0, 40)} (${x.office}${x.srcN > 1 ? " 외 " + (x.srcN - 1) : ""})`).join(" · ") : ""}${(t.news2.signals || []).length ? " · ⚡강세 신호: " + t.news2.signals.map((x) => `${x.title.slice(0, 36)} (${x.office} ${x.at ? x.at.slice(11) : ""})`).join(" / ") : ""}` : `${t.name}: 뉴스 v2 없음`).join("\n") + (live.news2 ? `\n뉴스 v2 요청 +${live.news2.requests} · 오늘 누적 ${live.news2.budget ? live.news2.budget.used : "?"}${live.news2.errors.length ? " · 참고 " + live.news2.errors.slice(0, 3).join(" / ") : ""}` : "");
/* 게이트 [1947] 운영 결함(9.29-97~): 아래 장중(live)·오후 4시 묶음은 이 파일 중간에서 끝나는데(process.exit), 장중 묶음이 부르는 loadHistory 가 쓰는 histMemo 선언이 그 묶음 「뒤」에 있어
   저장 모드에서 「Cannot access 'histMemo' before initialization」 으로 죽었음(--dry 는 loadHistory 가 먼저 돌아가 안 죽음) → 선언을 묶음 위로. 맨 위 const/let 은 그것을 쓰는 묶음보다 위에 둘 것 */
const histMemo = new Map();
// ---- 장중 실시간 (live): 09:05~15:30 + 마감 뒤 늦게 도착한 실행은 16:00 까지 「15:30 장 마감 값」(server/auto.js liveSlot), auto/live.json 하나에 덮어쓰고 끝 (날짜 파일·latest 는 손대지 않음) ----
if (when === "live") {
  const hm = kstTime(now).slice(0, 5), slot = liveSlot(hm);
  if (!has("force") && !slot) { console.log(`${hm} 장중 아님 — 건너뜀`); process.exit(0); }
  if (!has("force") && save && savedRecently((await readFile(AUTO_DIR + "/live.json").catch(() => ({ json: null }))).json, Date.now())) { console.log("방금 받음 — 건너뜀"); process.exit(0); }
  const tm = save ? (await readFile(autoFile(date)).catch(() => ({ json: null }))).json : null;
  const pl = await prevLive(); // 뉴스 캐시 (오늘 것만)
  const tmap = await loadThemeMap(); // 9.29-100 테마 구성표 (없을 때만 새로 만듦)
  const cautions = hm >= "09:30" || has("force") ? await loadCautionFile() : null; /* 9.29-101 S4 (09:30 전엔 후보가 없어 안 받음) */
  /* 9.29-111: 키움 장중 수급 — 09:30 전(고르기 전)엔 안 물음 · 키 없음·실패 = 「없음」 → 지금 동작(네이버 · 「수급 확인 전」) · C 는 「C 수급 자료 없음」 */
  const kw = hm >= "09:30" || has("force") ? await kiwoomFlows({ env: process.env, date, hm, onToken: kwMask(process.env) }) : null;
  console.log(kwKeys(process.env) ? kwText(kw) : "키움: 키 없음 — 건너뜀(네트워크 0)");
  const live = await collectLive({ liveExtra: true, adapters: { naver }, now, date, us: tm && tm.morning && tm.morning.us, history: await loadHistory(date), news2: news2Opts(pl), surge: { map: tmap.map, cautions, alertCache: pl && pl.alerts, heatCache: pl && pl.heat, top10: TOP10_CODES, regular: !!(slot && slot.closed && hm >= REGULAR_AFTER), force: has("force"), kiwoom: kw } }); keepLiveExtra(live, pl); /* 9.29-144 [집2510][집2511] ④ 선물 카드 · 오른쪽 뉴스 칸(+6요청 · 못 받은 조각 = 직전 값) */ // 15:40 뒤 늦게 온 「장 마감 값」 run 은 정규장 값(15:30 봉)으로
  if (slot && slot.closed) { live.at = slot.at; live.closed = true; console.log(`${hm} 도착 — 장 마감(15:30) 뒤 늦게 시작한 실시간 실행이라 「15:30 장 마감 값」으로 받음`); }
  if (save && !liveOverwrite((await readFile(AUTO_DIR + "/live.json").catch(() => ({ json: null }))).json, live)) { console.log("오늘 장 마감 값이 이미 있어 장중 값으로 덮지 않음 — 건너뜀"); process.exit(0); }
  console.log(`실시간 ${live.at} · 코스피 ${live.kospi ? live.kospi.value + "% · 거래대금 " + live.kospi.amount : "-"} · ${live.wait ? live.wait + " 부터 고름(아직)" : (live.themes || []).map((t) => `${t.name}${t.relax ? "[선정완화 " + t.relax.text + "]" : ""} ${t.rate > 0 ? "+" : ""}${t.rate}% (강한 ${t.strongN} · +10% ${t.n10} · 대장 ${t.lead ? t.lead.name : "-"} · ${t.flowState === "pending" ? "수급 확인 전" : t.flowState} · ${(t.news[0] || {}).title || "뉴스 없음"})`).join(" / ")}`);
  if (live.universe) console.log(`대상 상위 10% ${live.universe.n}종목(받은 ${live.universe.have}) · 기준선 ${live.universe.cut}억 · 쪽 ${JSON.stringify(live.universe.pages)} · 사다리 ${(live.ladder.used || []).map((u) => u.step + ":" + u.passed).join(" ")} · 선정 요청 ${JSON.stringify(live.surgeReq)}${live.ref ? " · 참고 " + live.ref.name + " " + live.ref.money + "억" : ""}${live.short ? " · " + live.short : ""}`);
  if (live.errors.length) console.log("일부 실패:", live.errors.join(" / "));
  if (!live.wait) console.log("종배 피함 표시 붙은 곳(실시간): " + avoidText({ themes: live.themes, closing: live.closing && live.closing.items }));
  console.log("후보:", (live.candidates || []).map((c) => `${c.name}${c.alias.length ? "=" + c.alias.join("=") : ""} 단계${c.step} [${c.stocks.join(",")}]`).join(" / "));
  console.log(news2Text(live));
  if (!live.wait && (!live.themes || !live.themes.length) && !live.short) { console.error("주도 테마를 못 골랐음 — live.json 은 지난 값 그대로"); process.exit(1); }
  { const it = live.intra, old = pl && Array.isArray(pl.intraRuns) ? pl.intraRuns : []; /* 9.29-109 원장 [2298] 장중 재판정 5분마다: 회차(외인 선물 · 현물 외인·기관 · 프로그램) 이어 쌓기 · 최근 12 */
    live.intraRuns = it && it.at ? old.filter((x) => x.at !== it.at).concat([{ at: it.at, f: it.fut ? it.fut.foreign : null, sf: it.spot ? it.spot.foreign : null, si: it.spot ? it.spot.institution : null, pg: it.program && typeof it.program.total === "number" ? it.program.total : null }]).slice(-12) : old; }
  { const r0 = abRunOf(live), old = pl && Array.isArray(pl.abRuns) ? pl.abRuns : []; live.abRuns = r0 && !live.wait ? old.filter((x) => x.at !== r0.at).concat([r0]).slice(-AB_RUNS_MAX) : old; /* 9.29-108 원장 [2287] 장중 회차 A·B 이어 쌓기(오늘 live.json · 마감 뒤 채점) */
    console.log(`B 방식(거래대금 상위 ${live.rankB ? live.rankB.n : 0}): ${live.rankB ? live.rankB.themesB.map((t) => t.name + " " + t.n).join(" / ") : "없음"} · A: ${(live.themes || []).map((t) => t.name).join(" / ")} · 회차 ${live.abRuns.length} · 새 요청 0 · ${live.rankB ? live.rankB.ms : 0}ms`);
    const kwT = (live.themes || []).filter((t) => t.flow && t.flow.src).length; /* 9.29-111 */
    console.log(`C 방식(v7 테마수급 ∩ 수익률): ${live.rankC ? (live.rankC.themesC.length ? live.rankC.themesC.map((t) => `${t.name} 외인 ${t.foreign}억 · 기관 ${t.inst}억 · ${t.rate}%${t.tags.length ? "(" + t.tags.join("·") + ")" : ""}`).join(" / ") : "C " + live.rankC.none) : "없음"} · A 테마 중 키움 수급 붙음 ${kwT}/${(live.themes || []).length} · 선정 수급 키움 종목 ${live.kiwoom ? live.kiwoom.flowN : 0} · ④ 테마 수급 ${(live.themes || []).filter((t) => t.tflow).map((t) => `${t.name} 외인 ${t.tflow.foreign}억·기관 ${t.tflow.inst}억(${t.tflow.n}/${t.tflow.of}종목)`).join(" / ") || "없음"} · 주도주 수급 키움 ${(live.themes || []).flatMap((t) => t.slots || []).filter((x) => x.flow && x.flow.src === "kiwoom").length}종목`); } // 선정 실패(구성표·순위 못 받음)면 저장 안 함 · 09:30 전(wait)·완화 끝까지 0개(short)는 그대로 저장
  if (save) { await writeFile(AUTO_DIR + "/live.json", live, `실시간 ${date} ${live.at}`); console.log(`저장: ${AUTO_DIR}/live.json (${BRANCH})`); } else console.log(has("dry") ? "(--dry: 저장 안 함)" : "(GITHUB_TOKEN/GITHUB_REPOSITORY 없음: 저장 안 함)");
  process.exit(0);
}
// ---- 애프터 실시간 (afterlive): 16:00~20:05 평일 · auto/live-after.json 한 파일에만 저장 (날짜 파일·live.json·latest 무접촉) ----
if (when === "afterlive") {
  const hm = kstTime(now).slice(0, 5), AL = AUTO_DIR + "/" + AFTERLIVE_FILE;
  if (!has("force") && !afterLiveWindow(hm)) { console.log(`${hm} 애프터 실시간 시간 아님(16:00~20:05) — 건너뜀`); process.exit(0); }
  const rd = async (path) => { try { return save ? (await readFile(path)).json : await readPublic(path); } catch (e) { return null; } };
  const prevA = await rd(AL);
  if (!has("force") && savedRecently(prevA, Date.now())) { console.log("방금 받음 — 건너뜀"); process.exit(0); }
  const rec0 = await rd(autoFile(date)), L = rec0 && rec0.close && rec0.close.market && rec0.close.market.leaders ? rec0.close.market.leaders : null;
  const scan = afterLiveScan(hm, prevA, date), tm = await loadThemeMap();
  const r = await collectAfter({ get: nvGet, date, leaders: L, map: tm.map, at: hm, now: Date.now(), src: "애프터 실시간", candidates: scan, deadline: Date.now() + AFTERLIVE_BUDGET_MS });
  const out = afterLiveRecord(r, prevA, { date, hm, ts: Date.now(), scan });
  console.log(afterText(out) + ` · 스캔 ${scan ? "함" : "건너뜀(이전 " + (out.scanAt || "없음") + " 값 유지)"}`);
  if (arg("afterout")) writeFileSync(arg("afterout"), JSON.stringify(out));
  if (save) { await writeFile(AL, out, `애프터 실시간 ${date} ${hm}${out.ok ? "" : " (미완)"}`); console.log(`저장: ${AL} (${BRANCH})`); } else console.log(has("dry") ? "(--dry: 저장 안 함)" : "(GITHUB_TOKEN 없음: 저장 안 함)");
  process.exit(0);
}

// ---- 「오후 4시 기준」 묶음 (--when=close1600 · 16:00 KST run · 9.29-87 원장 [1662]~[1666]): 미국 선물 4종·코스피200 선물·원달러·WTI·비트코인만 받아 날짜 파일 「장마감_1600」 에 저장 (close 블록은 손대지 않음 · 실패 항목은 errors · 지어내기 0) ----
if (when === "close1600") {
  const snap = await collectCloseSnap({ sources: cfg.sources, adapters: { naver, yahoo, upbit }, now });
  console.log(`오후 4시 기준 ${snap.at} · ` + CLOSE_SNAP_ITEMS.map(([k, n]) => { const x = snap.items[k]; return x ? `${n} ${x.price} (${x.pct > 0 ? "+" : ""}${x.pct}%)` : `${n} 없음`; }).join(" · "));
  if (snap.errors.length) console.log("일부 실패:", snap.errors.join(" / "));
  if (!Object.keys(snap.items).length) { console.error("받은 값이 하나도 없음"); process.exit(1); }
  if (save) {
    await ensureBranch();
    const rec = mergeAuto((await readFile(autoFile(date))).json, date, CLOSE_SNAP_KEY, snap), msg = `자동 연동 ${date} 오후 4시 기준 ${snap.at}`;
    await writeFile(autoFile(date), rec, msg); await writeFile(AUTO_DIR + "/latest.json", rec, msg);
    console.log(`저장: ${autoFile(date)} ${CLOSE_SNAP_KEY} (${BRANCH})`);
  } else console.log(has("dry") ? "(--dry: 저장 안 함)" : "(GITHUB_TOKEN/GITHUB_REPOSITORY 없음: 저장 안 함)");
  process.exit(0);
}
const prevDay = prevBusinessDay(date, cfg.holidays); // 어제(직전 거래일)
const prev = save ? (await ensureBranch(), await readFile(autoFile(date))) : { json: null };
const keep = prev.json && prev.json.date === date && prev.json.morning && prev.json.morning.prev; // 8:05 수집은 7:05에 고른 전일 테마를 이어 쓴다
const todayMorning = prev.json && prev.json.date === date ? prev.json.morning : null;
// 지난 거래일 파일들(최근 먼저, 최대 n개): 코스피 거래대금 20일 평균(관망) · 테마 목록(지속일수 D) · 전일 수급(2일 연속). 빈 날이 5번 이어지면 그만 (첫 수집 2026-09-28 이전)
async function loadHistory(from, n = 20) {
  if (!save) return [];
  const mk = from + ":" + n; if (histMemo.has(mk)) return histMemo.get(mk);
  const p = loadHistory0(from, n); histMemo.set(mk, p); return p;
}
async function loadHistory0(from, n) {
  const recs = []; let d = from, miss = 0;
  while (recs.length < n && miss < 5) {
    d = prevBusinessDay(d, cfg.holidays);
    try { const f = await readFile(autoFile(d)); if (f.json && f.json.close) { recs.push(f.json); miss = 0; } else miss++; } catch (e) { miss++; }
  }
  return historyFrom(recs);
}
const prevFile = when === "morning" && save ? await readFile(autoFile(prevDay)).catch(() => ({ json: null })) : { json: null }; // 전날 파일 (확정 주도 테마 · 코스피 거래대금)
const prevClose = prevFile.json && prevFile.json.close && prevFile.json.close.market ? prevFile.json.close.market : {};
// SKHY 괴리 이력 (게이트 권고 ⑥): 오늘 앞선 아침 run + 최근 거래일 파일 최대 5개의 hist 를 날짜로 합침(같은 날은 최근 파일 값) — 하루 수집이 빠져도 이어짐 · 네이버 요청 0 (GitHub 읽기만)
const histOf = (m) => { const d = m && m.signals && m.signals.skhy && m.signals.skhy.detail; return d && Array.isArray(d.hist) ? d.hist : []; };
async function skhyHistMulti(n = 5) {
  const lists = [histOf(todayMorning), histOf(prevFile.json && prevFile.json.morning)]; let d = prevDay;
  for (let i = 1; i < n && save; i++) { d = prevBusinessDay(d, cfg.holidays); try { const f = await readFile(autoFile(d)); lists.push(histOf(f.json && f.json.morning)); } catch (e) {} }
  return mergeHist(lists);
}
const skhyH = when === "morning" ? await skhyHistMulti() : [];
const skhyHist = () => skhyH;
// 잠정/확정: 오늘 날짜를 18시 전에 도는 close run 만 잠정(16:20). 지난날 --date 백필이나 --final 은 확정
const provisional = when === "close" && !has("final") && date === kstDate(now) && kstTime(now).slice(0, 5) < "18:00";
// 아침: 어제 파일의 '오늘 주도 테마'가 아직 잠정이거나 종목 외인·기관이 없으면(18:40 장애·네이버가 늦게 올림) 어제 값으로 다시 확정해 채운다 (요청 43회, 평소엔 안 돎)
// 아침 수집 '앞'에서 돈다: 전일 테마(collectPrevThemes)가 prevClose.leaders 를 이어 쓰므로, 여기서 확정하면 그 결과(수급·차트 반영 순위)가 그대로 아침 전일 테마가 된다.
// 잠정을 이어 쓴 뒤 collectPrevThemes 안에서 n=2 로 다시 고르는 방법보다 골랐다 — 아침의 테마 목록은 어제 마감 그대로라 잠정 재선정은 같은 결과(F=C=1)만 내고 수급이 안 들어간다.
// 여기서도 수급을 못 받으면(nl.flowReady 거짓) 잠정 결과가 그대로 이어지는데, 그건 잠정 재선정과 같은 값이라 손해가 없다. prevClose 는 prevFile.json.close.market 과 같은 객체라 m.leaders 교체가 바로 반영된다.
if (when === "morning" && save) {
  try {
    const pf = prevFile, L = pf.json && pf.json.close && pf.json.close.market && pf.json.close.market.leaders;
    if (L && L.v === SURGE_V && L.method === "surge") { // 9.29-100: 급등 묶음은 다시 고르지 않고 어제 확정 수급만 채움(종목 3×5 = 최대 15회)
      if (!L.flowReady) { const r = await fillFinalFlows(L, { get: nvGet, bizdate: prevDay.replace(/-/g, "") });
        if (r.got) { pf.json.close.market.leaders = r.leaders; pf.json.updatedAt = Date.now(); await writeFile(autoFile(prevDay), pf.json, `자동 연동 ${prevDay} 주도 테마 확정 수급 채움`); console.log(`어제(${prevDay}) 주도 테마 확정 수급 채움 ${r.got}종목 · 요청 ${r.requests}회`); }
        else console.log(`어제(${prevDay}) 종목 수급 아직 없음 — 그대로 이어 씀`); }
    } else if (L && (!L.flowReady || L.provisional)) {
      const m = pf.json.close.market, nl = await collectLeaders({ now, date: prevDay, bizdate: prevDay.replace(/-/g, ""), kospi: m.kospi || null, us: pf.json.morning && pf.json.morning.us, history: await loadHistory(prevDay), provisional: false });
      if (nl.all) { if (!pf.json.close.themes) pf.json.close.themes = nl.all; delete nl.all; }
      if (nl.flowReady) { if (L.provisional) m.leadersProvisional = L; m.leaders = nl; pf.json.updatedAt = Date.now(); await writeFile(autoFile(prevDay), pf.json, `자동 연동 ${prevDay} 주도 테마 확정(수급 채움)`); console.log(`어제(${prevDay}) 주도 테마 확정: ${nl.text}`); }
      else console.log(`어제(${prevDay}) 종목 수급 아직 없음 — 잠정 결과를 이어 씀`);
    }
  } catch (e) { console.log("어제 주도 테마 수급 채우기 실패:", e.message || e); }
}
// 9.29-100 테마 구성표 주 1회: 아침 run 이 7일 지났으면 다시 만든다(약 270회 · 실패하면 옛 표) — --dry 는 --map/--mapout 을 줄 때만
if (when === "morning" && (save || has("map") || has("mapout"))) { try { await loadThemeMap({ rebuild: true }); } catch (e) { console.log("테마 구성표 확인 실패:", e.message || e); } }
/* 9.29-107 원장 [2205] 저녁 애프터장 줄 보충: 07:00 뒤 아침 run(예약 07:05·08:05) 이 어제 날짜 파일에 「애프터_2000」 확정(ok)이 없으면 어제 분봉으로 계산해 어제 파일에 넣음
   (분봉 약 7거래일 보관 실측 · 위 「어제 주도 테마 수급 채움」 과 같은 자리 · ②③ 후보 = 폴링 거래 시각(localTradedAt) 날짜가 어제인 종목만 — 아니면 ②③ 비우고 「자료 미완」 이유) · 실패해도 아침 수집 그대로 */
if (when === "morning" && save && prevFile.json && (kstTime(now).slice(0, 5) >= AFTER_MORNING_FROM || has("after"))) {
  const ex = prevFile.json[AFTER_KEY];
  if (ex && ex.ok && !has("after")) console.log(`어제(${prevDay}) 저녁 애프터 이미 있음(${ex.at} · 마지막 봉 ${ex.lastBar})`);
  else {
    try {
      const tm = await loadThemeMap();
      const r = await collectAfter({ get: nvGet, date: prevDay, leaders: prevClose.leaders || null, map: tm.map, at: kstTime(now).slice(0, 5), now: Date.now(), src: "아침 보충", deadline: Date.now() + AFTER_BUDGET_MS });
      console.log(afterText(r));
      if (!ex || r.ok || !ex.ok) { prevFile.json[AFTER_KEY] = r; prevFile.json.updatedAt = Date.now(); await writeFile(autoFile(prevDay), prevFile.json, `자동 연동 ${prevDay} 저녁 애프터 보충`); console.log(`저장: ${autoFile(prevDay)} ${AFTER_KEY} (보충)`); }
    } catch (e) { console.log("어제 저녁 애프터 보충 실패:", e.message || e); }
  }
}
// 9.29-100 마감 주도 테마: 급등 묶음(오늘 확정 없으면 정규장 값으로 한 번 · 있으면 확정 수급만) + 옛 방식(T·L) 비교용 → close.shadow · 실패하면 leaders 없음(앞선 값 유지 · mergeCloseLeaders)
async function closeLeaders(market) {
  const hm = kstTime(now).slice(0, 5), get = memoGet(nvGet), history = await loadHistory(date), us = todayMorning && todayMorning.us;
  const prevL = prev.json && prev.json.date === date && prev.json.close && prev.json.close.market ? prev.json.close.market.leaders : null;
  let res = {};
  try {
    const tmap = prevL && prevL.v === SURGE_V ? { map: null } : await loadThemeMap();
    res = await collectSurgeLeaders({ get, map: tmap.map, date, hm, us, history, kospi: market.kospi || null, kosdaq: market.kosdaq || null, top10: TOP10_CODES, prev: prevL, final: hm >= "18:00" || date !== kstDate(now), regimeOf: (a, h) => regimeOfAmt(a, h) });
    console.log(`급등 묶음 ${res.kept ? "(다시 안 고름 · " + (res.flowReq !== undefined ? "확정 수급 채움 " + res.flowReq + "회" : "그대로") + ")" : "새로 고름(" + res.basis + ")"}: ${res.text || "없음"}`);
    if (!res.kept && Array.isArray(res.themes)) { const pl2 = (await prevLive()) || {}; const ht = await attachHeat(res.themes, { get, date, cache: pl2.heat }); console.log(`과열 꼬리표 요청 ${ht.requests}회`); const al = await attachAlerts(res.themes, { get, date, cache: pl2.alerts });
      { const cz = await loadCautionFile(); tagAvoidAll({ themes: res.themes, closing: res.closing && res.closing.items }, cz); console.log("종배 피함 표시 붙은 곳(마감): " + avoidText({ themes: res.themes, closing: res.closing && res.closing.items })); } /* 게이트 [1943] ②: S4 종배 피함 — 종가배팅 후보가 0개인 날에도 공시를 읽고 테마 종목에 붙임(장중과 같은 함수) */
      if (res.closing && Array.isArray(res.closing.items) && res.closing.items.length) { /* 9.29-101 S6 전일 상한가(일봉 하루 캐시) — 마감 종가배팅 후보에도 */
        const h2 = await attachHeat([{ slots: res.closing.items }], { get, date, cache: { date: ht.date, codes: ht.codes, open: ht.open, a20: ht.a20 }, wantOpen: false, max: 10 }); console.log(`종가배팅 후보 전일 상한가 확인 요청 ${h2.requests}회`); } console.log(`시장경보 확인 ${Object.keys(al.codes).length}종목 · 요청 ${al.requests}회`); } // K7 · 네이버 basic(장중 live 가 받은 것은 재사용)
    if (!res.kept && res.universe) console.log(`대상 ${res.universe.n}종목 기준선 ${res.universe.cut}억 · 사다리 ${(res.ladder.used || []).map((u) => u.step + ":" + u.passed).join(" ")} · 요청 ${JSON.stringify(res.requests)}${res.ref ? " · 참고 " + res.ref.name : ""}${res.short ? " · " + res.short : ""}`);
  } catch (e) { console.log("급등 묶음 선정 실패:", e.message || e); res = {}; }
  try { // 옛 방식(T·L) — 비교용 그림자 (성적표 s) · close.themes(테마 100개 목록)도 여기서
    const o = await collectLeaders({ get, now, date, kospi: market.kospi || null, kosdaq: market.kosdaq || null, us, history, provisional });
    if (o.all) { res.all = o.all; delete o.all; }
    res.shadow = Object.assign({ kind: "old-TL", label: "옛 방식(T·L) 비교용" }, o);
  } catch (e) { res.shadow = { kind: "old-TL", error: String((e && e.message) || e) }; }
  console.log(`마감 주도 테마 요청 ${get.count()}회`);
  return res;
}
let part = when === "intraday"
  ? await collectIntraday({ adapters: { naver }, now })
  : when === "themes"
  ? await collectThemesOnly({ themes: cfg.themes, sources: cfg.sources, adapters: { naver, yahoo, upbit }, now, morning: todayMorning })
  : when === "morning"
  ? await collectMorning({ sources: cfg.sources, themes: cfg.themes, adapters: { naver, yahoo, upbit, tradingview, kis }, now, holidays: cfg.holidays, date, prevThemes: (m) => collectPrevThemes({ keep, bizdate: prevDay.replace(/-/g, ""), leaders: prevClose.leaders || null, us: m.us, kospi: prevClose.kospi || null, afterKnown: afterLeadMap(prevFile.json && prevFile.json[AFTER_KEY]) }), listings: () => fetchListings(fetch, { today: date }), adr: { krClose: () => fetchKrClose(fetch, "000660", date), hist: skhyHist() } })
  : await collectClose({ adapters: { naver }, now, leaders: closeLeaders, listings: () => fetchListings(fetch, { today: date }), candles: (leaders, cache) => collectCandles({ date, leaders, morning: todayMorning, cache }) }); // 신규 상장 예정 · 앱 차트용 일봉 (9.29-76 원장 [1500] · [1502]) · 그림자 V2 (9.29-84)
// 같은 날 앞선 close run 과 합친다: 잠정 → 확정이면 잠정은 leadersProvisional 로 보관, 확정 뒤 잠정이 늦게 오면 확정 유지 (server/auto.js mergeCloseLeaders)
if (when === "close" && prev.json && prev.json.date === date && prev.json.close) mergeCloseLeaders(prev.json.close, part);
const saveAs = when === "themes" ? "morning" : when; // 테마만 받은 것도 아침 기록에 들어간다
const got = when === "intraday" ? ["fut", "spot", "kospi"].filter((k) => part[k] !== undefined).length : saveAs === "morning" ? Object.keys(part.signals).length + Object.keys(part.us).length : Object.keys(part.market).length;
// 장중 재판정은 하루 여러 번 → 앞선 확인 기록을 이어 붙인다
if (when === "intraday" && prev.json && prev.json.date === date && prev.json.intraday) part.list = [...(prev.json.intraday.list || []), { at: prev.json.intraday.at, kospi: prev.json.intraday.kospi, fut: prev.json.intraday.fut, spot: prev.json.intraday.spot, program: prev.json.intraday.program }].slice(-12); // 9.29-108 원장 [2273]: 30분마다(09:32~14:32 · 11회) → 12회까지 · 회차별 프로그램도
if (!got) { console.error("받은 값이 하나도 없음:", part.errors.join(" / ")); process.exit(1); }
// 관찰 기록 (9.29-82 원장 [1556] · [1558]): 확정 close run 이고 오늘 종목 수급이 들어왔을 때만 (19:45 에 아직 없으면 20:20 이 함). 실패해도 날짜 파일 저장은 그대로
let obs = null, obsOld = null;
const LD = when === "close" && part.market ? part.market.leaders : null;
if (when === "close" && !provisional && LD && !LD.provisional && LD.flowReady) {
  try {
    const rd = async (path) => { if (!save) return readPublic(path); const x = await readFile(path); if (x.sha && !x.json) throw new Error(path + " 을 못 읽음(크기·형식) — 덮지 않음"); return x.json; };
    obsOld = await rd(OBS_FILE);
    const uni = await rd(OBS_UNIVERSE_FILE);
    obs = await collectObserve({ date, universe: uni, file: obsOld, at: part.at });
    console.log(obsText(obs));
  } catch (e) { obs = null; console.log("관찰 기록 실패:", e.message || e); }
}
// 성적표 (9.29-84 원장 [1597]): 확정 close run · close.at ≥ 16:20(마감 봉 규칙) 일 때 오늘 선정 a(확정)·b(16:20 잠정)·c(live 마지막)·s(그림자) 행 추가 + 지난 행 D+1~D+4 채움. 실패해도 날짜 파일 저장은 그대로
let sc = null, scOld = null;
if (when === "close" && !provisional && LD && !LD.provisional) {
  try {
    const rd = async (path) => { if (!save) return readPublic(path); const x = await readFile(path); if (x.sha && !x.json) throw new Error(path + " 을 못 읽음(크기·형식) — 덮지 않음"); return x.json; };
    scOld = await rd(SC_FILE);
    const pl = await prevLive(), pc = prev.json && prev.json.date === date && prev.json.close ? prev.json.close : null;
    const b = part.market.leadersProvisional || (pc && pc.market && pc.market.leadersProvisional) || null;
    // 9.29-99 원장 [1822][1823]: 예전에 같은 날 확정이 두 번 돌아 a 행이 두 벌 섞인 지난 날 → 그 날짜 파일의 마지막 확정 주도 테마로 정리(days[].a 가 생기면 다음부터 안 읽음)
    const fixA = {};
    for (const d of ldsDupDays(scOld)) { if (d === date || ((scOld && scOld.days) || []).some((x) => x.date === d && Array.isArray(x.a))) continue;
      try { const j = save ? (await readFile(autoFile(d))).json : await readPublic(autoFile(d)); const L = j && j.close && j.close.market && j.close.market.leaders; if (L && !L.provisional && Array.isArray(L.themes) && L.themes.length) fixA[d] = ldsLatestA(L.themes); } catch (e) {} }
    sc = await collectScorecard({ date, closeAt: part.at, file: scOld, units: { a: LD.themes, b: b && b.themes, c: pl && pl.themes, s: part.shadow && part.shadow.themes }, allThemes: part.themes, fixA });
    console.log(scText(sc));
  } catch (e) { sc = null; console.log("성적표 실패:", e.message || e); }
}

// 관심 후보 (9.29-97 범위 확장 원장 [1802]): 확정 close run · 오늘 종목 수급이 들어왔을 때(flowReady) — 사이클 테마 안 종목 수급·차트 판정 → close.watch (실패해도 날짜 파일 저장은 그대로 · 앞선 값은 mergeCloseLeaders 가 유지)
if (when === "close" && !provisional && LD && !LD.provisional && LD.flowReady) {
  try {
    const nvGet = async (u) => { const r = await fetch(u, { headers: { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": NV_UA }, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
    const oldW = prev.json && prev.json.date === date && prev.json.close ? prev.json.close.watch : null; // 같은 날 앞선 확정 run 의 후보 (19:45 → 20:20)
    part.watch = mergeWatch(oldW, await collectWatch({ get: nvGet, date, leaders: LD, history: await loadHistory(date), now, prev: oldW }), date);
    console.log(watchText(part.watch));
  } catch (e) { console.log("관심 후보 실패:", e.message || e); }
}
/* 9.29-102 원장 [1905] 단골 참고 줄 · 9.29-103 원장 [2003] 그림자 기록 뺌: 급등 묶음 결과가 있는 마감 run 마다 최근 20거래일(오늘 포함) 확정 주도 대표 이름 횟수를 세어 close.forecast 에 넣음
   자료 = 위 closeLeaders 가 이미 읽은 지난 날짜 파일 20개(loadHistory · 같은 호출이라 다시 안 읽음) + 오늘 확정 3개 → 네이버 요청 0 · GitHub 읽기 0 · 쓰기 0(날짜 파일에 같이 실림) */
if (when === "close" && LD && LD.method === "surge" && Array.isArray(LD.themes) && LD.themes.length) {
  try { part.forecast = regularsOf(await loadHistory(date), { date, themes: LD.themes }); console.log(fcText(part.forecast)); }
  catch (e) { console.log("단골 세기 실패:", e.message || e); }
}
/* 9.29-105 원장 [2132] ③ 미국장 테마 전진 기록(전진 검증): 확정 close run 마다 오늘 아침 신호(테마 평균 % · S&P 대비 초과 · 등급) + 한국 대표 종목 시가 갭·시가→종가 → auto/observe/us-forward.json
   하루 한 줄(같은 날짜 중복 0) · 지난 5줄 빈 칸도 채움 · 네이버 일봉 요청 상한 30 · 게이트 [2153]: 날짜 파일·latest 저장 「뒤」에 돌고(--dry 는 요약 뒤) 전체 60초 상한(넘으면 남은 칸은 다음 run)
   저장 판단 = 부르기 전 파일 글자와 비교(fwdShouldSave) · 실패해도 날짜 파일 저장·종료 코드 그대로 (--dry 는 공개 저장소 읽기만 · --fwdout=경로 로 결과 파일) */
async function runForward() {
  if (when !== "close" || provisional) return null;
  try {
    let old = null;
    if (save) { const x = await readFile(FWD_FILE); if (x.sha && !x.json) throw new Error(FWD_FILE + " 을 못 읽음(크기·형식) — 덮지 않음"); old = x.json; } else old = await readPublic(FWD_FILE);
    const oldText = JSON.stringify(old);
    const r = await collectForward({ get: nvGet, date, morning: todayMorning, themes: cfg.themes, file: old, deadline: Date.now() + FWD_BUDGET_MS });
    console.log(fwdText(r));
    if (!save) { if (arg("fwdout")) writeFileSync(arg("fwdout"), JSON.stringify(r.file)); return r; }
    if (fwdShouldSave(r, oldText)) {
      try { r.file.updatedAt = Date.now(); await writeFile(FWD_FILE, r.file, `전진 기록 ${date} 새 줄 ${r.added} · 채움 ${r.filled}`); console.log(`저장: ${FWD_FILE} (줄 ${r.file.rows.length})`); }
      catch (e) { console.log("전진 기록 저장 실패:", e.message || e); }
    }
    return r;
  } catch (e) { console.log("전진 기록 실패:", e.message || e); return null; }
}
/* 9.29-107 원장 [2198][2200][2205][2206] 저녁 애프터장 줄: 마감 run(잠정 16:20 제외)이 20:05 뒤(afterDue)면 「애프터_2000」 계산 — 날짜 파일·latest 저장 「뒤」에 돌고 결과만 한 번 더 저장(실패해도 마감 저장·종료 코드 그대로)
   요청 = 폴링 약 6회(테마 구성표 종목 400개씩) + 분봉(주도 테마 ≤15 + 그날 거래대금 10억↑ 종목) · 상한 AFTER_MAX_REQ · 150초 */
async function runAfter(rec) {
  if (when !== "close" || provisional) return null;
  const hm = kstTime(now).slice(0, 5), today = kstDate(now), due = afterDue({ date, today, hm, existing: rec && rec[AFTER_KEY], force: has("after") });
  if (!due.due) { console.log("저녁 애프터 건너뜀: " + due.why); return null; }
  try {
    const tm = await loadThemeMap(), L = rec && rec.close && rec.close.market ? rec.close.market.leaders : null;
    const r = await collectAfter({ get: nvGet, date, leaders: L, map: tm.map, at: hm, now: Date.now(), src: date < today ? "지난 날 보충" : "20:20", deadline: Date.now() + AFTER_BUDGET_MS });
    console.log(afterText(r));
    if (!save && arg("afterout")) writeFileSync(arg("afterout"), JSON.stringify(r));
    return r;
  } catch (e) { console.log("저녁 애프터 실패:", e.message || e); return null; }
}
/* 9.29-108 원장 [2287] A·B 자동 채점: 마감 run(잠정 16:20 제외 · 19:45·20:20) 이 오늘 live.json 의 장중 회차(abRuns)를 그날 확정 주도 테마와 맞춰 auto/observe/leaders-ab.json 에 한 줄(같은 날 다시 돌면 그 줄만) · 실패해도 마감 저장 그대로 */
async function runAB(rec) {
  if (when !== "close" || provisional) return;
  try {
    const L = rec && rec.close && rec.close.market ? rec.close.market.leaders : null, lv = save ? (await readFile(AUTO_DIR + "/live.json")).json : await readPublic(AUTO_DIR + "/live.json");
    let row = lv && lv.date === date ? abScore(lv.abRuns, L, date) : null;
    /* 9.29-143 원장 [집2563][집2565] 중립 정답표 = 그날 마감 네이버 테마 상승률 순위(rec.close.themes · 이미 받은 목록 · 새 요청 0) · A·B·C 같은 자 · 장중(z)은 오늘 회차로 · 다음 날(zn)은 지난 날짜 파일 목록(loadHistory · 같은 호출 재사용)으로 채움 */
    const zTh = rec && rec.close && Array.isArray(rec.close.themes) ? rec.close.themes : null, z = lv && lv.date === date && zTh ? abNeutralDay(lv.abRuns, zTh) : null;
    if (z) row = row ? Object.assign(row, { z }) : { date, runs: z.runs, pick: z.pick, z };
    let old = null; if (save) { const x = await readFile(AB_FILE); if (x.sha && !x.json) throw new Error(AB_FILE + " 을 못 읽음 — 덮지 않음"); old = x.json; } else old = await readPublic(AB_FILE);
    let file = old, changed = false;
    if (row) { const u = abUpsert(file, row); file = u.file; changed = u.changed; } else console.log("A·B 채점: 오늘 장중 회차 없음 — 오늘 줄 건너뜀");
    /* 9.29-110 [2318] 다음 날 적중: 지난 거래일 줄의 마지막 회차 A·B 가 오늘 마감 확정 주도 테마에 재진입했나 · 평균 플러스인가 */
    const nx = abNext(file, L, date); if (nx.row) { file = nx.file; changed = changed || nx.changed; console.log(`A·B 다음 날 ${nx.row.date} → ${date}: A 재진입 ${nx.row.next.a.re}/3 평균 ${nx.row.next.a.avg === null ? "—" : nx.row.next.a.avg + "%"}${nx.row.next.a.hit ? " 적중" : ""} · B 재진입 ${nx.row.next.b.re}/3 평균 ${nx.row.next.b.avg === null ? "—" : nx.row.next.b.avg + "%"}${nx.row.next.b.hit ? " 적중" : ""}${nx.row.next.c ? ` · C 재진입 ${nx.row.next.c.re}/3 평균 ${nx.row.next.c.avg === null ? "—" : nx.row.next.c.avg + "%"}${nx.row.next.c.hit ? " 적중" : ""}` : ""}`); }
    { const days = {}; for (const h of await loadHistory(date)) if (h && h.date && Array.isArray(h.themes) && h.themes.length) days[h.date] = h.themes; if (zTh) days[date] = zTh;
      const zn = abNeutralNext(file, days, { holidays: cfg.holidays, today: date }); if (zn.changed) { file = zn.file; changed = true; console.log(`A·B·C 다음 날 중립 채점 채움: ${zn.filled.join(" · ")}`); } }
    if (!file || !changed && !row) return;
    if (row && typeof row.c === "number") console.log(`C 장중 ${row.c}/3 (${row.cN}회차)`); /* 9.29-111 */
    const sm = abSummary(file); if (sm) console.log("A·B 누적:" + (typeof sm.a === "number" ? ` 장중 A ${sm.a}/3 · B ${sm.b}/3 · ${sm.n}일` : " 옛 채점 기록 없음") /* 9.29-145 gate-142 경미: 중립만 있는 파일 = 「장중 A undefined/3」 → 옛 숫자 없으면 안 적음 */ + (typeof sm.c === "number" ? ` · C ${sm.c}/3 (${sm.cn}일)` : "") + (sm.next ? ` · 다음 날 A ${sm.next.a.hit}/${sm.next.n}일 · B ${sm.next.b.hit}/${sm.next.n}일 적중` : "") + (sm && sm.z && sm.z.next ? ` · 중립 다음 날도 감 ${["a", "b", "c"].filter((m) => sm.z.next[m]).map((m) => m.toUpperCase() + " " + sm.z.next[m].go + "/" + sm.z.next[m].n + "개(" + sm.z.next[m].d + "일)").join(" · ")}` : ""));
    if (save && changed) { file.updatedAt = Date.now(); await writeFile(AB_FILE, file, `A·B 채점 ${date}`); console.log(`저장: ${AB_FILE}`); }
  } catch (e) { console.log("A·B 채점 실패:", e.message || e); }
}
// 아침 브리핑 (9.29-97): 아침 run 은 07:00 뒤(또는 --brief) 4묶음 · 장중 run 은 10:20 전 시작이면 ② 공시만 · 실패해도 날짜 파일 저장은 그대로
let brief = null;
{
  const hm = kstTime(now).slice(0, 5), oldBrief = prev.json && prev.json.date === date ? prev.json.brief : null;
  const only = when === "morning" && (hm >= "07:00" || has("brief")) ? BRIEF_SECTIONS : when === "intraday" && (hm < "10:20" || has("brief")) ? ["disc"] : null;
  if (only) {
    try {
      const members = JSON.parse(readFileSync(new URL("../shared/index_members.json", import.meta.url), "utf8"));
      const leadNames = when === "morning" ? [...new Set([...((prevClose.leaders && prevClose.leaders.themes) || []).flatMap((t) => (t.slots || []).slice(0, 5).map((x) => x && x.name)), ...((part.prev || []).flatMap((t) => (t.stocks || []).map((x) => x && x.name)))].filter(Boolean))] : (oldBrief && oldBrief.lead) || [];
      const getJ = async (u) => { const r = await fetch(u, { headers: { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": NV_UA }, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
      const postT = async (u, body) => { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html", "User-Agent": NV_UA }, body, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); };
      const fresh = await collectBrief({ get: getJ, post: postT, date, prevKr: prevDay, nextDays: nextBusinessDays(date, cfg.holidays, 2), now, hm, members, leadNames, themes: cfg.themes, budget: oldBrief && oldBrief.budget, only, expectedUs: part.expectedUs || null, watch: when === "morning" ? (prevFile.json && prevFile.json.close && prevFile.json.close.watch) || null : null });
      brief = mergeBrief(oldBrief, fresh, date);
      console.log(`브리핑 ${only.join("·")} · 이번 요청 ${fresh.requests}회`);
      console.log(briefText(brief));
    } catch (e) { brief = null; console.log("브리핑 실패:", e.message || e); }
  }
}

if (!save) {
  if (part.shadow) console.log(shadowText(part.shadow));
  if (part.candles) console.log(`일봉 ${Object.keys(part.candles).length}개 (저장 안 함): ${Object.values(part.candles).map((c) => c.code + " " + c.bars.length + "봉").join(" · ")}`);
  const rec = mergeAuto(null, date, saveAs, part);
  console.log(summarize(rec));
  await runForward(); // 9.29-105 전진 기록(저장 안 함 · 요약 뒤)
  await runAfter(rec); // 9.29-107 저녁 애프터장 줄(저장 안 함 · --afterout=파일)
  await runAB(rec); // 9.29-108 A·B 채점(저장 안 함)
  console.log(has("dry") ? "(--dry: 저장 안 함)" : "(GITHUB_TOKEN/GITHUB_REPOSITORY 없음: 저장 안 함)");
  process.exit(0);
}
// 앱 차트용 일봉 (확정 close run 만 · 9.29-76 원장 [1502]): 종목마다 auto/candles/<코드>.json — 실패해도 날짜 파일 저장은 계속
// 9.29-77 (원장 [1511]·[1513]): 앱이 중계 서버에서 일봉을 받으므로 기본 꺼짐(server/auto.js CANDLE_SAVE = false → part.candles 없음 → 쓰기 0) · 이미 저장된 파일은 그대로
if (part.candles) {
  let n = 0;
  for (const [code, c] of Object.entries(part.candles)) {
    try { await writeFile(candleFile(code), c, `일봉 ${date} ${code}`); n++; } catch (e) { part.errors.push("일봉 저장 " + code + ": " + (e.message || e)); }
  }
  console.log(`일봉 저장: ${n}/${Object.keys(part.candles).length}개 → ${AUTO_DIR}/candles/`);
}
const rec = mergeAuto(prev.json, date, saveAs, part);
if (brief) rec.brief = brief; // 최상위 brief (morning 블록 밖 — mergeAuto 가 morning 을 통째로 덮어도 그대로 · 이번에 못 만들면 앞선 brief 유지)
const msg = `자동 연동 ${date} ${when === "morning" ? "아침" : when === "themes" ? "아침(테마 보충)" : when === "intraday" ? "장중" : "오후"} ${part.at}`;
await writeFile(autoFile(date), rec, msg);
await writeFile(AUTO_DIR + "/latest.json", rec, msg);
console.log(summarize(rec));
if (obs && obs.universe) { // 대상 목록을 새로 만든 run 만 (7일마다)
  try { await writeFile(OBS_UNIVERSE_FILE, obs.universe, `관찰 대상 목록 ${date} ${obs.universe.stocks.length}종목`); console.log(`저장: ${OBS_UNIVERSE_FILE} (${obs.universe.stocks.length}종목)`); }
  catch (e) { console.log("관찰 대상 목록 저장 실패:", e.message || e); }
}
if (obs && (obs.ev.checked || obs.filled) && JSON.stringify(obs.file) !== JSON.stringify(obsOld)) { // 새로 센 종목이나 채운 결과가 있을 때만 (같은 날 두 번째 run 은 못 받은 종목만 다시 · 날짜+코드 중복 0)
  try { obs.file.updatedAt = Date.now(); await writeFile(OBS_FILE, obs.file, `관찰 기록 ${date} 급락+동반매수 ${obs.ev.signals.length}건 · 결과 채움 ${obs.filled}`); console.log(`저장: ${OBS_FILE} (신호 ${obs.file.signals.length}건 · ${obs.file.days.length}일)`); }
  catch (e) { console.log("관찰 기록 저장 실패:", e.message || e); }
}
if (sc && !sc.skipped && (sc.added || sc.filled) && JSON.stringify(sc.file) !== JSON.stringify(scOld)) { // 새 행이나 채운 칸이 있을 때만 (열쇠 중복 0)
  try { sc.file.updatedAt = Date.now(); await writeFile(SC_FILE, sc.file, `성적표 ${date} 새 행 ${sc.added} · 채움 ${sc.filled}`); console.log(`저장: ${SC_FILE} (행 ${sc.file.rows.length} · ${sc.file.days.length}일)`); }
  catch (e) { console.log("성적표 저장 실패:", e.message || e); }
}
await runForward(); // 9.29-105 전진 기록 = 날짜 파일·latest·관찰·성적표 저장 뒤 (게이트 [2153] ② 지연 위험)
await runAB(rec); // 9.29-108 원장 [2287] A·B 채점 = 마감 저장 뒤
{ const af = await runAfter(rec); // 9.29-107 저녁 애프터장 줄 = 마감 저장 뒤 · 결과만 다시 저장
  if (af) { try { rec[AFTER_KEY] = af; const m2 = `자동 연동 ${date} 저녁 애프터 ${af.at}${af.ok ? "" : " (미완)"}`; await writeFile(autoFile(date), rec, m2); await writeFile(AUTO_DIR + "/latest.json", rec, m2); console.log(`저장: ${autoFile(date)} ${AFTER_KEY}`); } catch (e) { console.log("저녁 애프터 저장 실패:", e.message || e); } } }
if (part.shadow) console.log(shadowText(part.shadow));
console.log(`저장: ${autoFile(date)} (${BRANCH})`);
if (part.errors.length) console.log("일부 실패:", part.errors.join(" / "));
