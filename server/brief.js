// 아침 브리핑 (9.29-97 원장 [1775][1779][1780] t일정뉴스) — 「오늘 특별 일정 · 다음 2거래일」 카드 4묶음을 수집기가 규칙으로만 뽑는다 (런타임 LLM 0 · 지어내기 0)
//  ① 📅 한국시장 일정: KIND IR 일정 중 실적·경영실적·컨퍼런스콜만 (청약예정은 fetchListings 의 subs · 달력은 앱이 계산)
//  ② 📢 실적·주요 공시: KIND 당일공시(전날·오늘 POST 2회) · 범위 전날 거래일 15:30 ~ 오늘 08:30 · 코스피200+코스닥150(shared/index_members.json)+주도 테마 종목
//      오탐 제외 = 소유주식변동·임원·주요주주 소유보고·대량보유·담보·증권발행실적보고서·IR 안내 … (빼기 먼저) → 허용 목록(잠정실적·공급계약·증자·자사주·배당·합병 …)만 · [정정]/[기재정정] 은 「정정」 꼬리표
//      news2.js DISC_BIZ_RE 는 안 쓴다 (「실적」「계약」「최대주주」 낱말만 보면 증권발행실적보고서·최대주주등소유주식변동신고서 가 걸림 — 오탐 원인)
//  ③ 🇺🇸 미국 큰 폭: 네이버 NASDAQ·NYSE 시총 상위 100씩(200종목) 중 ±3% 이상 상승 3·하락 3 · 이유 = 네이버 해외 종목 뉴스(로이터 한글) 첫 기사 중 제목 방향어가 실제 등락과 반대가 아닌 것 · 없으면 null(「이유 기사 못 찾음」) · config/themes.json 대응 테마 꼬리표
//  ④ 📰 아침 국내 종목 뉴스: 네이버 mainnews 2쪽 · flashnews · ranknews · 범위 전날 거래일 18:00 ~ 오늘 08:30 · ② 와 같은 종목 범위 · 같은 사건 묶기(groupArticles)
//      점수 = 언론사 수×2 + ranknews +2 + 주도 테마 종목 +1 + 재료어 +1 · 시황 꼬리표 기사는 「시황 1줄」 따로
//  저장: 날짜 파일 최상위 brief (morning 블록 안 금지 — mergeAuto 가 통째로 덮음) · 섹션마다 받은 것만 덮고 실패하면 지난 값 유지 + 시도 시각·오류 · 약 5KB(상한 8KB) · 하루 요청 상한 BRIEF_DAILY_MAX
import { groupArticles, unent } from "./news2.js";

// 하루 상한 60 → 80 (원장 [1802] 범위 확장): 아침 run 1회 = 15 + 관심 후보 뉴스 최대 5 = 20 · 07:05·08:05 = 40 · 09:25 공시 2 · 06:35 run 이 07:00 넘어 늦게 돌면 한 번 더 20 → 62 · 여유 18
// 크기 상한 8KB → 12KB: 공시 「범위 종목 안 전부」(최대 40줄) · 관심 후보 뉴스가 더해짐 (10/8 실제 다시 돌리기 약 7KB) · 넘치면 뉴스부터 줄임
export const BRIEF_V = 1, BRIEF_DAILY_MAX = 80, BRIEF_MAX_BYTES = 12000, DISC_MAX = 40;
export const BRIEF_SECTIONS = ["sched", "disc", "us", "news"];
export const DISC_FROM = "1530", BRIEF_TO = "0830", NEWS_FROM = "1800", US_MOVE = 3, US_N = 3, TITLE_MAX = 40;
export const KIND_DISC_URL = "https://kind.krx.co.kr/disclosure/todaydisclosure.do";
export const kindDiscBody = (ymd) => "method=searchTodayDisclosureSub&currentPageSize=700&pageIndex=1&orderMode=0&orderStat=D&forward=todaydisclosure_sub&chose=S&todayFlag=N&selDate=" + ymd + "&marketType=";
export const KIND_IR_URL = "https://kind.krx.co.kr/corpgeneral/irschedule.do";
export const kindIrBody = (from, to) => "method=searchIRScheduleSub&forward=searchirschedule_sub&currentPageSize=100&pageIndex=1&fromDate=" + from + "&toDate=" + to + "&marketType=";
export const US_RANK_URL = (ex) => "https://api.stock.naver.com/stock/exchange/" + ex + "/marketValue?page=1&pageSize=100";
export const US_NEWS_URL = (rc) => "https://api.stock.naver.com/news/worldStock/" + encodeURIComponent(rc) + "?pageSize=6&page=1";
export const KR_NEWS_URL = (cat, page = 1) => "https://m.stock.naver.com/front-api/news/category?category=" + cat + "&pageSize=50&page=" + page;

