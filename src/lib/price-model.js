/* ============================================================
   분양예정가 추정 모델
   ------------------------------------------------------------
   아직 모집공고가 안 난 현장은 분양가를 알 수 없습니다.
   그래서 **이미 분양한 단지들의 실제 분양가**로 학습한 모델로 추정합니다.

       평당 분양가 = 지역 기준값 × 보정계수들
       예상 분양가 = 평당 분양가 × 공급면적(평)

   지역 기준값은 주소를 토큰 경로(시도 › 시군구 › 읍면동)로 보고
   뿌리에서 잎으로 값을 물려주되, 표본이 적은 잎은 부모 쪽으로 끌어당긴
   값입니다(축소추정). scripts/calibrate.js 가 만들어 둔
   src/data/price-model-fit.js 를 그대로 읽어 씁니다.

   성능은 지어낸 값이 아니라 **공고 단위 5겹 교차검증** 결과입니다
   (학습에 안 쓴 공고를 지역+브랜드만 보고 맞혀 본 것). FIT_CV 참고.

   학습 표에 아예 없는 지역만 아래 원가식으로 떨어집니다.
   ============================================================ */

import { PY_PRICE_REGIONS, PY_PRICE_FINE, PY_PRICE_ALIAS, PY_PRICE_ALIAS_FINE,
         PY_PRICE_META } from "../data/py-price.js";
import { FIT_REGION, FIT_REGION_N, FIT_FACTORS, FIT_CV, FIT_META }
  from "../data/price-model-fit.js";

export { FIT_CV, FIT_META };

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

/* ── 학습 모델 조회 ──────────────────────────────────────────
   주소 토큰 경로를 잎에서 뿌리로 훑어 가장 세밀한 노드를 씁니다.
   "경기도 화성시 오산동" 이 있으면 그걸 쓰고, 없으면 "경기도 화성시",
   그것도 없으면 "경기도" 로 물러납니다. */
function fitBase(tokens) {
  for (let i = tokens.length; i >= 1; i--) {
    const k = tokens.slice(0, i).join(" ");
    if (FIT_REGION[k] != null) return { logPy: FIT_REGION[k], key: k, n: FIT_REGION_N[k] || 0 };
  }
  return null;
}

/* 지역 문자열을 학습 노드로 연결합니다.
   주소처럼 생겼으면(토큰 2개 이상) 그대로, 아니면 별칭 표를 거칩니다. */
export function fitLookup(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const toks = t.split(/\s+/).slice(0, 4);
  if (toks.length >= 2) {
    const b = fitBase(toks);
    if (b && b.key.split(" ").length >= 2) return b;
  }
  const hit = lookupRegion(t);
  if (hit?.key) {
    const b = fitBase(hit.key.split(/\s+/));
    if (b) return { ...b, word: hit.word };
  }
  return toks.length >= 2 ? fitBase(toks) : null;
}

/* 학습에 쓴 것과 같은 구간 나누기 — 여기가 어긋나면 보정이 헛돕니다 */
const pyBandOf = (py) => (py < 22 ? "소형" : py < 30 ? "중소형" : py < 38 ? "국민" : "대형");
const sizeOf = (total) =>
  !total ? null : total >= 1500 ? "초대형" : total >= 700 ? "대단지" : total >= 300 ? "중형" : "소규모";
/* 노드 키의 마지막 토큰으로만 판단합니다. 시군구까지밖에 모르면 건너뜁니다. */
const ruralOf = (key) => {
  const last = String(key || "").split(" ").pop() || "";
  if (/[면리]$/.test(last)) return "읍면리";
  if (/[동가]$/.test(last)) return "동";
  return null;
};

