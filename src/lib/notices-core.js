/* ============================================================
   공공데이터 오픈API — 순수 로직 (브라우저 / Node 공용)
   ------------------------------------------------------------
   localStorage·import.meta 같은 브라우저 전용 API 를 쓰지 않습니다.
   앱(src/lib/openapi.js)과 수집 스크립트(scripts/collect.js)가
   같은 파싱·정규화 규칙을 쓰도록 여기 모아둡니다.
   ============================================================ */

/* ── 응답에서 레코드 배열 꺼내기 ───────────────────────────
   기관마다 감싸는 모양이 달라서, 실제 응답을 받아보기 전에는
   한 가지 모양으로 단정할 수 없습니다. 알려진 형태를 순서대로 훑고
   못 찾으면 "배열처럼 생긴 가장 큰 값"을 집습니다.
   어떤 경로에서 꺼냈는지 pickedFrom 으로 돌려줘서 화면에서 확인 가능. */
export function extractRecords(json) {
  const tried = [];
  const take = (v, from) => {
    tried.push(from);
    return Array.isArray(v) && v.length ? { rows: v, pickedFrom: from } : null;
  };

  if (Array.isArray(json)) {
    /* LH 계열은 [{resHeader:[...]}, {dsList:[...]}] 처럼 배열로 옵니다 */
    for (const seg of json) {
      if (seg && typeof seg === "object") {
        for (const k of Object.keys(seg)) {
          const hit = take(seg[k], `[]. ${k}`);
          if (hit && k.toLowerCase() !== "resheader") return hit;
        }
      }
    }
    const hit = take(json, "최상위 배열");
    if (hit) return hit;
  }

  const paths = [
    ["dsList"], ["data"], ["items"],
    ["response", "body", "items", "item"],
    ["response", "body", "items"],
    ["body", "items", "item"],
    ["body", "items"],
    ["result"], ["list"], ["rows"],
  ];
  for (const p of paths) {
    let cur = json;
    for (const seg of p) cur = cur && typeof cur === "object" ? cur[seg] : undefined;
    const hit = take(cur, p.join("."));
    if (hit) return hit;
  }

  /* 마지막 수단: 객체 안에서 가장 긴 배열 */
  if (json && typeof json === "object") {
    let best = null;
    for (const [k, v] of Object.entries(json)) {
      if (Array.isArray(v) && (!best || v.length > best.rows.length)) best = { rows: v, pickedFrom: k };
    }
    if (best && best.rows.length) return best;
  }
  return { rows: [], pickedFrom: null, tried };
}

/* ── 필드 이름 후보군에서 값 집기 ─────────────────────────
   공공데이터는 같은 뜻도 기관마다 이름이 다릅니다(PAN_NM / bsnsNm / houseNm …).
   후보를 나열해두고 먼저 잡히는 값을 씁니다. 대소문자·언더스코어 무시. */
const norm = (k) => String(k).toLowerCase().replace(/[_\s-]/g, "");
function pick(row, candidates) {
  if (!row || typeof row !== "object") return undefined;
  const map = new Map(Object.keys(row).map((k) => [norm(k), k]));
  for (const c of candidates) {
    const real = map.get(norm(c));
    if (real !== undefined) {
      const v = row[real];
      if (v !== null && v !== undefined && String(v).trim() !== "") return { value: v, key: real };
    }
  }
  return undefined;
}
const val = (row, cands, fallback) => (pick(row, cands)?.value ?? fallback);

