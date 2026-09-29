// Yahoo Finance 차트 엔드포인트 어댑터 (비공식 — 막히면 config/sources.json에서 다른 어댑터로 교체)
// 어댑터 규약: quote(symbol) → Promise<{ price, prevClose, time }>  (time: 시세 시각 ISO 문자열)

const BASE = process.env.YAHOO_BASE || "https://query1.finance.yahoo.com";

// 차트 응답에서 현재가·기준가를 뽑는다.
// range=1d 응답의 chartPreviousClose/previousClose = 직전 정규장 종가(주식) 또는 직전 정산가(선물).
// 없으면 일봉 종가 배열에서 직전 종가를 찾는다.
export function parseChart(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.meta) {
    const e = json && json.chart && json.chart.error;
    throw new Error("yahoo: 응답 형식 이상" + (e ? " (" + (e.description || e.code) + ")" : ""));
  }
  const meta = r.meta;
  const price = meta.regularMarketPrice;
  let prevClose = meta.previousClose ?? meta.chartPreviousClose;
  if (prevClose == null) {
    const closes = ((r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || []).filter((c) => c != null);
    if (closes.length >= 2) prevClose = closes[closes.length - 2];
  }
  if (typeof price !== "number" || typeof prevClose !== "number" || prevClose === 0) throw new Error("yahoo: 가격 없음");
  const time = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;
  return { price, prevClose, time };
}

export async function quote(symbol, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const url = BASE + "/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=1d&interval=5m";
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0 (cockpit)", Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error("yahoo " + symbol + ": HTTP " + res.status);
  return parseChart(await res.json());
}

// 일봉 종가 목록 [{date: 거래소 현지 날짜, close}] — 연휴 누적 변화 계산용
export function parseDaily(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.timestamp) throw new Error("yahoo: 일봉 없음");
  const off = (r.meta && r.meta.gmtoffset) || 0, closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  return r.timestamp.map((t, i) => ({ date: new Date((t + off) * 1000).toISOString().slice(0, 10), close: closes[i] })).filter((x) => typeof x.close === "number");
}
export async function daily(symbol, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const url = BASE + "/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=1mo&interval=1d";
  const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (cockpit)", Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error("yahoo " + symbol + ": HTTP " + res.status);
  return parseDaily(await res.json());
}

export default { name: "yahoo", quote, daily };
