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
import { FIT_REGION, FIT_REGION_N, FIT_PLACE, FIT_CV, FIT_META, SEP }
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
/* 국토부 고시 기본형건축비 2026.3 — ㎡당 222만원 × 3.3058 = 평당 734만원 */
export const CONST_PY_BASE = 734;
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
   경로는 [시도] > [읍면/택지/시가지] > [시군구] > [재개발/일반] > [읍면동·지구].
   잎에서 뿌리로 훑어 가장 깊은 노드를 씁니다. **어느 깊이에서 멈췄는지가
   그대로 신뢰도**입니다 — 읍면동까지 같은 사례를 찾았으면 잘 맞고,
   시도까지 올라가 빌려왔으면 크게 틀립니다. 교차검증으로 잰 값:

     읍면동·지구까지 일치   평균 8.1%   (전체의 41%)
     시군구까지 일치        평균 12.3%
     그 위로 올라감         평균 20.0%
*/
const TAXI_RE = /지구|블록|BL|신도시|택지/;

/* 학습 때와 **똑같이** 경로를 만들어야 합니다. 여기가 어긋나면 조회가 헛돕니다. */
export function pathOfAddress(gu) {
  const tok = String(gu || "").split(/\s+/).filter(Boolean);
  const rural = /(읍|면|리)$/.test(tok[2] || "") || /[읍면리] /.test(String(gu))
    ? "읍면" : TAXI_RE.test(String(gu)) ? "택지" : "시가지";
  return [tok[0], rural, tok[1], "일반", tok[2]].filter(Boolean);
}

function walk(path) {
  for (let i = path.length; i >= 1; i--) {
    const k = path.slice(0, i).join(SEP);
    if (FIT_REGION[k] != null) {
      return { logPy: FIT_REGION[k], key: k, n: FIT_REGION_N[k] || 0, depth: i };
    }
  }
  return null;
}

/* ── 지명 색인 ────────────────────────────────────────────
   "동탄", "당리", "서울대입구" 같은 낱말을 학습 노드 경로로 바꿉니다.
   세 군데서 모읍니다.
     ① FIT_PLACE — 학습 데이터(실제 공고 주소)에서 뽑은 읍면동·지구 이름
     ② DONG_TO_SGG — 기사에 자주 나오는 동·역세권 이름 (표에 없는 동네용)
     ③ 시군구 이름 자체
   같은 글에 여러 개가 걸리면 **더 깊은 쪽**을 씁니다.
   "부산 더샵 당리센트리체"에서 '부산'이 아니라 '당리'가 이겨야 합니다. */
const PLACE_INDEX = new Map();
const addPlace = (word, path) => {
  if (!word || word.length < 2 || !path?.length) return;
  const cur = PLACE_INDEX.get(word);
  if (!cur || path.length > cur.length) PLACE_INDEX.set(word, path);
};
for (const [w, k] of Object.entries(FIT_PLACE)) {
  if (FIT_REGION[k] != null) addPlace(w, k.split(SEP));
}

/* 색인 채우기는 DONG_TO_SGG 정의 뒤에 이어집니다 (아래 initPlaceIndex) */
let PLACE_KEYS = [...PLACE_INDEX.keys()].sort((a, b) => b.length - a.length);

function walkPath(path) {
  for (let i = path.length; i >= 1; i--) {
    const k = path.slice(0, i).join(SEP);
    if (FIT_REGION[k] != null) {
      return { logPy: FIT_REGION[k], key: k, n: FIT_REGION_N[k] || 0, depth: i };
    }
  }
  return null;
}

/* 한 문장에서 가장 깊게 걸리는 지명을 찾습니다 */
function resolveIn(text) {
  const t = String(text || "");
  let best = null;
  for (const w of PLACE_KEYS) {
    if (!t.includes(w)) continue;
    /* 색인이 가리키는 노드는 시군구 단계에서 끊겨 있을 수 있습니다.
       사업유형 층을 붙여 한 단계 더 내려가 봅니다 — 주소로 조회할 때와
       깊이를 맞춰야 신뢰도 등급이 어긋나지 않습니다.
       뉴스 현장은 재개발인지 신규택지인지 모르므로, 그 지역에 한쪽만
       있으면 그쪽을 쓰고 둘 다 있으면 위 단계(둘을 합친 값)에 머뭅니다. */
    const p0 = PLACE_INDEX.get(w);
    const branches = ["일반", "재개발"]
      .map((b) => walkPath([...p0, b]))
      .filter((h) => h && h.depth === p0.length + 1);
    const hit = branches.length === 1 ? branches[0] : walkPath(p0);
    if (!hit) continue;
    if (!best || hit.depth > best.depth || (hit.depth === best.depth && w.length > best.word.length)) {
      best = { ...hit, word: w };
    }
  }
  return best;
}

