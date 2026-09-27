// 한국투자증권 KIS Developers 어댑터 — 코스피200 야간선물용 자리
//
// 아직 연결하지 않았다. 계좌·앱키가 필요하고, 야간(KRX 연계 CME/유렉스) 선물 시세를
// Open API로 받을 수 있는지 먼저 확인해야 한다 (docs/SPEC.md 4장).
// 확인되면 아래 quote()에서 토큰 발급 → 시세 조회 후 { price, prevClose, time }을 돌려주면 된다.
// prevClose는 "전일 정규장 종가"여야 한다 (야간 세션 기준가가 아님).
//
// 그전까지는 항상 실패를 던지고, 화면에서는 손 입력 칸으로 폴백한다.

export async function quote(symbol) {
  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
    throw new Error("KIS 미설정 — 야간선물은 손 입력");
  }
  throw new Error("KIS 야간선물 조회 미구현 — 손 입력 (" + symbol + ")");
}

export default { name: "kis", quote };
