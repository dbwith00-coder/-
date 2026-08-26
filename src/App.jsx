import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { loadConfig, saveConfig, fetchAllNotices } from "./lib/openapi";
import SNAPSHOT from "./data/notices.json";
import NEWS from "./data/upcoming-news.json";
import { estimatePrice, guessRegion, GRADE_WHY } from "./lib/price-model";
import { FIT_CV, FIT_META } from "./data/price-model-fit.js";

/* ============================================================
   집당 프로토타입에서 "청약 · 입주설계" 모듈만 뽑아낸 독립 버전입니다.
   공조 자동설계 / 입주 박람회 / 스토어 / 파트너스는 포함하지 않았습니다.

   ⚠️ 가점 계산 수정 사항 (원본 대비):
   원본의 nhScore·bankScore 계산식에 청약홈 공식 배점표와 어긋나는 부분이
   있어 바로잡았습니다 (아래 "수정" 주석 참고). 부양가족 점수(famScore)는
   원본 그대로이며 공식 배점표와 일치합니다.
   ============================================================ */

const CSS = `
.mv, .mv *, .mv *::before, .mv *::after { box-sizing: border-box; }
.mv {
  --paper:#FFFFFF;
  --band:#F4F5F7;
  --mist:#F4F5F7;
  --mist-2:#E8EAEE;
  --ink:#17181C;
  --ink-2:#4E545E;
  --ink-3:#767D88;
  --line:#E3E6EA;
  --brand:#9C3B28;
  --brand-2:#7A2C1D;
  --brand-soft:#FBEDE9;
  --flow:#0F5F4E;
  --flow-2:#0B4A3C;
  --tint:#E8F3EF;
  --accent:#FF4D2D;
  --accent-soft:#FFF0EC;
  --good:#08A05C;
  --sans:'Pretendard','Pretendard Variable',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',system-ui,sans-serif;
  --mono:ui-monospace,'SFMono-Regular',Menlo,'Cascadia Mono','Roboto Mono',monospace;
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.65;
  letter-spacing: -.016em;
  color: var(--ink);
  background: var(--paper);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: "tnum" 0;
}
.mv button { font: inherit; color: inherit; cursor: pointer; border: none; background: none; letter-spacing: inherit; }
.mv input, .mv select { font: inherit; color: inherit; letter-spacing: inherit; }
.mv :focus-visible { outline: 3px solid var(--flow); outline-offset: 2px; border-radius: 6px; }
.mv h1,.mv h2,.mv h3,.mv h4,.mv p,.mv ul,.mv figure { margin: 0; }
.mv ul { padding: 0; list-style: none; }
.mv a { color: inherit; }

.mv-num { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.mv-eyebrow { font-family: var(--mono); font-size: 11.5px; letter-spacing: .13em;
  text-transform: uppercase; color: var(--ink-3); font-weight: 600; }
.mv-wrap { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
.mv-band { background: var(--band); }

.mv-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 48px; padding: 12px 22px; border-radius: 10px; font-weight: 700; font-size: 16px;
  text-decoration: none; background: var(--ink); color: #fff; transition: opacity .12s ease; }
.mv-btn:hover { opacity: .86; }
.mv-btn:active { transform: translateY(1px); }
.mv-btn.mv-primary { background: var(--accent); }
.mv-btn.mv-ghost { background: #fff; color: var(--ink); border: 1.5px solid var(--line); }
.mv-btn.mv-ghost:hover { background: var(--band); opacity: 1; }
.mv-btn.mv-sm { min-height: 38px; padding: 8px 15px; font-size: 14px; border-radius: 8px; }
.mv-btn:disabled { opacity: .3; cursor: not-allowed; }

.mv-card { border: 1px solid var(--line); border-radius: 14px; background: #fff; }
.mv-pad { padding: 22px; }
.mv-grid { display: grid; gap: 16px; }
.mv-g2 { grid-template-columns: repeat(auto-fit, minmax(290px,1fr)); }
.mv-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mv-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mv-scroll { overflow-x: auto; }
.mv-scroll .mv-tbl { min-width: 520px; }

.mv-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
  border-radius: 999px; background: var(--band); font-size: 13.5px; font-weight: 700;
  letter-spacing: -.02em; color: var(--ink-2); }
.mv-chip.mv-on { background: var(--ink); color: #fff; }
.mv-chip.mv-warn { background: var(--accent-soft); color: #B03017; }
.mv-chip.mv-cool { background: #E9F0FF; color: #1B4FA8; }
.mv-hr { height: 1px; background: var(--line); border: 0; margin: 20px 0; }

.mv-sec { padding: 48px 0; }
.mv-sec-h { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.mv-sec-h h2 { font-size: 31px; letter-spacing: -.05em; font-weight: 900; line-height: 1.26; }
.mv-sec-h p { font-size: 16px; color: var(--ink-2); margin-top: 7px; line-height: 1.6; }

.mv-field { margin-bottom: 18px; }
.mv-field label { display: block; font-size: 15px; font-weight: 700; letter-spacing: -.028em;
  color: var(--ink); margin-bottom: 8px; }
.mv-in { width: 100%; height: 50px; padding: 0 14px; border: 1.5px solid var(--line); border-radius: 10px;
  background: #fff; font-size: 16px; }
.mv-in:focus { border-color: var(--ink); outline: none; }
.mv input[type="range"] { width: 100%; height: 28px; accent-color: var(--accent); }

.mv-tbl { width: 100%; border-collapse: collapse; font-size: 14.5px; }
.mv-tbl th { text-align: left; padding: 11px 13px; background: var(--band); font-family: var(--mono);
  font-size: 11.5px; letter-spacing: .07em; color: var(--ink-2); text-transform: uppercase;
  font-weight: 600; white-space: nowrap; }
.mv-tbl { font-size: 15px; }
.mv-tbl td { padding: 13px; border-bottom: 1px solid var(--line); vertical-align: top; line-height: 1.55; }
.mv-tbl tr:last-child td { border-bottom: 0; }
.mv-tbl .mv-r { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mv-tbl td small { display: block; color: var(--ink-3); font-size: 12.5px; }
.mv-total { display: flex; justify-content: space-between; padding: 9px 0; font-size: 15px; }
.mv-total b { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.mv-total.mv-big { padding-top: 15px; border-top: 2px solid var(--ink); font-size: 17px; font-weight: 800; }
.mv-total.mv-big b { font-size: 26px; color: var(--accent); letter-spacing: -.035em; }
.mv-gauge { height: 12px; border-radius: 999px; background: var(--mist-2); overflow: hidden; }
.mv-gauge i { display: block; height: 100%; background: var(--ink); border-radius: 999px;
  transition: width .6s cubic-bezier(.2,.8,.2,1); }

.mv-note { background: var(--band); border-radius: 12px; padding: 15px 17px; font-size: 14px; color: var(--ink-2); }
.mv-note b { color: var(--ink); }

.mv-b2b { --band:#151821; --line:#2A2F3C; --ink:#F2F4F7; --ink-2:#A7B0BE; --ink-3:#79828F; --paper:#0E1016; }

.mv-ov { position: fixed; inset: 0; z-index: 90; background: rgba(14,29,25,.55);
  display: flex; align-items: center; justify-content: center; padding: 18px; }
.mv-sheet { background: #fff; border-radius: 18px; width: 100%; max-width: 940px;
  max-height: 92vh; overflow: auto; box-shadow: 0 24px 70px rgba(0,0,0,.3); }
.mv-sheet-h { position: sticky; top: 0; z-index: 2; display: flex; align-items: center;
  justify-content: space-between; padding: 14px 22px; background: rgba(255,255,255,.95);
  backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.mv-x { width: 34px; height: 34px; border-radius: 50%; background: var(--mist);
  font-size: 15px; font-weight: 700; }
.mv-x:hover { background: var(--mist-2); }
.mv-sheet-body { padding: 8px 22px 30px; }
.mv-dl { display: grid; gap: 7px; font-size: 13.5px; color: var(--ink-2); line-height: 1.6; }
.mv-dl li { padding-left: 15px; position: relative; }
.mv-dl li::before { content: "·"; position: absolute; left: 4px; font-weight: 800; }

.mv-dbar { display: flex; align-items: center; gap: 10px; background: #17285A; color: #fff;
  padding: 11px 16px; border-radius: 10px; font-size: 15px; font-weight: 800;
  letter-spacing: -.03em; margin-bottom: 14px; }
.mv-dbar b { background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 5px; font-size: 11.5px; }

.mv-subsum { display: flex; align-items: center; gap: 28px; padding: 26px 30px;
  border-radius: 18px; background: linear-gradient(135deg, var(--brand), var(--brand-2));
  color: #fff; flex-wrap: wrap; }
.mv-subsum-div { width: 1px; align-self: stretch; background: rgba(255,255,255,.22); }
@media (max-width: 760px) { .mv-subsum-div { display: none; } .mv-subsum { gap: 18px; padding: 20px; } }

.mv-sitecard { border: 1px solid var(--line); border-radius: 14px; padding: 18px; background: #fff;
  text-align: left; transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease; }
.mv-sitecard:hover { transform: translateY(-3px); border-color: var(--ink-3);
  box-shadow: 0 12px 30px rgba(14,29,25,.1); }
.mv-sitebar { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-top: 14px;
  padding-top: 13px; border-top: 1px solid var(--line); }
.mv-sitebar small { display: block; font-size: 11.5px; color: var(--ink-3); }
.mv-sitebar b { display: block; font-size: 15px; font-weight: 800; margin-top: 2px; }
.mv-range { width: 100%; accent-color: var(--brand); height: 6px; }
.mv-listrow { display: block; width: 100%; text-align: left; padding: 12px 18px;
  border-bottom: 1px solid var(--line); }
.mv-listrow:hover { background: var(--mist); }
.mv-listrow.mv-on { background: var(--brand-soft); }
.mv-listrow strong { font-size: 14.5px; letter-spacing: -.03em; }
.mv-listrow small { display: block; font-size: 12.5px; color: var(--ink-3); margin-top: 3px; }

.mv-chero { display: flex; align-items: center; gap: 22px; padding: 24px 26px;
  border-radius: 18px; border: 1px solid; flex-wrap: wrap; }
.mv-chero h2 { font-size: 30px; font-weight: 900; letter-spacing: -.05em; margin-top: 3px; }
.mv-chero p { font-size: 14.5px; color: var(--ink-2); margin-top: 8px; max-width: 52ch; line-height: 1.6; }
.mv-chgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px,1fr)); gap: 16px; }
.mv-chcard { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: #fff;
  text-align: left; transition: transform .15s ease, box-shadow .15s ease; }
.mv-chcard:hover { transform: translateY(-3px); box-shadow: 0 14px 34px rgba(14,29,25,.13); }
.mv-chtop { height: 190px; padding: 14px 20px; }
.mv-slot-art { height: 78px; display: flex; align-items: center; justify-content: center; font-size: 44px; }
.mv-slot-cat { height: 22px; display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; letter-spacing: -.025em; line-height: 1; }
.mv-chbody { padding: 16px 20px 18px; }
.mv-chbody p { font-size: 14.5px; color: var(--ink-2); line-height: 1.62; min-height: 47px; }
`;

/* ============================================================
   숫자 표시 헬퍼
   ============================================================ */
const won = (n) => Math.round(n).toLocaleString("ko-KR");
const eok = (n) => {
  const e = Math.floor(n / 10000);
  const m = Math.round(n % 10000);
  return e > 0 ? `${e}억 ${m ? m.toLocaleString("ko-KR") + "만" : ""}`.trim() : `${m.toLocaleString("ko-KR")}만`;
};

/* ============================================================
   청약 · 금융 데이터
   ============================================================ */
const SUB_CH = [
  { k: "score", n: "모의청약", cat: "가점·특공·분양현장", c: "#9C3B28", c2: "#C97A66", ic: "🧮",
    desc: "내 조건을 넣으면 가점 계산과 특별공급 실시간 판정, 넣을 수 있는 분양 공고까지 한 번에 봅니다." },
  { k: "community", n: "커뮤니티", cat: "게시판", c: "#2B6E5E", c2: "#6FB59E", ic: "💬",
    desc: "같이 청약 준비하는 사람들과 정보를 나누고 댓글로 이야기해요." },
];

const REGIONS = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
  "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도",
  "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도",
  "경상남도", "제주특별자치도",
];

/* ── 분양공고 후 단지 ──
   GitHub Actions 수집기가 청약홈 API 에서 받아 저장소에 커밋한 실제 공고입니다.
   (src/data/notices.json · 수집 시각은 파일 안의 collectedAt)
   실시간 호출이 되는 환경에서는 이 스냅샷 대신 방금 받은 데이터가 쓰입니다. */
const SITES = SNAPSHOT.sites;

/* ── 분양공고 전 단지 ──
   분양예정가 = (평당 택지비 + 평당 건축비) × (1 + 가산비율) × 공급면적(평)
   아크메르 동탄은 위드님이 주신 변수 그대로이고, 나머지는 같은 공식에
   추정 변수를 넣은 가칭 단지입니다. 실제 공고가와는 다를 수 있습니다. */
/* ── 분양공고 전 단지 (API 아님) ──
   공고가 안 난 단지는 공공 API 에 없어서, 택지비·건축비·가산비율을 직접 넣어
   원가식으로 계산하고 시장 예상과 결합해 범위로 추정합니다.
   분양예정가 = (평당 택지비 + 평당 건축비) × (1 + 가산비율) × 공급면적(평)
   가칭 샘플들은 실제 공고 데이터가 들어오면서 오해를 부를 수 있어 정리했고,
   변수를 직접 받은 단지만 남겼습니다. */
const PRE_SITES = [
  { id: "p1", supply: "민영", n: "아크메르 동탄", gu: "경기 화성시 반송동(동탄1)", brand: "주상복합 · 하이엔드",
    when: "2026.4분기~2027 상반기 공고 예정", land: 1200, constCost: 1100, margin: 0.30, py: 34,
    note: "메타폴리스 2단계 부지, 약 1,800세대 최고 49층. 실제 분양가는 주변 시세·분양시장 상황을 종합해 결정됩니다." },
];

/* ── 기관추천 특별공급 유형별 기준 · 준비서류 ──
   공고·추천기관마다 세부 기준이 달라질 수 있으니 반드시 해당 기관에 확인하세요. */
const AGENCY_INFO = {
  "국가유공자": {
    std: "국가유공자 예우법상 본인 또는 유족 · 무주택 세대구성원",
    docs: ["국가유공자(유족) 확인원", "주민등록등본", "무주택 확인 서류"],
    org: "국가보훈부 관할 보훈(지)청에서 추천서 발급" },
  "장기복무 제대군인": {
    std: "10년 이상 복무 후 전역한 제대군인 · 무주택 세대구성원",
    docs: ["복무기간 확인서(전역증)", "제대군인 확인원", "주민등록등본"],
    org: "국가보훈부 제대군인지원센터에서 추천" },
  "중소기업 장기근속자": {
    std: "동일 중소기업 5년 이상 또는 중소기업 통산 10년 이상 재직 · 무주택",
    docs: ["재직증명서", "4대보험 가입이력", "중소기업 확인서"],
    org: "중소벤처기업부 지방청에서 추천" },
  "장애인": {
    std: "장애인등록증 소지자 · 무주택 세대구성원",
    docs: ["장애인증명서 또는 복지카드", "주민등록등본"],
    org: "주소지 시·군·구청에서 추천" },
};

/* ── 같은 단지 안에서 유리한 타입 추정 ──
   청약홈 과거 데이터에서 반복 확인되는 패턴을 규칙으로 옮긴 추정치입니다:
   · 70~74㎡ 틈새평형은 84㎡(국민평형)보다 커트라인이 확연히 낮음 → -8점
   · 59㎡ 소형은 84㎡보다 다소 낮음 → -3점
   · 84㎡ 이상은 단지 대표 당첨선(cut) 그대로
   실제 타입별 커트라인은 공고·단지마다 다르니 어디까지나 참고용 추정입니다. */
