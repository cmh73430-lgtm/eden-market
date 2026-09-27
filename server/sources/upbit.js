// 업비트 공개 시세 API (공식, 키 불필요) — 가상자산용.
// quote("BTC-USD" | "KRW-BTC") → { price, prevClose, time }  (prevClose = 전일 종가, 업비트 기준 00:00 UTC)
export function parseUpbit(json) {
  const d = Array.isArray(json) ? json[0] : null;
  if (!d || typeof d.trade_price !== "number" || !d.prev_closing_price) throw new Error("upbit: 응답 형식 이상");
  return { price: d.trade_price, prevClose: d.prev_closing_price, time: d.trade_timestamp ? new Date(d.trade_timestamp).toISOString() : null };
}

export async function quote(symbol, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const m = /^([A-Z]+)-(USD|KRW)$/.exec(symbol);
  const market = /^KRW-/.test(symbol) ? symbol : m ? "KRW-" + m[1] : null;
  if (!market) throw new Error("upbit: 가상자산 심볼 아님 " + symbol);
  const res = await fetchImpl("https://api.upbit.com/v1/ticker?markets=" + encodeURIComponent(market), {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error("upbit HTTP " + res.status);
  return parseUpbit(await res.json());
}

export default { name: "upbit", quote };