/* 지역 문자열 → 학습 노드.
   주소처럼 생겼으면(토큰 2개 이상) 경로를 직접 만들고,
   낱말이면 지명 색인을 씁니다. */
export function fitLookup(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (t.split(/\s+/).filter(Boolean).length >= 2) {
    const b = walkPath(pathOfAddress(t));
    if (b && b.depth >= 3) return b;
  }
  return resolveIn(t);
}

/* 깊이 → 신뢰도 등급.
   등급 이름도, 등급별 오차·표시범위도 전부 교차검증 실측값입니다.
   깊이 3(시군구까지)과 깊이 2 이하(시도까지)는 오차가 뚜렷이 달라서
   "낮음"과 "매우 낮음"으로 갈라 놓습니다. */
export const gradeOf = (depth) =>
  depth >= 5 ? "높음" : depth === 4 ? "보통" : depth === 3 ? "낮음" : "매우 낮음";
const DEPTH_KEY = { "높음": 5, "보통": 4, "낮음": 3, "매우 낮음": 2 };
export const gradeStat = (g) => FIT_CV?.byDepth?.[DEPTH_KEY[g]] ?? null;
export const GRADE_WHY = {
  "높음": "읍면동·지구까지 같은 사례가 있습니다",
  "보통": "시군구까지 같은 사례가 있습니다",
  "낮음": "시군구 실적을 통째로 씁니다",
  "매우 낮음": "시도 평균까지 올라가 빌려옵니다",
};

