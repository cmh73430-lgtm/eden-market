// 종목당 거래대금 기준 — 수집기(server/auto.js thresholdFor · server/surge.js 종가배팅 칸)와 앱(매매수칙 「💰 거래대금 적정 기준」 표 · 종가배팅 칸)이 같이 쓰는 계산 하나 (9.29-100 원장 [1880] 「두 곳 어긋남 0」)
// 디렉터 표: 그 시장 하루 거래대금 A(조) 10조 미만 500억 · 10조 700억 · 20조 1,000억 · 30조↑ 1,500억 · 구간 사이 비례(7조 이하 500 · 7~10조 500→700) · 50억 단위 반올림
// 코스피 종목 = (코스피 하루 거래대금 − 삼성전자 − SK하이닉스) 를 표에 · 코스닥 종목 = 코스닥 하루 거래대금 그대로 (거래대금기준_전문가조사.md 권장안 · 장 마감 판정이라 장중 보정 없음)
export const TV_BIG2 = ["005930", "000660"];   // 삼성전자 · SK하이닉스
export const TV_BIG2_SHARE = 0.44;              // 매매수칙 표의 코스피 칸만: 두 종목 몫 약 44%(조사 표본) 를 뺀 돈으로 계산 — 실제 종가배팅 칸은 그날 두 종목 거래대금을 그대로 뺌
export const TV_KOSPI_ROWS = [10, 15, 20, 25, 30, 40], TV_KOSDAQ_ROWS = [5, 7, 8, 9, 10, 12]; // 표 줄(조)
export function tvThreshold(amountEok) {
  const A = typeof amountEok === "number" && amountEok > 0 ? amountEok / 10000 : null;
  if (A === null) return 500;
  const t = A <= 7 ? 500 : A < 10 ? 500 + ((A - 7) / 3) * 200 : A < 20 ? 700 + ((A - 10) / 10) * 300 : A < 30 ? 1000 + ((A - 20) / 10) * 500 : 1500;
  return Math.round(t / 50) * 50;
}
// 그날 종목 기준: kospi·kosdaq = 하루 거래대금(억) · big2 = 삼성전자+SK하이닉스 그날 거래대금(억 · 모르면 null → 코스피 전체로) → { KS, KQ, base:{ KS, KQ } }
export function tvStockThresholds({ kospi = null, kosdaq = null, big2 = null } = {}) {
  const ks = typeof kospi === "number" && kospi > 0 ? (typeof big2 === "number" && big2 > 0 && big2 < kospi ? kospi - big2 : kospi) : null;
  return { KS: tvThreshold(ks), KQ: tvThreshold(typeof kosdaq === "number" && kosdaq > 0 ? kosdaq : null), base: { KS: ks, KQ: typeof kosdaq === "number" && kosdaq > 0 ? kosdaq : null, big2: typeof big2 === "number" ? big2 : null } };
}
// 매매수칙 표 줄: [["10조","500억"], …] (코스피 = 두 종목 몫 44% 뺀 돈 · 코스닥 = 그대로)
export function tvTableRows(market) {
  const k = market === "KQ", rows = k ? TV_KOSDAQ_ROWS : TV_KOSPI_ROWS;
  return rows.map((jo) => [jo + "조", tvThreshold(jo * 10000 * (k ? 1 : 1 - TV_BIG2_SHARE)).toLocaleString("ko-KR") + "억"]);
}
