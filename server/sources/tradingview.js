// 코스피200 야간선물 — 키 없이 받는 길 (2026-09-27 확인).
//   ① 네이버 코스피200 선물(FUT): 전날 낮 시장 마감가(15:45)와 지금 최근월물(예: "26.12.")
//   ② TradingView 공개 스캐너(scanner.tradingview.com/futures/scan): 같은 월물(KRX:K2IZ2026)의 마지막 가격 (20분 지연)
// 한국거래소 규칙(2025-06-09~): 야간 18:00~다음 날 06:00 (17:50~18:00 시가 단일가, 05:50~06:00 종가 단일가), 거래일은 다음 날(T+1),
// 기준가는 전날 정규장 기준가(정산가 = 보통 15:45 종가), 주가지수 상품 가격제한 ±8%.
// TradingView의 KRX 선물 세션은 "1800F-0600,0845-1546" — 야간장을 다음 거래일 막대의 앞부분으로 넣는다(2026-09-23 막대로 확인:
// 시가 1110.20·고가 1143.75가 그날 주간 범위 1115.65~1141.20 밖). 그래서 06:00~08:45 사이 마지막 가격 = 야간 종가다.
// 자기 점검: ②가 ①과 똑같으면 야간 거래를 못 잡은 것(휴장 다음 날이거나 TradingView에 야간이 안 들어옴)으로 보고
// 실패로 던진다 → 앱은 0%를 넣지 않고 손 입력 칸으로 남긴다.
// 어댑터 규약: quote(symbol) → { price, prevClose, time }  (prevClose = 전날 낮 마감가 → kind "pct"로 앱과 같은 값)

const M = "https://m.stock.naver.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const MONTH = { 1: "F", 2: "G", 3: "H", 4: "J", 5: "K", 6: "M", 7: "N", 8: "Q", 9: "U", 10: "V", 11: "X", 12: "Z" };
const num = (s) => { const n = Number(String(s ?? "").replace(/,/g, "")); return s === null || s === undefined || s === "" || !Number.isFinite(n) ? null : n; };

// "26.12." → "K2IZ2026"
export function tvContract(month) {
  const m = /^(\d{2})\.(\d{1,2})/.exec(String(month || ""));
  if (!m || !MONTH[+m[2]]) throw new Error("tradingview: 월물 해석 실패 " + month);
  return "K2I" + MONTH[+m[2]] + "20" + m[1];
}

export function pickClose(json, ticker) {
  const row = json && Array.isArray(json.data) ? json.data.find((d) => d.s === ticker) : null;
  const close = row && Array.isArray(row.d) ? num(row.d[0]) : null;
  if (close === null) throw new Error("tradingview: " + ticker + " 가격 없음");
  return close;
}

async function getJson(url, opts, fetchImpl, timeoutMs) {
  const res = await fetchImpl(url, { ...opts, headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url.split("/")[2]);
  return res.json();
}

// TradingView의 전날 기준가 = 마지막 가격 - 전일 대비
export function pickBase(json, ticker) {
  const row = json && Array.isArray(json.data) ? json.data.find((d) => d.s === ticker) : null;
  const close = row ? num(row.d[0]) : null, chg = row ? num(row.d[2]) : null;
  return close !== null && chg !== null ? Math.round((close - chg) * 100) / 100 : null;
}
// 야간 종가가 확정된 뒤·주간장 시작 전(KST 06:00~08:45)에만 믿는다. 그 밖에는 진행 중인 야간값이나 주간값일 수 있다.
export function inNightWindow(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600 * 1000), m = k.getUTCHours() * 60 + k.getUTCMinutes();
  return m >= 6 * 60 && m < 8 * 60 + 45;
}

export async function quote(symbol, { fetchImpl = fetch, timeoutMs = 10000, now = new Date() } = {}) {
  if (symbol !== "K200_NIGHT") throw new Error("tradingview: 지원하지 않는 심볼 " + symbol);
  if (!inNightWindow(now)) throw new Error("야간선물은 아침 06:00~08:45 사이에만 확정값 — 손 입력");
  const nh = { headers: { Referer: M + "/" } };
  const [basic, integ] = await Promise.all([
    getJson(M + "/api/index/FUT/basic", nh, fetchImpl, timeoutMs),
    getJson(M + "/api/index/FUT/integration", nh, fetchImpl, timeoutMs),
  ]);
  const dayClose = num(basic.closePrice);
  if (dayClose === null) throw new Error("네이버 선물 마감가 없음");
  const ticker = "KRX:" + tvContract(integ.month);
  const tv = await getJson("https://scanner.tradingview.com/futures/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/" },
    body: JSON.stringify({ symbols: { tickers: [ticker] }, columns: ["close", "update_mode", "change_abs"] }),
  }, fetchImpl, timeoutMs);
  const night = pickClose(tv, ticker), tvBase = pickBase(tv, ticker);
  if (Math.abs(night - dayClose) < 1e-9) throw new Error("야간 거래를 못 잡음 (" + ticker + " = 낮 마감가 " + dayClose + ") — 손 입력");
  // TradingView가 스스로 보는 전날 기준가와 네이버 낮 마감가가 0.3% 넘게 다르면(월물 교체·갱신 지연) 믿지 않는다
  if (tvBase !== null && Math.abs(tvBase / dayClose - 1) > 0.003) throw new Error("기준가 불일치 (TradingView " + tvBase + " vs 네이버 " + dayClose + ") — 손 입력");
  const pct = (night / dayClose - 1) * 100;
  if (Math.abs(pct) > 8.5) throw new Error("가격제한(±8%) 밖 값 " + pct.toFixed(2) + "% — 손 입력");
  return { price: night, prevClose: dayClose, time: basic.localTradedAt || null, detail: { ticker, night, dayClose, tvBase } };
}

export default { name: "tradingview", quote };