const d8 = (d) => String(d || "").replace(/-/g, "");
const cut = (s, n = TITLE_MAX) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const num = (s) => { if (s === null || s === undefined || s === "") return null; const n = Number(String(s).replace(/,/g, "").replace(/^\+/, "")); return Number.isFinite(n) ? n : null; };
// 시간 범위 [from, to] (YYYYMMDDHHmm 12자리 문자열 비교 · 양 끝 포함)
export const briefWindow = (prevKr, date, fromHM) => ({ from: d8(prevKr) + fromHM, to: d8(date) + BRIEF_TO });
export const inWin = (dt, w) => { const x = String(dt || "").slice(0, 12); return x.length === 12 && x >= w.from && x <= w.to; };

// ---- 종목 범위: 코스피200 + 코스닥150 이름 + 주도 테마 종목 이름 (+ 기사에서 흔히 쓰는 줄임말) ----
export const NAME_ALIAS = { "삼성전자": ["삼전"], "SK하이닉스": ["하이닉스", "하닉"], "LG에너지솔루션": ["LG엔솔", "엔솔"], "삼성바이오로직스": ["삼성바이오"], "한화에어로스페이스": ["한화에어로"], "두산에너빌리티": ["두산에너빌"], "NAVER": ["네이버"], "현대차": ["현대자동차"], "S-Oil": ["에쓰오일", "S-OIL"] };
const JOSA_AFTER = "은는이가을를의에도와과로서만";
export function stockIndex(members = null, leadNames = []) {
  const names = new Map(); // 표기 → 대표 이름
  const add = (n, canon) => { const s = String(n || "").trim(); if (s.length >= 2 && !names.has(s)) names.set(s, canon); };
  const ms = members ? [members.kospi200, members.kosdaq150].filter(Boolean).flatMap((g) => Object.values(g.names || {})) : [];
  const lead = new Set((leadNames || []).map((x) => String(x || "").trim()).filter((x) => x.length >= 2));
  for (const n of [...ms, ...lead]) { add(n, n); for (const a of NAME_ALIAS[n] || []) add(a, n); }
  const list = [...names.keys()].sort((a, b) => b.length - a.length);
  return { names, list, lead, has: (n) => names.has(String(n || "").replace(/\s+/g, "").trim()) || names.has(String(n || "").trim()) };
}
// 제목에서 종목 하나 찾기 (긴 이름 먼저) · 3글자 이하 이름은 뒤 글자가 글자·숫자면 안 됨(한글이면 조사만) — 「SK」 가 「SK하이닉스」 에, 「풍산」 이 「풍산홀딩스」 에 걸리지 않게
export function findStock(title, idx) {
  const t = String(title || "");
  for (const v of idx.list) {
    let from = 0, i;
    while ((i = t.indexOf(v, from)) >= 0) {
      const nx = t[i + v.length] || "", pv = t[i - 1] || "";
      const okBefore = !/[A-Za-z0-9]/.test(pv) || !/^[A-Za-z0-9]/.test(v);
      const okAfter = v.length > 3 || !nx || (!/[A-Za-z0-9]/.test(nx) && (!/[가-힣]/.test(nx) || JOSA_AFTER.includes(nx)));
      if (okBefore && okAfter) return idx.names.get(v);
      from = i + 1;
    }
  }
  return null;
}

