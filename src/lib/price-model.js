/* ============================================================
   분양예정가 추정 모델
   ------------------------------------------------------------
   아직 모집공고가 안 난 현장은 분양가를 알 수 없습니다.
   그래서 원가를 쌓아 올려 추정합니다.

       평당 분양가 = (평당 택지비 + 평당 건축비) × (1 + 가산비율)
       예상 분양가 = 평당 분양가 × 공급면적(평)

   ⚠️ 아래 파라미터(지역별 택지비·건축비·가산비율)는 시장 상황을 보고
      정한 값이지 실측 데이터가 아닙니다. 백테스트가 맞았다고 해서
      모든 단지에서 맞는다는 뜻이 아닙니다.
   ============================================================ */

/* ── 1. 평당 택지비 (만원, 2026년 기준) ─────────────────────
   추정 결과를 가장 크게 흔드는 값입니다. 위에서부터 먼저 걸리는 것을 씁니다. */
export const LAND_PY = [
  [/강남|서초|송파|반포|압구정|청담|잠원|개포/, 4000, "강남권"],
  [/용산|성동|성수|마포|여의도|영등포|광진|동작|흑석|노량진/, 2500, "서울 도심"],
  [/서울|관악|서울대입구|노원|은평|서대문|중랑|강동|강서|구로|금천|도봉|동대문|성북|양천|종로/, 1600, "서울 그 외"],
  [/과천|판교|분당|성남/, 1500, "과천·판교·분당"],
  [/하남|광명|안양|의왕|구리|위례/, 1000, "서울 인접"],
  [/수지|기흥|동탄|화성|수원|안산|부천|시흥/, 800, "경기 남부"],
  [/송도|검단|청라|영종|인천|고양|김포|남양주|의정부|파주/, 600, "인천·경기 북부"],
  [/처인|남사|평택|이천|안성|여주|양평|포천/, 350, "경기 외곽"],
  [/부산|서면|해운대|당리|연산|대구|대전|둔산|광주|첨단|울산|세종/, 500, "광역시"],
];
/* 지방 중소도시 — 광역시보다 낮게 */
export const LAND_CITY = [/천안|아산|탕정|청주|전주|창원|진주|김해|포항|구미|경주|제주|강릉|춘천|원주|목포|여수|순천/, 320, "지방 도시"];
export const LAND_DEFAULT = [250, "지방 일반"];

/* ── 2. 평당 건축비 (만원, 2026년 기준) ─────────────────────
   기본형건축비 수준을 평당으로 환산한 표준값에 브랜드 급을 얹습니다. */
export const CONST_PY_BASE = 780;
export const BRAND_TIER = [
  [/아크로|디에이치|르엘|오티에르|트리마제|원베일리|블레스티지|하이엔드|써밋/, 1.30, "하이엔드"],
  [/자이|래미안|힐스테이트|푸르지오|e편한세상|이편한세상|롯데캐슬|더샵|아이파크|위브|SK뷰|포레나/, 1.10, "1군 브랜드"],
];
export const BRAND_DEFAULT = [1.0, "일반"];

/* ── 3. 가산비율 (시행 이윤·금융비·가산항목) ────────────────
   분양가상한제가 걸리면 이윤이 제한돼 낮게 잡습니다. */
export function marginFor({ region, capped }) {
  if (capped) return [0.15, "분양가상한제 — 이윤 제한"];
  if (/강남|서초|송파|용산|성동|과천/.test(region)) return [0.28, "고가 지역"];
  if (/서울|경기|인천/.test(region)) return [0.25, "수도권 일반"];
  return [0.20, "지방"];
}

/* ── 4. 시점 보정 ───────────────────────────────────────────
   과거 시점으로 되돌려 검증할 때 씁니다(백테스트).
   건축비는 건설공사비지수, 택지비는 지가 흐름을 따릅니다. */
export const CONST_INDEX = { 2015: 100, 2018: 112, 2020: 118, 2022: 142, 2024: 152, 2026: 160 };
export const LAND_INDEX  = { 2015: 100, 2018: 118, 2020: 130, 2022: 152, 2024: 163, 2026: 170 };
const idx = (table, year) => {
  if (table[year]) return table[year];
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (year <= years[0]) return table[years[0]];
  if (year >= years[years.length - 1]) return table[years[years.length - 1]];
  /* 사이 값은 선형 보간 */
  for (let i = 0; i < years.length - 1; i++) {
    if (year >= years[i] && year <= years[i + 1]) {
      const [a, b] = [years[i], years[i + 1]];
      const t = (year - a) / (b - a);
      return table[a] + (table[b] - table[a]) * t;
    }
  }
  return 100;
};

