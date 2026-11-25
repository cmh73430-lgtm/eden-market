// 9.29-180 디렉터 「finviz.com/map?t=sec_all 여기서도 연동할건해」→「자동받기해」: Finviz 미국 업종 지도 값 자동 받기
// ① 지도 화면(map?t=sec_all)에서 구조 파일 주소(data-chunk-id="map_base_sec_all") → 그 파일 안 업종 나무(섹터 > 업종 > 종목 · value = 시총)
// ② 등락 = finviz.com/api/map_perf?t=sec_all&st=d1 (전체 종목 → 전일 대비 % · 화면 sec_all 과 같음) · robots.txt 막힘 목록에 없음(2026-11-25 실측) · 차단 장치 우회 0(평범한 요청 2~3회)
// ③ 섹터·업종 등락 = 시총 가중 평균 · 결과 auto/us-map.json (앱 ② 뉴욕증시 카드가 읽음) · 남의 코드 실행 0(구조 파일은 글자로만 읽어 JSON 으로 바꿈)
// 사용: node scripts/us-map.mjs [--dir=<eden-market>] [--dry]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const DIR = args.dir || process.cwd();
const UA = { "User-Agent": "Mozilla/5.0", Referer: "https://finviz.com/map?t=sec_all" };
async function get(url, json) { let e; for (let i = 0; i < 3; i++) { try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status); return json ? await r.json() : await r.text(); } catch (x) { e = x; await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); } } throw e; }

// 구조 파일 글자 → 섹터 배열(JSON) : 섹터 이름 하나를 찾아 감싼 [ ] 를 괄호 짝으로 잘라 키에 따옴표
export function parseTree(js) {
  const SECT = ["Technology", "Financial", "Healthcare", "Consumer Cyclical", "Communication Services", "Industrials", "Energy", "Basic Materials", "Consumer Defensive", "Real Estate", "Utilities"];
  const at = SECT.map((s) => js.indexOf('{name:"' + s + '",children:[')).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return null;
  let s = at; while (s > 0 && js[s] !== "[") s--;
  let d = 0, e = s; for (; e < js.length; e++) { const c = js[e]; if (c === '"') { e++; while (e < js.length && js[e] !== '"') { if (js[e] === "\\") e++; e++; } continue; } if (c === "[" || c === "{") d++; else if (c === "]" || c === "}") { d--; if (d === 0) break; } }
  const lit = js.slice(s, e + 1).replace(/([{,])(name|description|value|children):/g, '$1"$2":');
  try { const a = JSON.parse(lit); return Array.isArray(a) && a.length >= 5 ? a : null; } catch (x) { return null; }
}
// 나무 + 등락(종목→%) → 섹터·업종 시총 가중 평균
export function aggregate(tree, perf) {
  const r1 = (x) => Math.round(x * 100) / 100;
  const sectors = [], industries = [], movers = [];
  for (const sec of tree) {
    let sw = 0, sv = 0;
    for (const ind of sec.children || []) {
      let w = 0, v = 0, n = 0;
      for (const t of ind.children || []) { const p = perf[t.name]; if (typeof p === "number" && t.value > 0) { w += t.value; v += t.value * p; n++; if (t.value >= 200000) movers.push({ t: t.name, d: t.description, sec: sec.name, rate: r1(p), cap: t.value }); } }
      if (w > 0) { industries.push({ sec: sec.name, name: ind.name, rate: r1(v / w), n }); sw += w; sv += v; }
    }
    if (sw > 0) sectors.push({ name: sec.name, rate: r1(sv / sw) });
  }
  sectors.sort((a, b) => b.rate - a.rate); industries.sort((a, b) => b.rate - a.rate);
  return { sectors, indUp: industries.slice(0, 8), indDn: industries.slice(-8).reverse(), bigUp: movers.sort((a, b) => b.rate - a.rate).slice(0, 6), bigDn: movers.slice(-6).reverse(), industriesN: industries.length };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/^\//, "")}` || process.argv[1].endsWith("us-map.mjs")) {
  const page = await get("https://finviz.com/map?t=sec_all");
  const m = /href="([^"]+)"\s+data-chunk-id="map_base_sec_all"/.exec(page) || /data-chunk-id="map_base_sec_all"[^>]*href="([^"]+)"/.exec(page);
  if (!m) { console.error("구조 파일 주소 못 찾음(화면 꼴 바뀜) — 저장 안 함"); process.exit(1); }
  const tree = parseTree(await get(new URL(m[1], "https://finviz.com").href));
  if (!tree) { console.error("업종 나무 못 읽음 — 저장 안 함"); process.exit(1); }
  const perf = await get("https://finviz.com/api/map_perf?t=sec_all&st=d1", true);
  const nodes = perf && perf.nodes; if (!nodes || Object.keys(nodes).length < 300) { console.error("등락 자료 이상 — 저장 안 함"); process.exit(1); }
  const kst = new Date(Date.now() + 9 * 3600e3).toISOString();
  const out = { app: "jangjeon-cockpit", kind: "us-map", v: 1, date: kst.slice(0, 10), at: kst.slice(11, 16), src: "Finviz 미국 업종 지도(전일 대비 · 시총 가중)", tickers: Object.keys(nodes).length, ...aggregate(tree, nodes), updatedAt: Date.now() };
  console.log(`Finviz ${out.date} ${out.at} · 종목 ${out.tickers} · 업종 ${out.industriesN} · 섹터: ${out.sectors.map((s) => s.name + " " + s.rate + "%").join(" / ")}`);
  if (args.dry) { console.log("(--dry: 저장 안 함)"); process.exit(0); }
  const f = join(DIR, "auto/us-map.json"); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(out)); console.log("저장: auto/us-map.json");
}
