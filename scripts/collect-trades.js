/* ============================================================
   국토부 아파트 매매 실거래가 수집 — 분양예정가에 "주변 시세"를 넣기 위해
   ------------------------------------------------------------
   왜 필요한가: 위치만 아는 모델은 평균 오차 12.7%에서 멈춥니다.
   같은 읍면동·6개월 안에 분양한 두 단지끼리도 평당가가 10.8% 벌어지는데,
   그 차이를 만드는 게 주변 아파트 가격대이기 때문입니다.
   수지자이 에디시온(평당 4,562만)과 같은 풍덕천동의 다른 단지(2,000만대)를
   가르는 건 주소가 아니라 시세입니다.

   두 단계로 돕니다.
     1. 법정동코드 표를 통째로 받아 둡니다 (시군구 → LAWD_CD 5자리).
        실거래가 API 는 이 코드로만 조회됩니다.
     2. 공고가 있는 시군구마다, 그 공고 시점 앞뒤 개월의 거래를 받습니다.
        학습에는 "공고 당시" 시세가 필요하고, 뉴스 현장 추정에는
        "지금" 시세가 필요해서 최근 6개월도 함께 받습니다.

   저장은 원자료가 아니라 (시군구·법정동·연월)별 중앙값입니다.
   원자료를 다 넣으면 저장소가 수십 MB로 불어납니다.

   ⚠️ 평당가 환산은 분양가 쪽과 **똑같이** 맞춥니다.
      평 = 전용면적 × 1.35 ÷ 3.3058 (전용 → 공급 환산 후 평)
      여기가 어긋나면 시세와 분양가를 비교하는 의미가 없어집니다.
   ============================================================ */

import fs from "node:fs";

const KEY = process.env.ODCLOUD_KEY || "";
if (!KEY) { console.error("ODCLOUD_KEY 가 없습니다"); process.exit(1); }
console.log(`인증키 길이 ${KEY.length}자`);

const OUT = "data";
fs.mkdirSync(OUT, { recursive: true });
const q = (o) => new URLSearchParams(o).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

async function getJson(url, tries = 3) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(25000),
        headers: { Accept: "application/json,text/xml;q=0.9", "User-Agent": "jipdang/1.0" },
      });
      const text = await res.text();
      try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
    } catch (e) { lastErr = e; await sleep(600 * (i + 1)); }
  }
  throw lastErr;
}

/* XML <item> 들을 객체 배열로 — API 가 JSON 을 안 줄 때 대비 */
function itemsFromXml(text) {
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)]
      .map((x) => [x[1], x[2].trim()])));
}

/* ── 1단계 · 법정동코드 표 ────────────────────────────────── */
const LAWD_FILE = `${OUT}/lawd.json`;
async function loadLawd() {
  if (fs.existsSync(LAWD_FILE)) {
    const j = JSON.parse(fs.readFileSync(LAWD_FILE, "utf8"));
    if (Object.keys(j.sgg || {}).length > 200) {
      console.log(`법정동코드 표 재사용 — 시군구 ${Object.keys(j.sgg).length}개`);
      return j;
    }
  }
  console.log("법정동코드 표를 받습니다…");
  const sgg = {};       /* "경기도 화성시" → "41590" */
  const emd = {};       /* "41590|반월동" → true (주소 매칭 확인용) */
  for (let page = 1; page <= 60; page++) {
    const url = `https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList?${q(
      { ServiceKey: KEY, pageNo: page, numOfRows: 1000, type: "json" })}`;
    const { json, text } = await getJson(url);
    const rows = json?.StanReginCd?.[1]?.row || itemsFromXml(text);
    if (!rows.length) break;
    for (const r of rows) {
      const code = String(r.region_cd || "");
      const name = String(r.locatadd_nm || "").trim();
      if (code.length !== 10 || !name) continue;
      const [umd, ri] = [code.slice(5, 8), code.slice(8, 10)];
      if (umd === "000" && ri === "00") {
        /* 시군구 단계 — "경기도 화성시" 처럼 두 토큰 */
        if (name.split(/\s+/).length >= 2) sgg[name] = code.slice(0, 5);
      } else if (ri === "00") {
        emd[`${code.slice(0, 5)}|${name.split(/\s+/).pop()}`] = 1;
      }
    }
    if (rows.length < 1000) break;
    await sleep(120);
  }
  const out = { at: new Date().toISOString(), sgg, emd };
  fs.writeFileSync(LAWD_FILE, JSON.stringify(out));
  console.log(`법정동코드 — 시군구 ${Object.keys(sgg).length}개 · 읍면동 ${Object.keys(emd).length}개`);
  return out;
}