const FIELDS = {
  /* 주의: 사업주체명(BSNS_MBY_NM)은 공고명이 아니라 공급자입니다. supplier 쪽에만 둡니다. */
  name:   ["PAN_NM", "panNm", "HOUSE_NM", "houseNm", "HOUSE_NM_KOR", "공고명", "주택명",
           "PBLANC_NM", "SPL_INF_TP_NM", "BSNS_NM", "title"],
  region: ["CNP_CD_NM", "cnpCdNm", "AREA_NM", "LCC_NM", "지역", "SIDO", "sido", "ARA_NM", "addr", "ADRES"],
  addr:   ["LGDONG_ADDR", "ADRES", "addr", "RN_ADRES", "주소", "HSSPLY_ADRES"],
  supplier: ["SPL_INST_NM", "BSNS_MBY_NM", "splInstNm", "공급기관", "INSTT_NM", "brand"],
  total:  ["TOT_SUPLY_HSHLDCO", "SUM_HSHLD_CO", "totHshldCo", "총세대수", "HSHLD_CO"],
  general:["GNRL_SUPLY_HSHLDCO", "SPL_HSHLD_CO", "일반공급세대수", "SUPLY_HSHLDCO"],
  notice: ["PAN_NT_ST_DT", "panNtStDt", "RCRIT_PBLANC_DE", "공고일", "NT_DT", "PAN_DT"],
  status: ["PAN_SS", "panSs", "STATUS", "진행상태", "PAN_ST_NM"],
  type:   ["HSHLD_TP_NM", "HOUSE_TY", "SPL_TP_NM", "주택형", "EXCLUSE_AR", "TNTY_NM"],
  area:   ["EXCLUSE_AR", "excluseAr", "전용면적", "SUPLY_AR", "AR"],
  units:  ["SUPLY_HSHLDCO", "HSHLD_CO", "세대수", "SPL_HSHLD_CO"],
  price:  ["LWDN_MNY", "TOT_MNY", "SUPLY_AMT", "분양가", "LTTOT_TOP_AMOUNT", "RENT_GTN", "TOP_AMT"],
  id:     ["PAN_ID", "panId", "PBLANC_NO", "id", "SEQ", "NOTICE_ID"],
};

/* CUT_BANDS 를 못 쓰는 파일이라 지역→예상 당첨선은 여기서 최소한만 추정.
   실데이터에 당첨선이 없으므로, 화면에는 "추정" 배지가 함께 나갑니다. */
const REGION_CUT = [
  [/강남|서초|송파/, 72],
  [/서울/, 61],
  [/과천|판교|성남|하남|광명|분당/, 63],
  [/수원|용인|화성|동탄|안양|의왕|군포/, 58],
  [/고양|김포|파주|의정부|남양주|인천|검단/, 49],
  [/부산|대구|대전|광주|울산|세종/, 45],
];
const guessCut = (text) => {
  for (const [re, v] of REGION_CUT) if (re.test(text || "")) return v;
  return 42;
};