const pick = (table, text, fallback) => {
  for (const [re, v, label] of table) if (re.test(text || "")) return [v, label];
  return fallback;
};

/* ── 추정 ───────────────────────────────────────────────────
   region  지역 문자열(단지명·주소 등 아무거나 — 정규식으로 훑습니다)
   brand   브랜드/시공사 문자열
   py      공급면적(평). 기본 34평(전용 84㎡)
   year    분양 시점. 기본 2026
   capped  분양가상한제 여부
*/
export function estimatePrice({ region = "", brand = "", py = 34, year = 2026, capped = false } = {}) {
  const [land2026, landLabel] = pick(
    [...LAND_PY, LAND_CITY], region, LAND_DEFAULT);
  const [tier, tierLabel] = pick(BRAND_TIER, `${brand} ${region}`, BRAND_DEFAULT);
  const [margin, marginLabel] = marginFor({ region, capped });

  /* 시점 보정 — 2026 기준값을 해당 연도로 되돌립니다 */
  const landPy = Math.round(land2026 * (idx(LAND_INDEX, year) / idx(LAND_INDEX, 2026)));
  const constPy = Math.round(CONST_PY_BASE * tier * (idx(CONST_INDEX, year) / idx(CONST_INDEX, 2026)));

  const pyPrice = Math.round((landPy + constPy) * (1 + margin));
  const total = Math.round(pyPrice * py);

  /* 단일 숫자로 내밀면 확정처럼 보입니다. ±15% 범위를 함께 냅니다. */
  const lo = Math.round(total * 0.85);
  const hi = Math.round(total * 1.15);

  return {
    landPy, constPy, margin, pyPrice, total, lo, hi, py, year,
    labels: { land: landLabel, brand: tierLabel, margin: marginLabel },
  };
}

/* 단지명·기사 제목에서 지역 힌트를 뽑습니다 (뉴스 후보에는 주소가 없습니다) */
const REGION_WORDS = [
  /* 서울 — 동 단위 지명이 구보다 먼저 와야 "성수"가 잡힙니다 */
  "반포", "압구정", "청담", "개포", "잠원", "성수", "서울대입구", "흑석", "노량진",
  "강남", "서초", "송파", "용산", "성동", "마포", "영등포", "동작", "광진", "노원", "은평",
  "서대문", "중랑", "강동", "강서", "관악", "구로", "금천", "도봉", "동대문", "성북", "양천", "종로",
  "과천", "판교", "분당", "성남", "하남", "광명", "안양", "의왕", "구리", "위례",
  "수지", "기흥", "처인", "남사", "동탄", "화성", "수원", "안산", "부천", "시흥",
  "송도", "검단", "청라", "영종", "고양", "김포", "남양주", "의정부", "파주",
  "평택", "이천", "안성", "여주", "양평", "포천", "오산", "군포", "용인", "인천",
  /* 광역시 하위 지명 */
  "서면", "해운대", "당리", "연산", "첨단", "둔산",
  "부산", "대구", "대전", "광주", "울산", "세종",
  "아산", "탕정", "천안", "청주", "전주", "창원", "진주", "김해", "포항", "구미",
  "경주", "제주", "강릉", "춘천", "원주", "목포", "여수", "순천",
  /* 마지막 보루 — 위에서 아무것도 안 걸렸을 때만 */
  "서울", "경기",
];

/* 지역 힌트는 단지명에서 먼저 찾습니다.
   기사 제목까지 한꺼번에 합쳐 훑으면 "아산탕정자이" 기사에 '천안'이 섞여 있을 때
   엉뚱한 지역이 잡힙니다. 텍스트를 준 순서대로 하나씩 봅니다. */
export function guessRegion(...texts) {
  for (const t of texts.filter(Boolean)) {
    for (const w of REGION_WORDS) if (String(t).includes(w)) return w;
  }
  return "";
}