/* ── 추정 ───────────────────────────────────────────────────
   region  지역 문자열(주소 또는 단지명·지명)
   brand   브랜드/시공사 문자열
   py      공급면적(평). 기본 34평(전용 84㎡)
   year    분양 시점. 기본 2026
   capped  분양가상한제 여부
   supply  "민영" | "공공"      (모르면 민영)
   total   총 세대수            (모르면 0 — 규모 보정을 건너뜁니다)
   redev   정비사업 여부

   화면에는 "택지비 + 건축비 × (1+가산비율)" 형태로 보여줘야 하므로,
   평당가에서 건축비·가산비율을 거꾸로 빼서 택지비를 역산해 표시합니다.
   숫자를 지어내는 게 아니라 같은 값을 다른 형태로 보여주는 것뿐입니다.
*/
export function estimatePrice({ region = "", brand = "", py = 34, year = 2026,
                                capped = false, supply = "민영", total = 0, redev = false } = {}) {
  const [tier, tierLabel] = pick(BRAND_TIER, `${brand} ${region}`, BRAND_DEFAULT);
  const [margin, marginLabel] = marginFor({ region, capped });
  const constPy = Math.round(CONST_PY_BASE * tier * (idx(CONST_INDEX, year) / idx(CONST_INDEX, 2026)));

  const fit = fitLookup(region);
  let pyPrice, landPy, source, landLabel, applied = [];

  if (fit) {
    /* 1순위 — 학습 모델. 지역 기준값에 아는 조건만 곱합니다. */
    const feats = {
      rural: ruralOf(fit.key),
      supply,
      pyBand: pyBandOf(py),
      size: sizeOf(total),
      capped: capped ? "Y" : "N",
      tier: tierLabel === "하이엔드" ? "하이엔드" : tierLabel === "1군 브랜드" ? "1군" : "일반",
      redev: redev ? "Y" : "N",
    };
    let v = Math.exp(fit.logPy);
    for (const f of FIT_FACTORS) {
      const m = feats[f.key] == null ? null : f.tab[feats[f.key]];
      if (m) { v *= m; applied.push(`${feats[f.key]} ×${m}`); }
    }
    /* 과거 시점 검증용 되돌림 — 학습 데이터는 지금 공고 기준입니다 */
    pyPrice = Math.round(v * (idx(LAND_INDEX, year) / idx(LAND_INDEX, 2026)));
    landPy = Math.max(0, Math.round(pyPrice / (1 + margin) - constPy));
    source = "학습모델";
    landLabel = `${fit.key} 실적 ${fit.n}건`;
  } else {
    /* 2순위 — 학습 표에도 없는 지역이면 원가식 */
    const [land2026, label] = pick([...LAND_PY, LAND_CITY], region, LAND_DEFAULT);
    landPy = Math.round(land2026 * (idx(LAND_INDEX, year) / idx(LAND_INDEX, 2026)));
    pyPrice = Math.round((landPy + constPy) * (1 + margin));
    source = "원가식";
    landLabel = label;
  }

  const totalPrice = Math.round(pyPrice * py);
  /* 범위는 임의로 정하지 않고 교차검증 오차의 80분위를 씁니다.
     원가식으로 떨어진 지역은 학습 표본이 아예 없어 따로 잴 방법이 없습니다.
     그렇다고 더 좁게 잡을 근거는 없으므로 같은 폭을 씁니다. */
  const band = (FIT_CV?.p80 ?? 20) / 100;
  return {
    landPy, constPy, margin, pyPrice, total: totalPrice, py, year, source, applied,
    fitKey: fit?.key || null, fitN: fit?.n || 0,
    lo: Math.round(totalPrice * (1 - band)),
    hi: Math.round(totalPrice * (1 + band)),
    bandPct: Math.round(band * 100),
    labels: { land: landLabel, brand: tierLabel, margin: marginLabel },
  };
}

/* 기사에 자주 나오는 동·역세권 이름 → 시군구.
   실측 표는 시군구 단위라 이 다리가 없으면 "반포"가 강남권 원가식으로 떨어집니다. */
