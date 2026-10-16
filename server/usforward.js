// 미국장 테마 전진 기록 수집 — 9.29-105 원장 [2132] ③ (scripts/collect-auto.mjs 확정 close run 이 날짜 파일·latest 저장 「뒤」에 부른다 · 실패해도 날짜 파일 저장·종료 코드 무영향)
// 1) 오늘 아침 기록(morning.us · morning.signals.spx)으로 신호 한 줄을 넣고(fwdSignals · 같은 날짜 한 줄)
// 2) 신호가 있는 테마의 한국 대표 종목(FWD_KR) 오늘 일봉(네이버 chartUrl · 확정 run 이 C 등급에 쓰는 같은 주소)을 받아 시가 갭·시가→종가를 채운다
//    지난 줄(최근 5줄)에 빈 칸이 있으면 같이 채움(그날 일봉도 같은 응답 안에 있음) · 한 run 요청 상한 max · 전체 시간 상한 deadline(넘으면 남은 칸은 다음 run)
// 게이트 [2153] ①: 받은 파일(file)은 고치지 않는다(깊은 복사 뒤 작업) → 부르는 쪽이 「전 글자 ≠ 새 글자」로 저장을 정함(fwdShouldSave)
import { AUTO_DIR, chartUrl, candleRows } from "./auto.js";
import { fwdSignals, fwdAddRow, fwdPending, fwdBar, fwdKr, fwdSummary, fwdLine, FWD_KR } from "../shared/us-forward.js";
export const FWD_FILE = AUTO_DIR + "/observe/us-forward.json";
export const FWD_MAX = 30, FWD_BUDGET_MS = 60000;
export async function collectForward({ get, date, morning, themes, file, max = FWD_MAX, deadline = Infinity, now = () => Date.now() }) {
  const errors = []; let requests = 0;
  const base = file ? JSON.parse(JSON.stringify(file)) : null; // 원본 무변경
  const row = morning ? fwdSignals(date, morning, themes) : null;
  const { file: f, added } = fwdAddRow(base, row);
  const need = fwdPending(f);
  const codes = [...new Set(need.flatMap((x) => FWD_KR[x.k] || []))];
  const bars = {}; // 코드 → 일봉 줄
  for (const c of codes) {
    if (requests >= max) { errors.push("요청 상한 " + max); break; }
    if (now() > deadline) { errors.push("시간 상한 — 남은 칸은 다음 run"); break; }
    try { requests++; bars[c] = candleRows(await get(chartUrl(c, date)), 400); } catch (e) { errors.push(c + ": " + String((e && e.message) || e).slice(0, 40)); }
  }
  let filled = 0;
  for (const r of f.rows) {
    if (!need.some((x) => x.date === r.date)) continue;
    r.themes = (r.themes || []).map((t) => {
      if (!t || !t.st || t.kr) return t;
      const b = {}; for (const c of FWD_KR[t.k] || []) if (bars[c]) { const x = fwdBar(bars[c], r.date); if (x) b[c] = x; }
      const kr = fwdKr(t.k, b); if (!kr) return t; filled++; return Object.assign({}, t, { kr });
    });
  }
  return { file: f, added, filled, requests, errors: errors.slice(0, 5), noMorning: !row };
}
// 저장할지: 새 줄이나 채운 칸이 있고, 부르기 전 파일 글자(oldText = JSON.stringify(받은 파일))와 다를 때만
export const fwdShouldSave = (r, oldText) => !!(r && (r.added || r.filled) && JSON.stringify(r.file) !== oldText);
export function fwdText(r) {
  if (!r) return "전진 기록 없음";
  return `전진 기록(미국장 테마): 새 줄 ${r.added}${r.noMorning ? "(오늘 아침 미국 값 없음)" : ""} · 한국 결과 채움 ${r.filled} · 요청 ${r.requests}회 · 줄 ${r.file.rows.length}` + (r.errors.length ? " · 참고 " + r.errors.join(" / ") : "") + " · " + (fwdLine(fwdSummary(r.file)) || "요약 없음");
}