const toNum = (v) => {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
/* 공공데이터 금액 단위가 원/천원/만원으로 제각각이라, 만원 단위로 정규화.
   1억(10000만원) 넘는 값이 원 단위로 들어오면 10000으로 나눕니다. */
const toManwon = (v) => {
  const n = toNum(v);
  if (!n) return 0;
  if (n > 100000000) return Math.round(n / 10000);   // 원 단위로 보임
  if (n > 1000000) return Math.round(n / 10000);     // 원 단위 (수천만원대)
  return Math.round(n);                              // 이미 만원 단위
};

/* 기관마다 상태 표기가 제각각입니다("접수중" / "접수 중" / "공고중").
   화면은 "접수 중 / 접수 예정 / 접수 마감" 세 가지로만 거르므로 표준화합니다. */
export function canonStatus(raw) {
  const t = String(raw ?? "").replace(/\s/g, "");
  if (!t) return "";
  if (/^(접수중|신청중|청약중|모집중)$/.test(t)) return "접수 중";
  if (/^(접수예정|공고중|공고|모집예정|청약예정)$/.test(t)) return "접수 예정";
  if (/^(접수마감|마감|종료|접수종료|당첨자발표)$/.test(t)) return "접수 마감";
  return String(raw).trim();
}

/* ── 레코드 → 앱 내부 site 객체 ─────────────────────────── */
function normalizeRow(row, i, source) {
  const name = String(val(row, FIELDS.name, "") || "").trim();
  const addr = String(val(row, FIELDS.addr, "") || "").trim();
  const region = String(val(row, FIELDS.region, "") || "").trim() || addr;
  const areaTxt = val(row, FIELDS.area, "");
  const typeTxt = String(val(row, FIELDS.type, "") || "").trim();
  const units = toNum(val(row, FIELDS.units, 0));
  const price = toManwon(val(row, FIELDS.price, 0));

  /* 전용 59.98㎡ → "59㎡타입" 처럼 국내 표기는 절사입니다. 반올림하면 60㎡ 가 돼 버립니다. */
  const areaNum = toNum(areaTxt);
  const typeLabel = areaNum ? `${Math.floor(areaNum)}㎡` : (typeTxt || "면적 미상");

  const total = toNum(val(row, FIELDS.total, 0));
  const general = toNum(val(row, FIELDS.general, 0)) || units || total;
  const cut = guessCut(`${region} ${addr} ${name}`);

  return {
    id: `live-${source}-${val(row, FIELDS.id, i)}-${i}`,
    live: true,
    source,
    supply: source === "lh" ? "공공" : "민영",
    n: name || "(공고명 없음)",
    gu: region || "지역 미상",
    brand: String(val(row, FIELDS.supplier, source === "lh" ? "LH 한국토지주택공사" : "공공데이터")).trim(),
    total: total || general || units || 0,
    general,
    when: String(val(row, FIELDS.notice, "")).trim() || "일정 미상",
    status: canonStatus(val(row, FIELDS.status, "")) || "공고",
    types: [{ t: typeLabel, n: units || 0, price }],
    cut,
    cutEstimated: true,
    cutAmt: 0,
    cutAmtEstimated: true,
    tags: ["실시간", source === "lh" ? "LH" : "odcloud"].filter(Boolean),
    note: `공공데이터포털 오픈API에서 실시간으로 받아온 공고입니다. 예상 당첨선(${cut}점)은 API가 주지 않아 지역 기준으로 추정한 값이며, 분양가·세대수는 응답 원문 그대로입니다.`,
    raw: row,
  };
}

/* 같은 공고명이 여러 주택형으로 쪼개져 오는 경우 하나로 합칩니다 */
function mergeByNotice(sites) {
  const byKey = new Map();
  for (const s of sites) {
    const key = `${s.source}|${s.n}|${s.gu}`;
    const hit = byKey.get(key);
    if (!hit) { byKey.set(key, { ...s, types: [...s.types] }); continue; }
    for (const t of s.types) {
      if (!hit.types.some((x) => x.t === t.t)) hit.types.push(t);
    }
    hit.general = Math.max(hit.general, s.general);
    hit.total = Math.max(hit.total, s.total);
  }
  return [...byKey.values()].map((s) => ({
    ...s,
    types: s.types.length ? s.types : [{ t: "면적 미상", n: 0, price: 0 }],
  }));
}

/* 레코드 배열 → 앱이 쓰는 공고 배열 (정규화 + 주택형 병합).
   앱과 수집 스크립트가 공유하는 진입점입니다. */
export function normalizeRows(rows, source) {
  return mergeByNotice((rows || []).map((r, i) => normalizeRow(r, i, source)));
}

/* ── 실제 호출 ──────────────────────────────────────────── */
/* 네트워크 단계에서 끊기는 경우(대표적으로 apis.data.go.kr) 한 번만 재시도합니다.
   응답이 오긴 왔는데 내용이 틀린 경우(HTTP 4xx/5xx, XML 오류)는 재시도하지 않습니다 —
   같은 답이 다시 올 뿐이고, 원인을 가려버립니다. */
async function callJson(url, signal, attempt = 0) {
  let res;
  try {
    res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(25000),
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    const kind = e?.name === "TimeoutError" ? "25초 안에 응답 없음" : String(e?.message || e);
    if (attempt === 0 && e?.name !== "AbortError") return callJson(url, signal, 1);
    throw new Error(`연결 실패 (${kind}) · 2회 시도`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} · ${text.slice(0, 160)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    /* data.go.kr 은 키 오류 등을 XML 로 돌려줍니다 */
    const msg = (text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/) ||
                 text.match(/<errMsg>(.*?)<\/errMsg>/) ||
                 text.match(/<resultMsg>(.*?)<\/resultMsg>/) || [])[1];
    throw new Error(msg ? `API 오류: ${msg}` : `JSON 아님 (앞부분: ${text.slice(0, 120)})`);
  }
}

export async function fetchLh(cfg, signal) {
  if (!cfg.serviceKey) throw new Error("인증키가 비어 있습니다");
  const q = new URLSearchParams({
    serviceKey: cfg.serviceKey,
    PG_SZ: String(cfg.rows),
    PAGE: "1",
  });
  const json = await callJson(`${cfg.lhBase}${cfg.lhPath}?${q}`, signal);
  const { rows, pickedFrom } = extractRecords(json);
  return { rows, pickedFrom, raw: json };
}

export async function fetchOdcloud(cfg, signal) {
  if (!cfg.serviceKey) throw new Error("인증키가 비어 있습니다");
  if (!cfg.odcPath) throw new Error("odcloud 오퍼레이션 경로가 비어 있습니다 (Swagger에서 확인 후 입력)");
  const q = new URLSearchParams({
    serviceKey: cfg.serviceKey,
    page: "1",
    perPage: String(cfg.rows),
  });
  const json = await callJson(`${cfg.odcBase}${cfg.odcPath}?${q}`, signal);
  const { rows, pickedFrom } = extractRecords(json);
  return { rows, pickedFrom, raw: json };
}

/* 두 API 를 각각 독립적으로 호출 — 하나가 죽어도 다른 하나는 살립니다 */
export async function fetchAllNotices(cfg, signal) {
  const out = {
    sites: [],
    at: new Date().toISOString(),
    sources: {
      lh:  { ok: false, count: 0, error: null, pickedFrom: null, sample: null },
      odc: { ok: false, count: 0, error: null, pickedFrom: null, sample: null },
    },
  };

  const jobs = [["lh", "generic"], ["odc", "applyhome"]].map(async ([key, mode]) => {
    try {
      let sites, pickedFrom, sample;
      if (mode === "applyhome") {
        /* 청약홈은 스키마가 확정돼 있어 전용 정규화를 씁니다 */
        const r = await fetchApplyhome(cfg, signal);
        sites = r.sites;
        pickedFrom = r.pickedFrom;
        sample = r.rows[0] ?? null;
        out.sources.odc.perSet = r.perSet;
      } else {
        const r = await fetchLh(cfg, signal);
        sites = normalizeRows(r.rows, "lh");
        pickedFrom = r.pickedFrom;
        sample = r.rows[0] ?? null;
      }
      out.sources[key] = { ok: true, count: sites.length, error: null, pickedFrom, sample };
      return sites;
    } catch (e) {
      out.sources[key] = {
        ok: false, count: 0, pickedFrom: null, sample: null,
        error: e?.name === "AbortError" ? "요청 취소됨" : String(e?.message || e),
      };
      return [];
    }
  });

  const results = await Promise.all(jobs);
  out.sites = results.flat();
  return out;
}

/* ============================================================
   청약홈(한국부동산원) APT 분양정보 — 확정 스키마 기준
   ------------------------------------------------------------
   Swagger: 청약홈 분양정보 조회 서비스 (api.odcloud.kr/api)
   공고 단위(Detail)와 주택형 단위(Mdl)를 HOUSE_MANAGE_NO + PBLANC_NO
   로 조인해서, 타입별 분양가·세대수와 특별공급 유형별 세대수까지 채웁니다.
   ============================================================ */
export const APPLYHOME = {
  detail: "/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail",
  model:  "/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl",
};

/* 청약홈이 제공하는 분양정보 세트.
   가점제와 무관한 오피스텔·생활형숙박시설·민간임대는 기본에서 뺐습니다
   (필요하면 cfg.sets 로 켜면 됩니다). */
export const APPLYHOME_SETS = [
  { key: "apt", label: "APT 분양", category: "APT", defaultOn: true,
    detail: "/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail",
    model:  "/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl" },
  { key: "remndr", label: "무순위·잔여세대", category: "무순위", defaultOn: true,
    detail: "/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail",
    model:  "/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancMdl" },
  { key: "urbty", label: "오피스텔·도시형·민간임대", category: "오피스텔등", defaultOn: false,
    detail: "/ApplyhomeInfoDetailSvc/v1/getUrbtyOfctlLttotPblancDetail",
    model:  "/ApplyhomeInfoDetailSvc/v1/getUrbtyOfctlLttotPblancMdl" },
  { key: "pblpvt", label: "공공지원 민간임대", category: "공공지원민간임대", defaultOn: false,
    detail: "/ApplyhomeInfoDetailSvc/v1/getPblPvtRentLttotPblancDetail",
    model:  "/ApplyhomeInfoDetailSvc/v1/getPblPvtRentLttotPblancMdl" },
  { key: "opt", label: "임의공급", category: "임의공급", defaultOn: false,
    detail: "/ApplyhomeInfoDetailSvc/v1/getOPTLttotPblancDetail",
    model:  "/ApplyhomeInfoDetailSvc/v1/getOPTLttotPblancMdl" },
];

const pad2 = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };
/* 세트마다 날짜 표기가 YYYY-MM-DD 이기도 YYYYMMDD 이기도 합니다 */
const normDate = (v) => {
  const t = String(v ?? "").trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return t;
};

