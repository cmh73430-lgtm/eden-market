// 달력 자동 갱신에 쓰는 해석기 (scripts/refresh-calendar.mjs) — 응답 형식이 바뀌어도 여기만 고치면 된다
const KNOWN = /새해|크리스마스|신정|설날|삼일절|3·1절|어린이날|부처님|석가|현충일|광복절|추석|개천절|한글날|성탄절|기독탄신일|대체|제헌절|근로자|노동절/;
export function lunarFromNager(list) {
  const pick = (re) => { const ds = list.filter((h) => re.test(h.localName || "") && !/대체/.test(h.localName || "")).map((h) => h.date).sort(); return ds.length ? ds[Math.min(1, ds.length - 1)] : null; }; // 연휴 3일 [전날, 당일, 다음날] (+대체 공휴일이 같은 이름으로 붙어도) → 두 번째 날이 당일
  const lunar = { seol: pick(/설날/), chuseok: pick(/추석/), buddha: pick(/부처님|석가/) };
  const extras = list.filter((h) => !KNOWN.test(h.localName || "")).map((h) => ({ date: h.date, name: h.localName }));
  return { lunar, extras };
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function parseFomc(html, year) {
  const i = html.indexOf(year + " FOMC Meetings"); if (i < 0) return [];
  const j = html.indexOf("FOMC Meetings", i + 20), seg = html.slice(i, j > 0 ? j : undefined), out = [];
  const re = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>\s*([^<]+)</g; let m;
  while ((m = re.exec(seg))) {
    const mon = m[1].trim().split("/").pop(), days = m[2].replace(/[*()a-zA-Z\s]/g, "").split("-").filter(Boolean);
    const mi = MONTHS.findIndex((x) => x.startsWith(mon.slice(0, 3))); if (mi < 0 || !days.length) continue;
    out.push(`${year}-${String(mi + 1).padStart(2, "0")}-${String(days[days.length - 1]).padStart(2, "0")}`);
  }
  return [...new Set(out)].sort();
}
export function parseBlsIcs(ics) {
  const out = { cpi: [], jobs: [] };
  ics.split("BEGIN:VEVENT").slice(1).forEach((b) => {
    const s = (b.match(/SUMMARY[^:]*:(.*)/) || [])[1] || "", d = (b.match(/DTSTART[^:]*:(\d{8})/) || [])[1];
    if (!d) return; const date = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
    if (/^Consumer Price Index/i.test(s.trim())) out.cpi.push(date);
    if (/^Employment Situation/i.test(s.trim())) out.jobs.push(date);
  });
  return out;
}

// 구글 대한민국 공휴일 달력(.ics): "설날"·"추석" 은 당일에만 붙고 앞뒤는 "설날 연휴" → 음력 당일을 정확히 알 수 있다 (nager 는 대체 공휴일까지 같은 이름이라 헷갈림)
export const KR_ICS = "https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics";
export function lunarFromIcs(ics, year) {
  const ev = ics.split("BEGIN:VEVENT").slice(1).map((b) => ({ s: ((b.match(/\nSUMMARY[^:]*:(.*)/) || [])[1] || "").trim(), d: (b.match(/DTSTART[^:]*:(\d{8})/) || [])[1] })).filter((e) => e.d && e.d.startsWith(String(year)))
    .map((e) => ({ name: e.s, date: e.d.slice(0, 4) + "-" + e.d.slice(4, 6) + "-" + e.d.slice(6, 8) }));
  const one = (re) => (ev.find((e) => re.test(e.name)) || {}).date || null;
  const lunar = { seol: one(/^설날$/), chuseok: one(/^추석$/), buddha: one(/부처님|석가/) };
  const extras = ev.filter((e) => /선거|임시\s*공휴일/.test(e.name)).map((e) => ({ date: e.date, name: e.name }));
  return { lunar, extras };
}