// ---- ② KIND 당일공시 ----
// 행 → { dt(YYYYMMDDHHmm), co, t, id(acptno), mk(유가증권|코스닥|코넥스), idx[KOSPI200 …] }
export function kindRows(html, ymd) {
  const out = [];
  for (const m of String(html || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1], tm = row.match(/<td class="first txc">\s*(\d\d:\d\d)\s*<\/td>/), co = row.match(/companysummary_open\([^)]*\)[^>]*title='([^']*)'/), rp = row.match(/openDisclsViewer\('(\d+)'[^>]*title='([^']*)'/);
    if (!tm || !rp) continue;
    const alts = [...row.matchAll(/alt='([^']*)'/g)].map((a) => a[1]);
    out.push({ dt: ymd + tm[1].replace(":", ""), co: unent(co ? co[1] : "").trim(), t: unent(rp[2]).trim(), id: rp[1], mk: alts.find((a) => /유가증권|코스닥|코넥스/.test(a)) || "", idx: alts.filter((a) => /KOSPI200|KOSDAQ150/.test(a)) });
  }
  return out;
}
// 낱말 비교는 띄어쓰기를 다 뺀 제목으로 (KIND 제목은 「현금ㆍ현물 배당 결정」「자기주식 처분 결정」「풍문 또는 보도에 대한 해명」처럼 띄어 쓴 것과 붙여 쓴 것이 섞임 — 10/7 실측)
export const DISC_DROP_RE = /소유주식|소유상황|소유보고|대량보유|주요주주특정증권|담보|증권발행실적|발행조건확정|투자설명서|증권신고서|일괄신고|기업설명회|주주총회|감사보고서|사업보고서|분기보고서|반기보고서|첨부정정|첨부추가|공개매수설명서|결과보고|주주명부폐쇄|변경상장|추가상장|참고서류|채무보증|수익증권거래|독립이사|기타시장안내|수시공시의무관련사항/;
// 허용 목록 → 꼬리표 (위에서부터 첫 번째)
export const DISC_KINDS = [
  ["실적", /\(잠정\)실적|잠정실적|매출액또는손익구조|손익구조\d+%|영업실적등에대한전망|결산실적공시예고/],
  ["계약", /공급계약|수주/],
  ["증자·사채", /유상증자결정|무상증자결정|감자결정|전환사채권발행결정|신주인수권부사채권발행결정|교환사채권발행결정/],
  ["자사주", /자기주식취득결정|자기주식처분결정|자기주식소각결정|자기주식취득신탁계약체결결정|주식소각결정/],
  ["배당", /현금ㆍ?현물배당결정|현금배당결정|주식배당결정|분기배당결정|중간배당결정/],
  ["합병·인수", /합병결정|분할결정|주식교환|주식이전|영업양수|영업양도|유형자산양수|유형자산양도|타법인주식및출자증권(취득|양도|처분)결정|공개매수신고서|최대주주변경/],
  ["투자", /신규시설투자|시설외투자/],
  ["주요", /조회공시요구|조회공시답변|풍문또는보도|투자판단관련주요경영사항|장래사업ㆍ?경영계획|품목허가|임상시험|특허권취득|매매거래정지|관리종목|상장폐지|불성실공시|소송등의제기|회생절차|부도발생|영업정지|생산중단/],
];
const FIX_RE = /^\s*\[(기재정정|정정|정정명령부과|발행조건확정)\]\s*/;
export function discClass(title) {
  const raw = String(title || ""), fix = FIX_RE.test(raw), t = raw.replace(FIX_RE, "").replace(/^\s*\((자회사의\s*)?주요경영사항\)\s*/, ""), z = t.replace(/\s+/g, "");
  if (/^\s*\[(첨부정정|첨부추가|첨부)\]/.test(raw) || DISC_DROP_RE.test(z)) return null;
  for (const [k, re] of DISC_KINDS) if (re.test(z)) return { k, fix };
  if (DISC_MARKET_RE.test(z)) return { k: "거래소", fix }; // 9.29-97 범위 확장 원장 [1802] 「주요공시도 마찬가지」 — 빠짐없이 (빼기 목록만 뺌)
  return { k: "기타", fix };
}
export const DISC_MARKET_RE = /공매도과열|가격제한폭|투자주의|투자경고|투자위험|단기과열|매매거래정지예고|시장경보|소수계좌|소수지점|이상급등/;
// 보이는 제목: 머리 [정정] · (공정공시) 류 · 연결재무제표기준 · (자회사·종속회사의 주요경영사항) 빼고 · 「투자판단 관련 주요경영사항(내용)」 은 내용만 · 30자
export function discTitle(t) {
  let x = String(t || "").replace(FIX_RE, "").replace(/\((공정공시|안내공시|자율공시)\)/g, "").replace(/\((자회사|종속회사)의\s*주요경영사항\)/g, "").replace(/^\s*\((자회사의\s*)?주요경영사항\)\s*/, "").replace(/연결재무제표기준|연결재무제표/g, "").trim();
  const m = x.match(/^투자판단\s*관련\s*주요경영사항\s*\((.+)\)$/); if (m) x = m[1];
  return cut(x.replace(/단일판매ㆍ?공급계약체결/, "공급계약 체결").replace(/ㆍ/g, "·").trim(), 30);
}
export function pickDisc(rows, idx, win, max = DISC_MAX) {
  const seen = new Set(), out = [];
  for (const r of rows || []) {
    if (!inWin(r.dt, win)) continue;
    const c = discClass(r.t); if (!c) continue;
    const member = idx.has(r.co) || (r.idx || []).length > 0; if (!member) continue;
    const key = r.co + "|" + r.t.replace(FIX_RE, ""); if (seen.has(key)) continue; seen.add(key);
    out.push({ dt: r.dt, co: r.co, t: discTitle(r.t), k: c.k, ...(c.fix ? { fix: 1 } : {}), ...(idx.lead.has(r.co) ? { lead: 1 } : {}), id: r.id });
  }
  const rank = (x) => (x.k === "실적" ? 0 : x.k === "계약" ? 1 : x.k === "기타" || x.k === "거래소" ? 3 : 2); // 많을 때 앞에서 남길 순서 (실적 → 계약 → 주요 → 기타·거래소) · 화면은 시간순·종목별
  return out.sort((a, b) => rank(a) - rank(b) || (a.dt < b.dt ? 1 : a.dt > b.dt ? -1 : 0)).slice(0, max);
}

