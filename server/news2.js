// 주도 테마 「왜 강한지」 뉴스 v2 — 9.29-84 원장 [1597] 「강한 근거만」 · [1581] 「검증된 뉴스 3개 이상」 · 연구 R3 보고 §3 점수제 v2(probe/score.py) 를 수집기로 이식
// 기존 live.themes[].news(대장주 피드 제목 매칭 2건)는 그대로 두고, 같은 테마 줄에 news2 블록을 더한다. 순수 함수 + 요청 함수 주입(get/getText/post). 실패는 조용히 폴백(errors 기록).
//
//  후보: 대장주·2등주 종목뉴스(현행과 같은 주소 → memoGet 이면 추가 요청 0 · body 포함) + 네이버 증권 뉴스 검색 API(날짜 필터 · 테마 핵심어 1회 + 대장주명 1회)
//      + 공시: DART todayRSS(키 없음) · KIND 당일 공시(POST) — run 마다 1회씩 공유 · 키가 필요한 DART OpenAPI 는 안 쓴다
//  점수(제목 기준): 종목명 제목 +2 / body 에만 +1 · 테마 핵심어 +1 · 업종어(79업종 별칭) 또는 테마 설명 빈출어 +1 · 인과어 +1 · 테마 종목 2개↑ +1 · 공시·계약 낱말 +1(근거어 있을 때만)
//      시간창 밖(오늘 장전 08:00 이전 · 전일 15:30 이전) = 최대 1점 · 종목명·테마어·업종어 전부 0 = 최대 1점(오탐 보정)
//  등급: 상 ≥4 · 중 2~3 · 하 ≤1. 검증 = 상 또는 (중 + 인과어) ← 디렉터 답 「강한 근거만」. 같은 사건 = 제목 토큰(2글자↑) 교집합 3개↑ → 하나로 묶고 출처 수 표시
//  표시: 검증(묶음+사업 공시) ≥ 3 → 「검증 뉴스 N건」 + 목록(출처·시각·링크) · 미만 → 「검증 뉴스 N개 · 이유 확인 중」 · 검증 묶음에 테마어 든 기사 0 → 「테마명 불일치 — 대장주 이유: …」 · 거래소 강세 신호 공시는 건수 밖 「⚡강세 신호」 1줄 ([1600])
//  비용: 테마 3개 × 검색 2 + DART 1 + KIND 1 = 8회/run (+ 첫 run 업종 2×3 + 업종표 1 = 7 · 하루 캐시) · 하루 상한 NEWS2_DAILY_MAX 넘으면 검색·공시 생략(종목뉴스 채점만)
export const NEWS2_V = 1;
export const NEWS2_DAILY_MAX = 900;   // 하루 추가 요청 상한 (5분 run 약 80회 × 8 = 640 + 캐시 7 → 여유 포함 900). 넘으면 네이버 검색·DART·KIND 를 안 부른다
export const NEWS2_VERIFY_MIN = 3, NEWS2_SHOW = 3, NEWS2_SEARCH_PAGE = 30, NEWS2_FEED_PAGE = 15;
export const NEWS2_WINDOW_START = "08:00"; // 오늘 기사 시작(장전 뉴스 포함) · 전날은 15:30 뒤만
export const CAUSAL = ["강세", "급등", "상한가", "수혜", "날았다", "훨훨", "불붙", "들썩", "폭등", "줄상승", "동반 상승", "뭉칫돈", "견인", "훈풍", "급등주", "랠리", "몰린다", "흔든다", "리밸런싱", "신고가", "질주", "껑충", "치솟", "강세장"];
export const DISC_WORDS = ["공급계약", "수주", "유상증자", "실적", "계약", "공급", "납품"]; // 「공급」·「납품」 추가: 10/6 블로터 「삼성전기에 245억 MSVP 장비 공급」 처럼 계약 낱말 없이 쓰는 제목 (종목명·테마어가 있을 때만 +1)
// 공시 분류 (원장 [1600]): 거래소 「강하다는 사실」 신호(가격제한폭 확대·단기과열·공매도 과열·투자주의/경고/위험·이상 급등·시황 변동)는 검증 뉴스 건수에서 빼고 「⚡강세 신호」 줄로 따로 · 사업 공시(공급계약·수주·실적·증자·합병·특허·승인 …)만 검증 인정
export const DISC_SIGNAL_RE = /가격제한폭|단기과열|공매도\s*과열|투자주의|투자경고|투자위험|이상\s*급등|현저한\s*시황|시황\s*변동|소수\s*계좌|소수\s*지점/;
export const DISC_BIZ_RE = /공급계약|수주|실적|잠정|유상증자|무상증자|합병|분할|특허|승인|허가|조회공시|풍문|최대주주|자기주식|계약|투자판단|영업\s*정지|생산\s*재개|임상|품목/;
export const DISC_RE = new RegExp(DISC_SIGNAL_RE.source + "|" + DISC_BIZ_RE.source); // 둘 다 아니면 공시는 안 씀(본점 이전·소유 보고 등)
export const discKind = (title) => (DISC_SIGNAL_RE.test(String(title || "")) ? "signal" : DISC_BIZ_RE.test(String(title || "")) ? "disc" : null);
// 네이버 79업종 → 기사에서 쓰는 별칭 (R3 IND_ALIAS 8개 + 업종명 그대로). 나머지 업종은 이름 그대로 매칭
export const IND_ALIAS = { "반도체와반도체장비": ["반도체", "반도체장비", "소부장"], "석유와가스": ["석유", "정유", "유가"], "전자장비와기기": ["전자장비", "전자부품"], "우주항공과국방": ["우주항공", "국방", "방산"], "소프트웨어": ["소프트웨어", "SW"], "통신장비": ["통신장비"], "전기제품": ["전기제품"], "전자제품": ["전자제품", "가전"], "제약": ["제약", "신약"], "생물공학": ["바이오"], "건설": ["건설"], "조선": ["조선"], "화학": ["화학"], "철강": ["철강"], "은행": ["은행"], "증권": ["증권"], "보험": ["보험"], "게임엔터테인먼트": ["게임"], "디스플레이패널": ["디스플레이", "OLED"], "디스플레이장비및부품": ["디스플레이", "OLED"] };
export const STOP = new Set("있음 있는 위한 통해 등을 등의 대한 관련 것이 것으로 업체 업체들 사업 기술 시장 제품 산업 분야 가능 특징 주목 기대 확대 활용 다양한 기존 대비 관련주 테마 기타 대표 수혜 개선 양적 질적 부품 소재 장비 개발 제조 제작 생산 주요 서비스 공급 영위 기반 솔루션 제공 플랫폼 핵심 글로벌 국내 세계 보유 진행 중심 분야별".split(" ")); // 뒤쪽은 편입 사유(themeItemInfoMap) 빈출 일반어 — 설명어로 쓰면 아무 기사나 맞아서 뺌
const JOSA = /(은|는|이|가|을|를|의|로|과|와|에|도)$/;
export const unent = (x) => String(x ?? "").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&middot;/g, "·").replace(/&hellip;/g, "…").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");