/* ── 2단계 · 어느 시군구의 어느 달을 받을지 정하기 ──────────── */
const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const BACK = Number(process.env.MONTHS_BACK || 6);   /* 공고 시점에서 몇 개월 뒤로 */

const ymOf = (d, offset = 0) => {
  const t = new Date(d);
  if (isNaN(t)) return null;
  t.setMonth(t.getMonth() - offset);
  return `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}`;
};

const lawd = await loadLawd();
/* 주소 두 토큰이 표의 시군구 이름과 맞아야 합니다.
   "경기도 용인시 처인구" 처럼 구가 있으면 세 토큰이 표에 있습니다. */
function lawdOf(gu) {
  const tok = String(gu || "").split(/\s+/).filter(Boolean);
  for (const n of [tok.slice(0, 3).join(" "), tok.slice(0, 2).join(" ")]) {
    if (lawd.sgg[n]) return { code: lawd.sgg[n], name: n };
  }
  return null;
}

const jobs = new Map();          /* "41590|202603" → true */
const notMatched = new Set();
const nowYm = ymOf(new Date());
for (const s of SNAP.sites) {
  const L = lawdOf(s.gu);
  if (!L) { notMatched.add(String(s.gu || "").split(/\s+/).slice(0, 2).join(" ")); continue; }
  for (let i = 0; i <= BACK; i++) {
    const ym = ymOf(s.when || new Date(), i);
    if (ym) jobs.set(`${L.code}|${ym}`, 1);
  }
  /* 지금 시세도 — 뉴스 현장 추정에 씁니다 */
  for (let i = 1; i <= BACK; i++) jobs.set(`${L.code}|${ymOf(new Date(), i)}`, 1);
}
console.log(`받을 것 ${jobs.size}건 (시군구×연월) · 주소 매칭 실패 ${notMatched.size}개`);
if (notMatched.size) console.log(`  실패 예: ${[...notMatched].slice(0, 8).join(" / ")}`);

/* ── 3단계 · 거래 받기 ────────────────────────────────────── */
const PY_PER_M2 = 1.35 / 3.3058;
const cells = {};                /* "41590|반월동|202603" → [중앙값, 건수] */
const bucket = {};
let done = 0, failed = 0, rows = 0;

async function fetchOne(code, ym) {
  const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?${q(
    { serviceKey: KEY, LAWD_CD: code, DEAL_YMD: ym, numOfRows: 1000, pageNo: 1, _type: "json" })}`;
  const { json, text } = await getJson(url);
  const it = json?.response?.body?.items?.item;
  const list = Array.isArray(it) ? it : it ? [it] : itemsFromXml(text);
  for (const r of list) {
    /* 필드 이름이 신/구 버전에서 다릅니다 — 둘 다 받습니다 */
    const amt = String(r.dealAmount ?? r.거래금액 ?? "").replace(/[^\d]/g, "");
    const area = parseFloat(r.excluUseAr ?? r.전용면적 ?? "0");
    const dong = String(r.umdNm ?? r.법정동 ?? "").trim();
    if (!amt || !area || !dong) continue;
    /* 국민평형 근처만 — 소형·대형을 섞으면 평당가가 흔들립니다 */
    if (area < 55 || area > 100) continue;
    const py = area * PY_PER_M2;
    const pyPrice = Number(amt) / py;              /* 만원/평 */
    if (pyPrice < 200 || pyPrice > 20000) continue;
    (bucket[`${code}|${dong}|${ym}`] ??= []).push(pyPrice);
    rows++;
  }
}

const queue = [...jobs.keys()];
const CONC = Number(process.env.CONCURRENCY || 6);
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const key = queue.shift();
    const [code, ym] = key.split("|");
    try { await fetchOne(code, ym); }
    catch (e) { failed++; if (failed <= 5) console.log(`  실패 ${key}: ${String(e?.message || e).slice(0, 80)}`); }
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${jobs.size} · 거래 ${rows}건 · 실패 ${failed}`);
    await sleep(60);
  }
}));

for (const [k, v] of Object.entries(bucket)) cells[k] = [Math.round(median(v)), v.length];

const out = {
  at: new Date().toISOString(), notices: SNAP.collectedAt,
  monthsBack: BACK, requested: jobs.size, failed, trades: rows,
  cells,
};
fs.writeFileSync(`${OUT}/trades.json`, JSON.stringify(out));
console.log(`\n거래 ${rows}건 → 칸 ${Object.keys(cells).length}개 · 실패 ${failed}건`);
console.log(`${OUT}/trades.json 저장 (${(fs.statSync(`${OUT}/trades.json`).size / 1024 / 1024).toFixed(1)}MB)`);
