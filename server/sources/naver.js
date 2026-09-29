// 네이버증권(Npay 증권) 어댑터 — 모바일 웹이 쓰는 JSON 주소를 읽는다 (비공식, 개인 용도).
// 어댑터 규약: quote(symbol) → Promise<{ price, prevClose, time }>
//
// symbol 형식
//   index:.SOX                       해외지수 (.SOX .VIX .NDX ...)
//   futures:NQcv1                    해외지수선물
//   stock:NVDA                       미국 주식·ETF (거래소 접미사는 검색으로 자동 확인: NVDA → NVDA.O)
//   market:exchange:FX_USDKRW        시장지표 (환율·원자재·채권)  market:<category>:<reutersCode>
//   domestic:KPI200                  국내 지수
// 야후식 심볼(GC=F, HG=F, NVDA ...)도 받는다 (config/themes.json 을 그대로 쓰기 위해).

const API = "https://api.stock.naver.com";
const M = "https://m.stock.naver.com";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// 야후식 심볼 → 네이버 심볼
export const ALIASES = {
  "NQ=F": "futures:NQcv1", "ES=F": "futures:EScv1",
  "^SOX": "index:.SOX", "^VIX": "index:.VIX", "^NDX": "index:.NDX", "^GSPC": "index:.INX",
  "KRW=X": "market:exchange:FX_USDKRW",
  "CL=F": "market:energy:CLcv1", "GC=F": "market:metals:GCcv1", "HG=F": "market:metals:HGcv1",
  "^TNX": "market:bond:US10YT=RR",
};

const num = (s) => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// 전일 대비 값에 부호가 빠져 있어도 하락(code 5, 4)이면 음수로
const signed = (v, type) => {
  if (v === null) return null;
  const falling = type && (type.name === "FALLING" || type.name === "LOWER_LIMIT" || type.code === "5" || type.code === "4");
  return falling && v > 0 ? -v : v;
};

// 응답 JSON → {price, prevClose, time}
export function parseNaver(json) {
  const d = json && json.result && typeof json.result === "object" && !Array.isArray(json.result) ? json.result
    : json && Array.isArray(json.datas) ? json.datas[0] : json;
  if (!d || typeof d !== "object") throw new Error("naver: 응답 형식 이상");
  const price = num(d.closePriceRaw ?? d.closePrice);
  const type = d.compareToPreviousPrice || d.fluctuationsType;
  const change = signed(num(d.compareToPreviousClosePriceRaw ?? d.compareToPreviousClosePrice ?? d.fluctuations), type);
  if (price === null || change === null) throw new Error("naver: 가격 없음" + (d.message ? " (" + d.message + ")" : ""));
  const prevClose = price - change;
  if (prevClose === 0) throw new Error("naver: 기준가 0");
  const amount = tradeEok(d);
  return amount === null ? { price, prevClose, time: d.localTradedAt || null } : { price, prevClose, time: d.localTradedAt || null, amount };
}

// 누적 거래대금 → 억원. Raw 는 원 단위, 아니면 단위가 응답마다 달라서(지수는 백만원) 코스피·코스닥 하루 거래대금으로 그럴듯한 값(1천억~300조)을 고른다
export function tradeEok(d) {
  const raw = num(d.accumulatedTradingValueRaw);
  if (raw !== null && raw > 0) return Math.round(raw / 1e8);
  const v = num(d.accumulatedTradingValue);
  if (v === null || v <= 0) return null;
  const hit = [v / 100, v / 1e8, v].find((x) => x >= 1000 && x <= 3000000);
  return hit === undefined ? null : Math.round(hit);
}

async function getJson(url, fetchImpl, timeoutMs) {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: M + "/" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json()).message || ""; } catch {}
    throw new Error("naver HTTP " + res.status + (msg ? " " + msg : ""));
  }
  return res.json();
}

// 미국 티커 → 네이버 reutersCode (NVDA → NVDA.O, GEV → GEV). 한 번 찾으면 기억한다.
const codeCache = new Map();
export async function resolveStock(ticker, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (/\.[A-Z]{1,2}$/.test(ticker)) return ticker;
  if (codeCache.has(ticker)) return codeCache.get(ticker);
  const j = await getJson(M + "/front-api/search/autoComplete?query=" + encodeURIComponent(ticker) + "&target=stock", fetchImpl, timeoutMs);
  const items = (j.result && j.result.items) || [];
  const hit = items.find((i) => i.code === ticker && i.nationCode === "USA") || items.find((i) => i.code === ticker);
  if (!hit) throw new Error("naver: 종목 코드 못 찾음 " + ticker);
  codeCache.set(ticker, hit.reutersCode);
  return hit.reutersCode;
}

export function urlFor(sym) {
  const [kind, a, b] = sym.split(":");
  const e = encodeURIComponent;
  switch (kind) {
    case "index": return API + "/index/" + e(a) + "/basic";
    case "futures": return API + "/futures/" + e(a) + "/basic";
    case "stock": return API + "/stock/" + e(a) + "/basic";
    case "market": return M + "/front-api/marketIndex/productDetail?category=" + e(a) + "&reutersCode=" + e(b);
    case "domestic": return "https://polling.finance.naver.com/api/realtime/domestic/index/" + e(a);
    default: throw new Error("naver: 알 수 없는 심볼 " + sym);
  }
}

export async function quote(symbol, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (/-USD$|-KRW$/.test(symbol)) throw new Error("naver: 가상자산 미지원 " + symbol);
  let sym = ALIASES[symbol] || symbol;
  if (!sym.includes(":")) sym = "stock:" + sym;
  if (sym.startsWith("stock:")) sym = "stock:" + (await resolveStock(sym.slice(6), { fetchImpl, timeoutMs }));
  return parseNaver(await getJson(urlFor(sym), fetchImpl, timeoutMs));
}

export default { name: "naver", quote };