// 테마 핵심어: 이름·합쳐진 이름의 괄호 앞 전체 + 구분자로 자른 조각(2글자↑ · 일반어 제외). 종목명은 따로(names)
export function coreWords(names = []) {
  const w = new Set();
  for (const nm of names) {
    const head = String(nm || "").split(/[(（]/)[0].trim(); if (head.length >= 2 && !STOP.has(head)) w.add(head);
    for (const p of String(nm || "").split(/[()（）/·,\s]+/)) { const x = p.trim(); if (x.length >= 2 && !STOP.has(x)) { w.add(x); if (x.length >= 3 && /[주株]$/.test(x)) w.add(x.slice(0, -1)); } } // 보안주 → 보안
  }
  return [...w];
}
// 종목명 + 축약형(6글자↑ 이름은 앞 4글자 — 「SK이노베이션」→「SK이노」 · 「나라스페이스테크놀로지」→「나라스페」 는 못 잡으므로 앞 6글자도)
export function stockNames(names = []) {
  const out = new Set();
  for (const n of names) { const s = String(n || "").trim(); if (s.length < 2) continue; out.add(s); if (s.length >= 6) { out.add(s.slice(0, 4)); out.add(s.slice(0, 6)); } }
  return [...out];
}
// 테마 설명(themeDescription) 빈출어: 2~6글자 · 조사 떼기 · 2번 이상 나온 것 상위 12
export function descWords(text) {
  const freq = {};
  for (let x of String(text || "").match(/[가-힣A-Za-z]{2,6}/g) || []) { if (x.length > 2) x = x.replace(JOSA, ""); if (x.length >= 2 && !STOP.has(x)) freq[x] = (freq[x] || 0) + 1; }
  return Object.entries(freq).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 12);
}
export const industryWords = (indNames = []) => [...new Set(indNames.filter(Boolean).flatMap((i) => IND_ALIAS[i] || [i]))];
// 테마 상세의 설명(themeDescription) + 종목별 편입 사유(themeItemInfoMap · R3 ②d 「왜 소속」) 를 한 글로 — 설명어 빈출 계산용
export const themeText = (detail) => (detail ? [detail.themeDescription || "", ...Object.values(detail.themeItemInfoMap || {}).map((v) => (typeof v === "string" ? v : (v && (v.reason || v.text || v.description)) || ""))].join(" ") : "");

