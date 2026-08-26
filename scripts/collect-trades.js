/* ============================================================
   국토부 아파트 매매 실거래가 수집 — 분양예정가에 "주변 시세"를 넣기 위해
   ------------------------------------------------------------
   왜 필요한가: 위치만 아는 모델은 평균 오차 12.7%에서 멈춥니다.
   같은 읍면동·6개월 안에 분양한 두 단지끼리도 평당가가 10.8% 벌어지는데,
   그 차이를 만드는 게 주변 아파트 가격대이기 때문입니다.
   수지자이 에디시온(평당 4,562만)과 같은 풍덕천동의 다른 단지(2,000만대)를
   가르는 건 주소가 아니라 시세입니다.

   ── 걸림돌과 해결 ──────────────────────────────────────────
   실거래가 API 는 시군구를 이름이 아니라 5자리 코드(LAWD_CD)로만 받습니다.
   그런데 행정표준코드 API 는 이 인증키로 열리지 않습니다
   (SERVICE_KEY_IS_NOT_REGISTERED — 서비스마다 활용신청이 따로입니다).

   그래서 코드표를 실거래가 API 자체로 만듭니다. 5자리를 훑어서 자료가
   나오는 코드를 찾고, 그 응답에 들어 있는 **법정동 이름(umdNm)** 을 모읍니다.
   나중에 공고 주소의 읍면동을 이 목록에 맞춰 코드를 찾습니다.

   ⚠️ 응답의 estateAgentSggNm 은 **중개업소 소재지**라 지역 이름으로 쓰면
      안 됩니다 (11110 종로구를 조회해도 "서울 성북구"가 나옵니다).
      법정동 이름만 믿습니다.

   ⚠️ 화성시처럼 2025년에 구가 신설된 곳은 옛 코드(41590)가 0건입니다.
      새 코드(41591 만세구·41593 효행구·41595 병점구)로 자료가 옮겨갔습니다.
      훑기 방식이라 이런 변화가 자동으로 따라잡힙니다.

   ⚠️ 평당가 환산은 분양가 쪽과 **똑같이** 맞춥니다.
      평 = 전용면적 × 1.35 ÷ 3.3058 (전용 → 공급 환산 후 평)
      여기가 어긋나면 시세와 분양가를 비교하는 의미가 없어집니다.

   저장은 원자료가 아니라 (시군구코드·법정동·연월)별 중앙값입니다.
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

const ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";
const tradeUrl = (code, ym, rows = 1000) =>
  `${ENDPOINT}?${q({ serviceKey: KEY, LAWD_CD: code, DEAL_YMD: ym, numOfRows: rows, pageNo: 1, _type: "json" })}`;

/* 한도 초과·키 오류는 **JSON 으로도** 옵니다. 형식이 달라서
     정상   {"response":{"body":{"items":{...}}}}
     오류   {"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"..."}}}
   앞 판에서는 뒤엣것을 그냥 "빈 결과"로 읽어 버려, 충남부터 제주까지
   전부 0개로 조용히 지나갔습니다(실패 0건으로 표시되면서).
   이제는 오류로 인식하고, 한도 초과면 즉시 멈춥니다 — 계속 두드려 봐야
   호출만 태우고 결과는 다 비어 있습니다. */
class QuotaError extends Error {}
function parseResponse(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { /* XML */ }
  const errMsg = j?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg
    ?? (!j ? /<errMsg>(.*?)<\/errMsg>/.exec(text)?.[1] : null)
    ?? (!j ? /<returnAuthMsg>(.*?)<\/returnAuthMsg>/.exec(text)?.[1] : null);
  if (errMsg) {
    if (/LIMIT|EXCEEDS|초과/i.test(errMsg)) throw new QuotaError(errMsg);
    throw new Error(errMsg);
  }
  const code = j?.response?.header?.resultCode;
  if (code != null && !/^0+$/.test(String(code))) {
    const msg = j?.response?.header?.resultMsg || `resultCode ${code}`;
    if (/LIMIT|EXCEEDS|초과/i.test(msg)) throw new QuotaError(msg);
    throw new Error(msg);
  }
  if (!j) throw new Error(text.replace(/\s+/g, " ").slice(0, 120));
  const it = j?.response?.body?.items?.item;
  return Array.isArray(it) ? it : it ? [it] : [];
}

async function fetchTrades(code, ym, rows = 1000, tries = 2) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(tradeUrl(code, ym, rows), {
        signal: AbortSignal.timeout(25000),
        headers: { Accept: "application/json", "User-Agent": "jipdang/1.0" },
      });
      return parseResponse(await res.text());
    } catch (e) {
      if (e instanceof QuotaError) throw e;      /* 재시도 의미 없음 */
      last = e; await sleep(500 * (i + 1));
    }
  }
  throw last || new Error("unknown");
}