/* HOUSE_TY 는 "084.9500A" 같은 형식입니다 → "84㎡A" */
export function houseTypeLabel(ty) {
  const s = String(ty ?? "").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return s || "면적 미상";
  const suffix = s.slice(m.index + m[0].length).replace(/^[.\s]+/, "").trim();
  return `${Math.floor(parseFloat(m[1]))}㎡${suffix}`;
}

/* 이 API 에는 진행상태 필드가 없어서 접수일로 파생합니다.
   세트마다 접수일 필드 이름이 달라 후보를 모두 봅니다. */
const RCEPT_START = ["SPSPLY_RCEPT_BGNDE", "RCEPT_BGNDE", "SUBSCRPT_RCEPT_BGNDE", "GNRL_RCEPT_BGNDE"];
const RCEPT_END = ["RCEPT_ENDDE", "SUBSCRPT_RCEPT_ENDDE", "GNRL_RCEPT_ENDDE", "GNRL_RNK1_ETC_AREA_ENDDE"];
const firstDate = (row, keys) => {
  for (const k of keys) { const v = normDate(row[k]); if (v) return v; }
  return "";
};
export function deriveStatus(row, today = isoDay(new Date())) {
  const start = firstDate(row, RCEPT_START);
  const end = firstDate(row, RCEPT_END);
  if (!start && !end) return "공고";
  if (start && today < start) return "접수 예정";
  if (end && today > end) return "접수 마감";
  return "접수 중";
}