// 기사 한 건 { t 제목, b 요약, dt YYYYMMDDHHmm, of 매체, url, src }
export function feedArticles(json, src = "종목뉴스") {
  const items = (Array.isArray(json) ? json : []).flatMap((g) => (g && Array.isArray(g.items) ? g.items : []));
  return items.filter((x) => x && (x.title || x.titleFull)).map((x) => ({ t: unent(x.titleFull || x.title).trim(), b: unent(x.body || "").trim(), dt: String(x.datetime || ""), of: x.officeName || null, url: x.mobileNewsUrl || (x.officeId && x.articleId ? "https://n.news.naver.com/mnews/article/" + x.officeId + "/" + x.articleId : null), src }));
}
export function searchArticles(json) {
  const items = json && Array.isArray(json.items) ? json.items : [];
  return items.filter((x) => x && (x.title || x.titleFull)).map((x) => ({ t: unent(x.titleFull || x.title).trim(), b: unent(x.body || "").trim(), dt: String(x.datetime || ""), of: x.officeName || null, url: x.officeId && x.articleId ? "https://n.news.naver.com/mnews/article/" + x.officeId + "/" + x.articleId : null, src: "검색" }));
}
export const searchUrl = (query, ymd, page = NEWS2_SEARCH_PAGE) => "https://stock.naver.com/api/domestic/news/search?query=" + encodeURIComponent(query) + "&page=1&pageSize=" + page + "&startDate=" + ymd + "&endDate=" + ymd;
export const feedUrl = (code) => "https://m.stock.naver.com/api/news/stock/" + code + "?pageSize=" + NEWS2_FEED_PAGE; // 현행 fetchNews(words 있을 때)와 같은 주소 → memoGet 이면 추가 요청 0
export const integrationUrl = (code) => "https://m.stock.naver.com/api/stock/" + code + "/integration";
export const INDUSTRY_LIST_URL = "https://m.stock.naver.com/api/stocks/industry?page=1&pageSize=100";
export const DART_RSS_URL = "https://dart.fss.or.kr/api/todayRSS.xml";
export const KIND_URL = "https://kind.krx.co.kr/disclosure/todaydisclosure.do";
export const kindBody = (ymd) => "method=searchTodayDisclosureSub&currentPageSize=700&pageIndex=1&orderMode=0&orderStat=D&forward=todaydisclosure_sub&chose=S&todayFlag=N&selDate=" + ymd + "&marketType=";