const typeCutDelta = (typeName) => {
  const size = parseInt(typeName, 10);
  if (!size) return 0;
  if (size >= 70 && size < 80) return -8;
  if (size < 70) return -3;
  return 0;
};
/* 보정을 왜 그렇게 줬는지 화면에 같이 보여주기 위한 라벨 */
const typeCutReason = (typeName) => {
  const size = parseInt(typeName, 10);
  if (!size) return "면적 판독 불가 · 보정 없음";
  if (size >= 70 && size < 80) return "70~74㎡ 틈새평형 · 84㎡ 대비 -8점";
  if (size < 70) return "소형 · 84㎡ 대비 -3점";
  return "국민평형 이상 · 단지 대표 당첨선 그대로";
};
/* 커트라인이 낮을 것으로 보이는 순으로 정렬.
   1순위 예상 커트라인 → 2순위 세대수 많은 쪽(물량이 많을수록 당첨선이 내려가는 경향)
   → 3순위 분양가 낮은 쪽. 같은 점수대가 겹칠 때 순서를 정하는 규칙입니다. */
const rankTypesFor = (s) =>
  (s.types || [])
    .map((t) => ({ ...t, estCut: Math.max(0, s.cut + typeCutDelta(t.t)), reason: typeCutReason(t.t) }))
    .sort((a, b) => a.estCut - b.estCut || b.n - a.n || a.price - b.price);
/* 상위 N개 (타입이 N개보다 적으면 있는 만큼만) */
const bestTypesFor = (s, n = 3) => rankTypesFor(s).slice(0, n);

const CUT_BANDS = [
  { area: "서울 강남3구", lo: 69, hi: 79, note: "반포·청담·잠원 등 인기 단지" },
  { area: "서울 그 외", lo: 55, hi: 68, note: "강북·서남권 신축" },
  { area: "경기 남부", lo: 52, hi: 66, note: "과천·판교·동탄" },
  { area: "경기 북부·인천", lo: 40, hi: 58, note: "검단·고양·의정부" },
  { area: "지방 광역시", lo: 35, hi: 55, note: "부산·대구·광주" },
];

const SPECIALS2 = [
  { k: "newly", n: "신혼부부", ratio: "민영 18% · 공공 30%", ic: "💑",
    req: ["혼인 7년 이내 또는 6세 이하 자녀", "무주택 세대구성원",
          "소득 기준 (외벌이 140% · 맞벌이 200% 이하)", "청약통장 6개월 이상"],
    tip: "자녀 수와 혼인 기간이 짧을수록 유리합니다. 2세 이하 자녀가 있으면 신생아 우선공급도 함께 노려보세요." },
  { k: "first", n: "생애최초", ratio: "민영 9% · 공공 25%", ic: "🌱",
    req: ["세대 구성원 전원 생애 최초 주택 구입", "혼인 중이거나 자녀가 있을 것",
          "5년 이상 소득세 납부", "소득 기준 130% 이하 (추첨제는 완화)"],
    tip: "민영주택은 소득 초과여도 추첨 물량이 있습니다. 미혼이면 자격이 안 됩니다." },
  { k: "multi", n: "다자녀가구", ratio: "민영 10% · 공공 10%", ic: "👨‍👩‍👧‍👦",
    req: ["미성년 자녀 2명 이상 (2024년부터 완화)", "무주택 세대구성원", "청약통장 6개월 이상"],
    tip: "2024년부터 3자녀에서 2자녀로 문턱이 낮아졌습니다. 배점은 자녀 수가 절대적입니다." },
  { k: "old", n: "노부모부양", ratio: "민영 3% · 공공 5%", ic: "🧓",
    req: ["만 65세 이상 직계존속을 3년 이상 부양", "세대주일 것",
          "무주택 세대구성원 전원", "1순위 자격 보유"],
    tip: "경쟁이 가장 적은 유형입니다. 부양 기간 3년은 주민등록 기준으로 셉니다." },
  { k: "inst", n: "기관추천", ratio: "민영 10% · 공공 15%", ic: "🎖️",
    req: ["국가유공자·장애인·중소기업 근로자 등", "해당 기관 추천", "무주택"],
    tip: "기관마다 접수 창구와 마감일이 다릅니다. 청약홈 접수 전에 기관에 먼저 신청해야 합니다." },
  { k: "baby", n: "신생아 특별공급", ratio: "공공 최대 35%", ic: "👶",
    req: ["입주자모집공고일 기준 2년 이내 출생 자녀", "무주택 세대구성원",
          "소득 150% 이하 (맞벌이 200%)"],
    tip: "2024년 신설. 신혼·생애최초와 중복 신청은 안 되니 유리한 쪽 하나만 고르세요." },
];

const BANKS2 = [
  { n: "KB국민은행", v: [3.92, 5.08], f: [4.11, 5.29], note: "주택전용 우대 최대 1.0%p" },
  { n: "신한은행", v: [3.88, 5.02], f: [4.08, 5.24], note: "급여이체·카드 우대" },
  { n: "하나은행", v: [3.95, 5.12], f: [4.15, 5.32], note: "모바일 신청 0.1%p 우대" },
  { n: "우리은행", v: [3.90, 5.06], f: [4.10, 5.27], note: "청약통장 보유 우대" },
  { n: "NH농협은행", v: [3.86, 4.98], f: [4.06, 5.20], note: "지역조합 추가 우대 가능" },
  { n: "카카오뱅크", v: [3.82, 4.94], f: [4.02, 5.16], note: "비대면 · 중도상환수수료 면제" },
  { n: "케이뱅크", v: [3.84, 4.96], f: [4.04, 5.18], note: "비대면 · 서류 간소화" },
  { n: "토스뱅크", v: [3.87, 5.00], f: [4.07, 5.22], note: "비대면 · 실시간 한도조회" },
];

/* ============================================================
   훅
   ============================================================ */
function useScrollTop(deps, offset = 20) {
  const ref = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el) return;
    const t = setTimeout(() => { el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, style: { scrollMarginTop: offset } };
}

/* ============================================================
   공통 UI 조각
   ============================================================ */
/* 번들 크기를 줄이려고 스냅샷에서 뺀 설명문을 여기서 다시 만듭니다 */
function siteNote(s) {
  if (s.note) return s.note;
  if (!s.live) return "";
  const who = [s.brand && `시공 ${s.brand}`, s.receipt?.result && `당첨자발표 ${s.receipt.result}`]
    .filter(Boolean).join(" · ");
  return `청약홈 API 에서 받아온 공고입니다.${who ? " " + who + "." : ""} ` + (s.scoreless
    ? "무순위·잔여세대는 가점제가 아니라 추첨이라 가점 비교를 하지 않습니다."
    : `예상 당첨선(${s.cut}점)은 API 가 제공하지 않아 지역 기준으로 추정한 값이고, 주택명·분양가·세대수·특별공급 물량은 응답 원문 그대로입니다.`);
}

function DSec({ n, t, children }) {
  return (
    <section style={{ marginTop: 28 }}>
      <div className="mv-dbar"><b className="mv-num">{n}</b>{t}</div>
      {children}
    </section>
  );
}

/* ============================================================
   청약 · 입주설계 (메인 컴포넌트)
   ============================================================ */