const isY = (v) => String(v ?? "").trim().toUpperCase() === "Y";

/* 앱의 특별공급 유형 키(SPECIALS2.k)와 API 필드를 맞춰둡니다 */
export const SPECIAL_UNIT_FIELDS = [
  ["newly", "NWWDS_HSHLDCO", "신혼부부"],
  ["newly", "SPSPLY_NEW_MRRG_HSHLDCO", "신혼부부"],
  ["first", "LFE_FRST_HSHLDCO", "생애최초"],
  ["multi", "MNYCH_HSHLDCO", "다자녀가구"],
  ["old", "OLD_PARNTS_SUPORT_HSHLDCO", "노부모부양"],
  ["inst", "INSTT_RECOMEND_HSHLDCO", "기관추천"],
  ["baby", "NWBB_HSHLDCO", "신생아"],
  ["young", "YGMN_HSHLDCO", "청년"],
  ["young", "SPSPLY_YGMN_HSHLDCO", "청년"],
  ["aged", "SPSPLY_AGED_HSHLDCO", "고령자"],
  ["transfer", "TRANSR_INSTT_ENFSN_HSHLDCO", "이전기관"],
  ["etc", "ETC_HSHLDCO", "기타"],
];

const MODEL_TYPE = ["HOUSE_TY", "TP", "EXCLUSE_AR"];
const MODEL_PRICE = ["LTTOT_TOP_AMOUNT", "SUPLY_AMOUNT"];
const MODEL_GENERAL = ["SUPLY_HSHLDCO", "GNSPLY_HSHLDCO"];