// ---- ① KIND IR 일정: 실적·경영실적·컨퍼런스콜만 ----
export const IR_RE = /실적|컨퍼런스\s*콜|컨콜|conference\s*call|earnings|business\s+performance|operating\s+results/i;
export function irRows(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1], co = row.match(/companysummary_open\([^)]*\)[^>]*>([^<]*)<\/a>/) || row.match(/title="([^"]*)" onclick="companysummary_open/), t = row.match(/fnDetailView\('(\d+)'\)[^>]*>([\s\S]*?)<\/a>/) || row.match(/title="([^"]*)" onclick="fnDetailView\('(\d+)'/);
    const d = row.match(/<td class="txc">\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/), tm = row.match(/<td class="txc">[\s\S]*?(\d{1,2}:\d{2})[\s\S]*?<\/td>\s*$/);
    if (!co || !t || !d) continue;
    const title = unent(t[1] && /^\d+$/.test(t[1]) ? t[2] : t[1]).replace(/\s+/g, " ").trim(), mk = (row.match(/alt='([^']*)'/) || [])[1] || "";
    out.push({ d: d[1], tm: tm ? tm[1].padStart(5, "0") : "", co: unent(co[1]).trim(), t: title, mk });
  }
  return out;
}
export function pickIr(rows, from, to, max = 8) {
  const seen = new Set();
  return (rows || []).filter((r) => r.d >= from && r.d <= to && IR_RE.test(r.t)).filter((r) => { const k = r.co + r.d; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.d + a.tm < b.d + b.tm ? -1 : 1)).slice(0, max).map((r) => ({ d: r.d, tm: r.tm, co: r.co, t: cut(r.t, 30) }));
}

