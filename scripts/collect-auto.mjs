// 자동 연동 수집기 — GitHub Actions(.github/workflows/auto.yml)가 평일 아침·오후에 실행한다.
//   아침(KST 12시 전): 미국 선물·환율·SOX·VIX·유가·금리 + 미국 대응주 (네이버 → 야후 순) + 전일 주도 테마(애프터·프리마켓)
//   오후:             코스피·코스닥 마감 등락률 + 투자자별 수급 + 오늘 주도 테마 (네이버) — 16:20 은 잠정(게이트·L·U·B, 요청 13회), 18:40 은 확정(+수급·일봉, 43회)
//   아침 전일 테마는 전날 18:40 확정 결과(close.market.leaders)를 이어 쓰고 NXT 애프터·프리마켓만 붙인다 (재선정 안 함, 없으면 n=2 잠정 선정). 전날 결과가 아직 잠정·수급 없음이면 아침 수집 전에 먼저 확정(백필)한다
// 결과는 GITHUB_REPOSITORY 의 AUTO_BRANCH(기본 cockpit-data, 공개 저장소 eden-market 은 main) 브랜치 auto/<날짜>.json 과 auto/latest.json 에 둔다.
// 옵션: --when=morning|intraday|close|themes|live (기본: 지금 시각으로 판단 · live = 장중 실시간 주도 테마 → auto/live.json 만 · themes = 미국장 테마 값만 아침 기록에 채워 넣기, 새 테마를 추가한 날) --date=YYYY-MM-DD (기본: 오늘 KST) --dry (저장 안 함) --force (주말·휴장도 실행)
//       --final (close: 실행 시각과 관계없이 확정 run — 수급·일봉 포함). 오늘이 아닌 --date 로 손으로 백필하는 close run 도 확정으로 돈다 (잠정 결과가 확정을 덮지 않게)
import { loadCollectConfig } from "../server/config.js";
import { prevBusinessDay, kstTime } from "../shared/calendar.js";
import { autoFile, AUTO_DIR, collectLive, collectClose, collectMorning, collectPrevThemes, collectLeaders, collectIntraday, kstDate, mergeAuto, mergeCloseLeaders, skipReason, summarize, whenOf, collectThemesOnly, historyFrom, fetchListings, collectCandles, candleFile, liveSlot, liveOverwrite } from "../server/auto.js";
import naver from "../server/sources/naver.js";
import yahoo from "../server/sources/yahoo.js";
import upbit from "../server/sources/upbit.js";
import kis from "../server/sources/kis.js";
import tradingview from "../server/sources/tradingview.js";

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith("--" + name + "=")); return a ? a.slice(name.length + 3) : def; };
const has = (name) => process.argv.includes("--" + name);
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
// ---- 장중 실시간 (live): 09:05~15:30 + 마감 뒤 늦게 도착한 실행은 16:00 까지 「15:30 장 마감 값」(server/auto.js liveSlot), auto/live.json 하나에 덮어쓰고 끝 (날짜 파일·latest 는 손대지 않음) ----
if (when === "live") {
  const hm = kstTime(now).slice(0, 5), slot = liveSlot(hm);
  if (!has("force") && !slot) { console.log(`${hm} 장중 아님 — 건너뜀`); process.exit(0); }
  const tm = save ? (await readFile(autoFile(date)).catch(() => ({ json: null }))).json : null;
  const live = await collectLive({ adapters: { naver }, now, date, us: tm && tm.morning && tm.morning.us, history: await loadHistory(date) });
  if (slot && slot.closed) { live.at = slot.at; live.closed = true; console.log(`${hm} 도착 — 장 마감(15:30) 뒤 늦게 시작한 실시간 실행이라 「15:30 장 마감 값」으로 받음`); }
  if (save && !liveOverwrite((await readFile(AUTO_DIR + "/live.json").catch(() => ({ json: null }))).json, live)) { console.log("오늘 장 마감 값이 이미 있어 장중 값으로 덮지 않음 — 건너뜀"); process.exit(0); }
  console.log(`실시간 ${live.at} · 코스피 ${live.kospi ? live.kospi.value + "% · 거래대금 " + live.kospi.amount : "-"} · ${(live.themes || []).map((t) => `${t.name} ${t.rate > 0 ? "+" : ""}${t.rate}% (대금 ${Math.round(t.value || 0).toLocaleString("ko-KR")}억 · ${(t.news[0] || {}).title || "뉴스 없음"})`).join(" / ")}`);
  if (live.errors.length) console.log("일부 실패:", live.errors.join(" / "));
  console.log("후보:", (live.candidates || []).map((c) => `${c.name}${c.alias.length ? "=" + c.alias.join("=") : ""} ${c.score} [${c.stocks.join(",")}]`).join(" / "));
  if (!live.themes || !live.themes.length) { console.error("주도 테마를 못 골랐음"); process.exit(1); }
  if (save) { await writeFile(AUTO_DIR + "/live.json", live, `실시간 ${date} ${live.at}`); console.log(`저장: ${AUTO_DIR}/live.json (${BRANCH})`); } else console.log(has("dry") ? "(--dry: 저장 안 함)" : "(GITHUB_TOKEN/GITHUB_REPOSITORY 없음: 저장 안 함)");
  process.exit(0);
}
const prevDay = prevBusinessDay(date, cfg.holidays); // 어제(직전 거래일)
const prev = save ? (await ensureBranch(), await readFile(autoFile(date))) : { json: null };
const keep = prev.json && prev.json.date === date && prev.json.morning && prev.json.morning.prev; // 8:05 수집은 7:05에 고른 전일 테마를 이어 쓴다
const todayMorning = prev.json && prev.json.date === date ? prev.json.morning : null;
// 지난 거래일 파일들(최근 먼저, 최대 n개): 코스피 거래대금 20일 평균(관망) · 테마 목록(지속일수 D) · 전일 수급(2일 연속). 빈 날이 5번 이어지면 그만 (첫 수집 2026-09-28 이전)
async function loadHistory(from, n = 20) {
  if (!save) return [];
  const recs = []; let d = from, miss = 0;
  while (recs.length < n && miss < 5) {
    d = prevBusinessDay(d, cfg.holidays);
    try { const f = await readFile(autoFile(d)); if (f.json && f.json.close) { recs.push(f.json); miss = 0; } else miss++; } catch (e) { miss++; }
  }
  return historyFrom(recs);
}
const prevFile = when === "morning" && save ? await readFile(autoFile(prevDay)).catch(() => ({ json: null })) : { json: null }; // 전날 파일 (확정 주도 테마 · 코스피 거래대금)
const prevClose = prevFile.json && prevFile.json.close && prevFile.json.close.market ? prevFile.json.close.market : {};
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
  ? await collectMorning({ sources: cfg.sources, themes: cfg.themes, adapters: { naver, yahoo, upbit, tradingview, kis }, now, holidays: cfg.holidays, date, prevThemes: (m) => collectPrevThemes({ keep, bizdate: prevDay.replace(/-/g, ""), leaders: prevClose.leaders || null, us: m.us, kospi: prevClose.kospi || null }), listings: () => fetchListings(fetch, { today: date }) })
  : await collectClose({ adapters: { naver }, now, leaders: async (market) => collectLeaders({ now, date, kospi: market.kospi || null, us: todayMorning && todayMorning.us, history: await loadHistory(date), provisional }), listings: () => fetchListings(fetch, { today: date }), candles: (leaders, cache) => collectCandles({ date, leaders, morning: todayMorning, cache }) }); // 신규 상장 예정 · 앱 차트용 일봉 (9.29-76 원장 [1500] · [1502])
