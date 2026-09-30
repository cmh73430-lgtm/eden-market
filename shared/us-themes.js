// 한국 테마 이름(네이버) ↔ 미국장 대응 테마 키 연결표 — standalone/app.js 의 US[].kw 와 같은 내용 (test/auto.test.js 가 둘이 같은지 대조한다).
// 서버(server/auto.js 주도 테마 U 단계)가 쓴다. 앱은 이 파일을 빌드 때 인라인하지 않고(scripts/build-standalone.js 는 rules·calendar·insight 만 붙임) US[].kw 표를 따로 가진다 —
// 한쪽만 고치면 test/auto.test.js 의 대조 테스트가 잡는다. 키는 config/themes.json 의 24개 key 와 같다.
// 순수 모듈 (브라우저·Node 공용). 표 순서 = 앱 US 배열 순서 (같은 길이 키워드가 겹치면 앞의 것이 이긴다).
export const USTHEME_KW = {
  semi: ["반도체", "HBM", "메모리", "AI 반도체", "시스템반도체", "엔비디아"],
  power: ["전력", "변압기", "전선", "전력설비", "스마트그리드", "초고압"],
  nuke: ["원자력", "원전", "SMR"],
  batt: ["2차전지", "이차전지", "배터리", "리튬", "양극재", "음극재", "전고체"],
  def: ["방산", "방위", "조선", "K-방산"],
  bio: ["바이오", "제약", "비만", "신약", "의료", "CMO", "바이오시밀러"],
  robot: ["로봇", "휴머노이드"],
  space: ["우주", "위성", "항공", "UAM"],
  solar: ["태양광", "태양전지"],
  equip: ["반도체 장비", "반도체장비", "장비", "CXL", "유리기판"],
  auto: ["자동차", "완성차", "자동차부품", "타이어"],
  ship: ["해운", "컨테이너", "벌크"],
  bank: ["은행", "금융", "증권", "보험", "지주"],
  steel: ["철강", "강관"],
  h2: ["수소", "연료전지"],
  build: ["건설", "인프라", "시멘트", "레미콘"],
  fintech: ["스테이블코인", "핀테크", "결제", "페이", "전자결제"],
  aisw: ["AI", "인공지능", "챗봇", "소프트웨어", "온디바이스"],
  cyber: ["보안", "해킹", "정보보안"],
  lng: ["LNG", "LPG", "가스", "천연가스"],
  vaccine: ["백신", "진단", "코로나", "mRNA"],
  btc: ["가상화폐", "비트코인", "블록체인", "코인", "가상자산"],
  gold: ["금 ", "금값", "귀금속"],
  cu: ["구리", "비철금속"],
};

// 테마 이름 → 미국 테마 키 (대소문자 무시 부분일치 · 가장 긴 키워드가 맞는 쪽 우선 · 없으면 null)
export function usKeyOf(name) {
  const n = String(name || "").toUpperCase();
  let best = null, bestLen = 0;
  for (const [k, kws] of Object.entries(USTHEME_KW)) {
    const len = Math.max(0, ...kws.map((w) => (n.includes(w.toUpperCase()) ? w.length : 0)));
    if (len > bestLen) { best = k; bestLen = len; }
  }
  return best;
}
