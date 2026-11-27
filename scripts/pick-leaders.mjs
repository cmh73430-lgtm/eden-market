// 9.29-177 주도주 선별기(검색기) 수집 — 15:20(정규장 종배) · 19:30(NXT 종배) · 수동 실행. 계산 = shared/picker.js
// 결과: auto/picks.json(지금 회차 · 앱 「검색기」 탭이 읽음) + auto/observe/picks-log.json(회차 기록 · 다음 거래일 시가·고가·종가 붙임 = 성과 추적)
// 사용: node scripts/pick-leaders.mjs [--dir=<eden-market 경로 · 기본 현재 폴더>] [--slot=15:20|19:30] [--date=YYYY-MM-DD] [--dry] [--force]
// 쓰기는 로컬 파일만(커밋·푸시는 eden/picker.yml 이 함). 자동 주문 0 · 투자 권유 아님 · 실행 중 LLM 0 · 키·토큰 0(네이버 공개 주소만).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pick, fillNext, orderbookOf, obMinOf, marketToday, PICK } from "../shared/picker.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const DIR = args.dir || process.cwd();
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString();
const date = args.date || kst().slice(0, 10), hm = kst().slice(11, 16);
const slot = args.slot || (hm >= "15:10" && hm <= "15:40" ? "15:20" : hm >= "19:20" && hm <= "20:05" ? "19:30" : "수시 " + hm); // 종배 회차(15:20·19:30) 밖 = 「수시」(⚠ 종배 주의 점수 안 깎음)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d8 = (d) => d.replace(/-/g, "");
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const readJson = (p, dflt = null) => { try { return JSON.parse(readFileSync(join(DIR, p), "utf8")); } catch (e) { return dflt; } };
const writeJson = (p, v) => { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const num = (s) => { if (s === null || s === undefined || s === "" || s === "N/A") return null; const n = Number(String(s).replace(/[,+%]/g, "")); return Number.isFinite(n) ? n : null; };
let requests = 0; const errors = [];
async function get(url, { json = true, tries = 4 } = {}) {
  let e;
  for (let i = 0; i < tries; i++) {
    try { requests++; const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error("HTTP " + r.status); return json ? await r.json() : await r.text(); }
    catch (x) { e = x; await sleep(700 * (i + 1)); }
  }
  throw e;
}

// 휴장·주말 건너뜀(--force 면 돎)
const hol = readJson("data/holidays.json", {}); const holSet = new Set(Object.values(hol).flat().map((h) => h && h.date));
const dow = new Date(date + "T00:00:00Z").getUTCDay();
if (!args.force && (dow === 0 || dow === 6 || holSet.has(date))) { console.log(`${date} 휴장·주말 — 건너뜀`); process.exit(0); }

let cfg = { themes: {}, index: [] }; try { cfg = JSON.parse(readFileSync(new URL("../config/picker-themes.json", import.meta.url), "utf8")); } catch (e) { errors.push("관심 테마 설정 못 읽음: " + (e.message || e)); } // 설정 = 이 스크립트 옆 config(eden-market 에도 같은 자리로 복사)
const map = readJson("auto/observe/theme-map.json");
const isExcluded = (s) => { const t = String(s.stockEndType || ""), n = String(s.stockName || ""); return /etf|etn/i.test(t) || /스팩|기업인수목적/.test(n); }; // 우선주는 넣음(짝꿍 대한항공우 같은 경우)

// R1 거래대금 상위: 두 시장 1쪽(각 100) → 거래대금 순 상위 100
const top = new Map();
for (const mkt of ["KOSPI", "KOSDAQ"]) {
  try {
    const j = await get(`https://m.stock.naver.com/api/stocks/priceTop/${mkt}?page=1&pageSize=100`);
    for (const s of (j && j.stocks) || []) {
      if (!s || !s.itemCode || isExcluded(s)) continue;
      const ov = s.overMarketPriceInfo || {};
      top.set(String(s.itemCode), { code: String(s.itemCode), name: String(s.stockName), market: mkt === "KOSPI" ? "코스피" : "코스닥", cap: num(s.marketValue), value: num(s.accumulatedTradingValue) === null ? null : num(s.accumulatedTradingValue) * 1e6, rate: num(s.fluctuationsRatio), price: num(s.closePrice), vol: num(s.accumulatedTradingVolume), tradedAt: s.localTradedAt || null,
        nxtPrice: ov.tradingSessionType && ov.tradingSessionType !== "REGULAR_MARKET" ? num(ov.overPrice) : null, nxtRate: ov.tradingSessionType && ov.tradingSessionType !== "REGULAR_MARKET" ? num(ov.fluctuationsRatio) : null, nxtSession: ov.tradingSessionType || null });
    }
  } catch (e) { errors.push(`거래대금 상위 ${mkt}: ${e.message || e}`); }
}
const top100 = [...top.values()].filter((s) => s.value !== null).sort((a, b) => b.value - a.value).slice(0, PICK.TOP_N);
if (!top100.length) { console.error("거래대금 상위를 못 받음 — 저장 안 함 · " + errors.join(" / ")); process.exit(1); }
// 게이트 177 REJECT ②: 시세 날짜 = 거래대금 상위 체결 시각(localTradedAt)의 날짜(가장 많은 값) · 실행 날과 다르면(늦게 돈 예약이 자정을 넘김 등) 저장 안 함 → 날짜 틀린 기록·지어낸 「오늘」 일봉 0
const cnt = {}; for (const s of top100) { const d = String(s.tradedAt || "").slice(0, 10); if (d) cnt[d] = (cnt[d] || 0) + 1; }
const mktDate = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
if (!args.force && mktDate !== date) { console.log(`시세 날짜 ${mktDate || "모름"} ≠ 실행 날 ${date} — 저장 안 함`); process.exit(0); }

// 관심 테마·지수관련주 종목 이름 → 코드(상위 100 에 있으면 그대로 · 없으면 네이버 자동완성 · 캐시 auto/observe/picker-codes.json)
const codeCache = readJson("auto/observe/picker-codes.json", {});
const byName = new Map(top100.map((s) => [s.name, s.code]));
const wantNames = [...new Set([...Object.values(cfg.themes || {}).flat(), ...(cfg.index || [])])];
for (const n of wantNames) {
  if (byName.has(n) || codeCache[n]) continue;
  try { const j = await get(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(n)}&target=stock`); const it = ((j && j.items) || []).find((x) => x && x.name === n && /^[0-9A-Z]{6}$/.test(String(x.code))); if (it) codeCache[n] = String(it.code); else errors.push(`이름 못 찾음: ${n}`); } catch (e) { errors.push(`이름 찾기 ${n}: ${e.message || e}`); }
  await sleep(150);
}
const pool = new Map(top100.map((s) => [s.code, s]));
for (const n of wantNames) { const c = byName.get(n) || codeCache[n]; if (c && !pool.has(c)) pool.set(c, { code: c, name: n, cap: null, value: null, rate: null }); }

// 종목마다 일봉 140일 + 투자자별 순매수
const from = addDays(date, -140);
const parseSise = (t) => { const rows = []; for (const m of String(t).matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)) rows.push([m[1].slice(0, 4) + "-" + m[1].slice(4, 6) + "-" + m[1].slice(6), +m[2], +m[3], +m[4], +m[5], +m[6]]); return rows; };
const stocks = [];
for (const s of pool.values()) {
  let bars = [], trend = [];
  try { bars = parseSise(await get(`https://api.finance.naver.com/siseJson.naver?symbol=${s.code}&requestType=1&startTime=${d8(from)}&endTime=${d8(date)}&timeframe=day`, { json: false })); } catch (e) { errors.push(`일봉 ${s.name}: ${e.message || e}`); continue; }
  try { const tr = await get(`https://m.stock.naver.com/api/stock/${s.code}/trend?pageSize=3&bizdate=${d8(date)}`); trend = (Array.isArray(tr) ? tr : []).map((r) => ({ date: String(r.bizdate).slice(0, 4) + "-" + String(r.bizdate).slice(4, 6) + "-" + String(r.bizdate).slice(6, 8), frgn: num(r.foreignerPureBuyQuant), inst: num(r.organPureBuyQuant), indi: num(r.individualPureBuyQuant), vol: num(r.accumulatedTradingVolume) })); } catch (e) { errors.push(`수급 ${s.name}: ${e.message || e}`); }
  // 오늘 일봉이 아직 없으면 거래대금 상위 값으로 한 줄 채움(고가 모름 = 현재가)
  if (!bars.some((b) => b[0] === date) && s.price > 0 && s.vol >= 0 && String(s.tradedAt || "").slice(0, 10) === date) bars.push([date, s.price, s.price, s.price, s.price, s.vol]); // 그 종목 체결 날짜가 오늘일 때만
  stocks.push({ code: s.code, name: s.name, market: s.market || null, cap: s.cap, bars, trend, from, live: { value: s.value, rate: s.rate, nxtPrice: slot === "19:30" ? s.nxtPrice : null, nxtRate: s.nxtRate } });
  await sleep(120);
}

// 나스닥 선물(지수관련주 칸 · 야후 NQ=F · 못 받으면 「자료 없음」)
let nasdaq = null;
try { const j = await get("https://query1.finance.yahoo.com/v8/finance/chart/NQ=F?range=1d&interval=5m"); const m = j.chart.result[0].meta; const p = m.regularMarketPrice, pc = m.previousClose ?? m.chartPreviousClose; if (p > 0 && pc > 0) nasdaq = { rate: Math.round((p / pc - 1) * 1000) / 10, at: m.regularMarketTime ? new Date(m.regularMarketTime * 1000 + 9 * 3600e3).toISOString().slice(11, 16) : null }; } catch (e) { errors.push(`나스닥 선물: ${e.message || e}`); }

// 9.29-179 R5 호가: 1차 후보(최대 40)만 네이버 askingPrice 받아 금액 추정 → 다시 계산(1억 미만 탈락 · 못 받으면 보류)
// 9.29-180 호가 기준 = 그날 시장 거래대금에 맞춤: 오늘 = auto/live.json(같은 날) 코스피+코스닥 거래대금 · 평균 = 지난 날짜 파일 close.market.invest 20거래일 · 장중은 지난 시간 비율로 환산
const amt = (iv) => (iv && iv.kospi && iv.kosdaq && iv.kospi.amount > 0 && iv.kosdaq.amount > 0 ? iv.kospi.amount + iv.kosdaq.amount : null);
const hist = []; for (let k = 1; k <= 45 && hist.length < 20; k++) { const d = addDays(date, -k); const j = readJson(`auto/${d}.json`); const v = j && j.close && j.close.market ? amt(j.close.market.invest) : null; if (v) hist.push(v); }
// 게이트 180 REJECT ③: 지난 시간 비율 = 실행 시각 ✕ → 자료 자체 시각(kospi.time) · 오늘 장 마감 값(날짜 파일 close)이 있으면 그것(하루치 · 비율 1) · 실시간 자료가 30분 넘게 묵었으면 1억 그대로
const todayRec = readJson(`auto/${date}.json`), closeAmt = todayRec && todayRec.close && todayRec.close.market ? amt(todayRec.close.market.invest) : null;
const lv = readJson("auto/live.json"), lvOk = lv && lv.kospi && lv.kosdaq && lv.kospi.amount > 0 && lv.kosdaq.amount > 0;
const mt = marketToday({ date, hm, closeAmt, live: lvOk ? { date: lv.date, at: typeof lv.kospi.time === "string" ? lv.kospi.time.slice(11, 16) : null, amount: lv.kospi.amount + lv.kosdaq.amount } : null }); // kospi.time "2026-11-25T12:25:23+09:00" → 12:25
const todayAmt = mt.amount, mins = mt.elapsed * 390;
if (todayAmt === null) errors.push(`호가 기준 = 1억 그대로(오늘 시장 거래대금 ${mt.src})`);
const ob = obMinOf(todayAmt, hist.length >= 10 ? hist.reduce((a, x) => a + x, 0) / hist.length : null, mins / 390);
if (ob.ratio === null) errors.push(`호가 기준 = 1억 그대로(시장 거래대금 자료 부족 · 오늘 ${todayAmt ?? "없음"} · 평균 ${hist.length}일)`);
const first = pick(stocks, { date, slot, interest: cfg.themes, map, indexNames: cfg.index, nasdaq, obMin: ob.min });
for (const p of first.picks.slice(0, 40)) {
  try { let ob = null; try { ob = orderbookOf(await get(`https://stock.naver.com/api/stockSecurity/items/v2/domestic/${p.code}/order-book?depth=10`, { tries: 2 })); } catch (e) {} if (!ob) ob = orderbookOf(await get(`https://m.stock.naver.com/api/stock/${p.code}/askingPrice`)); const s = stocks.find((x) => x.code === p.code); if (ob && s) s.ob = Object.assign(ob, { at: hm }); } catch (e) { errors.push(`호가 ${p.name}: ${e.message || e}`); }
  await sleep(120);
}
const r = pick(stocks, { date, slot, interest: cfg.themes, map, indexNames: cfg.index, nasdaq, obMin: ob.min }); r.obRatio = ob.ratio; r.marketAmt = todayAmt; r.marketAvg20 = hist.length ? Math.round(hist.reduce((a, x) => a + x, 0) / hist.length) : null;
// 9.29-183 디렉터 「종목옆에 어디지수소속인지」: 상위 100 = 받은 시장 · 관심 종목(시장 모름)만 네이버 basic 의 stockExchangeType 으로(후보만 · 최대 20)
for (const p of r.picks.filter((x) => !x.market).slice(0, 20)) { try { const b = await get(`https://m.stock.naver.com/api/stock/${p.code}/basic`); const t = b && b.stockExchangeType && (b.stockExchangeType.nameKor || b.stockExchangeType.code); p.market = /코스닥|KOSDAQ|KQ/i.test(String(t)) ? "코스닥" : /코스피|유가|KOSPI|KS/i.test(String(t)) ? "코스피" : t ? String(t) : null; } catch (e) { errors.push(`시장 ${p.name}: ${e.message || e}`); } await sleep(120); }
const out = { app: "jangjeon-cockpit", kind: "picks", v: 1, date, slot, at: hm, ...r, pool: { top: top100.length, interest: pool.size - top100.length }, requests, errors: errors.slice(0, 30), note: "후보 표시 도구 · 자동 주문 0 · 투자 권유 아님 · 호가 10단계(R5) 1억 미만 = 탈락 · 못 받은 종목 = 보류", updatedAt: Date.now() };

// 성과 기록: 같은 날·같은 회차는 그 줄만 바꿈 · 지난 줄에 다음 거래일 값 붙임(그 종목 일봉 다시 받음 · 최대 40종목)
// 9.29-183 디렉터 「5분마다」: 장중 수시(5분마다) 결과는 picks.json 만 바꿈 · 성과 기록(picks-log)은 15:20·19:30 만(수시 줄이 하루 70여 줄 쌓여 400줄 한도로 옛 기록을 밀어내지 않게)
const isLive = String(slot).startsWith("수시");
const log = readJson("auto/observe/picks-log.json", { app: "jangjeon-cockpit", kind: "picks-log", v: 1, rows: [] });
const row = { date, slot, at: hm, picks: r.picks.slice(0, 20).map((p) => ({ code: p.code, name: p.name, score: p.score, role: p.role, theme: p.theme, flags: p.flags, nature: p.nature, close: p.close })) };
if (!isLive) log.rows = log.rows.filter((x) => !(x.date === date && x.slot === slot)).concat([row]).slice(-400);
const need = isLive ? [] : [...new Set(log.rows.filter((x) => x.date < date).flatMap((x) => x.picks.filter((p) => !p.next).map((p) => p.code)))].slice(0, 40);
const barsByCode = Object.fromEntries(stocks.map((s) => [s.code, s.bars]));
for (const c of need) { if (barsByCode[c]) continue; try { barsByCode[c] = parseSise(await get(`https://api.finance.naver.com/siseJson.naver?symbol=${c}&requestType=1&startTime=${d8(addDays(date, -40))}&endTime=${d8(date)}&timeframe=day`, { json: false })); } catch (e) { errors.push(`성과 일봉 ${c}: ${e.message || e}`); } await sleep(120); }
const filled = isLive ? 0 : fillNext(log.rows, barsByCode); log.updatedAt = Date.now();

console.log(`호가 기준 ${Math.round(r.obMin / 1e6) / 100}억(시장 ×${r.obRatio ?? "—"} · 오늘 ${r.marketAmt ?? "—"}억 · 평균 ${r.marketAvg20 ?? "—"}억) · `); console.log(`검색기 ${date} ${slot}(${hm}) · 본 종목 ${r.scanned}(상위 ${top100.length} + 관심 ${pool.size - top100.length}) · 후보 ${r.picks.length} · 요청 ${requests} · 성과 채움 ${filled}`);
for (const p of r.picks.slice(0, 10)) console.log(`  ${p.score} ${p.name} [${p.theme}${p.role ? " " + p.role : ""}] ${p.rate}% · 배수 ${p.mult}/${p.prevMult} · ${p.nature}${p.flags.length ? " · " + p.flags.join(" ") : ""}`);
console.log("주도 테마(쏠림×상승): " + r.topThemes.map((t) => `${t.name} ${t.share}%·${t.rate}%`).join(" / ") + (r.thin.length ? " · 호가 얇아 뺌: " + r.thin.map((x) => x.name).join(",") : ""));
if (errors.length) console.log("참고(일부 실패):", errors.slice(0, 8).join(" / "));
if (args.dry) { console.log("(--dry: 저장 안 함)"); process.exit(0); }
writeJson("auto/picks.json", out); if (!isLive) writeJson("auto/observe/picks-log.json", log); writeJson("auto/observe/picker-codes.json", codeCache);
console.log("저장: auto/picks.json · auto/observe/picks-log.json");