// 같은 날 앞선 close run 과 합친다: 잠정 → 확정이면 잠정은 leadersProvisional 로 보관, 확정 뒤 잠정이 늦게 오면 확정 유지 (server/auto.js mergeCloseLeaders)
if (when === "close" && prev.json && prev.json.date === date && prev.json.close) mergeCloseLeaders(prev.json.close, part);
const saveAs = when === "themes" ? "morning" : when; // 테마만 받은 것도 아침 기록에 들어간다
const got = when === "intraday" ? ["fut", "spot", "kospi"].filter((k) => part[k] !== undefined).length : saveAs === "morning" ? Object.keys(part.signals).length + Object.keys(part.us).length : Object.keys(part.market).length;
// 장중 재판정은 하루 여러 번 → 앞선 확인 기록을 이어 붙인다
if (when === "intraday" && prev.json && prev.json.date === date && prev.json.intraday) part.list = [...(prev.json.intraday.list || []), { at: prev.json.intraday.at, kospi: prev.json.intraday.kospi, fut: prev.json.intraday.fut, spot: prev.json.intraday.spot }].slice(-6);
if (!got) { console.error("받은 값이 하나도 없음:", part.errors.join(" / ")); process.exit(1); }

if (!save) {
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
const msg = `자동 연동 ${date} ${when === "morning" ? "아침" : when === "themes" ? "아침(테마 보충)" : when === "intraday" ? "장중" : "오후"} ${part.at}`;
await writeFile(autoFile(date), rec, msg);
await writeFile(AUTO_DIR + "/latest.json", rec, msg);
console.log(summarize(rec));
console.log(`저장: ${autoFile(date)} (${BRANCH})`);
if (part.errors.length) console.log("일부 실패:", part.errors.join(" / "));