// ---- ③ 미국 큰 폭 ----
export function usRows(json, ex) {
  const st = json && Array.isArray(json.stocks) ? json.stocks : [];
  return st.map((x) => ({ s: String(x.symbolCode || ""), rc: String(x.reutersCode || ""), n: String(x.stockName || "").trim(), r: num(x.fluctuationsRatio), p: num(x.closePrice), ex, at: String(x.localTradedAt || "") })).filter((x) => x.rc && x.n && x.r !== null);
}
export function usMovers(rows, n = US_N, th = US_MOVE) {
  const seen = new Set(), xs = (rows || []).filter((x) => { if (seen.has(x.rc)) return false; seen.add(x.rc); return true; });
  const up = xs.filter((x) => x.r >= th).sort((a, b) => b.r - a.r).slice(0, n), dn = xs.filter((x) => x.r <= -th).sort((a, b) => a.r - b.r).slice(0, n);
  return { up, dn, n: xs.length };
}
export const UP_WORDS = /상승|급등|강세|오름|올라|오른|뛰었|뛰어|치솟|랠리|반등|최고치|신고가|껑충|호조|급반등|상향/;
export const DOWN_WORDS = /하락|급락|약세|내림|내려|내린|떨어|추락|폭락|밀려|밀리|하회|부진|저조|하향|곤두박질/;
// 제목 방향어가 실제 등락 부호와 반대인가 (반대 낱말만 있고 같은 쪽 낱말은 없을 때) — 10/7 마이크론 +4.06% 인데 22:03 장 전 로이터 「주가 하락」 실측
export function dirConflict(title, rate) {
  const t = String(title || ""), up = UP_WORDS.test(t), dn = DOWN_WORDS.test(t);
  return rate > 0 ? dn && !up : rate < 0 ? up && !dn : false;
}
export function usNews(json) {
  return (Array.isArray(json) ? json : []).filter((x) => x && x.tit).map((x) => ({ t: unent(x.tit).trim(), o: x.ohnm || "", dt: String(x.dt || ""), oid: x.oid || "", aid: x.aid || "" }));
}
// 종목 이름 낱말: 한글 이름 첫 낱말(「마이크론 테크놀로지」→「마이크론」) · 2글자↑ · 심볼(낱말 단위)
export const usNameWords = (x) => [String(x.n || "").split(/\s+/)[0], String(x.n || "").replace(/\s+/g, "")].filter((w, i, a) => w.length >= 2 && a.indexOf(w) === i);
const hasSym = (t, s) => !!s && /^[A-Z]{1,6}$/.test(s) && new RegExp("(^|[^A-Za-z])" + s + "([^A-Za-z]|$)").test(t); // 심볼은 영문 대문자 1~6자만 (정규식 특수문자 없음)
// 이유 기사: 범위 안 · 제목에 그 종목 이름(또는 심볼) · 방향어가 실제 등락과 반대가 아님 — 첫 번째 · 없으면 null (지어내기 0 · 시장 전체 기사는 이유로 안 씀)
//  여러 개면: 제목 방향어가 실제 등락과 같은 쪽 → 「증시 동향-A, B, C」 같은 나열 기사 아님 → 최신 순 (10/8 모더나: 「모더나, 머크, 템퍼스와의 협력 소식에 주가 상승」 이 「미국 증시 동향-할로자임, 모더나, 머크」 보다 앞)
// 나열 기사 = 「미국 증시 동향-A, B, C」 또는 쉼표 2개↑에 방향어(상승·하락 …)가 없는 제목(「어피리에이티드 매니저스 그룹, 골드만 삭스, 벡사이트」) → 이유로 안 씀 (게이트 권고 ① 원장 [1807])
//  「모더나, 머크, 템퍼스와의 협력 소식에 주가 상승」 은 방향어가 있어 나열 아님
export const LIST_RE = /증시\s*동향/;
export const isListTitle = (t) => LIST_RE.test(String(t || "")) || ((String(t || "").match(/,/g) || []).length >= 2 && !UP_WORDS.test(t) && !DOWN_WORDS.test(t));
export function pickReason(arts, x, fromDt) {
  const words = usNameWords(x), ok = [];
  (arts || []).forEach((a, i) => {
    if (fromDt && a.dt.slice(0, 12) < fromDt) return;
    if (!(words.some((w) => a.t.includes(w)) || hasSym(a.t, x.s))) return;
    if (dirConflict(a.t, x.r) || isListTitle(a.t)) return;
    const same = x.r > 0 ? UP_WORDS.test(a.t) : x.r < 0 ? DOWN_WORDS.test(a.t) : false;
    ok.push({ a, i, sc: same ? 1 : 0 });
  });
  ok.sort((p, q) => q.sc - p.sc || (p.a.dt < q.a.dt ? 1 : p.a.dt > q.a.dt ? -1 : p.i - q.i));
  const a = ok[0] && ok[0].a;
  return a ? { t: cut(a.t), o: a.o, dt: a.dt.slice(0, 12), oid: a.oid, aid: a.aid } : null;
}
export function usThemeMap(themes) { const m = {}; for (const t of (themes && themes.themes) || []) for (const s of t.symbols || []) if (!m[s]) m[s] = String(t.name || "").split(" (")[0]; return m; }

// ---- ④ 국내 종목 뉴스 ----
export function krNews(json, src) {
  const r = json && Array.isArray(json.result) ? json.result : [];
  return r.filter((x) => x && (x.titleFull || x.title)).map((x) => ({ t: unent(x.titleFull || x.title).trim(), dt: String(x.datetime || ""), o: x.officeName || "", oid: x.officeId || "", aid: x.articleId || "", src }));
}
export const MKT_RE = /\[[^\]]*(시황|마감|개장|장전|출발|증시|오늘장|마켓뷰|모닝)[^\]]*\]|^\s*(뉴욕증시|美증시|미 증시|코스피|코스닥)\s*[,·:]/;
export const NEWS_PER_STOCK = 2; // 한 종목이 목록을 다 채우지 않게 (같은 종목 다른 사건은 2줄까지)
export const MATERIAL_RE = /공급계약|수주|계약|실적|흑자|최대|인수|합병|M&A|승인|허가|특허|임상|목표가|상향|신고가|투자|증설|배당|자사주|소각|수출|협약|MOU|양산|출시|진출/;
export function pickNews(arts, idx, win, max = 6) {
  const seen = new Set(), rank = new Set(), rows = []; let mkt = null;
  for (const a of arts || []) {
    const key = a.oid + "/" + a.aid;
    if (a.src === "rank") rank.add(key);
    if (seen.has(key) || !inWin(a.dt, win)) continue; seen.add(key);
    if (MKT_RE.test(a.t)) { if (!mkt || a.dt > mkt.dt) mkt = a; continue; }
    const st = findStock(a.t, idx); if (!st) continue;
    rows.push({ a, st });
  }
  const by = new Map(); for (const r of rows.sort((x, y) => (x.a.dt < y.a.dt ? 1 : -1))) { if (!by.has(r.st)) by.set(r.st, []); by.get(r.st).push(r); }
  const items = [];
  for (const [st, rs] of by) for (const g of groupArticles(rs)) {
    const offs = [...new Set(g.rows.map((r) => r.a.o).filter(Boolean))], top = g.rows[0].a, inRank = g.rows.some((r) => rank.has(r.a.oid + "/" + r.a.aid)), lead = idx.lead.has(st), mat = MATERIAL_RE.test(top.t);
    const sc = offs.length * 2 + (inRank ? 2 : 0) + (lead ? 1 : 0) + (mat ? 1 : 0);
    items.push({ n: st, t: cut(top.t), o: top.o, on: offs.length, sc, dt: top.dt.slice(0, 12), oid: top.oid, aid: top.aid, ...(inRank ? { rk: 1 } : {}), ...(lead ? { lead: 1 } : {}) });
  }
  items.sort((a, b) => b.sc - a.sc || (a.dt < b.dt ? 1 : -1));
  const per = new Map(), kept = items.filter((x) => { const c = (per.get(x.n) || 0) + 1; per.set(x.n, c); return c <= NEWS_PER_STOCK; });
  return { items: kept.slice(0, max), mkt: mkt ? { t: cut(mkt.t), o: mkt.o, dt: mkt.dt.slice(0, 12), oid: mkt.oid, aid: mkt.aid } : null, n: rows.length };
}