// 공시: DART RSS → [{ t "(코스닥)회사 - 보고서명", company, title, dt(KST YYYYMMDDHHmm), url, src:"DART" }]
export function dartItems(xml) {
  const out = [];
  for (const m of String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const g = (tag) => { const r = m[1].match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">")); return r ? unent(r[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : ""; };
    const title = g("title"), mm = title.match(/^\(([^)]*)\)\s*(.+?)\s+-\s+(.+)$/);
    const pub = Date.parse(g("pubDate")); const dt = Number.isFinite(pub) ? new Date(pub + 9 * 3600e3).toISOString().replace(/[-T:]/g, "").slice(0, 12) : "";
    out.push({ t: title, company: mm ? mm[2].trim() : "", title: mm ? mm[3].trim() : title, market: mm ? mm[1] : "", dt, url: g("link") || null, of: "DART", src: "DART" });
  }
  return out;
}
// 공시: KIND 당일 공시 HTML → [{ company, title, dt, url, src:"KIND" }] (시각 HH:MM · 회사 title='…' · 보고서 openDisclsViewer('번호') title='…')
export function kindItems(html, ymd) {
  const out = [];
  for (const m of String(html || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1], tm = row.match(/<td class="first txc">\s*(\d\d:\d\d)\s*<\/td>/), co = row.match(/companysummary_open\([^)]*\)[^>]*title='([^']*)'/), rp = row.match(/openDisclsViewer\('(\d+)'[^>]*title='([^']*)'/);
    if (!tm || !rp) continue;
    out.push({ company: unent((co ? co[1] : "")).trim(), title: unent(rp[2]).trim(), t: unent((co ? co[1] : "") + " " + rp[2]).trim(), dt: ymd + tm[1].replace(":", ""), url: "https://kind.krx.co.kr/common/disclsviewer.do?method=search&acptno=" + rp[1], of: "KIND", src: "KIND" });
  }
  return out;
}
// 테마 종목에 대한 공시만 (회사명 일치 · 유형 필터)
export function pickDisclosures(items, allNames, win) {
  const names = new Set((allNames || []).map((n) => String(n).replace(/\s+/g, "")));
  const out = [];
  for (const d of items || []) {
    const kind = discKind(d.title);
    if (!(kind && d.company && names.has(String(d.company).replace(/\s+/g, "")) && inWindow(d, win))) continue;
    const title = d.company + " " + d.title, dup = out.find((x) => x.title === title); // 같은 공시가 DART·KIND 양쪽에 → 하나로(출처 2)
    if (dup) { if (!dup.srcs.includes(d.of)) { dup.srcs.push(d.of); dup.srcN++; } continue; }
    out.push({ kind, title, at: fmtAt(d.dt), office: d.of, url: d.url, grade: kind === "signal" ? "신호" : "공시", pts: kind === "signal" ? 0 : 4, srcN: 1, srcs: [d.of] });
  }
  return out;
}

// 시간창 { day: YYYYMMDD, prev: YYYYMMDD(직전 거래일), from: 분, to: 분 } — 오늘은 08:00~판정 시각(+10분 여유) · 전날은 15:30 뒤
export function windowOf(day8, prev8, hm) {
  const to = hm && /^\d\d:\d\d/.test(hm) ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + 10 : 24 * 60;
  return { day: day8, prev: prev8, from: 8 * 60, to };
}
const hhmm = (dt) => (dt && dt.length >= 12 ? Number(dt.slice(8, 10)) * 60 + Number(dt.slice(10, 12)) : null);
export function inWindow(a, win) {
  const d = (a.dt || "").slice(0, 8), m = hhmm(a.dt);
  if (m === null) return false;
  if (d === win.day) return win.from <= m && m <= win.to;
  if (d === win.prev) return m >= 15 * 60 + 30;
  return false;
}
export const fmtAt = (dt) => (dt && dt.length >= 12 ? dt.slice(0, 4) + "-" + dt.slice(4, 6) + "-" + dt.slice(6, 8) + " " + dt.slice(8, 10) + ":" + dt.slice(10, 12) : null);