/* 달 문자열 — 실거래는 당월 자료가 비어 있을 수 있어 기본은 지난달 */
const ymOf = (d, back = 0) => {
  const t = new Date(d);
  if (isNaN(t)) return null;
  t.setMonth(t.getMonth() - back);
  return `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}`;
};

/* ── 1단계 · 시군구 코드표 만들기 (훑기) ────────────────────
   한 번 만들면 data/lawd.json 으로 저장해 다시 안 훑습니다.
   중간에 끊겨도 이어서 하도록 시도 접두사 단위로 저장합니다. */
const LAWD_FILE = `${OUT}/lawd.json`;
/* 강원(42→51)·전북(45→52)은 특별자치도 전환으로 코드가 바뀌었습니다.
   어느 쪽에 자료가 있는지 모르니 둘 다 훑습니다. */
const SIDO = ["11", "26", "27", "28", "29", "30", "31", "36",
              "41", "42", "43", "44", "45", "46", "47", "48", "50", "51", "52"];

async function scanLawd() {
  let store = { at: null, done: [], codes: {} };
  if (fs.existsSync(LAWD_FILE)) store = JSON.parse(fs.readFileSync(LAWD_FILE, "utf8"));
  const probeYm = ymOf(new Date(), 2);
  const todo = SIDO.filter((p) => !store.done.includes(p));
  if (!todo.length) {
    console.log(`코드표 재사용 — 시군구 ${Object.keys(store.codes).length}개`);
    return store;
  }
  console.log(`코드표를 훑습니다 (${todo.length}개 시도 × 900) — 기준월 ${probeYm}`);

  let quota = null;
  for (const prefix of todo) {
    if (quota) break;
    const codes = [];
    for (let n = 100; n <= 999; n++) codes.push(prefix + String(n));
    const queue = [...codes];
    let hits = 0, calls = 0, errs = 0, lastErr = null;
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (queue.length && !quota) {
        const code = queue.shift();
        try {
          const list = await fetchTrades(code, probeYm, 30, 1);
          calls++;
          if (list.length) {
            const dongs = [...new Set(list.map((r) => String(r.umdNm ?? r.법정동 ?? "").trim()).filter(Boolean))];
            if (dongs.length) { store.codes[code] = dongs; hits++; }
          }
        } catch (e) {
          if (e instanceof QuotaError) { quota = e.message; break; }
          errs++; lastErr = e;
        }
        await sleep(25);
      }
    }));
    /* 한도로 끊겼으면 그 시도는 "끝났다"고 표시하면 안 됩니다 — 다음에 다시 */
    if (!quota) store.done.push(prefix);
    store.at = new Date().toISOString();
    fs.writeFileSync(LAWD_FILE, JSON.stringify(store));
    console.log(`  ${prefix}xxx — 시군구 ${hits}개 · ${calls}회 · 실패 ${errs}`
      + `${lastErr ? ` (${String(lastErr.message).slice(0, 50)})` : ""} · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  }
  if (quota) {
    console.log(`\n⚠ 일일 호출 한도에 걸렸습니다: ${quota}`);
    console.log(`  여기까지 시군구 ${Object.keys(store.codes).length}개를 저장했습니다.`);
    console.log(`  남은 시도: ${SIDO.filter((p) => !store.done.includes(p)).join(" ")}`);
    console.log(`  한도는 자정(KST)에 초기화됩니다. 다시 돌리면 이어서 합니다.`);
    store.quota = quota;
  } else {
    console.log(`코드표 완성 — 시군구 ${Object.keys(store.codes).length}개`);
  }
  return store;
}

const lawd = await scanLawd();

/* 법정동 이름 → 코드들. 같은 이름이 여러 시군구에 있으므로 목록으로 둡니다. */
const dongToCodes = {};
for (const [code, dongs] of Object.entries(lawd.codes)) {
  for (const d of dongs) (dongToCodes[d] ??= []).push(code);
}

/* 시도 이름 → 코드 앞 2자리. 여기만 손으로 적습니다(바뀌지 않는 값). */
const SIDO_PREFIX = {
  서울: "11", 부산: "26", 대구: "27", 인천: "28", 광주: "29", 대전: "30", 울산: "31",
  세종: "36", 경기: "41", 강원: ["42", "51"], 충청북도: "43", 충북: "43",
  충청남도: "44", 충남: "44", 전북: ["45", "52"], 전라북도: ["45", "52"],
  전라남도: "46", 전남: "46", 경상북도: "47", 경북: "47", 경상남도: "48", 경남: "48",
  제주: "50",
};
function prefixOf(sido) {
  const s = String(sido || "");
  for (const [k, v] of Object.entries(SIDO_PREFIX)) if (s.startsWith(k)) return [].concat(v);
  return null;
}

/* 공고 주소 → 시군구 코드.
   시도 접두사로 후보를 좁히고, 읍면동 이름으로 고릅니다. */
function codeOf(gu) {
  const tok = String(gu || "").split(/\s+/).filter(Boolean);
  const pre = prefixOf(tok[0]);
  if (!pre) return null;
  const cands = (dongToCodes[tok[2]] || []).filter((c) => pre.includes(c.slice(0, 2)));
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    /* 같은 시도에 같은 동 이름이 여럿 — 거래가 많은 쪽이 대개 맞습니다 */
    return cands.sort((a, b) => (lawd.codes[b]?.length || 0) - (lawd.codes[a]?.length || 0))[0];
  }
  return null;
}

/* ── 2단계 · 받을 목록 정하기 ──────────────────────────────── */
const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));
const BACK = Number(process.env.MONTHS_BACK || 6);

const jobs = new Map();
const matched = new Map();       /* 공고 → 코드 (모델 쪽에서 다시 씁니다) */
let noCode = 0;
for (const s of SNAP.sites) {
  const code = codeOf(s.gu);
  if (!code) { noCode++; continue; }
  matched.set(`${s.n}|${s.gu}`, code);
  for (let i = 0; i <= BACK; i++) {
    const ym = ymOf(s.when || new Date(), i);
    if (ym) jobs.set(`${code}|${ym}`, 1);
  }
  for (let i = 1; i <= BACK; i++) jobs.set(`${code}|${ymOf(new Date(), i)}`, 1);
}
console.log(`주소 → 코드 매칭 ${matched.size}건 · 실패 ${noCode}건`);
console.log(`받을 것 ${jobs.size}건 (시군구 × 연월)`);

/* ── 3단계 · 거래 받기 ────────────────────────────────────── */
const PY_PER_M2 = 1.35 / 3.3058;
const bucket = {};
let done = 0, failed = 0, rows = 0, quotaHit = false;
const queue = [...jobs.keys()];
const CONC = Number(process.env.CONCURRENCY || 5);
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const key = queue.shift();
    const [code, ym] = key.split("|");
    try {
      for (const r of await fetchTrades(code, ym)) {
        const amt = String(r.dealAmount ?? r.거래금액 ?? "").replace(/[^\d]/g, "");
        const area = parseFloat(r.excluUseAr ?? r.전용면적 ?? "0");
        const dong = String(r.umdNm ?? r.법정동 ?? "").trim();
        if (!amt || !area || !dong) continue;
        /* 국민평형 근처만 — 소형·대형을 섞으면 평당가가 흔들립니다 */
        if (area < 55 || area > 100) continue;
        const pyPrice = Number(amt) / (area * PY_PER_M2);
        if (pyPrice < 200 || pyPrice > 20000) continue;
        (bucket[`${code}|${dong}|${ym}`] ??= []).push(pyPrice);
        rows++;
      }
    } catch (e) {
      if (e instanceof QuotaError) {
        if (!quotaHit) console.log(`\n⚠ 거래 수집 중 일일 한도: ${e.message}`);
        quotaHit = true;
        queue.length = 0;                       /* 더 두드려도 다 비어서 옵니다 */
        break;
      }
      failed++;
      if (failed <= 5) console.log(`  실패 ${key}: ${String(e?.message || e).slice(0, 80)}`);
    }
    if (++done % 200 === 0) console.log(`  ${done}/${jobs.size} · 거래 ${rows}건 · 실패 ${failed}`);
    await sleep(30);
  }
}));

const cells = {};
for (const [k, v] of Object.entries(bucket)) cells[k] = [Math.round(median(v)), v.length];

fs.writeFileSync(`${OUT}/trades.json`, JSON.stringify({
  at: new Date().toISOString(), notices: SNAP.collectedAt,
  monthsBack: BACK, requested: jobs.size, failed, trades: rows,
  partial: quotaHit || !!lawd.quota,
  matched: Object.fromEntries(matched), cells,
}));
const mb = (fs.statSync(`${OUT}/trades.json`).size / 1024 / 1024).toFixed(2);
console.log(`\n거래 ${rows}건 → 칸 ${Object.keys(cells).length}개 · 실패 ${failed}건`);
console.log(`${OUT}/trades.json 저장 (${mb}MB)`);