function Subscription({ tab, setTab, allSites, live }) {
  const top = useScrollTop([tab]);
  /* ── 1. 공통 기본 정보 ── */
  const [isHead, setIsHead] = useState(true);            // 세대주 여부
  const [myRegion, setMyRegion] = useState("");           // 거주 지역
  const [regionSince, setRegionSince] = useState("");     // 해당 지역 계속 거주 개시일
  const [bankType, setBankType] = useState("주택청약종합저축"); // 통장 종류 — 청약 가능 주택 범위 결정
  const [bankDate, setBankDate] = useState("2018-08-01"); // 청약통장 최초 가입일
  const [spouseBankDate, setSpouseBankDate] = useState(""); // 배우자 통장 가입일 (민영 가점 최대 +3점)
  const [monthlyPay, setMonthlyPay] = useState(10);       // 월 납입액 (만원) — 자동계산용
  const [payManual, setPayManual] = useState(false);      // 납입 횟수·총액 직접 입력 모드
  const [payCountManual, setPayCountManual] = useState(96);
  const [depositManual, setDepositManual] = useState(960); // 실납입 총액·예치금 (만원, 민영용)
  const [recognizedManual, setRecognizedManual] = useState(960); // 공공 인정 납입액 (만원)
  /* ── 2. 주택 소유 이력 · 무주택 기간 ── */
  const [ownsNow, setOwnsNow] = useState(false);          // 세대원 전원 현재 유주택 여부
  const [ownedBefore, setOwnedBefore] = useState(false);  // 과거 소유 이력
  const [soldDate, setSoldDate] = useState("");           // 매도 완료일
  const [neverOwnedEver, setNeverOwnedEver] = useState(true); // 평생 무주택 (생애최초용)
  const [nhBaseDate, setNhBaseDate] = useState("2014-08-01"); // 만30세 도달일 (30세 전 혼인 시 혼인신고일)
  /* ── 3. 일반공급 ── */
  const [supplyType, setSupplyType] = useState("민영");    // 민영 / 공공
  const [applyMethod, setApplyMethod] = useState("가점제"); // 가점제 / 추첨제 (민영)
  const [fam, setFam] = useState(2);                      // 부양가족 수
  /* ── 4. 특별공급 조건 ── */
  const [marriageDate, setMarriageDate] = useState("");   // 혼인신고일 (미혼이면 비움)
  const [engaged, setEngaged] = useState(false);          // 예비 신혼부부
  const [dualIncome, setDualIncome] = useState(false);    // 맞벌이
  const [kids, setKids] = useState(1);                    // 미성년 자녀 수
  const [youngKids, setYoungKids] = useState(0);          // 만 6세 미만 자녀 수
  const [babyBirthDate, setBabyBirthDate] = useState(""); // 막내 출생일 (신생아 판정)
  const [tax5y, setTax5y] = useState(true);               // 5년 이상 소득세 납부
  const [single40, setSingle40] = useState(false);        // 만 40세 이상 1인 가구
  const [parentCare, setParentCare] = useState(false);    // 만 65세+ 직계존속 3년 이상 부양
  const [parentOwns, setParentOwns] = useState(false);    // 피부양자 주택 소유 여부
  const [agency, setAgency] = useState("");               // 기관추천 유형
  /* ── 5. 소득 · 자산 · 예산 ── */
  const [householdSize, setHouseholdSize] = useState(3);  // 세대구성원 수
  const [cash, setCash] = useState(18000);                // 보유 현금 (만원)
  const [income, setIncome] = useState(7200);             // 세전 연소득 (만원)
  const [debt, setDebt] = useState(0);
  const [totalAssets, setTotalAssets] = useState(30000);  // 총자산가액 (만원)
  const [carValue, setCarValue] = useState(2500);         // 자동차 가액 (만원)
  const [myBudget, setMyBudget] = useState(70000);        // 예산 (만원)
  /* ── 분양현장 ── */
  const [area, setArea] = useState("전체");
  const [site, setSite] = useState(null);
  /* ── 오른쪽 공고 목록 필터 ── */
  const [listRegion, setListRegion] = useState("전체");   // 희망 지역 (공고 목록 쪽에서 선택)
  const [listSp, setListSp] = useState("");               // 선택한 특공 유형 ("" = 일반공급)
  const [showClosed, setShowClosed] = useState(false);    // 접수 마감 공고까지 볼지
  const [openNews, setOpenNews] = useState(null);         // 펼친 뉴스 후보
  /* 공고 전 현장은 분양가를 알 수 없어 원가식으로 추정합니다.
     지역은 단지명과 기사 제목에서 뽑고, 없으면 추정을 포기합니다. */
  const newsPriced = useMemo(() => NEWS.candidates.map((c) => {
    const region = guessRegion(c.name, ...(c.articles || []).map((a) => a.title));
    const est = region ? estimatePrice({ region, brand: c.name, py: 34 }) : null;
    return { ...c, region, est };
  }), []);
  const [newsMore, setNewsMore] = useState(false);        // 후보 전체 보기
  /* ── 입력 마법사 ── */
  const [step, setStep] = useState(1);                    // 1 공통 → 2 일반분양 → 3 특별공급(선택) → 4 결과
  const [spEntered, setSpEntered] = useState(false);      // 특별공급 조건까지 입력하고 제출했는지

  /* ── 가점 (청약홈 공식 배점표 기준으로 계산) ──────────────
     무주택기간: 만 30세 도달일(30세 전 혼인 시 혼인신고일)부터 자동 계산.
       과거 소유 이력이 있으면 매도 완료일부터 다시 세고, 현재 유주택이면 0점.
       1년 미만 2점, 이후 1년당 +2점, 15년 이상 32점 상한 (공식 배점표 대조 검증).
     청약통장: 최초 가입일 기준 자동 계산 (6개월 미만 1점, 6개월~1년 2점,
       1년 이상 (년수+2)점, 15년 이상 17점 상한 — 전 구간 대조 검증). */
  const getAccountScore = (dateStr) => {
    if (!dateStr) return 0;
    const join = new Date(dateStr);
    const now = new Date();
    if (Number.isNaN(join.getTime())) return 0;
    let months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
    if (now.getDate() < join.getDate()) months -= 1;
    if (months < 0) return 0;
    if (months < 6) return 1;
    if (months < 12) return 2;
    const years = Math.floor(months / 12);
    return Math.min(17, years + 2);
  };
  const monthsFrom = (dateStr) => {
    if (!dateStr) return -1;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return -1;
    const now = new Date();
    let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) m -= 1;
    return Math.max(-1, m);
  };
  const yearsFrom = (dateStr) => {
    const m = monthsFrom(dateStr);
    return m < 0 ? 0 : Math.floor(m / 12);
  };
  /* 무주택기간: 만 30세 도달일(30세 전 혼인이면 혼인신고일)부터.
     과거에 집을 팔았다면 매도 완료일부터 다시 셉니다. 현재 유주택이면 0점. */
  const nhStart = ownedBefore && soldDate && new Date(soldDate) > new Date(nhBaseDate) ? soldDate : nhBaseDate;
  const nhYears = ownsNow ? 0 : yearsFrom(nhStart);
  const nhScore = ownsNow ? 0 : nhYears < 1 ? 2 : Math.min(32, (nhYears + 1) * 2);
  const famScore = Math.min(35, 5 + fam * 5);
  /* 통장 가점: 본인 가입기간 점수 + 배우자 통장 가입기간 점수의 50%(최대 3점), 합산 17점 상한.
     배우자 합산은 2024년 도입 제도로, 소수점은 보수적으로 버림 처리했습니다. */
  const bankScoreSelf = getAccountScore(bankDate);
  const spouseBonus = spouseBankDate ? Math.min(3, Math.floor(getAccountScore(spouseBankDate) / 2)) : 0;
  const bankScore = Math.min(17, bankScoreSelf + spouseBonus);
  /* 가입일부터 매달 납입했다고 보고 자동 계산 — 불규칙하게 넣었다면 직접 입력 모드로 */
  const payCountAuto = Math.max(0, monthsFrom(bankDate));
  const depositAuto = payCountAuto * monthlyPay;
  /* 공공분양 월 인정 한도: 1983.4~2024.10은 10만원, 2024.11부터 25만원 (41년 만의 상향).
     실제로 얼마를 넣었든 공공 청약에서는 이 한도까지만 납입액으로 인정됩니다. */
  const monthsAfterCap = Math.min(payCountAuto, Math.max(0, monthsFrom("2024-11-01")));
  const monthsBeforeCap = payCountAuto - monthsAfterCap;
  const recognizedAuto = monthsBeforeCap * Math.min(monthlyPay, 10) + monthsAfterCap * Math.min(monthlyPay, 25);
  const payCountEff = payManual ? payCountManual : payCountAuto;
  const recognizedEff = payManual ? recognizedManual : recognizedAuto;
  const score = nhScore + famScore + bankScore;
  const band = CUT_BANDS.find((b) => score >= b.lo) || CUT_BANDS[CUT_BANDS.length - 1];
  /* 특공 판정에 쓰는 파생값 */
  const isMarried = !!marriageDate;
  const marriedYears = yearsFrom(marriageDate);
  const babyMonths = monthsFrom(babyBirthDate);
  const babyYears = babyMonths < 0 ? -1 : Math.floor(babyMonths / 12);

  /* ── 특별공급 판정 ─────────────────────────────────── */
  const specialFit = useMemo(() => SPECIALS2.map((sp) => {
    let ok = false, why = "";
    if (sp.k === "newly") {
      ok = engaged || (isMarried && marriedYears <= 7) || (isMarried && kids > 0 && babyYears >= 0 && babyYears <= 6);
      why = ok
        ? engaged ? "예비 신혼부부" : `혼인 ${marriedYears}년${kids > 0 ? ` · 자녀 ${kids}명` : ""}${dualIncome ? " · 맞벌이(소득기준 완화)" : ""}`
        : isMarried ? "혼인 7년 초과 · 6세 이하 자녀 없음" : "혼인신고일이 없습니다";
    } else if (sp.k === "first") {
      ok = neverOwnedEver && !ownsNow && !ownedBefore && tax5y && (isMarried || kids > 0 || single40);
      why = ok ? "평생 무주택 · 소득세 5년 납부" :
        !neverOwnedEver || ownsNow || ownedBefore ? "주택 보유 이력 있음" :
        !tax5y ? "소득세 5년 납부 실적 필요" : "혼인·자녀 또는 만 40세 이상 1인 가구 필요";
    } else if (sp.k === "multi") {
      ok = kids >= 2;
      why = ok ? `미성년 자녀 ${kids}명${youngKids > 0 ? ` · 영유아 ${youngKids}명` : ""}` : `자녀 ${kids}명 · 2명 이상 필요`;
    } else if (sp.k === "old") {
      ok = parentCare && !parentOwns;
      why = parentCare ? (parentOwns ? "부양 직계존속이 주택 보유 중 (무주택 요건 미충족)" : "만 65세 이상 3년 부양") : "해당 없음";
    } else if (sp.k === "baby") {
      ok = babyMonths >= 0 && babyMonths <= 24;
      why = ok ? `막내 출생 ${babyMonths}개월` : babyBirthDate ? `출생 ${babyMonths}개월 · 24개월 이내 필요` : "출생일이 없습니다";
    } else {
      ok = agency ? null : false;
      why = agency ? `${agency} · 기관 추천서 확인 필요` : "선택한 추천 기관 없음";
    }
    return { ...sp, ok, why };
  }), [engaged, isMarried, marriedYears, dualIncome, kids, youngKids, babyYears, babyMonths, babyBirthDate,
       neverOwnedEver, ownsNow, ownedBefore, tax5y, single40, parentCare, parentOwns, agency]);
  const fitCount = specialFit.filter((x) => x.ok === true).length;

  /* ── 대출 ─────────────────────────────────────────── */
  const STRESS = 1.5;
  const pay = (P, rPct, yrs = 30) => {
    const r = rPct / 100 / 12, n = yrs * 12;
    return r === 0 ? P / n : Math.round((P * r) / (1 - Math.pow(1 + r, -n)));
  };
  const limitByDsr = (rPct, yrs = 30) => {
    const monthly = (income * 10000 * 0.4) / 12 - (debt * 10000 * 0.05) / 12;
    if (monthly <= 0) return 0;
    const r = (rPct + STRESS) / 100 / 12, n = yrs * 12;
    const wonAmt = (monthly * (1 - Math.pow(1 + r, -n))) / r;
    return Math.floor(wonAmt / 10000 / 100) * 100;
  };
  const banksCalc = useMemo(() => BANKS2.map((b) => {
    const rate = b.v[0];
    const cap = limitByDsr(rate);
    return { ...b, rate, cap, monthly: pay(cap * 10000, rate) };
  }).sort((a, b) => b.cap - a.cap || a.rate - b.rate),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [income, debt]);
  const bestBank = banksCalc[0];
  const budget = cash + (bestBank ? bestBank.cap : 0);

  /* ── 분양현장 ─────────────────────────────────────── */
  /* 청약홈 주소는 "충청남도"·"경상북도" 처럼 정식 명칭이라
     "충남"·"경북" 칩만으로는 매칭이 안 됩니다. 별칭을 함께 둡니다. */
  const areas = ["전체", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
  const AREA_ALIAS = {
    충북: ["충청북도", "충북"], 충남: ["충청남도", "충남"],
    전북: ["전북", "전라북도"], 전남: ["전라남도", "전남"],
    경북: ["경상북도", "경북"], 경남: ["경상남도", "경남"],
  };
  const inArea = (site, a) =>
    a === "전체" || (AREA_ALIAS[a] || [a]).some((pre) => (site.gu || "").startsWith(pre));
  const s2r = (s) => (s.status === "접수 중" ? 0 : s.status === "접수 예정" ? 1 : 2);
  /* 접수 시작까지 남은 일수 */
  const daysUntil = (d) => {
    if (!d) return null;
    const t = new Date(d + "T00:00:00");
    if (Number.isNaN(t.getTime())) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((t - now) / 86400000));
  };
  /* 통장 종류가 선택한 공급유형에 청약 가능한지 (예·부금=민영만, 청약저축=공공만, 종합·드림=전부) */
  const bankOk = supplyType === "공공"
    ? !(bankType === "청약예금" || bankType === "청약부금")
    : bankType !== "청약저축";
  /* 무순위·잔여세대는 추첨이라 가점 목록에서 빼고 따로 보여줍니다 */
  const scored = allSites.filter((s) => !s.scoreless);
  const siteList = scored
    .filter((s) => s.supply === supplyType)
    .filter((s) => showClosed || s.status !== "접수 마감")
    .filter((s) => inArea(s, area))
    .sort((a, b) => (s2r(a) - s2r(b)) ||
      (supplyType === "공공" ? (a.cutAmt || 0) - (b.cutAmt || 0) : a.cut - b.cut));
  /* 오른쪽 공고 목록: 공급유형·지역으로 거르고, 민영=당첨선 낮은순 / 공공=인정액 컷 낮은순 */
  /* 이미 끝난 공고를 위에 두면 쓸모가 없어서, 접수 상태를 1순위로 정렬합니다 */
  const statusRank = (s) => (s.status === "접수 중" ? 0 : s.status === "접수 예정" ? 1 : 2);
  const byCut = (a, b) =>
    supplyType === "공공" ? (a.cutAmt || 0) - (b.cutAmt || 0) : a.cut - b.cut;
  const mine = scored
    .filter((s) => s.supply === supplyType)
    .filter((s) => inArea(s, listRegion));
  /* 지금 접수 중인 공고 (+ 토글을 켜면 마감분까지) */
  const rightSites = mine
    .filter((s) => s.status === "접수 중" || (showClosed && s.status === "접수 마감"))
    .sort((a, b) => statusRank(a) - statusRank(b) || byCut(a, b));
  /* 공고는 났고 접수가 아직 시작되지 않은 공고 — 접수 시작일 빠른 순.
     곧 열리는 공고는 전국에 몇 건 안 되므로 민영·공공을 같이 봅니다.
     무순위·잔여세대는 아래 전용 섹션이 있어 제외합니다. */
  const upcoming = scored
    .filter((x) => x.status === "접수 예정")
    .filter((x) => inArea(x, listRegion))
    .sort((a2, b2) => String(a2.rceptStart || "9999").localeCompare(String(b2.rceptStart || "9999")));
  /* 무순위·잔여세대 */
  const noScoreSites = allSites
    .filter((x) => x.scoreless)
    .filter((x) => showClosed || x.status !== "접수 마감")
    .filter((x) => inArea(x, listRegion))
    .sort((a2, b2) => s2r(a2) - s2r(b2) || String(b2.when).localeCompare(String(a2.when)));

  /* 공고 전 단지 — 시세 혼합을 걷어내고 산식 하나로만 계산합니다.
     절반씩 섞으면 원가 추정인지 시세 반영인지 알 수 없어지고 검증도 안 됩니다. */
  const rightPre = PRE_SITES
    .filter((x) => x.supply === supplyType)
    .filter((x) => inArea(x, listRegion))
    .map((x) => {
      const est = estimatePrice({ region: `${x.gu} ${x.n}`, brand: x.n, py: x.py });
      const manualPy = Math.round((x.land + x.constCost) * (1 + x.margin));
      return { ...x, est, manualPy, manualTotal: manualPy * x.py };
    })
    .sort((a2, b2) => a2.est.total - b2.est.total);
  const [openPre, setOpenPre] = useState(null); // 산출 과정 펼친 공고전 단지 id
  /* 프로필을 바꿔서 자격이 사라진 특공 유형이 선택된 채 남지 않도록 */
  const activeSp = listSp && specialFit.some((x) => x.k === listSp && x.ok === true) ? listSp : "";
  /* 분양공고 모달의 기준 타입 (84㎡ 우선, 없으면 가장 큰 타입)과 예산 대비 차액 */
  const siteRefType = site ? site.types.find((t) => t.t.startsWith("84")) || site.types[site.types.length - 1] : null;
  const siteDiff = siteRefType ? siteRefType.price - myBudget : 0;

  /* ══════════════ 허브 ══════════════ */
  if (!tab) {
    return (
      <div className="mv-wrap mv-sec">
        <div ref={top.ref} style={top.style} />
        <div className="mv-between" style={{ marginBottom: 22, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div className="mv-eyebrow">청약 · 입주설계</div>
            <h2 style={{ fontSize: 32, letterSpacing: "-.05em", fontWeight: 900, marginTop: 4 }}>
              당첨부터 잔금까지
            </h2>
            <p style={{ color: "var(--ink-2)", fontSize: 16, marginTop: 6, maxWidth: "56ch" }}>
              가점을 계산하고, 넣을 수 있는 특별공급을 찾고, 은행별 한도까지 한 화면에서 봅니다.
            </p>
          </div>
          <span className="mv-chip mv-warn" style={{ padding: "9px 15px", fontSize: 13 }}>
            2026년 8월 기준 · 청약홈 · 은행연합회
          </span>
        </div>

        <div className="mv-subsum">
          <div>
            <span className="mv-eyebrow" style={{ color: "rgba(255,255,255,.7)" }}>내 가점</span>
            <div className="mv-num" style={{ fontSize: 38, fontWeight: 900, letterSpacing: "-.05em" }}>
              {score}<small style={{ fontSize: 17, opacity: .7 }}> / 84</small>
            </div>
            <div style={{ fontSize: 13.5, opacity: .85, marginTop: 2 }}>{band.area}권 진입 가능</div>
          </div>
          <div className="mv-subsum-div" />
          <div>
            <span className="mv-eyebrow" style={{ color: "rgba(255,255,255,.7)" }}>넣을 수 있는 특공</span>
            <div className="mv-num" style={{ fontSize: 38, fontWeight: 900, letterSpacing: "-.05em" }}>
              {fitCount}<small style={{ fontSize: 17, opacity: .7 }}>개 유형</small>
            </div>
            <div style={{ fontSize: 13.5, opacity: .85, marginTop: 2 }}>
              {specialFit.filter((x) => x.ok).map((x) => x.n).slice(0, 2).join(" · ") || "일반공급만 가능"}
            </div>
          </div>
          <div className="mv-subsum-div" />
          <div>
            <span className="mv-eyebrow" style={{ color: "rgba(255,255,255,.7)" }}>예상 예산</span>
            <div className="mv-num" style={{ fontSize: 38, fontWeight: 900, letterSpacing: "-.05em" }}>
              {eok(budget)}<small style={{ fontSize: 17, opacity: .7 }}>원</small>
            </div>
            <div style={{ fontSize: 13.5, opacity: .85, marginTop: 2 }}>
              현금 {eok(cash)} + 대출 {bestBank ? eok(bestBank.cap) : "—"}
            </div>
          </div>
        </div>

        <div className="mv-chgrid" style={{ marginTop: 24 }}>
          {SUB_CH.map((c) => (
            <button key={c.k} className="mv-chcard" onClick={() => setTab(c.k)}>
              <div className="mv-chtop" style={{ background: `linear-gradient(170deg, ${c.c}0D, ${c.c}1F)`, height: 148 }}>
                <div style={{ fontSize: 44 }}>{c.ic}</div>
                <span style={{
                  fontSize: 27, fontWeight: 900, letterSpacing: "-.07em", lineHeight: 1,
                  backgroundImage: `linear-gradient(178deg, ${c.c2} 10%, ${c.c} 85%)`,
                  WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                  WebkitTextFillColor: "transparent", display: "block", marginTop: 8,
                }}>{c.n}</span>
                <div className="mv-slot-cat" style={{ color: c.c }}>{c.cat}</div>
              </div>
              <div className="mv-chbody">
                <p>{c.desc}</p>
                <div className="mv-between" style={{ marginTop: 14, fontSize: 13.5 }}>
                  <span style={{ color: "var(--ink-3)" }}>
                    {c.k === "score" ? `분양 ${allSites.length} · 특공 ${SPECIALS2.length}유형` : "게시판 · 댓글"}
                  </span>
                  <b style={{ color: c.c }}>보기 →</b>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const meta = SUB_CH.find((c) => c.k === tab);

  return (
    <div className="mv-wrap mv-sec">
      <div ref={top.ref} style={top.style} />
      <button className="mv-btn mv-ghost mv-sm" style={{ marginBottom: 18 }} onClick={() => setTab(null)}>
        ← 청약 전체
      </button>

      <div className="mv-chero" style={{ background: `linear-gradient(150deg, ${meta.c}0F, ${meta.c}24)`,
        borderColor: `${meta.c}33`, marginBottom: 24 }}>
        <div style={{ fontSize: 52 }}>{meta.ic}</div>
        <div>
          <div className="mv-eyebrow" style={{ color: meta.c }}>{meta.cat}</div>
          <span style={{
            fontSize: 36, fontWeight: 900, letterSpacing: "-.07em",
            backgroundImage: `linear-gradient(178deg, ${meta.c2} 10%, ${meta.c} 85%)`,
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            WebkitTextFillColor: "transparent", display: "block",
          }}>{meta.n}</span>
          <p>{meta.desc}</p>
        </div>
      </div>

      {/* ══════════════ 가점 계산 ══════════════ */}
      {tab === "score" && (
        <>
        {step < 4 && (
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <div className="mv-row" style={{ gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
            {["공통사항", "일반분양", "특별공급 (선택)"].map((n, i) => (
              <span key={n} className={"mv-chip" + (step === i + 1 ? " mv-on" : "")} style={{ fontSize: 12.5 }}>
                {i + 1}. {n}
              </span>
            ))}
          </div>
          {step === 1 && (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="mv-card mv-pad">
              <div className="mv-eyebrow" style={{ marginBottom: 16 }}>기본 정보 · 청약통장</div>
              <div className="mv-field">
                <label>세대주 여부</label>
                <div className="mv-row" style={{ gap: 6 }}>
                  {["세대주", "세대원"].map((v, i) => (
                    <button key={v} className={"mv-chip" + ((i === 0) === isHead ? " mv-on" : "")}
                      style={{ padding: "9px 18px" }} onClick={() => setIsHead(i === 0)}>{v}</button>
                  ))}
                </div>
              </div>
              <div className="mv-field">
                <label htmlFor="sc-region">거주 지역 (주민등록상)</label>
                <select id="sc-region" className="mv-in" value={myRegion} onChange={(e) => setMyRegion(e.target.value)}>
                  <option value="">선택 안 함</option>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="mv-field">
                <label htmlFor="sc-since">해당 지역 계속 거주 개시일 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 당해 우선공급용</b></label>
                <div className="mv-row" style={{ gap: 8 }}>
                  <input id="sc-since" type="date" className="mv-in" style={{ flex: 1 }} value={regionSince}
                    onChange={(e) => setRegionSince(e.target.value)} />
                  {regionSince && (
                    <button className="mv-btn mv-ghost mv-sm" style={{ flex: "none" }}
                      onClick={() => setRegionSince("")}>지우기</button>
                  )}
                </div>
              </div>
              <div className="mv-field">
                <label htmlFor="sc-btype">청약통장 종류</label>
                <select id="sc-btype" className="mv-in" value={bankType} onChange={(e) => setBankType(e.target.value)}>
                  {["주택청약종합저축", "청년주택드림 청약통장", "청약저축", "청약예금", "청약부금"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 5, lineHeight: 1.6 }}>
                  {bankType === "청약저축" ? "청약저축은 공공(국민주택)만 청약 가능해요. 민영도 넣으려면 종합저축 전환(2024.10부터 허용)이 필요합니다."
                    : bankType === "청약예금" || bankType === "청약부금"
                    ? `${bankType}은 민영주택만 청약 가능해요${bankType === "청약부금" ? " (85㎡ 이하)" : ""}. 공공도 넣으려면 종합저축 전환이 필요합니다.`
                    : "모든 주택 유형(공공·민영)에 청약할 수 있어요. 종류는 점수가 아니라 청약 가능 범위를 결정합니다."}
                </div>
              </div>
              <div className="mv-field">
                <label htmlFor="sc-bk">청약통장 최초 가입일</label>
                <input id="sc-bk" type="date" className="mv-in" value={bankDate}
                  onChange={(e) => setBankDate(e.target.value)} />
                <div className="mv-between" style={{ marginTop: 6 }}>
                  <span className="mv-num" style={{ fontSize: 13, color: "var(--ink-3)" }}>가입기간 기준 자동 계산</span>
                  <span className="mv-chip mv-on">{bankScore}점 <small style={{ opacity: .7 }}>/17</small></span>
                </div>
              </div>
              <div className="mv-field">
                <label htmlFor="sc-sbk">배우자 통장 가입일 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 기혼자만 · 없으면 비움</b></label>
                <div className="mv-row" style={{ gap: 8 }}>
                  <input id="sc-sbk" type="date" className="mv-in" style={{ flex: 1 }} value={spouseBankDate}
                    onChange={(e) => setSpouseBankDate(e.target.value)} />
                  {spouseBankDate && (
                    <button className="mv-btn mv-ghost mv-sm" style={{ flex: "none" }}
                      onClick={() => setSpouseBankDate("")}>지우기</button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 5 }}>
                  배우자 가입기간 점수의 50%를 최대 3점까지 합산해요{spouseBonus > 0 ? ` (지금 +${spouseBonus}점 반영 중)` : ""}. 합산해도 17점을 넘지 않습니다.
                </div>
              </div>
              <div className="mv-field" style={{ marginBottom: 0 }}>
                <div className="mv-between" style={{ marginBottom: 10 }}>
                  <label style={{ margin: 0 }}>납입 횟수 · 총액</label>
                  <div className="mv-row" style={{ gap: 5 }}>
                    <button className={"mv-chip" + (!payManual ? " mv-on" : "")} style={{ padding: "6px 12px", fontSize: 12 }}
                      onClick={() => setPayManual(false)}>자동 계산</button>
                    <button className={"mv-chip" + (payManual ? " mv-on" : "")} style={{ padding: "6px 12px", fontSize: 12 }}
                      onClick={() => {
                        if (!payManual) { setPayCountManual(payCountAuto); setDepositManual(depositAuto); setRecognizedManual(recognizedAuto); }
                        setPayManual(true);
                      }}>직접 입력</button>
                  </div>
                </div>
                {!payManual ? (
                  <>
                    <label htmlFor="sc-mpay" style={{ fontSize: 12.5 }}>월 납입액 (만원)</label>
                    <input id="sc-mpay" type="number" className="mv-in" value={monthlyPay === 0 ? "" : monthlyPay}
                      onChange={(e) => setMonthlyPay(Math.max(0, Number(e.target.value) || 0))} />
                    <div className="mv-between" style={{ marginTop: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--ink-3)" }}>납입 횟수 <b style={{ fontWeight: 600 }}>· 공공용</b></span>
                      <span className="mv-chip mv-cool">{payCountAuto}회 자동</span>
                    </div>
                    <div className="mv-between" style={{ marginTop: 6 }}>
                      <span style={{ fontSize: 13, color: "var(--ink-3)" }}>실납입 총액 <b style={{ fontWeight: 600 }}>· 예치금(민영)</b></span>
                      <span className="mv-chip mv-cool">{eok(depositAuto)}원 자동</span>
                    </div>
                    <div className="mv-between" style={{ marginTop: 6 }}>
                      <span style={{ fontSize: 13, color: "var(--ink-3)" }}>공공 인정 납입액 <b style={{ fontWeight: 600 }}>· 한도 적용</b></span>
                      <span className="mv-chip mv-on">{eok(recognizedAuto)}원</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.6 }}>
                      공공분양은 월 10만원(2024.11부터 25만원)까지만 납입액으로 인정돼서, 실납입과
                      인정액이 다를 수 있어요. 건너뛴 달이 있거나 금액이 달랐다면 <b>직접 입력</b>으로
                      실제 통장 값을 넣어주세요.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mv-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label htmlFor="sc-pcm" style={{ fontSize: 12.5 }}>납입 횟수 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 공공용</b></label>
                        <input id="sc-pcm" type="number" className="mv-in" value={payCountManual === 0 ? "" : payCountManual}
                          onChange={(e) => setPayCountManual(Math.max(0, Number(e.target.value) || 0))} />
                      </div>
                      <div>
                        <label htmlFor="sc-dpm" style={{ fontSize: 12.5 }}>예치금 잔액 (만원) <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 민영용</b></label>
                        <input id="sc-dpm" type="number" className="mv-in" value={depositManual === 0 ? "" : depositManual}
                          onChange={(e) => setDepositManual(Math.max(0, Number(e.target.value) || 0))} />
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <label htmlFor="sc-rcm" style={{ fontSize: 12.5 }}>공공 인정 납입액 (만원) <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 은행 확인값</b></label>
                      <input id="sc-rcm" type="number" className="mv-in" value={recognizedManual === 0 ? "" : recognizedManual}
                        onChange={(e) => setRecognizedManual(Math.max(0, Number(e.target.value) || 0))} />
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
                      통장 앱이나 은행 창구에서 확인한 실제 <b>인정 회차</b>·<b>인정 납입액</b>·<b>잔액</b>을 그대로 넣으시면 돼요.
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mv-card mv-pad">
              <div className="mv-eyebrow" style={{ marginBottom: 16 }}>주택 소유 이력 · 무주택 기간</div>
              <div className="mv-field" style={ownsNow ? { marginBottom: 0 } : undefined}>
                <label>세대원 전원 현재 주택 소유 여부</label>
                <div className="mv-row" style={{ gap: 6 }}>
                  {["무주택", "유주택"].map((v, i) => (
                    <button key={v} className={"mv-chip" + ((i === 1) === ownsNow ? " mv-on" : "")}
                      style={{ padding: "9px 18px" }} onClick={() => setOwnsNow(i === 1)}>{v}</button>
                  ))}
                </div>
                {ownsNow && (
                  <div className="mv-between" style={{ marginTop: 12 }}>
                    <span style={{ fontSize: 12.5, color: "#A93F1F" }}>
                      유주택 세대는 무주택기간 점수가 0점입니다. 관련 항목은 입력할 필요 없어요.
                    </span>
                    <span className="mv-chip">0점 <small style={{ opacity: .7 }}>/32</small></span>
                  </div>
                )}
              </div>
              {!ownsNow && (
                <>
                  <div className="mv-field">
                    <label>과거 주택 소유 이력</label>
                    <button className={"mv-chip" + (ownedBefore ? " mv-on" : "")} style={{ padding: "10px 16px", width: "100%" }}
                      onClick={() => setOwnedBefore((v) => !v)}>
                      {ownedBefore ? "✓ 소유했다가 처분한 적 있음" : "소유한 적 없음"}
                    </button>
                  </div>
                  {ownedBefore && (
                    <div className="mv-field">
                      <label htmlFor="sc-sold">매도 완료일 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 이날부터 무주택기간 다시 계산</b></label>
                      <div className="mv-row" style={{ gap: 8 }}>
                        <input id="sc-sold" type="date" className="mv-in" style={{ flex: 1 }} value={soldDate}
                          onChange={(e) => setSoldDate(e.target.value)} />
                        {soldDate && (
                          <button className="mv-btn mv-ghost mv-sm" style={{ flex: "none" }}
                            onClick={() => setSoldDate("")}>지우기</button>
                        )}
                      </div>
                    </div>
                  )}
                  {!ownedBefore && (
                    <div className="mv-field">
                      <label>평생 무주택 여부 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 생애최초용</b></label>
                      <button className={"mv-chip" + (neverOwnedEver ? " mv-on" : "")} style={{ padding: "10px 16px", width: "100%" }}
                        onClick={() => setNeverOwnedEver((v) => !v)}>
                        {neverOwnedEver ? "✓ 세대 전원 출생 후 한 번도 소유한 적 없음" : "소유 이력 있음"}
                      </button>
                    </div>
                  )}
                  <div className="mv-field" style={{ marginBottom: 0 }}>
                    <label htmlFor="sc-nhbase">만 30세가 된 날 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 30세 전 혼인 시 혼인신고일</b></label>
                    <input id="sc-nhbase" type="date" className="mv-in" value={nhBaseDate}
                      onChange={(e) => setNhBaseDate(e.target.value)} />
                    <div className="mv-between" style={{ marginTop: 6 }}>
                      <span className="mv-num" style={{ fontSize: 14, fontWeight: 800 }}>
                        무주택 {nhYears >= 15 ? "15년 이상" : `${nhYears}년`}
                      </span>
                      <span className="mv-chip mv-on">{nhScore}점 <small style={{ opacity: .7 }}>/32</small></span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mv-card mv-pad">
              <div className="mv-eyebrow" style={{ marginBottom: 16 }}>소득 · 자산 · 예산</div>
              <div className="mv-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="mv-field">
                  <label htmlFor="sc-hh">세대구성원 수</label>
                  <input id="sc-hh" type="number" className="mv-in" value={householdSize}
                    onChange={(e) => setHouseholdSize(Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <div className="mv-field">
                  <label htmlFor="sc-inc">세전 연소득 (만원)</label>
                  <input id="sc-inc" type="number" className="mv-in" value={income === 0 ? "" : income}
                    onChange={(e) => setIncome(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div className="mv-field">
                  <label htmlFor="sc-asset">총자산가액 (만원)</label>
                  <input id="sc-asset" type="number" className="mv-in" value={totalAssets === 0 ? "" : totalAssets}
                    onChange={(e) => setTotalAssets(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div className="mv-field">
                  <label htmlFor="sc-car">자동차 가액 (만원)</label>
                  <input id="sc-car" type="number" className="mv-in" value={carValue === 0 ? "" : carValue}
                    onChange={(e) => setCarValue(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div className="mv-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="sc-cash">보유 현금 (만원)</label>
                  <input id="sc-cash" type="number" className="mv-in" value={cash === 0 ? "" : cash}
                    onChange={(e) => setCash(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div className="mv-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="sc-budget">예산 (만원)</label>
                  <input id="sc-budget" type="number" className="mv-in" value={myBudget === 0 ? "" : myBudget}
                    onChange={(e) => setMyBudget(Math.max(0, Number(e.target.value) || 0))} />
                </div>
              </div>
              <div className="mv-note" style={{ marginTop: 14, fontSize: 12.5 }}>
                월평균 소득 약 <b className="mv-num">{Math.round(income / 12).toLocaleString()}만원</b>.
                소득·자산 기준(도시근로자 100~160% 등)은 공고마다 달라서, 여기 값은 공고문 기준표와
                직접 비교하는 참고용으로만 씁니다.
              </div>
            </div>
          </div>
          )}
          {step === 2 && (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="mv-card mv-pad">
              <div className="mv-eyebrow" style={{ marginBottom: 16 }}>신청 유형 · 부양가족</div>
              <div className="mv-field">
                <label>공급 유형</label>
                <div className="mv-row" style={{ gap: 6 }}>
                  {["민영", "공공"].map((v) => (
                    <button key={v} className={"mv-chip" + (supplyType === v ? " mv-on" : "")}
                      style={{ padding: "9px 18px" }} onClick={() => setSupplyType(v)}>{v}주택</button>
                  ))}
                </div>
              </div>
              {supplyType === "민영" && (
                <div className="mv-field">
                  <label>신청 방식</label>
                  <div className="mv-row" style={{ gap: 6 }}>
                    {["가점제", "추첨제"].map((v) => (
                      <button key={v} className={"mv-chip" + (applyMethod === v ? " mv-on" : "")}
                        style={{ padding: "9px 18px" }} onClick={() => setApplyMethod(v)}>{v}</button>
                    ))}
                  </div>
                </div>
              )}
              {supplyType === "공공" && (bankType === "청약예금" || bankType === "청약부금") && (
                <div className="mv-note" style={{ marginBottom: 14, fontSize: 12.5, borderLeft: "3px solid #C1440E" }}>
                  <b>{bankType}으로는 공공주택 청약이 안 돼요.</b> 종합저축 전환(2024.10부터 허용) 후 가능합니다.
                </div>
              )}
              {supplyType === "민영" && bankType === "청약저축" && (
                <div className="mv-note" style={{ marginBottom: 14, fontSize: 12.5, borderLeft: "3px solid #C1440E" }}>
                  <b>청약저축으로는 민영주택 청약이 안 돼요.</b> 종합저축 전환(2024.10부터 허용) 후 가능합니다.
                </div>
              )}
              {supplyType === "공공" && (
                <div className="mv-note" style={{ marginBottom: 14, fontSize: 12.5 }}>
                  공공주택 일반공급은 가점제가 아니라 순차제 경쟁입니다 — <b>40㎡ 초과는 저축총액(인정액) 많은 순, 40㎡ 이하는 납입 횟수 많은 순</b>.
                  현재 납입 {payCountEff}회 · 인정 납입액 {eok(recognizedEff)}원 기준으로 공고별 커트라인과 비교하세요. 참고로 최근 당첨 안정권은 약 1,200~1,500만원 수준으로 알려져 있어요.
                </div>
              )}
              <div className="mv-field" style={{ marginBottom: 0 }}>
                <label htmlFor="sc-fam">부양가족 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 본인 제외</b></label>
                <input id="sc-fam" type="range" min="0" max="6" value={fam}
                  onChange={(e) => setFam(+e.target.value)} className="mv-range" />
                <div className="mv-between" style={{ marginTop: 6 }}>
                  <span className="mv-num" style={{ fontSize: 15, fontWeight: 800 }}>
                    {fam >= 6 ? "6명 이상" : `${fam}명`}
                  </span>
                  <span className="mv-chip mv-on">{famScore}점 <small style={{ opacity: .7 }}>/35</small></span>
                </div>
              </div>
              <div className="mv-note" style={{ marginTop: 14, fontSize: 12.5 }}>
                부양가족은 <b>배우자 + 같은 등본상 직계존속(3년 이상 부양) + 미혼 직계비속</b>, 본인 제외입니다.
              </div>
            </div>

          </div>
          )}
          {step === 3 && (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="mv-card mv-pad">
              <div className="mv-eyebrow" style={{ marginBottom: 16 }}>특별공급 조건</div>
              <div className="mv-field">
                <label htmlFor="sc-marry">혼인신고일 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 미혼이면 비워두세요</b></label>
                <div className="mv-row" style={{ gap: 8 }}>
                  <input id="sc-marry" type="date" className="mv-in" style={{ flex: 1 }} value={marriageDate}
                    onChange={(e) => setMarriageDate(e.target.value)} />
                  {marriageDate && (
                    <button className="mv-btn mv-ghost mv-sm" style={{ flex: "none" }}
                      onClick={() => setMarriageDate("")}>지우기</button>
                  )}
                </div>
                {isMarried && (
                  <span className="mv-num" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 5, display: "block" }}>
                    혼인 {marriedYears}년차
                  </span>
                )}
              </div>
              <div className="mv-row" style={{ gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                <button className={"mv-chip" + (engaged ? " mv-on" : "")} style={{ padding: "9px 14px" }}
                  onClick={() => setEngaged((v) => !v)}>{engaged ? "✓ " : ""}예비 신혼부부</button>
                <button className={"mv-chip" + (dualIncome ? " mv-on" : "")} style={{ padding: "9px 14px" }}
                  onClick={() => setDualIncome((v) => !v)}>{dualIncome ? "✓ " : ""}맞벌이</button>
              </div>
              <div className="mv-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="mv-field">
                  <label htmlFor="sc-kids">미성년 자녀</label>
                  <input id="sc-kids" type="range" min="0" max="4" value={kids}
                    onChange={(e) => setKids(+e.target.value)} className="mv-range" />
                  <span className="mv-num" style={{ fontSize: 14, fontWeight: 800 }}>{kids}명</span>
                </div>
                <div className="mv-field">
                  <label htmlFor="sc-young">만 6세 미만</label>
                  <input id="sc-young" type="range" min="0" max="4" value={youngKids}
                    onChange={(e) => setYoungKids(+e.target.value)} className="mv-range" />
                  <span className="mv-num" style={{ fontSize: 14, fontWeight: 800 }}>{youngKids}명</span>
                </div>
              </div>
              {kids > 0 && (
                <div className="mv-field">
                  <label htmlFor="sc-baby">막내 출생일 <b style={{ color: "var(--ink-3)", fontWeight: 600 }}>· 신생아 특공: 24개월 이내 · 임신 중이면 임신진단서 발급일, 입양은 입양신고일</b></label>
                  <div className="mv-row" style={{ gap: 8 }}>
                    <input id="sc-baby" type="date" className="mv-in" style={{ flex: 1 }} value={babyBirthDate}
                      onChange={(e) => setBabyBirthDate(e.target.value)} />
                    {babyBirthDate && (
                      <button className="mv-btn mv-ghost mv-sm" style={{ flex: "none" }}
                        onClick={() => setBabyBirthDate("")}>지우기</button>
                    )}
                  </div>
                </div>
              )}
              <div className="mv-row" style={{ gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                <button className={"mv-chip" + (tax5y ? " mv-on" : "")} style={{ padding: "9px 14px" }}
                  onClick={() => setTax5y((v) => !v)}>{tax5y ? "✓ " : ""}소득세 5년 이상 납부</button>
                <button className={"mv-chip" + (single40 ? " mv-on" : "")} style={{ padding: "9px 14px" }}
                  onClick={() => setSingle40((v) => !v)}>{single40 ? "✓ " : ""}만 40세 이상 1인 가구</button>
                <button className={"mv-chip" + (parentCare ? " mv-on" : "")} style={{ padding: "9px 14px" }}
                  onClick={() => setParentCare((v) => !v)}>{parentCare ? "✓ " : ""}만 65세+ 3년 이상 부양</button>
                {parentCare && (
                  <button className={"mv-chip" + (parentOwns ? " mv-on" : "")} style={{ padding: "9px 14px" }}
                    onClick={() => setParentOwns((v) => !v)}>{parentOwns ? "✓ " : ""}부양 부모가 주택 보유</button>
                )}
              </div>
              <div className="mv-field" style={{ marginBottom: 0 }}>
                <label htmlFor="sc-agency">기관추천 대상</label>
                <select id="sc-agency" className="mv-in" value={agency} onChange={(e) => setAgency(e.target.value)}>
                  <option value="">해당 없음</option>
                  {["국가유공자", "장기복무 제대군인", "중소기업 장기근속자", "장애인"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                {agency && AGENCY_INFO[agency] && (
                  <div className="mv-note" style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.7 }}>
                    <b>{agency}</b> 기관추천<br />
                    · 기준: {AGENCY_INFO[agency].std}<br />
                    · 준비서류: {AGENCY_INFO[agency].docs.join(", ")}<br />
                    · 추천기관: {AGENCY_INFO[agency].org}<br />
                    <span style={{ color: "var(--ink-3)" }}>공고·기관마다 세부 기준이 달라질 수 있으니 추천기관에 꼭 확인하세요.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mv-card mv-pad">
              <div className="mv-eyebrow" style={{ marginBottom: 12 }}>실시간 판정 · 입력하면 바로 바뀌어요</div>
              <div style={{ display: "grid", gap: 8 }}>
                {specialFit.map((x) => (
                  <div key={x.k} className="mv-between" style={{ gap: 10, padding: "9px 12px",
                    background: x.ok === true ? "var(--tint)" : "var(--mist)", borderRadius: 10,
                    opacity: x.ok === false ? .62 : 1 }}>
                    <div style={{ minWidth: 0 }}>
                      <b style={{ fontSize: 13.5 }}>{x.ic} {x.n}</b>
                      <small style={{ display: "block", color: "var(--ink-2)", fontSize: 12, marginTop: 2 }}>
                        {x.why}
                      </small>
                      {x.ok === true && (
                        <small style={{ display: "block", color: "var(--ink-3)", fontSize: 11.5, marginTop: 5, lineHeight: 1.6 }}>
                          자격: {x.req.join(" · ")}<br />{x.tip}
                        </small>
                      )}
                    </div>
                    <span className={"mv-chip " + (x.ok === true ? "mv-on" : x.ok === null ? "mv-cool" : "")}
                      style={{ flex: "none", fontSize: 11.5, padding: "5px 10px" }}>
                      {x.ok === true ? "해당" : x.ok === null ? "확인 필요" : "미해당"}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12 }}>
                지금 기준 <b>{fitCount}개 유형 해당</b>. 해당 유형에는 자격 요약과 신청 팁이 함께 표시돼요.
              </div>
            </div>
          </div>
          )}

          <div className="mv-row" style={{ marginTop: 18, gap: 8, flexWrap: "wrap" }}>
            {step > 1 && (
              <button className="mv-btn mv-ghost" onClick={() => setStep(step - 1)}>← 이전</button>
            )}
            {step === 1 && (
              <button className="mv-btn mv-primary" onClick={() => setStep(2)}>다음 · 일반분양 →</button>
            )}
            {step === 2 && (
              <>
                <button className="mv-btn mv-primary" onClick={() => { setSpEntered(false); setListSp(""); setStep(4); }}>
                  제출하고 공고 보기
                </button>
                <button className="mv-btn mv-ghost" onClick={() => setStep(3)}>특별공급도 입력 →</button>
              </>
            )}
            {step === 3 && (
              <button className="mv-btn mv-primary" onClick={() => { setSpEntered(true); setStep(4); }}>
                제출하고 공고 보기
              </button>
            )}
          </div>
        </div>
        )}

        {step === 4 && (
        <>
        <button className="mv-btn mv-ghost mv-sm" style={{ marginBottom: 16 }} onClick={() => setStep(1)}>
          ← 조건 다시 입력
        </button>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="mv-card mv-pad" style={{ background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }}>
            <div className="mv-between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 18 }}>
              <div>
                <div className="mv-eyebrow" style={{ color: "rgba(255,255,255,.7)" }}>내 청약 가점</div>
                <div className="mv-num" style={{ fontSize: 62, fontWeight: 900, letterSpacing: "-.06em", lineHeight: 1 }}>
                  {score}<small style={{ fontSize: 24, opacity: .6 }}>/84</small>
                </div>
                <div className="mv-row" style={{ marginTop: 12, gap: 8, fontSize: 13 }}>
                  <span>무주택 {nhScore}</span><span style={{ opacity: .5 }}>+</span>
                  <span>부양가족 {famScore}</span><span style={{ opacity: .5 }}>+</span>
                  <span>통장 {bankScore}</span>
                </div>
              </div>
              <div style={{ flex: "1 1 300px", minWidth: 260 }}>
                <div className="mv-eyebrow" style={{ color: "rgba(255,255,255,.7)", marginBottom: 8 }}>내 조건</div>
                <div className="mv-row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {[
                    myRegion || null,
                    isHead ? "세대주" : "세대원",
                    ownsNow ? "유주택" : `무주택 ${nhYears >= 15 ? "15년+" : nhYears + "년"}`,
                    `부양가족 ${fam}명`,
                    supplyType === "공공" ? `통장 ${payCountEff}회 · 인정 ${eok(recognizedEff)}` : `통장 ${payCountEff}회 납입`,
                    supplyType === "민영" ? `민영 · ${applyMethod}` : "공공주택",
                    ...(spEntered
                      ? [isMarried ? `혼인 ${marriedYears}년차` : engaged ? "예비신혼" : "미혼",
                         kids > 0 ? `자녀 ${kids}명` : "자녀 없음",
                         `특공 ${fitCount}개 유형 해당`]
                      : []),
                  ].filter(Boolean).map((t) => (
                    <span key={t} style={{ background: "rgba(255,255,255,.16)", borderRadius: 8,
                      padding: "5px 11px", fontSize: 12.5 }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mv-gauge" style={{ marginTop: 16, height: 9, background: "rgba(255,255,255,.2)" }}>
              <i style={{ width: `${(score / 84) * 100}%`, background: "#fff" }} />
            </div>
          </div>

          <LivePanel live={live} />

          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-.035em", marginTop: 6 }}>
            접수 중 공고 <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-3)" }}>
              · {rightSites.filter((s) => s.status === "접수 중").length}건 · 지금 넣을 수 있는 공고</span>
          </div>

          <div className="mv-card">
            <div className="mv-pad" style={{ paddingBottom: 10 }}>
              <div className="mv-eyebrow" style={{ marginBottom: 12 }}>
                일반공급 · {supplyType === "공공" ? "인정액 여유 많은 순" : "당첨 확률 높은 순"}
              </div>
              {!bankOk && (
                <div className="mv-note" style={{ marginBottom: 12, borderLeft: "3px solid #C1440E" }}>
                  <b>{bankType}으로는 {supplyType}주택 청약이 안 돼요.</b> 아래 공고에 지원하려면
                  주택청약종합저축 전환(2024.10부터 허용)이 필요합니다.
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 10, lineHeight: 1.6 }}>
                {supplyType === "공공"
                  ? "공공 일반공급은 가점이 아니라 저축총액(인정액) 순 경쟁이라, 내 인정 납입액과 예상 컷을 비교합니다 (컷은 추정치)."
                  : '각 공고의 "유리한 타입"은 단지 대표 당첨선에 면적대별 보정(70~74㎡ -8점 · 70㎡ 미만 -3점)을 적용해 낮은 순으로 3개까지 보여줍니다. 청약홈 과거 패턴을 규칙으로 옮긴 추정치예요.'}
              </div>
              <div className="mv-between" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>희망 지역</span>
                <button className={"mv-chip" + (showClosed ? " mv-on" : "")}
                  style={{ padding: "5px 11px", fontSize: 11.5 }}
                  onClick={() => setShowClosed((v) => !v)}>
                  {showClosed ? "✓ 접수 마감 포함" : "접수 마감 숨김"}
                </button>
              </div>
              <div className="mv-row" style={{ gap: 5, flexWrap: "wrap" }}>
                {areas.map((a) => (
                  <button key={a} className={"mv-chip" + (listRegion === a ? " mv-on" : "")}
                    style={{ padding: "7px 13px", fontSize: 12.5 }} onClick={() => setListRegion(a)}>{a}</button>
                ))}
              </div>
            </div>
            <div style={!bankOk ? { opacity: .45, pointerEvents: "none" } : undefined}>
              {rightSites.map((s) => {
                if (supplyType === "공공") {
                  const hasCut = !!s.cutAmt;
                  const amtGap = recognizedEff - s.cutAmt;
                  const okA = amtGap >= 0;
                  return (
                    <button key={s.id} className="mv-listrow" onClick={() => setSite(s)}>
                      <div className="mv-between">
                        <strong>{s.live && <span className="mv-chip mv-cool" style={{ fontSize: 10.5, padding: "2px 7px", marginRight: 6 }}>실시간</span>}{s.n}</strong>
                        {hasCut ? (
                          <span className={"mv-chip " + (okA ? "mv-on" : "mv-warn")}>
                            {okA ? `인정액 +${eok(amtGap)} 여유` : `인정액 ${eok(-amtGap)} 부족`}
                          </span>
                        ) : (
                          <span className="mv-chip">인정액 컷 미제공</span>
                        )}
                      </div>
                      <small>
                        {s.gu} · {hasCut ? `예상 컷 ${eok(s.cutAmt)}원` : "API가 당첨선을 주지 않아 비교 생략"} · 내 인정액 {eok(recognizedEff)}원 · {s.when}
                      </small>
                    </button>
                  );
                }
                const gap = score - s.cut;
                const ok = gap >= 0;
                const bts = bestTypesFor(s);
                const btGap = bts.length ? score - bts[0].estCut : 0;
                return (
                  <button key={s.id} className="mv-listrow" onClick={() => setSite(s)}>
                    <div className="mv-between">
                      <strong>{s.live && <span className="mv-chip mv-cool" style={{ fontSize: 10.5, padding: "2px 7px", marginRight: 6 }}>실시간</span>}{s.n}</strong>
                      <span className={"mv-chip " + (ok ? "mv-on" : "mv-warn")}>
                        {ok ? `+${gap}점 여유` : `${-gap}점 부족`}
                      </span>
                    </div>
                    <small>{s.gu} · 예상 당첨선 {s.cut}점{s.cutEstimated ? " (지역 기준 추정)" : ""} · {s.when}</small>
                    {bts.length > 0 && (
                    <small style={{ display: "block", marginTop: 4, color: btGap >= 0 ? "var(--flow-2)" : "var(--ink-3)", fontWeight: 600 }}>
                      유리한 타입 {bts.length}개 ·{" "}
                      {bts.map((t, i) => {
                        const g = score - t.estCut;
                        return `${i + 1}. ${t.t} ~${t.estCut}점(${g >= 0 ? `+${g}` : g})`;
                      }).join("  ")}
                    </small>
                    )}
                  </button>
                );
              })}
              {rightSites.length === 0 && (
                <div className="mv-pad"><div className="mv-note">이 지역에는 등록된 공고가 없어요.</div></div>
              )}
            </div>
            {!spEntered && (
              <div className="mv-pad" style={{ paddingTop: 10 }}>
                <button className="mv-chip" style={{ padding: "8px 14px", fontSize: 12.5 }}
                  onClick={() => setStep(3)}>
                  + 특별공급 조건도 입력하면 특별분양 공고까지 볼 수 있어요
                </button>
              </div>
            )}
          </div>

          {spEntered && (
            <div className="mv-card">
              <div className="mv-pad" style={{ paddingBottom: 10 }}>
                <div className="mv-eyebrow" style={{ marginBottom: 12 }}>특별공급 · 내 해당 유형</div>
                {fitCount > 0 ? (
                  <>
                    <div className="mv-row" style={{ gap: 5, flexWrap: "wrap" }}>
                      {specialFit.filter((x) => x.ok === true).map((x) => (
                        <button key={x.k} className={"mv-chip" + (activeSp === x.k ? " mv-on" : "")}
                          style={{ padding: "7px 13px", fontSize: 12.5 }}
                          onClick={() => setListSp(activeSp === x.k ? "" : x.k)}>
                          {x.ic} {x.n}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.6 }}>
                      특별공급은 가점 순위 경쟁이 아니라서, 가점이 부족한 공고에도 자격만 되면 지원할 수 있어요.
                      위 지역 선택이 여기에도 같이 적용됩니다.
                    </div>
                  </>
                ) : (
                  <div className="mv-note">지금 넣은 조건으로는 해당하는 특별공급 유형이 없어요.</div>
                )}
              </div>
              {fitCount > 0 && (
                <div>
                  {rightSites.map((s) => (
                    <button key={s.id} className="mv-listrow" onClick={() => setSite(s)}>
                      <div className="mv-between">
                        <strong>{s.n}</strong>
                        <span className="mv-chip mv-cool">특공 지원 가능</span>
                      </div>
                      <small>
                        {s.gu} · {activeSp
                          ? specialFit.find((x) => x.k === activeSp).n
                          : specialFit.filter((x) => x.ok === true).map((x) => x.n).join(" · ")} · {s.when}
                      </small>
                    </button>
                  ))}
                  {rightSites.length === 0 && (
                    <div className="mv-pad"><div className="mv-note">이 지역에는 등록된 공고가 없어요.</div></div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-.035em", marginTop: 6 }}>
            접수 예정 공고 <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-3)" }}>
              · {upcoming.length}건 · 공고 났고 접수 시작 전</span>
          </div>

          <div className="mv-card">
            <div className="mv-pad" style={{ paddingBottom: 10 }}>
              <div className="mv-eyebrow" style={{ marginBottom: 6 }}>접수 시작일 빠른 순</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.7 }}>
                <b>모집공고는 이미 나왔고 접수만 시작 전</b>인 단지입니다. 그래서 분양가·세대수·
                특별공급 물량이 <b>공고에 확정돼 있고</b>, 여기 값은 추정이 아니라 공고 원문입니다.
                D-day 는 접수 시작일까지 남은 날입니다.<br />
                <b style={{ color: "#A93F1F" }}>아직 공고 자체가 안 난 현장</b>은 공공 API 에 없어서
                아래 <b>분양 예정 단지 후보(뉴스)</b> 와 <b>공고 전 예상가</b> 섹션에서 따로 다룹니다.
              </div>
            </div>
            <div>
              {upcoming.map((s) => {
                const d = daysUntil(s.rceptStart);
                return (
                  <button key={s.id} className="mv-listrow" onClick={() => setSite(s)}>
                    <div className="mv-between">
                      <strong>
                        <span className="mv-chip" style={{ fontSize: 10.5, padding: "2px 7px", marginRight: 6 }}>
                          {s.supply}
                        </span>
                        {s.n}
                      </strong>
                      <span className={"mv-chip " + (d !== null && d <= 7 ? "mv-on" : "mv-cool")}>
                        {d === null ? "접수일 미정" : d === 0 ? "오늘 접수 시작" : `D-${d}`}
                      </span>
                    </div>
                    <small>
                      {s.gu} · 총 {s.total.toLocaleString()}세대 · 접수 {s.rceptStart || "미정"}
                      {s.types?.[0]?.price ? ` · 분양가 ${eok(Math.min(...s.types.map((t) => t.price || Infinity)))}원~` : ""}
                    </small>
                    {(() => {
                      const bts = bestTypesFor(s);
                      if (!bts.length) return null;
                      const g0 = score - bts[0].estCut;
                      return (
                        <small style={{ display: "block", marginTop: 4, fontWeight: 600,
                          color: g0 >= 0 ? "var(--flow-2)" : "var(--ink-3)" }}>
                          유리한 타입 {bts.length}개 ·{" "}
                          {bts.map((t, i) => {
                            const g = score - t.estCut;
                            return `${i + 1}. ${t.t} ~${t.estCut}점(${g >= 0 ? `+${g}` : g})`;
                          }).join("  ")}
                        </small>
                      );
                    })()}
                  </button>
                );
              })}
              {upcoming.length === 0 && (
                <div className="mv-pad"><div className="mv-note">
                  이 지역에는 접수 예정 공고가 없어요. 지역을 넓혀보세요.
                </div></div>
              )}
            </div>
          </div>

          {noScoreSites.length > 0 && (
            <>
              <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-.035em", marginTop: 6 }}>
                무순위 · 잔여세대 <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-3)" }}>· 가점 무관 추첨</span>
              </div>
              <div className="mv-card">
                <div className="mv-pad" style={{ paddingBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.7 }}>
                    청약통장·가점과 무관하게 추첨으로 뽑는 물량입니다. 가점이 낮아도 조건만 맞으면
                    지원할 수 있어서, 가점이 부족한 분들이 노려볼 만합니다.
                  </div>
                </div>
                <div>
                  {noScoreSites.map((s) => (
                    <button key={s.id} className="mv-listrow" onClick={() => setSite(s)}>
                      <div className="mv-between">
                        <strong>{s.n}</strong>
                        <span className="mv-chip mv-cool">{s.status}</span>
                      </div>
                      <small>
                        {s.gu} · {s.total.toLocaleString()}세대 ·
                        {s.types[0]?.price ? ` ${eok(Math.min(...s.types.map((t) => t.price || Infinity)))}원~` : ""} · {s.when}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {NEWS.candidates.length > 0 && (
            <>
              <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-.035em", marginTop: 6 }}>
                분양 예정 현장 <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-3)" }}>
                  · 아직 공고 전 · 분양가는 산식으로 추정</span>
              </div>

              <div className="mv-card">
                <div className="mv-pad" style={{ paddingBottom: 10 }}>
                  <div className="mv-note" style={{ borderLeft: "3px solid #C1440E", fontSize: 12.5, lineHeight: 1.7 }}>
                    <b>공고가 안 난 현장이라 분양가가 아직 없습니다.</b> 단지는 뉴스에서 찾고,
                    분양가는 <b>(평당 택지비 + 건축비) × (1 + 가산비율) × 34평</b> 으로 계산합니다.
                    행을 누르면 산출 과정이 펼쳐집니다.<br />
                    단지명은 기사 제목에서 뽑은 것이라 오탐이 섞이고, 분양가는 추정입니다.
                    실제 금액은 모집공고가 나와야 확정됩니다.
                  </div>
                  <div className="mv-row" style={{ gap: 8, marginTop: 10, fontSize: 12, color: "var(--ink-3)" }}>
                    <span>기사 {NEWS.articleCount}건에서 현장 {NEWS.count}건 · 지역 확인 {newsPriced.filter((c) => c.est).length}건</span>
                    {NEWS.collectedAt && (
                      <span className="mv-num">{new Date(NEWS.collectedAt).toLocaleString("ko-KR")} 수집</span>
                    )}
                  </div>
                </div>
                <div>
                  {newsPriced.slice(0, newsMore ? 60 : 12).map((c) => (
                    <div key={c.name}>
                      <button className="mv-listrow" onClick={() => setOpenNews(openNews === c.name ? null : c.name)}>
                        <div className="mv-between">
                          <strong>{c.name}</strong>
                          {c.est ? (
                            <span className="mv-chip mv-warn">예상 {eok(c.est.total)}원</span>
                          ) : (
                            <span className="mv-chip">지역 불명 · 추정 불가</span>
                          )}
                        </div>
                        <small>
                          {c.region ? `${c.region} · ` : ""}
                          {c.est ? `범위 ${eok(c.est.lo)}~${eok(c.est.hi)} · 평당 ${c.est.pyPrice.toLocaleString()}만 · 34평 기준 · 신뢰도 ${c.est.grade}` : "기사에서 지역을 못 찾았습니다"}
                          {" · "}기사 {c.mentions}건
                        </small>
                      </button>
                      {openNews === c.name && (
                        <div style={{ padding: "0 17px 15px" }}>
                          {c.est && (
                            <div className="mv-note" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 8 }}>
                              <b>분양예정가 산출 ({c.est.source})</b><br />
                              택지비 <b className="mv-num">{c.est.landPy.toLocaleString()}만</b>/평 ({c.est.labels.land})
                              {" + "}건축비 <b className="mv-num">{c.est.constPy.toLocaleString()}만</b>/평 ({c.est.labels.brand})
                              {" = "}<b className="mv-num">{(c.est.landPy + c.est.constPy).toLocaleString()}만</b><br />
                              × 가산비율 (1 + {Math.round(c.est.margin * 100)}% · {c.est.labels.margin})
                              {" = 평당 "}<b className="mv-num">{c.est.pyPrice.toLocaleString()}만</b><br />
                              × 34평 = <b style={{ color: "#A93F1F" }}>{eok(c.est.total)}원</b>
                              {" "}(범위 {eok(c.est.lo)}~{eok(c.est.hi)})<br />
                              <span style={{ color: "var(--ink-3)" }}>
                                평당가는 <b>청약홈 실제 분양가 {FIT_META.samples.toLocaleString()}건</b>으로 학습한
                                지역 계층 모델에서 나옵니다 ({c.est.labels.land}).
                                택지비·건축비는 그 평당가를 화면용으로 되쪼갠 값입니다.<br />
                                <b>신뢰도 {c.est.grade}</b> — {GRADE_WHY[c.est.grade]}.
                                같은 조건에서 학습에 안 쓴 공고를 맞혀 본 평균 오차가{" "}
                                <b>{c.est.gradeMae}%</b>라서 범위를 ±{c.est.bandPct}%로 잡았습니다.
                              </span>
                            </div>
                          )}
                          <div className="mv-note" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                            <b>출처 기사</b><br />
                            {c.articles.map((a, i) => (
                              <div key={i} style={{ marginBottom: 6 }}>
                                <a href={a.link} target="_blank" rel="noopener noreferrer"
                                  style={{ textDecoration: "underline" }}>{a.title}</a>
                                <span style={{ color: "var(--ink-3)" }}> — {a.source}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {NEWS.candidates.length > 12 && (
                  <div className="mv-pad" style={{ paddingTop: 10 }}>
                    <button className="mv-chip" style={{ padding: "8px 14px", fontSize: 12.5 }}
                      onClick={() => setNewsMore((v) => !v)}>
                      {newsMore ? "접기" : `현장 ${newsPriced.length}건 전체 보기`}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-.035em", marginTop: 6 }}>
            공고 전 예상가 <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-3)" }}>· API 아님 · 직접 넣은 변수로 계산</span>
          </div>

          <div className="mv-card">
            <div className="mv-pad" style={{ paddingBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.7 }}>
                아직 공고가 안 난 단지는 분양가가 없어서 추정합니다.
                <b>시세는 섞지 않습니다</b> — 절반씩 섞으면 원가 추정인지 시세 반영인지
                알 수 없어지고 검증도 안 됩니다.<br />
                평당가는 <b>청약홈 실제 분양가 {FIT_META.samples.toLocaleString()}건</b>으로 학습한
                <b>지역 트리 두 개</b>를 반씩 섞은 값입니다.<br />
                <span style={{ paddingLeft: 8 }}>
                  A · [시도 › 읍면·택지·시가지 › 시군구 › 재개발·일반 › 읍면동·지구]<br />
                  B · [시도 › 시군구 › 읍면동 › 상세] (주소 그대로)
                </span><br />
                A에 성격을 한 층 넣은 이유는, 같은 안성시라도 아양지구(읍면)는 평당 1,292만인데
                시내 동은 2,000만대라 시 평균을 물려주면 70% 과대예측되기 때문입니다.
                다만 층이 하나 늘어 표본이 잘게 쪼개집니다. B는 그 반대고요.
                둘은 서로 다른 실수를 해서, 섞으면 각각보다 낫습니다(12.6 · 13.0 → 12.4).
                건축비는 국토부 고시 <b>기본형건축비(2026.3, ㎡당 222만원)</b>를 씁니다.<br />
                <b>중요 — 현장마다 오차가 다릅니다.</b> 근처에 비교할 분양 실적이
                얼마나 가까이 있느냐로 갈립니다. 아래는 공고 단위 5겹 교차검증
                실측값입니다(학습에 안 쓴 공고 {FIT_CV.all.n}건).
                <div style={{ marginTop: 6, marginBottom: 6 }}>
                  {[["높음", 5], ["보통", 4], ["낮음", 3], ["매우 낮음", 2]].map(([g, d]) => {
                    const st = FIT_CV.byDepth?.[d];
                    if (!st) return null;
                    return (
                      <div key={g} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                        <b style={{ minWidth: 58 }}>{g}</b>
                        <span style={{ minWidth: 150, color: "var(--ink-3)" }}>{GRADE_WHY[g]}</span>
                        <span>평균 <b>{st.mae}%</b> · 중앙 {st.p50}% · ±10% 안 {st.w10}%</span>
                        <span style={{ color: "var(--ink-3)" }}>({st.n}건)</span>
                      </div>
                    );
                  })}
                </div>
                즉 <b>읍면동·지구까지 비교 실적이 잡히는 현장은 평균 오차가
                {" "}{FIT_CV.byDepth?.[5]?.mae}%</b>로 10% 안입니다. 시군구 위로 올라가야
                하는 현장은 {FIT_CV.byDepth?.[2]?.mae}%까지 벌어집니다 — 그건 모델이 나빠서가
                아니라 그 동네에 비교할 분양이 없어서입니다. 같은 시군구·6개월 안에 분양한
                두 단지끼리도 평당가가 평균 16% 벌어집니다.<br />
                표시 범위는 임의값이 아니라 <b>그 등급에서 실제로 난 오차의 80분위</b>입니다.
              </div>
            </div>
            <div>
              {rightPre.map((s) => (
                <div key={s.id}>
                  <button className="mv-listrow" onClick={() => setOpenPre(openPre === s.id ? null : s.id)}>
                    <div className="mv-between">
                      <strong>{s.n}</strong>
                      <span className="mv-chip mv-warn">예상 {eok(s.est.total)}원</span>
                    </div>
                    <small>
                      {s.gu} · 범위 {eok(s.est.lo)}~{eok(s.est.hi)} · 평당 {s.est.pyPrice.toLocaleString()}만 ·
                      {" "}{s.py}평 기준 · {s.when}
                    </small>
                  </button>
                  {openPre === s.id && (
                    <div style={{ padding: "0 17px 15px" }}>
                      <div className="mv-note" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                        <b>산식 ({s.est.source})</b><br />
                        택지비 <b className="mv-num">{s.est.landPy.toLocaleString()}만</b>/평 ({s.est.labels.land})
                        {" + "}건축비 <b className="mv-num">{s.est.constPy.toLocaleString()}만</b>/평 ({s.est.labels.brand})<br />
                        × 가산비율 (1 + {Math.round(s.est.margin * 100)}% · {s.est.labels.margin})
                        {" = 평당 "}<b className="mv-num">{s.est.pyPrice.toLocaleString()}만</b><br />
                        × {s.py}평 = <b style={{ color: "#A93F1F" }}>{eok(s.est.total)}원</b>
                        {" "}(범위 ±{s.est.bandPct}% · {eok(s.est.lo)}~{eok(s.est.hi)})<br />
                        <span style={{ color: "var(--ink-3)" }}>
                          직접 넣은 변수(택지비 {s.land.toLocaleString()} + 건축비 {s.constCost.toLocaleString()},
                          {" "}가산 {Math.round(s.margin * 100)}%)로 계산하면 평당 {s.manualPy.toLocaleString()}만 ·
                          {" "}{eok(s.manualTotal)}원입니다.<br />{s.note}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {rightPre.length === 0 && (
                <div className="mv-pad"><div className="mv-note">이 지역에는 등록된 공고 전 단지가 없어요.</div></div>
              )}
            </div>
          </div>

          <div className="mv-note">
            예상 당첨선은 인근 단지의 최근 실적을 참고한 추정입니다. 실제 특별공급 물량·자격은
            단지별 모집공고에서 다르니 반드시 확인해 주세요.
          </div>
        </div>

        {/* ── 분양 현장 ── */}
        <div className="mv-sec-h" style={{ marginTop: 36 }}>
          <div>
            <h2 style={{ fontSize: 22 }}>분양 현장</h2>
            <p>지금 청약 중이거나 곧 나오는 단지를, 합격 가능성(내 가점 여유분) 높은 순으로 봅니다.</p>
          </div>
        </div>

        <div className="mv-row" style={{ marginBottom: 18, gap: 6 }}>
          {areas.map((a) => (
            <button key={a} className={"mv-chip" + (area === a ? " mv-on" : "")}
              style={{ padding: "8px 16px", fontSize: 13.5 }} onClick={() => setArea(a)}>{a}</button>
          ))}
          <span className="mv-num" style={{ marginLeft: "auto", fontSize: 13, color: "var(--ink-2)" }}>
            {siteList.length}개 단지
          </span>
        </div>

        <div className="mv-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))" }}>
          {siteList.map((s) => {
            const gap = score - s.cut;
            const minPrice = Math.min(...s.types.map((t) => t.price));
            const inBudget = myBudget > 0 && minPrice <= myBudget;
            return (
              <button key={s.id} className="mv-sitecard" onClick={() => setSite(s)}>
                <div className="mv-between" style={{ marginBottom: 9 }}>
                  <span className={"mv-chip " + (s.status === "접수 중" ? "mv-on" : s.status === "접수 예정" ? "mv-cool" : "")}
                    style={{ fontSize: 11.5 }}>{s.status}</span>
                  <span className="mv-num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{s.when}</span>
                </div>
                <strong style={{ display: "block", fontSize: 17.5, letterSpacing: "-.04em", lineHeight: 1.3 }}>
                  {s.n}
                </strong>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
                  {s.gu} · {s.brand}
                </div>
                <div className="mv-row" style={{ gap: 5, marginTop: 10 }}>
                  {inBudget && <span className="mv-chip mv-on" style={{ fontSize: 11 }}>내 예산 안</span>}
                  {s.tags.slice(0, 3).map((t) => (
                    <span key={t} className="mv-chip" style={{ fontSize: 11 }}>{t}</span>
                  ))}
                </div>
                <div className="mv-sitebar">
                  <div>
                    <small>일반분양</small>
                    <b className="mv-num">{s.general.toLocaleString()}세대</b>
                  </div>
                  <div>
                    <small>{s.supply === "공공" ? "예상 인정액 컷" : "예상 당첨선"}</small>
                    <b className="mv-num">{s.supply === "공공" ? eok(s.cutAmt) : `${s.cut}점`}</b>
                  </div>
                  <div>
                    <small>{s.supply === "공공" ? "내 인정액" : "내 가점"}</small>
                    {s.supply === "공공" ? (
                      <b className="mv-num" style={{ color: recognizedEff >= s.cutAmt ? "var(--flow)" : "var(--exhaust, #C1440E)" }}>
                        {eok(recognizedEff)}
                      </b>
                    ) : (
                      <b className="mv-num" style={{ color: gap >= 0 ? "var(--flow)" : "var(--exhaust, #C1440E)" }}>
                        {gap >= 0 ? `+${gap}` : gap}점
                      </b>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mv-note" style={{ marginTop: 18 }}>
          예상 당첨선은 인근 단지의 최근 실적을 참고한 추정입니다.
          실제 경쟁률과 커트라인은 모집공고와 청약홈 결과를 확인해 주세요.
        </div>
        </>
        )}

        {site && (
          <div className="mv-ov" onClick={(e) => e.target === e.currentTarget && setSite(null)}>
            <div className="mv-sheet">
              <div className="mv-sheet-h">
                <div>
                  <div className="mv-eyebrow">{site.gu} · {site.brand}</div>
                  <h3 style={{ fontSize: 23, fontWeight: 900, letterSpacing: "-.045em", marginTop: 4 }}>
                    {site.n}
                  </h3>
                </div>
                <button className="mv-x" onClick={() => setSite(null)} aria-label="닫기">✕</button>
              </div>
              <div className="mv-sheet-body">
                {site.tags?.length > 0 && (
                  <div className="mv-row" style={{ gap: 5, marginBottom: 12 }}>
                    <span className={"mv-chip " + (site.status === "접수 중" ? "mv-on" : "mv-cool")}
                      style={{ fontSize: 11.5 }}>{site.status}</span>
                    {site.tags.map((t) => (
                      <span key={t} className="mv-chip" style={{ fontSize: 11.5 }}>{t}</span>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: 15, lineHeight: 1.75, color: "var(--ink-2)" }}>{siteNote(site)}</p>

                <DSec n="01" t="공급 규모">
                  <div className="mv-scroll">
                    <table className="mv-tbl">
                      <thead><tr><th>타입</th><th className="mv-r">세대수</th>
                        <th className="mv-r">{site.live ? "분양가" : "예상 분양가"}</th>
                        <th className="mv-r">계약금 10%</th></tr></thead>
                      <tbody>
                        {site.types.map((t) => (
                          <tr key={t.t}>
                            <td><b>{t.t}</b></td>
                            <td className="mv-r">{t.n}세대</td>
                            <td className="mv-r"><b>{eok(t.price)}원</b></td>
                            <td className="mv-r">{eok(Math.round(t.price * 0.1))}원</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {site.receipt && (site.receipt.special || site.receipt.rank1 || site.receipt.result) && (
                    <div className="mv-note" style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.8 }}>
                      {site.receipt.special && <>특별공급 접수 <b>{site.receipt.special}</b><br /></>}
                      {site.receipt.rank1 && <>1순위 해당지역 <b>{site.receipt.rank1}</b><br /></>}
                      {site.receipt.result && <>당첨자 발표 <b>{site.receipt.result}</b></>}
                    </div>
                  )}
                  {site.live && (
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.6 }}>
                      분양가는 청약홈 API 의 <b>공급금액(분양최고금액)</b> 값 그대로입니다 — 추정이 아니라
                      모집공고에 확정된 금액이고, 같은 주택형 안에서 층·향에 따라 이보다 낮은 세대가 있습니다.
                      발코니 확장·옵션은 별도입니다.
                    </div>
                  )}
                  <div className="mv-row" style={{ marginTop: 12, gap: 16 }}>
                    <span style={{ fontSize: 13.5 }}>총 <b className="mv-num">{site.total.toLocaleString()}</b>세대</span>
                    <span style={{ fontSize: 13.5 }}>일반분양 <b className="mv-num">{site.general.toLocaleString()}</b>세대</span>
                    <span style={{ fontSize: 13.5 }}>공고 <b className="mv-num">{site.when}</b></span>
                  </div>
                </DSec>

                <DSec n="02" t="내 조건으로 보면">
                  <div className="mv-grid mv-g2">
                    <div className="mv-card mv-pad">
                      <div className="mv-eyebrow">가점 비교</div>
                      <div className="mv-row" style={{ alignItems: "flex-end", gap: 12, marginTop: 8 }}>
                        <div>
                          <div className="mv-num" style={{ fontSize: 32, fontWeight: 900,
                            color: (site.supply === "공공" ? (!site.cutAmt || recognizedEff >= site.cutAmt) : score >= site.cut) ? "var(--flow)" : "#C1440E" }}>
                            {site.supply === "공공" ? eok(recognizedEff) : `${score}점`}
                          </div>
                          <small style={{ fontSize: 12, color: "var(--ink-3)" }}>{site.supply === "공공" ? "내 인정 납입액" : "내 가점"}</small>
                        </div>
                        <div style={{ paddingBottom: 4, color: "var(--ink-3)" }}>vs</div>
                        <div>
                          <div className="mv-num" style={{ fontSize: 26, fontWeight: 800 }}>
                            {site.supply === "공공" ? (site.cutAmt ? eok(site.cutAmt) : "미제공") : `${site.cut}점`}
                          </div>
                          <small style={{ fontSize: 12, color: "var(--ink-3)" }}>{site.supply === "공공" ? "예상 인정액 컷" : "예상 당첨선"}</small>
                        </div>
                      </div>
                      <div className="mv-gauge" style={{ marginTop: 12, height: 8 }}>
                        <i style={{ width: `${Math.min(100, site.supply === "공공"
                            ? (site.cutAmt ? (recognizedEff / site.cutAmt) * 100 : 100)
                            : (score / 84) * 100)}%`,
                          background: (site.supply === "공공" ? (!site.cutAmt || recognizedEff >= site.cutAmt) : score >= site.cut)
                            ? "var(--flow)" : "#C1440E" }} />
                      </div>
                      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.6 }}>
                        {site.supply === "공공"
                          ? !site.cutAmt
                            ? "이 공고는 API가 당첨 인정액을 제공하지 않아 비교를 생략했습니다. 모집공고문의 순위별 기준을 확인하세요."
                            : recognizedEff >= site.cutAmt
                            ? "인정 납입액만 보면 일반공급 순차 경쟁을 노려볼 수 있습니다."
                            : `인정액이 ${eok(site.cutAmt - recognizedEff)}원 부족합니다. 매달 25만원씩 채우거나 특별공급을 함께 보세요.`
                          : score >= site.cut
                          ? "가점만 보면 일반공급을 노려볼 수 있습니다."
                          : `${site.cut - score}점이 부족합니다. 특별공급이나 추첨제 물량을 함께 보세요.`}
                      </p>
                      {site.supply !== "공공" && (() => {
                        const bts = bestTypesFor(site);
                        return (
                          <div className="mv-note" style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.7 }}>
                            <b>이 단지에서 유리한 타입 {bts.length}개</b>
                            <span style={{ color: "var(--ink-3)" }}> · 예상 당첨선 낮은 순</span>
                            <div style={{ display: "grid", gap: 6, margin: "9px 0 10px" }}>
                              {bts.map((t, i) => {
                                const g = score - t.estCut;
                                return (
                                  <div key={t.t} className="mv-between" style={{ gap: 8, alignItems: "flex-start",
                                    padding: "7px 10px", borderRadius: 8,
                                    background: i === 0 ? "var(--tint)" : "#fff" }}>
                                    <div style={{ minWidth: 0 }}>
                                      <b className="mv-num" style={{ fontSize: 13 }}>{i + 1}. {t.t}</b>
                                      <small style={{ display: "block", color: "var(--ink-3)", fontSize: 11.5, lineHeight: 1.5 }}>
                                        {t.n}세대 · {eok(t.price)}원
                                        {myBudget > 0 && t.price > myBudget && (
                                          <b style={{ color: "#C1440E" }}> · 예산 {eok(t.price - myBudget)}원 초과</b>
                                        )}
                                        <br />{t.reason}
                                      </small>
                                    </div>
                                    <span className={"mv-chip " + (g >= 0 ? "mv-on" : "mv-warn")}
                                      style={{ flex: "none", fontSize: 11.5, padding: "5px 10px" }}>
                                      ~{t.estCut}점 · {g >= 0 ? `+${g}점 여유` : `${-g}점 부족`}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            순위 기준은 <b>예상 당첨선 → 세대수 많은 순 → 분양가 낮은 순</b>입니다.
                            내 가점은 <b>여유·부족 표시에만</b> 쓰이고 순서는 바꾸지 않습니다
                            (여유 = 내 가점 − 예상 당첨선이라, 당첨선 낮은 순과 여유 큰 순이 같은 순서입니다).
                            청약홈 과거 데이터 패턴상 70~74㎡ 틈새평형은 84㎡보다 커트라인이 확연히 낮게 형성됩니다.
                            같은 평형에서도 타워형(B·C)이 판상형(A)보다 낮고, 특별공급 경쟁률이 낮았던
                            타입은 다음 날 일반공급도 낮게 가는 동조화 경향이 있으니 특공 결과를 선행지표로 보세요.
                            <span style={{ color: "var(--ink-3)" }}> (타입별 예상선은 이 패턴을 적용한 추정치이고, 동·향·층은 반영하지 않습니다)</span>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="mv-card mv-pad">
                      <div className="mv-eyebrow">자금 계획</div>
                      <ul className="mv-dl" style={{ marginTop: 10 }}>
                        <li>계약금 10~20% · 당첨 후 2~4주 안에 필요</li>
                        <li>중도금 60% · 집단대출로 2~3년에 걸쳐</li>
                        <li>잔금 20~30% · 입주 지정기간에</li>
                      </ul>
                      <div className="mv-total" style={{ marginTop: 12 }}>
                        <span>내 예산</span><b>{eok(myBudget)}원</b>
                      </div>
                      <div className="mv-total">
                        <span>{siteRefType.t} 기준</span>
                        <b>{eok(siteRefType.price)}원</b>
                      </div>
                      <div className="mv-total">
                        <span>차액</span>
                        <b style={{ color: siteDiff > 0 ? "#C1440E" : "var(--flow)" }}>
                          {siteDiff > 0 ? `${eok(siteDiff)}원 부족`
                            : siteDiff === 0 ? "차액 없음"
                            : `${eok(-siteDiff)}원 여유`}
                        </b>
                      </div>
                    </div>
                  </div>
                </DSec>

                <DSec n="03" t="넣을 수 있는 특별공급">
                  <div className="mv-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}>
                    {specialFit.filter((x) => x.ok === true).map((x) => {
                      const unit = site.specialUnits?.[x.k];
                      return (
                        <div key={x.k} className="mv-card mv-pad" style={{ borderColor: "#BFDED4", background: "var(--tint)" }}>
                          <div style={{ fontSize: 22 }}>{x.ic}</div>
                          <strong style={{ display: "block", fontSize: 15.5, marginTop: 6 }}>{x.n}</strong>
                          {unit ? (
                            <b className="mv-num" style={{ display: "block", fontSize: 19, color: "var(--flow)", marginTop: 4 }}>
                              {unit.n.toLocaleString()}세대
                              <small style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600 }}> 이 단지 배정</small>
                            </b>
                          ) : (
                            <small style={{ display: "block", fontSize: 12.5, color: "var(--ink-2)", marginTop: 3 }}>
                              {site.specialUnits ? "이 공고에는 배정 없음" : x.ratio}
                            </small>
                          )}
                        </div>
                      );
                    })}
                    {fitCount === 0 && <div className="mv-note">해당하는 특별공급이 없습니다. 일반공급으로 넣으셔야 합니다.</div>}
                  </div>
                  {site.specialUnits && Object.keys(site.specialUnits).length > 0 && (
                    <div className="mv-note" style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.8 }}>
                      <b>이 공고의 특별공급 배정 물량</b>
                      <span style={{ color: "var(--ink-3)" }}> · 청약홈 주택형별 상세 합계</span><br />
                      {Object.values(site.specialUnits)
                        .map((v) => `${v.label} ${v.n.toLocaleString()}세대`).join(" · ")}
                    </div>
                  )}
                </DSec>

                <div className="mv-row" style={{ marginTop: 22 }}>
                  <a className="mv-btn mv-primary" href={site.url || "https://www.applyhome.co.kr"}
                    target="_blank" rel="noopener noreferrer">청약홈에서 공고 확인 ↗</a>
                </div>
                <p style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 16, lineHeight: 1.6 }}>
                  ※ 분양가·세대수·일정은 조사 시점 기준 추정치입니다. 확정 내용은 반드시 입주자모집공고를 확인하세요.
                </p>
              </div>
            </div>
          </div>
        )}
        </>
      )}

      {/* ══════════════ 커뮤니티 ══════════════ */}
      {tab === "community" && <CommunityBoard />}
    </div>
  );
}

/* ============================================================
   커뮤니티 (게시판 + 댓글)
   글·댓글은 브라우저의 localStorage 에 저장됩니다 — 이 기기 안에서만 남습니다.
   ============================================================ */
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function communityId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ── 저장 ─────────────────────────────────────────────────
   예전에는 window.storage 라는 API 에 저장하려 했는데, 이 화면에는
   그런 API 가 아예 없습니다. 그래서 글이 화면에만 남고 새로고침하면
   전부 사라졌습니다.

   브라우저가 원래 주는 localStorage 를 씁니다. 아티팩트에서도, 파일을
   그냥 열었을 때도 똑같이 동작하고, 창을 닫아도 남습니다.

   사생활 보호 모드나 저장 공간 부족이면 접근 자체가 예외를 던지므로
   읽기·쓰기를 모두 감싸고, 실패는 화면에 그대로 알립니다 —
   저장 안 된 걸 저장된 것처럼 보이게 하면 안 됩니다. */
const BOARD_KEY = "jipdang:community:posts:v1";
const NICK_KEY = "jipdang:community:nickname";

function readLS(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function writeLS(key, value) {
  try { window.localStorage.setItem(key, value); return null; }
  catch (e) { return String((e && e.message) || e); }
}

function loadBoard() {
  const raw = readLS(BOARD_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    /* 저장된 자료가 깨져 있어도 화면이 죽지 않게 최소한만 추립니다 */
    return list
      .filter((p) => p && typeof p.id === "string" && typeof p.title === "string")
      .map((p) => ({ ...p, comments: Array.isArray(p.comments) ? p.comments : [] }));
  } catch (e) {
    return [];
  }
}
function saveBoard(list) {
  return writeLS(BOARD_KEY, JSON.stringify(list));   /* null 이면 성공 */
}

function CommunityBoard() {
  const [posts, setPosts] = useState(() => loadBoard());
  const [openId, setOpenId] = useState(null);
  const [nickname, setNickname] = useState(() => readLS(NICK_KEY) || "");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [err, setErr] = useState("");

  /* 저장은 이 기기 안에서만 이뤄집니다. 왜 그런지는 boardStorageNote 참고. */
  const save = (next) => {
    setPosts(next);
    const msg = saveBoard(next);
    setErr(msg || "");
    return !msg;
  };

  const submitPost = () => {
    const nick = nickname.trim(), title = newTitle.trim(), body = newBody.trim();
    if (!nick || !title || !body) return;
    const post = { id: communityId(), nickname: nick, title, body,
                   createdAt: new Date().toISOString(), comments: [] };
    if (save([post, ...posts])) { setNewTitle(""); setNewBody(""); }
    writeLS(NICK_KEY, nick);
  };

  const submitComment = (postId) => {
    const nick = nickname.trim(), body = commentBody.trim();
    if (!nick || !body) return;
    const comment = { id: communityId(), nickname: nick, body, createdAt: new Date().toISOString() };
    const next = posts.map((p) =>
      p.id === postId ? { ...p, comments: [...(p.comments || []), comment] } : p);
    if (save(next)) setCommentBody("");
    writeLS(NICK_KEY, nick);
  };

  const removePost = (postId) => {
    save(posts.filter((p) => p.id !== postId));
    setOpenId(null);
  };
  const removeComment = (postId, commentId) => {
    save(posts.map((p) => p.id === postId
      ? { ...p, comments: (p.comments || []).filter((c) => c.id !== commentId) } : p));
  };

  const openPost = posts.find((p) => p.id === openId);

  const errNotice = err && (
    <div className="mv-note" style={{ marginBottom: 12, borderLeft: "3px solid #C1440E" }}>
      저장에 실패했습니다 — {err}<br />
      브라우저가 사생활 보호 모드이거나 저장 공간이 꽉 찬 경우입니다.
      글은 화면에 남아 있지만 <b>창을 닫으면 사라집니다</b>.
    </div>
  );

  if (openPost) {
    return (
      <div>
        <button className="mv-btn mv-ghost mv-sm" style={{ marginBottom: 16 }} onClick={() => setOpenId(null)}>
          ← 목록으로
        </button>
        {errNotice}

        <div className="mv-card mv-pad">
          <div className="mv-between">
            <div className="mv-eyebrow">{openPost.nickname} · {timeAgo(openPost.createdAt)}</div>
            <button className="mv-btn mv-ghost mv-sm" onClick={() => removePost(openPost.id)}>삭제</button>
          </div>
          <h3 style={{ fontSize: 21, fontWeight: 900, letterSpacing: "-.04em", marginTop: 6 }}>
            {openPost.title}
          </h3>
          <p style={{ fontSize: 15, lineHeight: 1.75, color: "var(--ink-2)", marginTop: 14, whiteSpace: "pre-wrap" }}>
            {openPost.body}
          </p>
        </div>

        <div style={{ marginTop: 24 }}>
          <strong style={{ fontSize: 15 }}>댓글 {(openPost.comments || []).length}개</strong>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {(openPost.comments || []).length === 0 && (
              <div className="mv-note">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</div>
            )}
            {(openPost.comments || []).map((c) => (
              <div key={c.id} className="mv-card mv-pad" style={{ padding: 14 }}>
                <div className="mv-between">
                  <b style={{ fontSize: 13.5 }}>{c.nickname}</b>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <small style={{ color: "var(--ink-3)", fontSize: 12 }}>{timeAgo(c.createdAt)}</small>
                    <button className="mv-btn mv-ghost mv-sm" style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => removeComment(openPost.id, c.id)}>삭제</button>
                  </span>
                </div>
                <p style={{ fontSize: 14, marginTop: 6, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
                  {c.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mv-card mv-pad" style={{ marginTop: 14 }}>
            <input className="mv-in" style={{ marginBottom: 10 }} placeholder="닉네임"
              value={nickname} onChange={(e) => setNickname(e.target.value)} />
            <textarea className="mv-in" style={{ height: "auto", minHeight: 80, padding: "12px 14px", resize: "vertical" }}
              placeholder="댓글을 남겨주세요" value={commentBody} onChange={(e) => setCommentBody(e.target.value)} />
            <button className="mv-btn mv-primary" style={{ width: "100%", marginTop: 10 }}
              disabled={!nickname.trim() || !commentBody.trim()}
              onClick={() => submitComment(openPost.id)}>
              댓글 등록
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mv-card mv-pad" style={{ marginBottom: 20 }}>
        <div className="mv-eyebrow" style={{ marginBottom: 14 }}>글쓰기</div>
        <input className="mv-in" style={{ marginBottom: 10 }} placeholder="닉네임"
          value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <input className="mv-in" style={{ marginBottom: 10 }} placeholder="제목"
          value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <textarea className="mv-in" style={{ height: "auto", minHeight: 100, padding: "12px 14px", resize: "vertical" }}
          placeholder="같이 나누고 싶은 이야기를 적어주세요" value={newBody} onChange={(e) => setNewBody(e.target.value)} />
        <button className="mv-btn mv-primary" style={{ width: "100%", marginTop: 12 }}
          disabled={!nickname.trim() || !newTitle.trim() || !newBody.trim()}
          onClick={submitPost}>
          등록
        </button>
      </div>

      <div className="mv-between" style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 16 }}>전체 글 {posts.length}개</strong>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          댓글 {posts.reduce((a, p) => a + (p.comments || []).length, 0)}개
        </span>
      </div>

      {errNotice}

      <div className="mv-card">
        {posts.length === 0 && (
          <div className="mv-pad"><div className="mv-note">아직 글이 없습니다. 첫 글을 남겨보세요.</div></div>
        )}
        {posts.map((p) => (
          <button key={p.id} className="mv-listrow" onClick={() => setOpenId(p.id)}>
            <div className="mv-between">
              <strong>{p.title}</strong>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>댓글 {(p.comments || []).length}</span>
            </div>
            <small>{p.nickname} · {timeAgo(p.createdAt)}</small>
          </button>
        ))}
      </div>

      <div className="mv-note" style={{ marginTop: 18 }}>
        글과 댓글은 <b>이 브라우저에 저장</b>됩니다. 창을 닫았다 열어도 그대로 남아 있어요.<br />
        <span style={{ color: "var(--ink-3)" }}>
          다만 다른 사람 화면에는 보이지 않습니다 — 여럿이 같이 쓰는 게시판으로 만들려면
          글을 받아 둘 서버가 따로 있어야 합니다.
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   실시간 공고 연동 패널
   ============================================================ */
function LivePanel({ live }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(live.cfg);
  useEffect(() => { setDraft(live.cfg); }, [live.cfg]);

  const src = live.data?.sources;
  const chip = live.state === "loading" ? { c: "mv-cool", t: "불러오는 중…" }
    : live.count > 0 ? { c: "mv-on", t: `실시간 ${live.count}건 연결됨` }
    : { c: "mv-cool", t: `수집 스냅샷 ${live.snapshotCount}건 표시 중` };

  return (
    <div className="mv-card mv-pad">
      <div className="mv-between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="mv-eyebrow">실시간 분양공고 연동</div>
          <div className="mv-row" style={{ gap: 8, marginTop: 6 }}>
            <span className={"mv-chip " + chip.c}>{chip.t}</span>
            {live.at && (
              <span className="mv-num" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {new Date(live.at).toLocaleString("ko-KR")} 기준
              </span>
            )}
          </div>
        </div>
        <div className="mv-row" style={{ gap: 6 }}>
          <button className="mv-btn mv-ghost mv-sm" onClick={live.refresh} disabled={live.state === "loading"}>
            새로고침
          </button>
          <button className="mv-btn mv-ghost mv-sm" onClick={() => setOpen((v) => !v)}>
            {open ? "설정 닫기" : "API 설정"}
          </button>
        </div>
      </div>

      <div className="mv-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10, marginTop: 14 }}>
        {[["lh", "LH 분양임대공고별 공급정보", "apis.data.go.kr/B552555"],
          ["odc", "청약홈 APT 분양정보", "api.odcloud.kr · 한국부동산원"]].map(([k, label, host]) => {
          const st = src?.[k];
          return (
            <div key={k} style={{ padding: "11px 13px", borderRadius: 10,
              background: st?.ok ? "var(--tint)" : "var(--mist)" }}>
              <b style={{ fontSize: 13.5 }}>{label}</b>
              <small style={{ display: "block", color: "var(--ink-3)", fontSize: 11.5, marginTop: 2 }}>{host}</small>
              <div style={{ marginTop: 7, fontSize: 12.5 }}>
                {st?.ok
                  ? <span style={{ color: "var(--flow-2)", fontWeight: 700 }}>
                      {st.count}건 수신{st.pickedFrom ? ` · 응답 경로 ${st.pickedFrom}` : ""}
                    </span>
                  : <span style={{ color: "#A93F1F" }}>{st?.error || "아직 호출 전"}</span>}
              </div>
              {st?.ok && st.sample && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--ink-3)" }}>
                    응답 첫 건 필드 보기
                  </summary>
                  <pre style={{ fontSize: 10.5, lineHeight: 1.5, overflowX: "auto", marginTop: 6,
                    background: "#fff", padding: 9, borderRadius: 7, maxHeight: 220 }}>
                    {JSON.stringify(st.sample, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          {[["serviceKey", "일반 인증키 (Decoding)", "공공데이터포털에서 발급받은 키"],
            ["lhBase", "LH 요청 경로 prefix", "/openapi/lh"],
            ["lhPath", "LH 오퍼레이션", "/lhLeaseNoticeSplInfo1"],
            ["odcBase", "청약홈 요청 경로 prefix", "/openapi/odcloud"],
            ["odcPath", "청약홈 공고 조회 경로", "/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail"],
            ["odcModelPath", "청약홈 주택형 조회 경로", "/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl"]].map(([k, label, ph]) => (
            <div className="mv-field" key={k} style={{ marginBottom: 12 }}>
              <label htmlFor={`api-${k}`} style={{ fontSize: 13 }}>{label}</label>
              <input id={`api-${k}`} className="mv-in" style={{ height: 42, fontSize: 14 }}
                placeholder={ph} value={draft[k] || ""}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            </div>
          ))}
          <div className="mv-row" style={{ gap: 8 }}>
            <button className="mv-btn mv-primary mv-sm" onClick={() => live.apply(draft)}>저장하고 다시 호출</button>
            <button className="mv-btn mv-ghost mv-sm" onClick={() => setDraft(live.cfg)}>되돌리기</button>
          </div>
          <div className="mv-note" style={{ marginTop: 12, fontSize: 12 }}>
            인증키는 이 브라우저에만 저장되고 서버로 보내지 않습니다.
            공공데이터 API 는 브라우저 직접 호출 시 <b>CORS</b> 로 막히므로, 위 경로는
            개발 서버·배포 서버의 프록시를 거치도록 상대경로로 두는 것이 기본값입니다.
          </div>
        </div>
      )}

      {live.count === 0 && live.state !== "loading" && (
        <div className="mv-note" style={{ marginTop: 12, borderLeft: "3px solid #17285A", fontSize: 12.5, lineHeight: 1.7 }}>
          지금 화면은 <b>수집 스냅샷</b>입니다 — 청약홈 API 에서 받아 저장해 둔
          <b> 실제 공고 {live.snapshotCount}건</b>
          {live.snapshotAt && <> (<b>{new Date(live.snapshotAt).toLocaleString("ko-KR")}</b> 수집)</>}.
          지어낸 예시가 아니라 진짜 데이터지만, <b>지금 이 순간</b>의 상태는 아닙니다.<br />
          게시된 링크는 보안 정책(CSP)상 외부 API 를 직접 호출할 수 없어 늘 스냅샷으로 보입니다.
          매일 자동 수집돼 갱신되고, 직접 띄워서 쓰시면 위 <b>API 설정</b>으로 실시간 호출이 됩니다.
        </div>
      )}
    </div>
  );
}

/* ============================================================
   루트
   ============================================================ */
export default function App() {
  const [tab, setTab] = useState(null);
  const [cfg, setCfg] = useState(() => loadConfig());
  const [state, setState] = useState("idle");
  const [data, setData] = useState(null);

  const run = useCallback((c) => {
    if (!c.enabled) return;
    const ctrl = new AbortController();
    setState("loading");
    fetchAllNotices(c, ctrl.signal)
      .then((res) => { setData(res); setState("done"); })
      .catch((e) => { setData({ sites: [], at: new Date().toISOString(),
        sources: { lh: { ok: false, error: String(e) }, odc: { ok: false, error: String(e) } } }); setState("done"); });
    return () => ctrl.abort();
  }, []);

  useEffect(() => { run(cfg); }, [cfg, run]);

  const live = {
    state, data, cfg,
    snapshotCount: SNAPSHOT.count,
    snapshotAt: SNAPSHOT.collectedAt,
    count: data?.sites?.length || 0,
    at: data?.at || null,
    refresh: () => run(cfg),
    apply: (next) => { saveConfig(next); setCfg(next); },
  };

  /* 실시간 공고를 앞에, 내장 샘플을 뒤에 — 실시간이 0건이면 샘플만 보입니다 */
  /* 실시간 호출이 성공하면 그 결과를, 실패하면(아티팩트 링크 등) 수집 스냅샷을 씁니다.
     둘을 섞으면 같은 공고가 중복되므로 한쪽만 씁니다. */
  const allSites = useMemo(
    () => (data?.sites?.length ? data.sites : SITES),
    [data]);

  return (
    <div className="mv">
      <style>{CSS}</style>
      <Subscription tab={tab} setTab={setTab} allSites={allSites} live={live} />
    </div>
  );
}
