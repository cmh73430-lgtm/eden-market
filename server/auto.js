// 자동 연동: GitHub Actions 가 평일 아침(미국 지표·미국 대응주)과 오후(코스피·코스닥 마감·수급)에 네이버 값을 모아
// 기록 저장소(cockpit-data 브랜치)의 auto/<날짜>.json 에 둔다. 앱은 그 파일을 읽어 빈 칸을 채운다 (손으로 고친 칸은 그대로).
// 여기는 순수 함수만 — 실제 실행은 scripts/collect-auto.mjs.
import { kstDate, kstTime, weekday } from "../shared/calendar.js";
import { collectAll } from "./collect.js";

export const AUTO_DIR = "auto";
export const autoFile = (date) => AUTO_DIR + "/" + date + ".json";

const num = (s) => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(String(s).replace(/,/g, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
};

// 오늘이 장이 없는 날이면 그 이유, 아니면 null
export function skipReason(date, holidays = [], holidayNames = {}) {
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return "주말";
  if (holidays.includes(date)) return "휴장 · " + (holidayNames[date] || "휴장일");
  return null;
}

// 시각으로 아침/오후 구분 (KST 12시 전 = 아침)
export function whenOf(now = new Date()) { return Number(kstTime(now).slice(0, 2)) < 12 ? "morning" : "close"; }

// 네이버 투자자 매매동향 응답 {bizdate, personalValue, foreignValue, institutionalValue} (억원) → 숫자
export function parseTrend(json) {
  if (!json || typeof json !== "object") throw new Error("trend: 응답 형식 이상");
  const out = { bizdate: json.bizdate || null, personal: num(json.personalValue), foreign: num(json.foreignValue), institution: num(json.institutionalValue) };
  if (out.foreign === null && out.institution === null) throw new Error("trend: 값 없음");
  return out;
}

const eok = (v) => (v === null ? "—" : (v > 0 ? "+" : "") + v.toLocaleString("ko-KR") + "억");
// 수급 한 줄: "코스피 외국인 -4,942억 · 기관 +3,189억 / 코스닥 외국인 +812억 · 기관 -95억"
export function investText(inv) {
  return ["kospi", "kosdaq"].filter((k) => inv && inv[k]).map((k) => (k === "kospi" ? "코스피" : "코스닥") + " 외국인 " + eok(inv[k].foreign) + " · 기관 " + eok(inv[k].institution)).join(" / ");
}

// 아침: 시장 신호 + 미국 대응주 (야간선물 k200 은 KIS 없이는 못 받으므로 실패해도 그대로 둔다)
export async function collectMorning({ sources, themes, adapters, now = new Date() }) {
  const got = await collectAll({ sources, themes, adapters, now });
  const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v.value, src: v.src, time: v.time || undefined, detail: v.detail }]));
  return { at: kstTime(now).slice(0, 5), ts: now.getTime(), signals: strip(got.signals), us: strip(got.us), errors: got.errors.map((e) => e.key + ": " + e.error) };
}

// 오후: 코스피·코스닥 마감 등락률 + 투자자별 수급 (네이버)
export async function collectClose({ adapters, fetchImpl = fetch, now = new Date(), timeoutMs = 10000 }) {
  const out = { at: kstTime(now).slice(0, 5), ts: now.getTime(), market: {}, errors: [] };
  const inv = {};
  for (const k of ["kospi", "kosdaq"]) {
    const code = k.toUpperCase();
    try {
      const q = await adapters.naver.quote("domestic:" + code);
      out.market[k] = { value: Number(((q.price / q.prevClose - 1) * 100).toFixed(2)), close: q.price, src: "naver", time: q.time || undefined };
    } catch (e) { out.errors.push(k + ": " + (e.message || e)); }
    try {
      const res = await fetchImpl("https://m.stock.naver.com/api/index/" + code + "/trend", {
        headers: { Accept: "application/json", Referer: "https://m.stock.naver.com/", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      inv[k] = parseTrend(await res.json());
    } catch (e) { out.errors.push(k + " 수급: " + (e.message || e)); }
  }
  if (Object.keys(inv).length) out.market.invest = Object.assign({ text: investText(inv) }, inv);
  return out;
}

// 그 날 파일에 이번 결과를 합친다 (아침·오후 따로 두고, 같은 시점은 최신으로 덮는다)
export function mergeAuto(prev, date, when, part) {
  const rec = Object.assign({ app: "jangjeon-cockpit", date }, prev && prev.date === date ? prev : {});
  rec[when] = part;
  rec.updatedAt = part.ts || Date.now();
  return rec;
}

export function summarize(rec) {
  const lines = [];
  const m = rec.morning, c = rec.close;
  if (m) {
    Object.entries(m.signals || {}).forEach(([k, v]) => lines.push(`아침 ${m.at} 신호 ${k.padEnd(5)} ${String(v.value).padStart(8)}  ${v.src}`));
    Object.entries(m.us || {}).forEach(([k, v]) => lines.push(`아침 ${m.at} 테마 ${k.padEnd(5)} ${String(v.value).padStart(8)}  ${v.src}`));
    (m.errors || []).forEach((e) => lines.push("아침 실패 " + e));
  }
  if (c) {
    ["kospi", "kosdaq"].forEach((k) => { const v = c.market && c.market[k]; if (v) lines.push(`오후 ${c.at} ${k.padEnd(6)} ${String(v.value).padStart(7)}%  종가 ${v.close}`); });
    if (c.market && c.market.invest) lines.push(`오후 ${c.at} 수급 ${c.market.invest.text}`);
    (c.errors || []).forEach((e) => lines.push("오후 실패 " + e));
  }
  return lines.join("\n");
}

export { kstDate };