export function normalizeApplyhome(d, models = [], set = APPLYHOME_SETS[0]) {
  const addr = String(d.HSSPLY_ADRES ?? "").trim();
  const areaNm = String(d.SUBSCRPT_AREA_CODE_NM ?? "").trim();
  /* 3토큰이면 서울은 동까지 나오지만 경기도는 "경기도 부천시 원미구" 에서 끊깁니다.
     동 단위가 있어야 같은 구 안의 가격 차이를 설명할 수 있어 4토큰까지 답니다. */
  const gu = addr ? addr.split(/\s+/).slice(0, 4).join(" ") : areaNm || "지역 미상";

  /* 금액 필드는 문서상 단위가 이미 "만원" 이라 환산하지 않습니다 */
  const types = models
    .map((m) => ({
      t: houseTypeLabel(val(m, MODEL_TYPE, "")),
      n: toNum(val(m, MODEL_GENERAL, 0)) + toNum(m.SPSPLY_HSHLDCO),
      price: toNum(val(m, MODEL_PRICE, 0)),
      general: toNum(val(m, MODEL_GENERAL, 0)),
      special: toNum(m.SPSPLY_HSHLDCO),
    }))
    .filter((t) => t.t !== "면적 미상" || t.n > 0);

  const general = models.reduce((a, m) => a + toNum(val(m, MODEL_GENERAL, 0)), 0);
  const total = toNum(d.TOT_SUPLY_HSHLDCO) || types.reduce((a, t) => a + t.n, 0);

  const specialUnits = {};
  for (const [key, field, label] of SPECIAL_UNIT_FIELDS) {
    const n = models.reduce((a, m) => a + toNum(m[field]), 0);
    if (n > 0) specialUnits[key] = { n: (specialUnits[key]?.n || 0) + n, label };
  }

  const tags = ["실시간"];
  if (set.category !== "APT") tags.push(set.category);
  if (isY(d.PARCPRC_ULS_AT)) tags.push("분양가상한제");
  if (isY(d.SPECLT_RDN_EARTH_AT)) tags.push("투기과열지구");
  if (isY(d.MDAT_TRGET_AREA_SECD)) tags.push("조정대상지역");
  if (isY(d.IMPRMN_BSNS_AT)) tags.push("정비사업");
  if (isY(d.PUBLIC_HOUSE_EARTH_AT)) tags.push("공공주택지구");
  if (isY(d.LRSCL_BLDLND_AT)) tags.push("대규모택지");

  const cut = guessCut(`${gu} ${areaNm} ${addr}`);
  const builder = String(d.CNSTRCT_ENTRPS_NM ?? "").trim();
  const developer = String(d.BSNS_MBY_NM ?? "").trim();

  const noteBits = [
    developer && `시행 ${developer}`,
    builder && `시공 ${builder}`,
    d.PRZWNER_PRESNATN_DE && `당첨자발표 ${normDate(d.PRZWNER_PRESNATN_DE)}`,
    d.MVN_PREARNGE_YM && `입주예정 ${d.MVN_PREARNGE_YM}`,
  ].filter(Boolean);

  /* 무순위·잔여세대는 가점제가 아니라 추첨이라 가점 비교가 의미 없습니다 */
  const scoreless = set.category !== "APT";

  return {
    id: `applyhome-${set.key}-${d.HOUSE_MANAGE_NO ?? "x"}-${d.PBLANC_NO ?? "x"}`,
    live: true,
    source: "applyhome",
    set: set.key,
    category: set.category,
    scoreless,
    supply: String(d.HOUSE_DTL_SECD ?? "").trim() === "03" ? "공공" : "민영",
    kind: String(d.HOUSE_SECD_NM ?? "").trim(),
    n: String(d.HOUSE_NM ?? "").trim() || "(주택명 없음)",
    gu,
    brand: builder || developer || "청약홈",
    total,
    general: general || total,
    when: normDate(d.RCRIT_PBLANC_DE) || "일정 미상",
    rceptStart: firstDate(d, RCEPT_START),
    rceptEnd: firstDate(d, RCEPT_END),
    status: canonStatus(deriveStatus(d)),
    receipt: {
      special: [d.SPSPLY_RCEPT_BGNDE, d.SPSPLY_RCEPT_ENDDE].filter(Boolean).map(normDate).join(" ~ "),
      rank1: [d.GNRL_RNK1_CRSPAREA_RCPTDE, d.GNRL_RNK1_CRSPAREA_ENDDE].filter(Boolean).map(normDate).join(" ~ "),
      general: [firstDate(d, RCEPT_START), firstDate(d, RCEPT_END)].filter(Boolean).join(" ~ "),
      result: normDate(d.PRZWNER_PRESNATN_DE),
    },
    types: types.length ? types : [{ t: "주택형 미상", n: 0, price: 0 }],
    specialUnits,
    cut,
    cutEstimated: true,
    cutAmt: 0,
    cutAmtEstimated: true,
    tags,
    url: String(d.PBLANC_URL ?? "").trim(),
    note: `청약홈 ${set.label} API 에서 받아온 공고입니다.${noteBits.length ? " " + noteBits.join(" · ") + "." : ""}${scoreless ? " 무순위·잔여세대는 가점제가 아니라 추첨이라 가점 비교를 하지 않습니다." : ` 예상 당첨선(${cut}점)은 API 가 제공하지 않아 지역 기준으로 추정한 값이고, 주택명·분양가·세대수·특별공급 물량은 응답 원문 그대로입니다.`}`,
    raw: d,
  };
}

