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
    status: String(val(row, FIELDS.status, "공고")).trim(),
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
async function callJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
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

  const jobs = [
    ["lh", fetchLh],
    ["odc", fetchOdcloud],
  ].map(async ([key, fn]) => {
    try {
      const { rows, pickedFrom } = await fn(cfg, signal);
      const sites = normalizeRows(rows, key === "lh" ? "lh" : "odc");
      out.sources[key] = {
        ok: true, count: sites.length, error: null, pickedFrom,
        sample: rows[0] ?? null,
      };
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
