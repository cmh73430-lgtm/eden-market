// 자동 연동 수집기 — GitHub Actions(.github/workflows/auto.yml)가 평일 아침·오후에 실행한다.
//   아침(KST 12시 전): 미국 선물·환율·SOX·VIX·유가·금리 + 미국 대응주 (네이버 → 야후 순) + 전일 주도 테마(애프터·프리마켓)
//   오후:             코스피·코스닥 마감 등락률 + 투자자별 수급 + 오늘 주도 테마 (네이버)
// 결과는 GITHUB_REPOSITORY 의 AUTO_BRANCH(기본 cockpit-data, 공개 저장소 eden-market 은 main) 브랜치 auto/<날짜>.json 과 auto/latest.json 에 둔다.
// 옵션: --when=morning|intraday|close (기본: 지금 시각으로 판단) --date=YYYY-MM-DD (기본: 오늘 KST) --dry (저장 안 함) --force (주말·휴장도 실행)
import { loadCollectConfig } from "../server/config.js";
import { prevBusinessDay } from "../shared/calendar.js";
import { autoFile, AUTO_DIR, collectClose, collectMorning, collectPrevThemes, collectLeaders, collectIntraday, kstDate, mergeAuto, skipReason, summarize, whenOf } from "../server/auto.js";
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
const prevDay = prevBusinessDay(date, cfg.holidays); // 어제(직전 거래일)
const prev = save ? (await ensureBranch(), await readFile(autoFile(date))) : { json: null };
const keep = prev.json && prev.json.date === date && prev.json.morning && prev.json.morning.prev; // 8:05 수집은 7:05에 고른 전일 테마를 이어 쓴다
const part = when === "intraday"
  ? await collectIntraday({ adapters: { naver }, now })
  : when === "morning"
  ? await collectMorning({ sources: cfg.sources, themes: cfg.themes, adapters: { naver, yahoo, upbit, tradingview, kis }, now, holidays: cfg.holidays, date, prevThemes: () => collectPrevThemes({ keep, bizdate: prevDay.replace(/-/g, "") }) })
  : await collectClose({ adapters: { naver }, now, leaders: () => collectLeaders({ now }) });
const got = when === "intraday" ? ["fut", "spot", "kospi"].filter((k) => part[k] !== undefined).length : when === "morning" ? Object.keys(part.signals).length + Object.keys(part.us).length : Object.keys(part.market).length;
// 장중 재판정은 하루 여러 번 → 앞선 확인 기록을 이어 붙인다
if (when === "intraday" && prev.json && prev.json.date === date && prev.json.intraday) part.list = [...(prev.json.intraday.list || []), { at: prev.json.intraday.at, kospi: prev.json.intraday.kospi, fut: prev.json.intraday.fut, spot: prev.json.intraday.spot }].slice(-6);
if (!got) { console.error("받은 값이 하나도 없음:", part.errors.join(" / ")); process.exit(1); }

if (!save) {
  const rec = mergeAuto(null, date, when, part);
  console.log(summarize(rec));
  console.log(has("dry") ? "(--dry: 저장 안 함)" : "(GITHUB_TOKEN/GITHUB_REPOSITORY 없음: 저장 안 함)");
  process.exit(0);
}
const rec = mergeAuto(prev.json, date, when, part);
const msg = `자동 연동 ${date} ${when === "morning" ? "아침" : when === "intraday" ? "장중" : "오후"} ${part.at}`;
await writeFile(autoFile(date), rec, msg);
await writeFile(AUTO_DIR + "/latest.json", rec, msg);
console.log(summarize(rec));
console.log(`저장: ${autoFile(date)} (${BRANCH})`);
// 아침: 어제 파일의 '오늘 주도 테마'에 종목 외인·기관이 아직 없으면(네이버가 늦게 올림) 지금 어제 값으로 다시 계산해 채운다
if (when === "morning") {
  try {
    const pf = await readFile(autoFile(prevDay));
    const L = pf.json && pf.json.close && pf.json.close.market && pf.json.close.market.leaders;
    if (L && !L.flowReady) {
      const nl = await collectLeaders({ bizdate: prevDay.replace(/-/g, "") });
      if (nl.flowReady) { pf.json.close.market.leaders = nl; pf.json.updatedAt = Date.now(); await writeFile(autoFile(prevDay), pf.json, `자동 연동 ${prevDay} 주도 테마 수급 채움`); console.log(`어제(${prevDay}) 주도 테마 수급 채움: ${nl.text}`); }
      else console.log(`어제(${prevDay}) 종목 수급 아직 없음`);
    }
  } catch (e) { console.log("어제 주도 테마 수급 채우기 실패:", e.message || e); }
}
if (part.errors.length) console.log("일부 실패:", part.errors.join(" / "));
