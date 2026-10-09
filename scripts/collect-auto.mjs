// 자동 연동 수집기 — GitHub Actions(.github/workflows/auto.yml)가 평일 아침·오후에 실행한다.
//   아침(KST 12시 전): 미국 선물·환율·SOX·VIX·유가·금리 + 미국 대응주 (네이버 → 야후 순) + 전일 주도 테마(애프터·프리마켓)
//   오후:             코스피·코스닥 마감 등락률 + 투자자별 수급 + 오늘 주도 테마 (네이버) — 16:20 은 잠정(게이트·L·U·B, 요청 13회), 18:40 은 확정(+수급·일봉, 43회)
//   아침 전일 테마는 전날 18:40 확정 결과(close.market.leaders)를 이어 쓰고 NXT 애프터·프리마켓만 붙인다 (재선정 안 함, 없으면 n=2 잠정 선정). 전날 결과가 아직 잠정·수급 없음이면 아침 수집 전에 먼저 확정(백필)한다
// 결과는 GITHUB_REPOSITORY 의 AUTO_BRANCH(기본 cockpit-data, 공개 저장소 eden-market 은 main) 브랜치 auto/<날짜>.json 과 auto/latest.json 에 둔다.
// 옵션: --when=morning|intraday|close|themes|live (기본: 지금 시각으로 판단 · live = 장중 실시간 주도 테마 → auto/live.json 만 · themes = 미국장 테마 값만 아침 기록에 채워 넣기, 새 테마를 추가한 날) --date=YYYY-MM-DD (기본: 오늘 KST) --dry (저장 안 함) --force (주말·휴장도 실행)
//       --final (close: 실행 시각과 관계없이 확정 run — 수급·일봉 포함). 오늘이 아닌 --date 로 손으로 백필하는 close run 도 확정으로 돈다 (잠정 결과가 확정을 덮지 않게)
// 관찰 기록 (9.29-82 원장 [1556] · [1558]): 마감 확정 run 이 400종목 중 「급락일 외국인·기관 동반 매수」 종목과 그 뒤 결과를 auto/observe/crash-cobuy.json 에 쌓는다
//   (대상 목록 auto/observe/universe.json 은 7일마다 다시 만듦 · 기록만 · 날짜 파일·앱 무변경 · --dry 는 목록만 출력)
// 그림자(shadow) 선정 V2 · 뉴스 v2 · 성적표 (9.29-84 원장 [1597]): live run 과 close run 이 현행 결과 옆에 shadow 블록(live.json · 날짜 파일 close.shadow)과 테마별 news2 를 더한다 · 기존 블록 무변경
//   RVOL 20일 평균은 중계 /day 일봉(실패하면 네이버 일봉) · 직전 live.json 의 shadow.rvolCache(하루 1회) 를 이어 쓴다 · 뉴스 캐시·하루 상한도 live.json 의 news2 에서 이어 씀
//   성적표: 확정 close run(close.at ≥ 16:20) 이 auto/observe/leaders-scorecard.json 에 오늘 선정(a 확정 · b 잠정 · c live 마지막 · s shadow)을 적고 지난 행 D+1~D+4 를 채운다
// 옵션 추가: --trace (요청 수·걸린 시간 출력 · 재현용)
// 아침 브리핑 (9.29-97 원장 [1775][1779][1780] t일정뉴스 · server/brief.js): 07:00 뒤 아침 run(07:05·08:05) 이 ① IR 실적 ② 공시 ③ 미국 큰 폭 ④ 국내 종목 뉴스를 받아 날짜 파일 최상위 brief 에 둔다 (morning 블록 밖)
//   09:25 장중 run(10:20 전 시작)은 ② 공시만 한 번 더 · 섹션마다 받은 것만 덮고 실패하면 지난 값 유지 · 하루 요청 상한 BRIEF_DAILY_MAX · --brief 면 시각과 관계없이 4묶음
//   SK하이닉스 ADR(SKHY) 환산 (원장 [1784]): 아침 run 이 한국 SK하이닉스 전일 종가 1회 + 지난 파일의 괴리 이력(요청 0)
import { readFileSync } from "node:fs";
import { loadCollectConfig } from "../server/config.js";
import { prevBusinessDay, kstTime, nextBusinessDays } from "../shared/calendar.js";
import { collectBrief, mergeBrief, briefText, BRIEF_SECTIONS } from "../server/brief.js";
import { collectWatch, watchText, mergeWatch } from "../server/watch.js"; // 관심 후보 (9.29-97 범위 확장 · 확정 close run → close.watch → 다음 아침 brief ④)
import { autoFile, AUTO_DIR, collectLive, collectClose, collectMorning, collectPrevThemes, collectLeaders, collectIntraday, kstDate, mergeAuto, mergeCloseLeaders, skipReason, summarize, whenOf, collectThemesOnly, historyFrom, fetchListings, collectCandles, candleFile, liveSlot, liveOverwrite, collectObserve, obsText, OBS_FILE, OBS_UNIVERSE_FILE, chartUrl, collectCloseSnap, CLOSE_SNAP_KEY, CLOSE_SNAP_ITEMS, fetchKrClose, mergeHist } from "../server/auto.js";
import { RVOL_BAR_COUNT } from "../server/shadow.js";
import { collectScorecard, scText, SC_FILE } from "../server/scorecard.js";
import { ldsDupDays, ldsLatestA } from "../shared/leaders-score.js";
import naver from "../server/sources/naver.js";
import yahoo from "../server/sources/yahoo.js";
import upbit from "../server/sources/upbit.js";
import kis from "../server/sources/kis.js";
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
async function rvolBars(code) {
  try { const r = await fetch(`${RELAY}/day?code=${code}&count=${RVOL_BAR_COUNT}`, { signal: AbortSignal.timeout(10000) }); if (r.ok) return await r.json(); } catch (e) {}
  const r = await fetch(chartUrl(code, date), { headers: { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": NV_UA }, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
}
// 직전 live.json(오늘 것) = RVOL 캐시 · 이름 안정화 · 뉴스 캐시·하루 상한의 원천. 저장 모드면 저장소, --dry 면 공개 저장소를 읽기만 한다 (없으면 null → 캐시 없이)
async function prevLive() { try { const j = save ? (await readFile(AUTO_DIR + "/live.json")).json : await readPublic(AUTO_DIR + "/live.json"); return j && j.date === date ? j : null; } catch (e) { return null; } }
const shadowOpts = (pl) => ({ bars: rvolBars, rvolCache: pl && pl.shadow ? pl.shadow.rvolCache : null, prevNames: pl && pl.shadow && Array.isArray(pl.shadow.names) ? pl.shadow.names : [] });
const news2Opts = (pl) => ({ prevDate: prevBusinessDay(date, cfg.holidays), cache: pl && pl.news2 ? pl.news2.cache : null, budget: pl && pl.news2 ? pl.news2.budget : null });
const shadowText = (sh) => !sh ? "그림자 없음" : sh.error ? "그림자 실패: " + sh.error : `그림자 V2 T 코스피 ${sh.T.KS}·코스닥 ${sh.T.KQ} · 게이트 ${sh.gatePassed} → 상세 ${sh.scanned} → 자격(L≥${sh.minL}) ${sh.qualified} · 요청 네이버 +${(sh.requests || {}).naver ?? "?"} · 일봉 ${(sh.requests || {}).rvol ?? 0} · ${sh.ms}ms: `
  + (sh.themes || []).map((t, i) => `${i + 1}.${t.name}${t.nameKept ? "(이름 유지)" : ""} ${t.score} L${t.L} RVOL ${t.rvolMed ?? "—"} 대금 ${t.valueExTop10}억(TOP10 제외${t.top10Share ? " · TOP10 " + t.top10Share + "%" : ""})`).join(" / ") + (sh.errors && sh.errors.length ? ` · 참고 ${sh.errors.length}건` : "");
const news2Text = (live) => (live.themes || []).map((t) => t.news2 ? `${t.name}: ${t.news2.label}${t.news2.items.length ? " — " + t.news2.items.slice(0, 3).map((x) => `[${x.grade}] ${x.title.slice(0, 40)} (${x.office}${x.srcN > 1 ? " 외 " + (x.srcN - 1) : ""})`).join(" · ") : ""}${(t.news2.signals || []).length ? " · ⚡강세 신호: " + t.news2.signals.map((x) => `${x.title.slice(0, 36)} (${x.office} ${x.at ? x.at.slice(11) : ""})`).join(" / ") : ""}` : `${t.name}: 뉴스 v2 없음`).join("\n") + (live.news2 ? `\n뉴스 v2 요청 +${live.news2.requests} · 오늘 누적 ${live.news2.budget ? live.news2.budget.used : "?"}${live.news2.errors.length ? " · 참고 " + live.news2.errors.slice(0, 3).join(" / ") : ""}` : "");
// ---- 장중 실시간 (live): 09:05~15:30 + 마감 뒤 늦게 도착한 실행은 16:00 까지 「15:30 장 마감 값」(server/auto.js liveSlot), auto/live.json 하나에 덮어쓰고 끝 (날짜 파일·latest 는 손대지 않음) ----
if (when === "live") {
  const hm = kstTime(now).slice(0, 5), slot = liveSlot(hm);
  if (!has("force") && !slot) { console.log(`${hm} 장중 아님 — 건너뜀`); process.exit(0); }
  const tm = save ? (await readFile(autoFile(date)).catch(() => ({ json: null }))).json : null;
  const pl = await prevLive(); // 그림자 캐시·이름 안정화·뉴스 캐시 (오늘 것만)
  const live = await collectLive({ adapters: { naver }, now, date, us: tm && tm.morning && tm.morning.us, history: await loadHistory(date), shadow: shadowOpts(pl), news2: news2Opts(pl) });
  if (slot && slot.closed) { live.at = slot.at; live.closed = true; console.log(`${hm} 도착 — 장 마감(15:30) 뒤 늦게 시작한 실시간 실행이라 「15:30 장 마감 값」으로 받음`); }
  if (save && !liveOverwrite((await readFile(AUTO_DIR + "/live.json").catch(() => ({ json: null }))).json, live)) { console.log("오늘 장 마감 값이 이미 있어 장중 값으로 덮지 않음 — 건너뜀"); process.exit(0); }
  console.log(`실시간 ${live.at} · 코스피 ${live.kospi ? live.kospi.value + "% · 거래대금 " + live.kospi.amount : "-"} · ${(live.themes || []).map((t) => `${t.name} ${t.rate > 0 ? "+" : ""}${t.rate}% (대금 ${Math.round(t.value || 0).toLocaleString("ko-KR")}억 · ${(t.news[0] || {}).title || "뉴스 없음"})`).join(" / ")}`);
  if (live.errors.length) console.log("일부 실패:", live.errors.join(" / "));
  console.log("후보:", (live.candidates || []).map((c) => `${c.name}${c.alias.length ? "=" + c.alias.join("=") : ""} ${c.score} [${c.stocks.join(",")}]`).join(" / "));
  console.log(shadowText(live.shadow)); console.log(news2Text(live));
  if (!live.themes || !live.themes.length) { console.error("주도 테마를 못 골랐음"); process.exit(1); }
  if (save) { await writeFile(AUTO_DIR + "/live.json", live, `실시간 ${date} ${live.at}`); console.log(`저장: ${AUTO_DIR}/live.json (${BRANCH})`); } else console.log(has("dry") ? "(--dry: 저장 안 함)" : "(GITHUB_TOKEN/GITHUB_REPOSITORY 없음: 저장 안 함)");
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
const histMemo = new Map();
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
    if (L && (!L.flowReady || L.provisional)) {
      const m = pf.json.close.market, nl = await collectLeaders({ now, date: prevDay, bizdate: prevDay.replace(/-/g, ""), kospi: m.kospi || null, us: pf.json.morning && pf.json.morning.us, history: await loadHistory(prevDay), provisional: false });
      if (nl.all) { if (!pf.json.close.themes) pf.json.close.themes = nl.all; delete nl.all; }
      if (nl.flowReady) { if (L.provisional) m.leadersProvisional = L; m.leaders = nl; pf.json.updatedAt = Date.now(); await writeFile(autoFile(prevDay), pf.json, `자동 연동 ${prevDay} 주도 테마 확정(수급 채움)`); console.log(`어제(${prevDay}) 주도 테마 확정: ${nl.text}`); }
      else console.log(`어제(${prevDay}) 종목 수급 아직 없음 — 잠정 결과를 이어 씀`);
    }
  } catch (e) { console.log("어제 주도 테마 수급 채우기 실패:", e.message || e); }
}
let part = when === "intraday"
  ? await collectIntraday({ adapters: { naver }, now })
  : when === "themes"
  ? await collectThemesOnly({ themes: cfg.themes, sources: cfg.sources, adapters: { naver, yahoo, upbit }, now, morning: todayMorning })
  : when === "morning"
  ? await collectMorning({ sources: cfg.sources, themes: cfg.themes, adapters: { naver, yahoo, upbit, tradingview, kis }, now, holidays: cfg.holidays, date, prevThemes: (m) => collectPrevThemes({ keep, bizdate: prevDay.replace(/-/g, ""), leaders: prevClose.leaders || null, us: m.us, kospi: prevClose.kospi || null }), listings: () => fetchListings(fetch, { today: date }), adr: { krClose: () => fetchKrClose(fetch, "000660", date), hist: skhyHist() } })
  : await collectClose({ adapters: { naver }, now, leaders: async (market) => collectLeaders({ now, date, kospi: market.kospi || null, kosdaq: market.kosdaq || null, us: todayMorning && todayMorning.us, history: await loadHistory(date), provisional, shadow: shadowOpts(await prevLive()) }), listings: () => fetchListings(fetch, { today: date }), candles: (leaders, cache) => collectCandles({ date, leaders, morning: todayMorning, cache }) }); // 신규 상장 예정 · 앱 차트용 일봉 (9.29-76 원장 [1500] · [1502]) · 그림자 V2 (9.29-84)
// 같은 날 앞선 close run 과 합친다: 잠정 → 확정이면 잠정은 leadersProvisional 로 보관, 확정 뒤 잠정이 늦게 오면 확정 유지 (server/auto.js mergeCloseLeaders)
if (when === "close" && prev.json && prev.json.date === date && prev.json.close) mergeCloseLeaders(prev.json.close, part);
const saveAs = when === "themes" ? "morning" : when; // 테마만 받은 것도 아침 기록에 들어간다
const got = when === "intraday" ? ["fut", "spot", "kospi"].filter((k) => part[k] !== undefined).length : saveAs === "morning" ? Object.keys(part.signals).length + Object.keys(part.us).length : Object.keys(part.market).length;
// 장중 재판정은 하루 여러 번 → 앞선 확인 기록을 이어 붙인다
if (when === "intraday" && prev.json && prev.json.date === date && prev.json.intraday) part.list = [...(prev.json.intraday.list || []), { at: prev.json.intraday.at, kospi: prev.json.intraday.kospi, fut: prev.json.intraday.fut, spot: prev.json.intraday.spot }].slice(-6);
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
if (part.shadow) console.log(shadowText(part.shadow));
console.log(`저장: ${autoFile(date)} (${BRANCH})`);
if (part.errors.length) console.log("일부 실패:", part.errors.join(" / "));
