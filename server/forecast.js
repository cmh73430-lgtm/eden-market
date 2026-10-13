// 「참고 · 자주 나온 테마(단골)」 줄 — 9.29-102 원장 [1905] · 9.29-103 원장 [2001][2003](예측 연구 폐기 → 이 줄 하나만 남김)
//  세기만(런타임 LLM 0 · 네이버 요청 0 · 따로 쌓는 파일 0): 최근 20거래일(오늘 포함) 확정 주도 3개의 「대표 이름」 횟수
//   · 합친 이름(alias)은 횟수에 안 셈 — 「오늘 주도」를 뺄 때만 씀
//   · 자료 = 수집기가 마감 run 에서 이미 읽는 지난 날짜 파일 20개(loadHistory · close.market.leaders.themes) + 오늘 확정 3개
//  9.29-103 에서 뺀 것: 그림자 기록 파일(auto/observe/forecast-shadow.json 읽기·쓰기) · 자동 채점 · 시간 가중 단골 P′ · 순위학습 M2-L 차기 5(계수 표) · 새 얼굴 · 장중 시각별 기록(live.json runs[])
export const FC_WIN = 20, FC_MIN_DAYS = 5, FC_TOP = 3, FC_NEXT = 5;
export const FC_RULE = "단골 = 최근 20거래일(오늘 포함) 확정 주도 「대표 이름」 횟수(합친 이름은 횟수에 안 셈 · 오늘 주도를 뺄 때만 씀) · 동률은 이름순 · 쉬는 단골 = 오늘 주도(대표·합친 이름)를 뺀 상위 5 · 기록 5일 미만이면 화면 숨김 · 매매 신호 아님";
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// 확정 주도 테마 목록(close.market.leaders.themes) → 대표 이름 3개 · 합친 이름(alias)
export function leaderNames(themes) { const xs = (Array.isArray(themes) ? themes : []).filter((t) => t && t.name).slice(0, FC_TOP); return { names: xs.map((t) => t.name), alias: [...new Set(xs.flatMap((t) => (Array.isArray(t.alias) ? t.alias : [])))] }; }
// 세는 날들(가까운 날 먼저 · 최대 20): 오늘(확정 3개가 있을 때) + 지난 날짜 파일 가운데 주도 이름이 있는 날 — 주도가 없던 날·오늘 뒤 날짜·같은 날짜 두 번은 안 셈
export function regularDays(history, { date, themes } = {}) {
  const today = leaderNames(themes), days = today.names.length ? [{ date, names: today.names }] : [], seen = new Set(days.map((d) => d.date));
  const past = (Array.isArray(history) ? history : []).filter((h) => h && h.date && h.date < date && Array.isArray(h.leaders)).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const h of past) { if (seen.has(h.date)) continue; const L = leaderNames(h.leaders); if (!L.names.length) continue; seen.add(h.date); days.push({ date: h.date, names: L.names }); }
  return { days: days.slice(0, FC_WIN), today: new Set([...today.names, ...today.alias]) };
}
// 날짜 파일에 넣는 화면용 값(close.forecast): { n 기록 일수, f3 단골 3, f5 오늘 주도를 뺀 단골 5 } — 앱은 이 값만 표시(계산 0)
export function regularsOf(history, { date, themes } = {}) {
  const { days, today } = regularDays(history, { date, themes }), cnt = new Map();
  for (const d of days) for (const nm of new Set(d.names)) cnt.set(nm, (cnt.get(nm) || 0) + 1);
  const top = (k, exclude) => [...cnt.entries()].filter(([nm]) => !exclude.has(nm)).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || byName(a, b)).slice(0, k);
  return { n: days.length, f3: top(FC_TOP, new Set()), f5: top(FC_NEXT, today) };
}
export function fcText(f) { const nm = (xs) => (xs && xs.length ? xs.map((x) => x.name + x.n + "회").join("·") : "없음"); return `단골(기록 ${f.n}일): ${nm(f.f3)} · 쉬는 단골 ${nm(f.f5)}`; }