/* ── 페이지네이션 ────────────────────────────────────────
   전국 물량을 다 받으려면 한 페이지로는 부족합니다.
   currentCount 가 perPage 보다 작아지거나 totalCount 를 채우면 멈춥니다. */
async function fetchPaged(base, path, cfg, signal, extra = {}) {
  const perPage = cfg.perPage || 100;
  const maxPages = cfg.maxPages || 20;
  const rows = [];
  let pickedFrom = null, total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams({
      serviceKey: cfg.serviceKey, page: String(page), perPage: String(perPage),
    });
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const json = await callJson(`${base}${path}?${q}`, signal);
    const r = extractRecords(json);
    pickedFrom = pickedFrom || r.pickedFrom;
    /* odcloud 는 totalCount = 데이터셋 전체, matchCount = 조건에 걸린 건수.
       우리가 알아야 하는 건 조건에 걸린 쪽입니다. */
    total = Number(json?.matchCount ?? json?.totalCount ?? 0) || total;
    rows.push(...r.rows);
    if (r.rows.length < perPage) break;
    if (total && rows.length >= total) break;
  }
  return { rows, pickedFrom, total: total || rows.length, pages: Math.ceil(rows.length / perPage) };
}

/* 동시 실행 개수를 묶어둡니다 — 공고 수만큼 주택형을 조회하므로 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

/* 세트 하나를 전량 조회 (공고 전체 + 각 공고의 주택형) */
export async function fetchApplyhomeSet(set, cfg, signal) {
  const base = cfg.odcBase;
  const since = cfg.since || daysAgo(cfg.sinceDays ?? 365);
  const { rows, pickedFrom, total } = await fetchPaged(base, set.detail, cfg, signal, {
    "cond[RCRIT_PBLANC_DE::GTE]": since,
  });
  const sorted = [...rows].sort((a, b) =>
    String(b.RCRIT_PBLANC_DE ?? "").localeCompare(String(a.RCRIT_PBLANC_DE ?? "")));
  const targets = cfg.detailLimit ? sorted.slice(0, cfg.detailLimit) : sorted;

  const models = await mapLimit(targets, cfg.concurrency || 6, async (r) => {
    try {
      const mq = new URLSearchParams({ serviceKey: cfg.serviceKey, page: "1", perPage: "100" });
      mq.set("cond[HOUSE_MANAGE_NO::EQ]", String(r.HOUSE_MANAGE_NO ?? ""));
      mq.set("cond[PBLANC_NO::EQ]", String(r.PBLANC_NO ?? ""));
      const mj = await callJson(`${base}${set.model}?${mq}`, signal);
      return extractRecords(mj).rows;
    } catch {
      return [];   /* 주택형 조회가 실패해도 공고 자체는 살립니다 */
    }
  });

  return { set, rows: targets, models, pickedFrom, total, fetched: rows.length };
}

/* 켜져 있는 세트를 모두 조회해 하나의 공고 목록으로 */
export async function fetchApplyhome(cfg, signal) {
  /* 키가 없으면 네트워크를 두드리지 않습니다 — 실패가 뻔하고 로그만 지저분해집니다 */
  if (!cfg.serviceKey) throw new Error("인증키가 비어 있습니다");
  const wanted = cfg.sets?.length
    ? APPLYHOME_SETS.filter((s) => cfg.sets.includes(s.key))
    : APPLYHOME_SETS.filter((s) => s.defaultOn);

  const results = [];
  for (const set of wanted) {
    try {
      results.push(await fetchApplyhomeSet(set, cfg, signal));
    } catch (e) {
      results.push({ set, rows: [], models: [], pickedFrom: null, total: 0, fetched: 0,
        error: String(e?.message || e) });
    }
  }

  const sites = results.flatMap((r) => r.rows.map((d, i) => normalizeApplyhome(d, r.models[i] || [], r.set)));
  const first = results.find((r) => r.rows.length);
  return {
    sites,
    rows: results.flatMap((r) => r.rows),
    models: results.flatMap((r) => r.models),
    perSet: results.map((r) => ({
      key: r.set.key, label: r.set.label, count: r.rows.length,
      total: r.total, error: r.error ?? null,
    })),
    pickedFrom: first?.pickedFrom ?? null,
    totalMatched: results.reduce((a, r) => a + r.total, 0),
  };
}