// ---- 관심 후보 종목 뉴스 ----
export const WATCH_NEWS_N = 5;
export const KR_FEED_URL = (code) => "https://m.stock.naver.com/api/news/stock/" + code + "?pageSize=10";
export function krFeed(json) {
  const items = (Array.isArray(json) ? json : []).flatMap((g) => (g && Array.isArray(g.items) ? g.items : []));
  return items.filter((x) => x && (x.titleFull || x.title)).map((x) => ({ t: unent(x.titleFull || x.title).trim(), b: unent(x.body || "").trim(), dt: String(x.datetime || ""), o: x.officeName || "", oid: x.officeId || "", aid: x.articleId || "" }));
}
// 종목 뉴스 주소는 관련 종목 기사도 섞여 옴(10/8 SK이노베이션 피드에 LG엔솔 기사) → 제목에 그 종목 이름(줄임말·6자↑ 앞 4자)이 든 기사 먼저 · 없으면 요약(body)에 든 기사 · 둘 다 없으면 버림
export const nameVariants = (n) => { const s = String(n || "").trim(); return [...new Set([s, ...(NAME_ALIAS[s] || []), ...(s.length >= 6 ? [s.slice(0, 4)] : [])].filter((x) => x.length >= 2))]; };
export function candArticles(arts, name) {
  const v = nameVariants(name), inT = (a) => v.some((w) => a.t.includes(w)), inB = (a) => v.some((w) => (a.b || "").includes(w));
  return [...arts.filter(inT), ...arts.filter((a) => !inT(a) && inB(a))];
}

// ---- 합치기 · 크기 ----
// 섹션마다: 이번에 받은 것(ok)만 덮고, 실패면 지난 값 그대로 + tryAt · err (지어내기 0) · 날짜가 다르면 지난 값 버림
export function mergeBrief(old, fresh, date) {
  const o = old && old.date === date ? old : null, out = { v: BRIEF_V, date };
  for (const k of BRIEF_SECTIONS) {
    const f = fresh && fresh[k], p = o && o[k];
    if (f && f.ok) { const x = Object.assign({}, f); delete x.ok; out[k] = x; }
    else if (f && f.err) out[k] = Object.assign({}, p || {}, { tryAt: f.tryAt, err: f.err });
    else if (p) out[k] = p;
  }
  out.lead = (fresh && fresh.lead) || (o && o.lead) || [];
  out.budget = (fresh && fresh.budget) || (o && o.budget) || { date, used: 0 };
  out.updatedAt = (fresh && fresh.ts) || (o && o.updatedAt) || null;
  return shrink(out);
}
export const briefBytes = (b) => Buffer.byteLength(JSON.stringify(b), "utf8");
// 상한(8KB) 넘으면 긴 목록부터 한 줄씩 줄인다 (앞쪽 = 점수·중요도 높은 것 유지)
export function shrink(b, max = BRIEF_MAX_BYTES) {
  const lists = [["news", "items"], ["news", "cand"], ["us", "up"], ["us", "dn"], ["disc", "items"], ["sched", "items"]]; // 앞 목록부터 (일정·공시는 모두 펼침이라 마지막)
  for (let guard = 0; guard < 200 && briefBytes(b) > max; guard++) {
    const c = lists.find(([s, k]) => b[s] && Array.isArray(b[s][k]) && b[s][k].length > 1);
    if (!c) break; const [s, k] = c; b[s][k] = b[s][k].slice(0, -1); b[s].cut = 1;
  }
  return b;
}