export const DONG_TO_SGG = {
  반포: "서울특별시 서초구", 잠원: "서울특별시 서초구", 방배: "서울특별시 서초구",
  압구정: "서울특별시 강남구", 청담: "서울특별시 강남구", 개포: "서울특별시 강남구",
  대치: "서울특별시 강남구", 도곡: "서울특별시 강남구",
  잠실: "서울특별시 송파구", 문정: "서울특별시 송파구",
  성수: "서울특별시 성동구", 왕십리: "서울특별시 성동구",
  서울대입구: "서울특별시 관악구", 봉천: "서울특별시 관악구",
  흑석: "서울특별시 동작구", 노량진: "서울특별시 동작구", 상도: "서울특별시 동작구",
  여의도: "서울특별시 영등포구", 신길: "서울특별시 영등포구",
  홍은: "서울특별시 서대문구", 충정로: "서울특별시 서대문구",
  월계: "서울특별시 노원구", 중화: "서울특별시 중랑구", 강일: "서울특별시 강동구",
  서면: "부산광역시 부산진구", 연산: "부산광역시 연제구", 당리: "부산광역시 사하구",
  대연: "부산광역시 남구", 문현: "부산광역시 남구", 해운대: "부산광역시 해운대구",
  첨단: "광주광역시 광산구", 둔산: "대전광역시 서구",
  두정: "충청남도 천안시", 백석: "충청남도 천안시", 탕정: "충청남도 아산시",
  동탄: "경기도 화성시", 판교: "경기도 성남시", 분당: "경기도 성남시",
  위례: "경기도 하남시", 풍무: "경기도 김포시", 신곡: "경기도 의정부시",
  은계: "경기도 시흥시", 대야: "경기도 시흥시", 오남: "경기도 남양주시",
  상동: "경기도 부천시", 소사: "경기도 부천시", 남사: "경기도 용인시 처인구",
  처인: "경기도 용인시 처인구", 수지: "경기도 용인시 수지구", 기흥: "경기도 용인시 기흥구",
  검단: "인천광역시 서구", 청라: "인천광역시 서구", 검암: "인천광역시 서구",
  송도: "인천광역시 연수구", 학익: "인천광역시 미추홀구",
  판문: "경상남도 진주시", 이현: "경상남도 진주시",
};
const ALIAS_KEYS = Object.keys(PY_PRICE_ALIAS).sort((a, b) => b.length - a.length);
const FINE_KEYS = Object.keys(PY_PRICE_ALIAS_FINE).sort((a, b) => b.length - a.length);

/* 지역 단어("천안", "반포")를 실측 시군구 키로 연결합니다 */
export function lookupRegion(text) {
  const t = String(text || "");
  if (!t) return null;
  /* 구 단위가 가장 정확합니다 — "경기도 용인시 처인구" 처럼 통째로 온 경우 */
  const three = t.split(/\s+/).slice(0, 3).join(" ");
  if (PY_PRICE_FINE[three]) return { key: three, ...PY_PRICE_FINE[three] };
  if (PY_PRICE_REGIONS[t]) return { key: t, ...PY_PRICE_REGIONS[t] };
  /* "처인", "수지" 같은 구 이름 */
  for (const word of FINE_KEYS) {
    if (t.includes(word)) {
      const r = PY_PRICE_FINE[PY_PRICE_ALIAS_FINE[word]];
      if (r) return { key: PY_PRICE_ALIAS_FINE[word], word, ...r };
    }
  }
  /* 동 단위 지명은 시군구로 먼저 바꿉니다 (표는 시군구 단위입니다) */
  for (const [dong, sgg] of Object.entries(DONG_TO_SGG)) {
    if (t.includes(dong)) {
      const r = PY_PRICE_FINE[sgg] || PY_PRICE_REGIONS[sgg];
      if (r) return { key: sgg, word: dong, ...r };
    }
  }
  /* 별칭은 긴 것부터 — "부천" 이 "부"보다 먼저 걸려야 합니다 */
  for (const word of ALIAS_KEYS) {
    if (t.includes(word)) {
      const r = PY_PRICE_REGIONS[PY_PRICE_ALIAS[word]];
      if (r) return { key: PY_PRICE_ALIAS[word], word, ...r };
    }
  }
  /* "경기도 부천시 원미구" 처럼 앞 두 토큰이 키인 경우 */
  const two = t.split(/\s+/).slice(0, 2).join(" ");
  if (PY_PRICE_REGIONS[two]) return { key: two, ...PY_PRICE_REGIONS[two] };
  return null;
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