// 점수 (R3 score.py v2 그대로) → { grade, pts, why, causal, themed }
export function scoreArticle(a, { names = [], words = [], indWords = [], descW = [], allNames = [], win }) {
  const t = a.t || "", b = a.b || ""; let pts = 0; const why = [];
  const nm = names.filter((n) => t.includes(n)), nmb = names.filter((n) => !nm.includes(n) && b.includes(n));
  if (nm.length) { pts += 2; why.push("종목명:" + nm.slice(0, 2).join("/")); } else if (nmb.length) { pts += 1; why.push("종목명(body):" + nmb.slice(0, 2).join("/")); }
  const tw = words.filter((w) => t.includes(w)); if (tw.length) { pts += 1; why.push("테마어:" + tw.slice(0, 2).join("/")); }
  const iw = indWords.filter((w) => t.includes(w)), dw = descW.filter((w) => t.includes(w) && !tw.includes(w)); if (iw.length || dw.length) { pts += 1; why.push("업종/설명어:" + [...iw, ...dw].slice(0, 2).join("/")); }
  const cz = CAUSAL.filter((c) => t.includes(c)); if (cz.length) { pts += 1; why.push("인과어:" + cz.slice(0, 2).join("/")); }
  const multi = allNames.filter((n) => n && t.includes(n)); if (multi.length >= 2) { pts += 1; why.push("테마종목2+:" + multi.slice(0, 3).join("/")); }
  if (DISC_WORDS.some((w) => t.includes(w)) && (nm.length || tw.length || iw.length || dw.length)) { pts += 1; why.push("공시/계약"); }
  if (win && !inWindow(a, win)) { pts = Math.min(pts, 1); why.push("시간창밖"); }
  if (!(nm.length || nmb.length || tw.length || iw.length || dw.length)) { pts = Math.min(pts, 1); why.push("근거어0"); }
  return { grade: pts >= 4 ? "상" : pts >= 2 ? "중" : "하", pts, why, causal: cz.length > 0, themed: tw.length > 0, ind: [...iw, ...dw], indHit: iw, descHit: dw };
}
export const verified = (s) => s.grade === "상" || (s.grade === "중" && s.causal); // 디렉터 답 「강한 근거만」
// 불일치 이유 = 검증(상/중+인과어) 기사들이 제목에서 실제로 맞춘 업종어·설명어 가운데 빈도 최다 (gate-cockpit84: 첫 슬롯 업종어로 고르면 전고체 → 「전자장비」(정답 정유) 로 틀림).
//  맞춘 업종어가 하나도 없으면 가장 점수 높은 검증 기사 제목(예: OLED 10/6 「LG전자, 북미 AIDC 냉각장치 공급계약에 급등」)
export function mismatchReason(ver) {
  const pick = (key) => { const freq = new Map(), pts = new Map();
    for (const r of ver) for (const w of new Set((r.s[key] || []))) { freq.set(w, (freq.get(w) || 0) + 1); pts.set(w, (pts.get(w) || 0) + r.s.pts); }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || pts.get(b[0]) - pts.get(a[0]) || b[0].length - a[0].length)[0]; return top ? top[0] : null; }; // 동률이면 점수 합 → 더 긴(구체적) 낱말
  const w = pick("indHit") || pick("descHit"); // 업종어(79업종 별칭) 먼저 · 없으면 테마 설명·편입 사유 빈출어 (OLED 10/6: 「차세대」 같은 설명어보다 「소부장」 업종어가 이유에 가깝다)
  if (w) return w;
  const best = ver[0]; return best ? best.a.t.slice(0, 48) : "";
}
const tokens = (t) => new Set(String(t).match(/[가-힣A-Za-z0-9]{2,}/g) || []);
// 같은 사건 묶기: 제목 토큰 교집합 3개↑ → 한 묶음. rows 는 점수 높은 순으로 들어온다 (대표 = 첫 행)
export function groupArticles(rows) {
  const groups = [];
  for (const r of rows) {
    const k = tokens(r.a.t); let hit = null;
    for (const g of groups) { let c = 0; for (const x of k) if (g.k.has(x)) c++; if (c >= 3) { hit = g; break; } }
    if (hit) { hit.rows.push(r); for (const x of k) hit.k.add(x); } else groups.push({ k: new Set(k), rows: [r] });
  }
  return groups;
}
// 채점·묶기·표시까지 (네트워크 0): articles[] · disclosures[](pickDisclosures 결과) → news2 블록
export function verifyNews({ articles = [], disclosures = [], names = [], words = [], indWords = [], descW = [], allNames = [], win }) {
  const seen = new Set(), rows = [];
  for (const a of articles) { if (!a.t || seen.has(a.t)) continue; seen.add(a.t); const s = scoreArticle(a, { names, words, indWords, descW, allNames, win }); rows.push({ a, s }); }
  const ver = rows.filter((r) => verified(r.s)).sort((a, b) => b.s.pts - a.s.pts || (b.a.dt || "").localeCompare(a.a.dt || ""));
  const groups = groupArticles(ver);
  const items = groups.map((g) => { const r = g.rows[0], srcs = [...new Set(g.rows.map((x) => x.a.of).filter(Boolean))]; return { kind: "news", title: r.a.t, at: fmtAt(r.a.dt), office: r.a.of, url: r.a.url, grade: r.s.grade, pts: r.s.pts, why: r.s.why, themed: r.s.themed, ind: r.s.ind, srcN: g.rows.length, srcs }; });
  const biz = disclosures.filter((d) => d.kind !== "signal"), signals = disclosures.filter((d) => d.kind === "signal").map((d) => ({ title: d.title, at: d.at, office: d.office, url: d.url, srcs: d.srcs })); // 강세 신호는 건수 밖 · 따로 1줄 ([1600])
  const all = [...biz, ...items].sort((a, b) => b.pts - a.pts || String(b.at || "").localeCompare(String(a.at || "")));
  const n = all.length, themed = items.some((x) => x.themed), mismatch = items.length > 0 && !themed;
  let label = n >= NEWS2_VERIFY_MIN ? "검증 뉴스 " + n + "건" : "검증 뉴스 " + n + "개 · 이유 확인 중";
  let reason = null;
  if (mismatch) { reason = mismatchReason(ver); label += " · 테마명 불일치 — 대장주 이유: " + reason; }
  return { v: NEWS2_V, n, nWithSignals: n + signals.length, label, mismatch, reason, verified: ver.length, candidates: rows.length, items: all.slice(0, Math.max(NEWS2_SHOW, Math.min(n, 5))), signals, low: rows.filter((r) => r.s.grade === "하").length };
}

