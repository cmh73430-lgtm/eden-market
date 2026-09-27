// 시세 수집: config/sources.json · config/themes.json 에 따라 어댑터를 불러 신호 값으로 바꾼다.
import { kstTime } from "../shared/calendar.js";

const round = (v, d) => Number(v.toFixed(d));

// ^TNX는 수익률×10으로 오는 경우가 있다 (예: 42.5 = 4.25%). 20 넘으면 10으로 나눈다.
export const normalizeYield = (x) => (x > 20 ? x / 10 : x);

export function toSignal(kind, { price, prevClose }) {
  switch (kind) {
    case "pct": return round((price / prevClose - 1) * 100, 2);
    case "diff": return round(price - prevClose, 2);
    case "level": return round(price, 2);
    case "bp": return round(Math.round((normalizeYield(price) - normalizeYield(prevClose)) * 1e6) / 1e4, 1); // 부동소수 오차 정리 후 bp
    default: throw new Error("알 수 없는 kind: " + kind);
  }
}

/**
 * @param {object} opts { sources, themes, adapters: {name: {quote}}, now }
 * @returns {{ signals: {k: {value, src, at, time}}, us: {k: {value, src, at, detail}}, errors: [{key, error}] }}
 */
export async function collectAll({ sources, themes, adapters, now = new Date() }) {
  const at = kstTime(now);
  const out = { signals: {}, us: {}, errors: [] };
  const cache = new Map(); // 같은 심볼 중복 조회 방지

  const get = (srcName, symbol) => {
    const key = srcName + ":" + symbol;
    if (!cache.has(key)) {
      const ad = adapters[srcName];
      cache.set(key, ad ? ad.quote(symbol) : Promise.reject(new Error("어댑터 없음: " + srcName)));
    }
    return cache.get(key);
  };
  // 소스 목록을 순서대로 시도하고 처음 성공한 것을 쓴다 (예: 네이버 → 야후)
  const firstOk = async (list) => {
    const errs = [];
    for (const c of list) {
      try { return { q: await get(c.source, c.symbol), c }; }
      catch (e) { errs.push(String(e.message || e)); }
    }
    throw new Error(errs.join(" / ") || "소스 없음");
  };
  const asList = (c) => (Array.isArray(c) ? c : [c]);

  const sigJobs = Object.entries(sources.signals || {}).map(async ([k, conf]) => {
    try {
      const { q, c } = await firstOk(asList(conf));
      out.signals[k] = { value: toSignal(c.kind, q), src: c.source, at, time: q.time || null, ...(q.detail ? { detail: q.detail } : {}) };
    } catch (e) {
      out.errors.push({ key: k, error: String(e.message || e) });
    }
  });

  const themeSrcs = [].concat(sources.themeSource || "yahoo");
  const themeJobs = (themes.themes || []).map(async (t) => {
    const results = await Promise.allSettled(t.symbols.map((s) => firstOk(themeSrcs.map((source) => ({ source, symbol: s })))));
    const detail = {};
    const vals = [];
    const used = new Set();
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        const v = toSignal("pct", r.value.q);
        detail[t.symbols[i]] = v;
        vals.push(v);
        used.add(r.value.c.source);
      }
    });
    if (vals.length) {
      out.us[t.key] = { value: round(vals.reduce((a, b) => a + b, 0) / vals.length, 2), src: [...used].join("+"), at, detail };
    } else {
      const err = results.find((r) => r.status === "rejected");
      out.errors.push({ key: "us." + t.key, error: String((err && err.reason && err.reason.message) || err?.reason || "실패") });
    }
  });

  await Promise.all([...sigJobs, ...themeJobs]);
  return out;
}

// 수집 결과를 날짜 레코드에 합친다. 사용자가 손으로 넣은 값(src: manual)은 덮어쓰지 않는다.
export function mergeCollected(rec, got) {
  rec.signals = rec.signals || {};
  rec.sources = rec.sources || {};
  rec.us = rec.us || {};
  rec.usSources = rec.usSources || {};
  for (const [k, s] of Object.entries(got.signals)) {
    if (rec.sources[k] && rec.sources[k].src === "manual") continue;
    rec.signals[k] = s.value;
    rec.sources[k] = { src: s.src, at: s.at, time: s.time };
  }
  for (const [k, s] of Object.entries(got.us)) {
    if (rec.usSources[k] && rec.usSources[k].src === "manual") continue;
    rec.us[k] = s.value;
    rec.usSources[k] = { src: s.src, at: s.at, detail: s.detail };
  }
  rec.collectErrors = got.errors;
  return rec;
}
