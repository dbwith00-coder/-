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
import { FIT_A, FIT_A_N, FIT_B, FIT_B_N, FIT_PLACE, FIT_CV, FIT_META, SEP }
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
   트리를 둘 씁니다.
     A  [시도] > [읍면·택지·시가지] > [시군구] > [재개발·일반] > [읍면동·지구]
     B  [시도] > [시군구] > [읍면동] > [상세]
   로그공간에서 반씩 섞습니다. 서로 다른 실수를 하기 때문에 둘 다보다 낫습니다
   (교차검증 12.64 / 12.95 → 12.38).

   **신뢰도는 A가 어느 깊이에서 멈췄는지**로 정합니다. 읍면동·지구까지 같은
   사례를 찾았으면 잘 맞고, 시도까지 올라가 빌려왔으면 크게 틀립니다.
   교차검증 실측:
     높음(깊이 5)      평균  7.9%   (전체의 41%)
     보통(깊이 4)      평균 11.9%
     낮음(깊이 3)      평균 17.0%
     매우 낮음(깊이 2) 평균 20.5%
*/
const TAXI_RE = /지구|블록|BL|신도시|택지/;

/* 학습 때와 **똑같은** 규칙이어야 합니다. 여기가 어긋나면 조회가 헛돕니다. */
export function ruralOf(gu) {
  const tok = String(gu || "").split(/\s+/).filter(Boolean);
  return /(읍|면|리)$/.test(tok[2] || "") || /[읍면리] /.test(String(gu))
    ? "읍면" : TAXI_RE.test(String(gu)) ? "택지" : "시가지";
}

function walk(table, counts, path) {
  for (let i = path.length; i >= 1; i--) {
    const k = path.slice(0, i).join(SEP);
    if (table[k] != null) return { log: table[k], key: k, n: counts[k] || 0, depth: i };
  }
  return null;
}

/* 트리A 경로. 뉴스 현장은 재개발인지 아닌지 모르므로, 그 지역에 한쪽만
   있으면 그쪽을 쓰고 둘 다 있으면 위 단계(둘을 합친 값)에 머뭅니다. */
function walkA({ sido, sgg, emd, rural }) {
  const base = [sido, rural, sgg].filter(Boolean);
  const branches = ["일반", "재개발"]
    .map((r) => walk(FIT_A, FIT_A_N, [...base, r, emd].filter(Boolean)))
    .filter((h) => h && h.depth > base.length);
  if (branches.length === 1) return branches[0];
  if (branches.length > 1) {
    /* 둘 다 있는데 읍면동까지 내려간 게 하나뿐이면 그건 씁니다 */
    const deep = branches.filter((h) => h.depth === base.length + 2);
    if (deep.length === 1) return deep[0];
  }
  return walk(FIT_A, FIT_A_N, base);
}
const walkB = ({ sido, sgg, emd }) => walk(FIT_B, FIT_B_N, [sido, sgg, emd].filter(Boolean));

/* 지명 낱말은 긴 것부터 — "동탄2신도시"가 "동탄"보다 먼저 걸려야 합니다 */
const PLACE_KEYS = Object.keys(FIT_PLACE).sort((a, b) => b.length - a.length);

/* 지역 문자열 → {시도, 시군구, 읍면동, 성격}.
   주소처럼 생겼으면(토큰 2개 이상) 그대로 쪼개고,
   낱말이면 학습 데이터에서 뽑아 둔 지명 색인을 씁니다. */
export function resolvePlace(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  /* 주소로 취급할지 판단 — 첫 토큰이 **아는 시도 이름**일 때만입니다.
     "첨단3지구 A6블록 제일풍경채" 같은 단지명도 띄어쓰기가 있어서,
     칸 수만 보고 주소로 넘기면 시도="첨단3지구" 가 돼 조회가 통째로 헛돕니다. */
  const tok = t.split(/\s+/).filter(Boolean);
  const asSido = FIT_PLACE[tok[0]];
  if (tok.length >= 2 && asSido && !asSido[1] && !asSido[2]) {
    return { sido: asSido[0], sgg: tok[1], emd: tok[2] || "", rural: ruralOf(t), word: null };
  }
  /* 낱말 하나 — 색인에서 가장 깊게 걸리는 것을 고릅니다 */
  let best = null;
  for (const w of PLACE_KEYS) {
    if (!t.includes(w)) continue;
    const [sido, sgg, emd, rural] = FIT_PLACE[w];
    const cand = { sido, sgg, emd, rural, word: w };
    /* 몇 단계까지 아는지 — 시도만 1, 시군구까지 2, 읍면동·지구까지 3.
       "김포"(시도 칸에 든 깨진 주소)보다 "풍무역세권"(시군구 칸)이 이겨야 합니다. */
    const d = 1 + (sgg ? 1 : 0) + (emd ? 1 : 0);
    if (!best || d > best.d || (d === best.d && w.length > best.p.word.length)) best = { d, p: cand };
  }
  if (best) return best.p;
  /* 색인에 없으면 손으로 만든 동·역세권 표(성수 → 성동구, 반포 → 서초구).
     여기서는 시세표(PY_PRICE) 유무와 무관하게 주소만 씁니다 —
     예전엔 시세표에 없는 구(성동구 등)에서 조회가 통째로 실패했습니다. */
  for (const [dong, sgg] of Object.entries(DONG_TO_SGG)) {
    if (!t.includes(dong)) continue;
    const k = sgg.split(/\s+/);
    return { sido: k[0], sgg: k[1] || "", emd: k[2] || "", rural: "시가지", word: dong };
  }
  return null;
}

/* 두 트리를 섞어 평당가 하나를 냅니다 */
export function fitLookup(text) {
  const p = resolvePlace(text);
  if (!p) return null;
  const a = walkA(p), b = walkB(p);
  if (!a && !b) return null;
  const log = a && b ? (1 - FIT_META.wB) * a.log + FIT_META.wB * b.log : (a || b).log;
  const ref = a || b;
  return { logPy: log, key: ref.key, n: ref.n, depth: a ? a.depth : 2, word: p.word, place: p };
}

/* 깊이 → 신뢰도 등급.
   등급 이름도, 등급별 오차·표시범위도 전부 교차검증 실측값입니다. */
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
    const p = resolvePlace(t);
    if (p?.word) return p.word;
  }
  for (const t of list) {
    for (const w of REGION_WORDS) if (t.includes(w)) return w;
  }
  return "";
}