// ---- 요청까지 (collectLive 가 테마마다 부른다) ----
// get(url)=json · getText(url)=text · post(url, body)=text — memoGet 으로 싸서 넘기면 종목뉴스·테마 상세는 현행과 공유
// cache = { date, industry: { code: 업종명 }, industryList: { no: name } } (하루) · shared = { dart: items|null, kind: items|null } (run 안 공유) · budget = { date, used }
export async function fetchNews2({ get, getText = null, post = null, theme, detail = null, date, prevDate, hm = null, cache = null, shared = {}, budget = null } = {}) {
  const day8 = String(date).replace(/-/g, ""), prev8 = String(prevDate || "").replace(/-/g, ""), win = windowOf(day8, prev8, hm), errors = []; let requests = 0;
  const c = cache && cache.date === date ? cache : { date, industry: {}, industryList: null };
  const b = budget && budget.date === date ? budget : { date, used: 0 };
  const canSpend = () => b.used < NEWS2_DAILY_MAX;
  const spend = async (fn, what) => { if (!canSpend()) { errors.push("하루 상한 — " + what + " 생략"); return null; } try { requests++; b.used++; return await fn(); } catch (e) { errors.push(what + ": " + (e.message || e)); return null; } };
  const slots = (theme.slots || []).slice(0, 2), leadNames = slots.map((s) => s.name);
  const names = stockNames(leadNames), words = coreWords([theme.name, ...(theme.alias || [])]);
  const articles = [];
  for (const s of slots) { try { const was = get.has ? get.has(feedUrl(s.code)) : false; const j = await get(feedUrl(s.code)); if (!was) { requests++; } articles.push(...feedArticles(j)); } catch (e) { errors.push("종목뉴스 " + s.name + ": " + (e.message || e)); } }
  const q1 = words[0] || null, q2 = leadNames[0] || null;
  for (const q of [q1, q2].filter(Boolean)) { const j = await spend(() => get(searchUrl(q, day8)), "검색 " + q); if (j) articles.push(...searchArticles(j)); }
  // 업종 (하루 캐시): 종목 integration → industryCode → 업종표
  const inds = [];
  for (const s of slots) {
    if (c.industry[s.code] === undefined) { const j = await spend(() => get(integrationUrl(s.code)), "업종 " + s.name); c.industry[s.code] = j && j.industryCode !== undefined ? String(j.industryCode) : null; }
    if (c.industry[s.code] && !c.industryList) { const j = await spend(() => get(INDUSTRY_LIST_URL), "업종표"); c.industryList = j && Array.isArray(j.groups) ? Object.fromEntries(j.groups.map((g) => [String(g.no), String(g.name || "").trim()])) : {}; }
    const nm = c.industry[s.code] && c.industryList ? c.industryList[c.industry[s.code]] : null; if (nm) inds.push(nm);
  }
  const indWords = industryWords(inds), descW = descWords(themeText(detail)), allNames = detail && Array.isArray(detail.stocks) ? detail.stocks.map((x) => x.stockName).filter(Boolean) : [];
  // 공시 (run 안 공유 · 키 없이 되는 것만)
  if (shared.dart === undefined && getText) shared.dart = await spend(async () => dartItems(await getText(DART_RSS_URL)), "DART RSS");
  if (shared.kind === undefined && post) shared.kind = await spend(async () => kindItems(await post(KIND_URL, kindBody(day8)), day8), "KIND");
  const disclosures = pickDisclosures([...(shared.dart || []), ...(shared.kind || [])], allNames, win);
  const out = verifyNews({ articles, disclosures, names, words, indWords, descW, allNames, win });
  return Object.assign(out, { industry: inds, words: words.slice(0, 4), requests, errors, cache: c, budget: b });
}