// ---- 요청까지 ----
// get(url)=json · post(url, body)=text · only: 이번에 받을 섹션 (기본 4개 · 09:25 장중 run 은 ["disc"])
// 반환: { sched?, disc?, us?, news? (각 { ok:true, at, ts, … } 또는 { err, tryAt }), lead, budget, ts, requests }
export async function collectBrief({ get, post, date, prevKr, nextDays = [], now = new Date(), hm = null, members = null, leadNames = [], themes = null, budget = null, only = BRIEF_SECTIONS, expectedUs = null, watch = null } = {}) {
  const at = hm || new Date(now.getTime() + 9 * 3600e3).toISOString().slice(11, 16), ts = now.getTime();
  const b = budget && budget.date === date ? { date, used: budget.used || 0 } : { date, used: 0 };
  let requests = 0; const out = { lead: (leadNames || []).slice(0, 20), budget: b, ts };
  const spend = async (fn) => { if (b.used >= BRIEF_DAILY_MAX) throw new Error("하루 요청 상한 " + BRIEF_DAILY_MAX); b.used++; requests++; return fn(); };
  const cands = watch && Array.isArray(watch.stocks) ? watch.stocks.filter((x) => x && x.name && x.code) : [];
  const idx = stockIndex(members, [...leadNames, ...cands.map((x) => x.name)]);
  const sec = async (k, fn) => { if (!only.includes(k)) return; try { out[k] = Object.assign({ ok: true, at, ts }, await fn()); } catch (e) { out[k] = { err: String((e && e.message) || e).slice(0, 80), tryAt: at }; } };
  // ① IR 실적 (오늘 ~ 다음 2거래일)
  await sec("sched", async () => {
    const to = nextDays.length ? nextDays[nextDays.length - 1] : date;
    const html = await spend(() => post(KIND_IR_URL, kindIrBody(date, to)));
    const rows = irRows(html); if (!rows.length && !/searchirschedule|irschedule|<table/i.test(String(html))) throw new Error("IR 일정 응답 이상");
    return { from: date, to, items: pickIr(rows, date, to) };
  });
  // ② 공시 (전날 거래일 · 오늘)
  await sec("disc", async () => {
    const win = briefWindow(prevKr, date, DISC_FROM), rows = [], errs = [];
    for (const d of [...new Set([prevKr, date])]) { try { rows.push(...kindRows(await spend(() => post(KIND_DISC_URL, kindDiscBody(d))), d8(d))); } catch (e) { errs.push(d.slice(5) + " " + String((e && e.message) || e).slice(0, 40)); } }
    if (errs.length >= 2 || (errs.length && !rows.length)) throw new Error("KIND " + errs.join(" / "));
    return { from: win.from, to: win.to, items: pickDisc(rows, idx, win), ...(errs.length ? { warn: "일부 못 받음 " + errs.join(" / ") } : {}) };
  });
  // ③ 미국 큰 폭 (NASDAQ·NYSE 시총 상위 100씩 → 상승 3·하락 3 → 종목마다 로이터 한글 1회)
  await sec("us", async () => {
    const all = [], errs = [];
    for (const ex of ["NASDAQ", "NYSE"]) { try { all.push(...usRows(await spend(() => get(US_RANK_URL(ex))), ex)); } catch (e) { errs.push(ex + " " + String((e && e.message) || e).slice(0, 30)); } }
    if (!all.length) throw new Error("시총 순위 " + (errs.join(" / ") || "비어 있음"));
    const mv = usMovers(all), tm = usThemeMap(themes), fromDt = expectedUs ? d8(expectedUs) + "0600" : null;
    const one = async (x) => { let why = null, nerr = null; try { why = pickReason(usNews(await spend(() => get(US_NEWS_URL(x.rc)))), x, fromDt); } catch (e) { nerr = 1; } return { s: x.s, rc: x.rc, n: x.n, r: x.r, p: x.p, ex: x.ex, ...(tm[x.s] ? { th: tm[x.s] } : {}), why, ...(nerr ? { nerr } : {}) }; };
    const up = [], dn = []; for (const x of mv.up) up.push(await one(x)); for (const x of mv.dn) dn.push(await one(x));
    const ses = (all.find((x) => x.at) || {}).at || "";
    return { n: mv.n, ses: ses.slice(0, 10), up, dn, ...(errs.length ? { warn: "일부 못 받음 " + errs.join(" / ") } : {}) };
  });
  // ④ 아침 국내 종목 뉴스
  await sec("news", async () => {
    const win = briefWindow(prevKr, date, NEWS_FROM), arts = [], errs = [];
    for (const [cat, page, src] of [["mainnews", 1, "main"], ["mainnews", 2, "main"], ["flashnews", 1, "flash"], ["ranknews", 1, "rank"]]) {
      try { arts.push(...krNews(await spend(() => get(KR_NEWS_URL(cat, page))), src)); } catch (e) { errs.push(cat + page + " " + String((e && e.message) || e).slice(0, 30)); }
    }
    if (!arts.length) throw new Error("뉴스 " + (errs.join(" / ") || "비어 있음"));
    const r = pickNews(arts, idx, win);
    // 관심 후보 (전날 저녁 확정 run 의 close.watch · 원장 [1802]): 일반 뉴스 줄에 꼬리표 + 후보 종목 뉴스(종목 뉴스 주소 · 최대 WATCH_NEWS_N 회 · 범위 같음)
    const tagOf = new Map(cands.map((x) => [x.name, x.tags || []]));
    r.items.forEach((x) => { if (tagOf.has(x.n)) x.tags = tagOf.get(x.n); });
    const cand = [];
    for (const c of cands.slice(0, WATCH_NEWS_N)) {
      let items = [], nerr = null;
      try { const rows = candArticles(krFeed(await spend(() => get(KR_FEED_URL(c.code)))).filter((a) => inWin(a.dt, win)), c.name); items = groupArticles(rows.map((a) => ({ a }))).slice(0, 2).map((g) => { const a = g.rows[0].a; const on = new Set(g.rows.map((x) => x.a.o)).size; return { t: cut(a.t), o: a.o, dt: a.dt.slice(0, 12), oid: a.oid, aid: a.aid, on, sc: on * 2 + 1 + (MATERIAL_RE.test(a.t) ? 1 : 0) }; }); } // sc = 언론사 수×2 + 관심 후보 1 + 재료어 1 (일반 뉴스 점수와 같은 잣대 · 화면에서 섞어 점수순)
      catch (e) { nerr = 1; }
      cand.push({ n: c.name, code: c.code, theme: c.theme, tags: c.tags || [], items, ...(nerr ? { nerr } : {}) });
    }
    return { from: win.from, to: win.to, items: r.items, mkt: r.mkt, ...(cand.length ? { cand, wdate: watch.date } : {}), ...(errs.length ? { warn: "일부 못 받음 " + errs.join(" / ") } : {}) };
  });
  out.requests = requests;
  return out;
}
// 한 줄 요약 (수집 로그용)
export function briefText(b) {
  if (!b) return "브리핑 없음";
  const st = (k) => { const s = b[k]; return !s ? "없음" : s.err ? `⚠ ${s.err} (${s.tryAt})${s.at ? " · 지난 값 " + s.at : ""}` : `${s.at}`; };
  const sched = b.sched && b.sched.items ? b.sched.items.map((x) => x.d.slice(5) + " " + x.co + " " + x.t).join(" / ") : "";
  const disc = b.disc && b.disc.items ? b.disc.items.map((x) => x.dt.slice(8, 10) + ":" + x.dt.slice(10) + " " + x.co + " " + x.t + "[" + x.k + (x.fix ? "·정정" : "") + "]").join(" / ") : "";
  const us = b.us && b.us.up ? [...b.us.up, ...b.us.dn].map((x) => `${x.n} ${x.r > 0 ? "+" : ""}${x.r}%${x.th ? "(" + x.th + ")" : ""} — ${x.why ? x.why.t : "이유 기사 못 찾음"}`).join(" / ") : "";
  const news = b.news && b.news.items ? b.news.items.map((x) => `${x.n} ${x.sc}점 ${x.t}`).join(" / ") + (b.news.mkt ? " · 시황 " + b.news.mkt.t : "") + (b.news.cand ? " · 관심 후보 " + b.news.cand.map((c) => `${c.n}[${c.tags.join("·")}] ${c.items.length ? c.items[0].t : c.nerr ? "못 받음" : "밤사이 기사 없음"}`).join(" / ") : "") : "";
  return `브리핑 ① 일정 ${st("sched")} ${sched}\n브리핑 ② 공시 ${st("disc")} ${disc}\n브리핑 ③ 미국 ${st("us")} ${us}\n브리핑 ④ 뉴스 ${st("news")} ${news}\n브리핑 요청 오늘 ${(b.budget || {}).used ?? "?"}/${BRIEF_DAILY_MAX} · 크기 ${briefBytes(b)}B`;
}