/* ── 추정 ───────────────────────────────────────────────────
   region  지역 문자열(주소 또는 단지명·지명)
   brand   브랜드/시공사 문자열
   py      공급면적(평). 기본 34평(전용 84㎡)
   year    분양 시점. 기본 2026
   capped  분양가상한제 여부

   화면에는 "택지비 + 건축비 × (1+가산비율)" 형태로 보여줘야 하므로,
   평당가에서 건축비·가산비율을 거꾸로 빼서 택지비를 역산해 표시합니다.
   숫자를 지어내는 게 아니라 같은 값을 다른 형태로 보여주는 것뿐입니다.
   건축비는 국토부 고시 기본형건축비(2026.3 기준 ㎡당 222만원 = 평당 734만)를
   기준으로 브랜드 급을 얹은 값입니다.
*/
export function estimatePrice({ region = "", brand = "", py = 34, year = 2026,
                                capped = false } = {}) {
  const [tier, tierLabel] = pick(BRAND_TIER, `${brand} ${region}`, BRAND_DEFAULT);
  const [margin, marginLabel] = marginFor({ region, capped });
  const constPy = Math.round(CONST_PY_BASE * tier * (idx(CONST_INDEX, year) / idx(CONST_INDEX, 2026)));

  const fit = fitLookup(region);
  let pyPrice, landPy, source, landLabel, grade;

  if (fit) {
    /* 과거 시점 검증용 되돌림 — 학습 데이터는 최근 1년 공고입니다 */
    pyPrice = Math.round(Math.exp(fit.logPy) * (idx(LAND_INDEX, year) / idx(LAND_INDEX, 2026)));
    landPy = Math.max(0, Math.round(pyPrice / (1 + margin) - constPy));
    source = "학습모델";
    grade = gradeOf(fit.depth);
    landLabel = `${fit.key.split(SEP).filter((x) => !/^(읍면|택지|시가지|재개발|일반)$/.test(x)).join(" ")} 실적 ${fit.n}건`;
  } else {
    /* 학습 표에도 없는 지역이면 원가식 */
    const [land2026, label] = pick([...LAND_PY, LAND_CITY], region, LAND_DEFAULT);
    landPy = Math.round(land2026 * (idx(LAND_INDEX, year) / idx(LAND_INDEX, 2026)));
    pyPrice = Math.round((landPy + constPy) * (1 + margin));
    source = "원가식";
    grade = "매우 낮음";
    landLabel = label;
  }

  const totalPrice = Math.round(pyPrice * py);
  /* 범위는 임의로 정하지 않습니다 — 그 신뢰도 등급에서 실제로 난 오차의 80분위 */
  const st = gradeStat(grade);
  const band = (st?.p80 ?? FIT_CV?.all?.p80 ?? 25) / 100;
  return {
    landPy, constPy, margin, pyPrice, total: totalPrice, py, year, source,
    grade, gradeMae: st?.mae ?? null, gradeN: st?.n ?? null,
    fitKey: fit?.key || null, fitN: fit?.n || 0, depth: fit?.depth ?? 0,
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

/* 색인에 없는 지명을 위한 마지막 보루 목록 */
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
   엉뚱한 지역이 잡힙니다. 텍스트를 준 순서대로 하나씩 봅니다.

   학습 데이터에서 뽑은 지명 색인(FIT_PLACE, 읍면동·지구까지 들어 있음)을
   먼저 씁니다. "동탄"만 잡던 것을 "동탄2신도시"까지 잡아야 추정이 한 단계
   깊어지고, 깊이가 곧 신뢰도입니다. 색인에 없을 때만 손으로 만든 목록으로. */
export function guessRegion(...texts) {
  const list = texts.filter(Boolean).map(String);
  for (const t of list) {
    const hit = resolveIn(t);
    if (hit) return hit.word;
  }
  for (const t of list) {
    for (const w of REGION_WORDS) if (t.includes(w)) return w;
  }
  return "";
}

/* DONG_TO_SGG · 시군구 이름을 색인에 마저 넣습니다.
   DONG_TO_SGG 가 아래에 정의돼 있어 여기서 한 번 더 채웁니다. */
export function initPlaceIndex() {
  /* 1단계 — 시·군·구 이름. "화성시" 와 "화성" 을 함께 넣고,
     짧은 형태는 따로 모아 둡니다. */
  const CITY_SHORT = new Set();
  const CITY_SUFFIX = /(특별자치도|광역시|특별시|자치시|자치도|시|군|구)$/;
  for (const key of Object.keys(FIT_REGION)) {
    const toks = key.split(SEP);
    const last = toks[toks.length - 1];
    if (!last || last.length < 2 || /^(읍면|택지|시가지|재개발|일반)$/.test(last)) continue;
    if (!CITY_SUFFIX.test(last)) continue;
    addPlace(last, toks);
    const short = last.replace(CITY_SUFFIX, "");
    if (short.length >= 2) { addPlace(short, toks); CITY_SHORT.add(short); }
  }
  /* 2단계 — 읍면동·지구 이름. 접미사를 뗀 형태는 그것이 시·군·구 이름과
     겹치지 않을 때만 넣습니다. "반포동"→"반포" 는 넣고,
     "의정부동"→"의정부" 는 의정부시와 겹치므로 넣지 않습니다. */
  for (const key of Object.keys(FIT_REGION)) {
    const toks = key.split(SEP);
    const last = toks[toks.length - 1];
    if (!last || last.length < 2 || /^(읍면|택지|시가지|재개발|일반)$/.test(last)) continue;
    if (CITY_SUFFIX.test(last)) continue;
    addPlace(last, toks);
    const short = last.replace(/(읍|면|동|리|가)$/, "");
    if (short.length >= 2 && !CITY_SHORT.has(short)) addPlace(short, toks);
  }
  /* 3단계 — 기사에 자주 나오는 동·역세권 이름 (학습 데이터에 없는 동네용) */
  for (const [dong, sgg] of Object.entries(DONG_TO_SGG)) {
    if (PLACE_INDEX.has(dong)) continue;
    const path = pathOfAddress(`${sgg} ${dong}동`);
    addPlace(dong, walkPath(path) ? path : pathOfAddress(sgg));
  }
  PLACE_KEYS = [...PLACE_INDEX.keys()].sort((a, b) => b.length - a.length);
}


initPlaceIndex();
