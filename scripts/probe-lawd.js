/* ============================================================
   법정동코드(LAWD_CD) 확보 경로 탐침
   ------------------------------------------------------------
   실거래가 API 는 시군구를 이름이 아니라 5자리 코드로만 받습니다.
   그런데 행정표준코드 API 는 이 키로 열리지 않았습니다
   (SERVICE_KEY_IS_NOT_REGISTERED — 서비스마다 활용신청이 따로입니다).

   그래서 코드표를 얻을 다른 길을 재 봅니다.
     ① 실거래가 상세(신) 가 다른 코드로는 되는지
     ② 공개된 법정동코드 데이터셋을 그냥 내려받을 수 있는지
     ③ 실거래가 API 자체로 코드를 훑어낼 수 있는지 (응답에 지역명이 옵니다)
        — 되면 남의 저장소에 기대지 않고 자립할 수 있습니다.

   아무것도 커밋하지 않습니다.
   ============================================================ */

import fs from "node:fs";

const KEY = process.env.ODCLOUD_KEY || "";
const q = (o) => new URLSearchParams(o).toString();
const short = (s, n = 300) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const d = new Date();
d.setMonth(d.getMonth() - 1);
const YM = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

const tradeUrl = (path, code) =>
  `https://apis.data.go.kr/1613000/${path}?${q(
    { serviceKey: KEY, LAWD_CD: code, DEAL_YMD: YM, numOfRows: 1, pageNo: 1, _type: "json" })}`;

async function get(url, ms = 20000) {
  const t0 = Date.now();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { Accept: "application/json,text/*;q=0.9", "User-Agent": "jipdang-probe/1.0" },
  });
  const text = await res.text();
  return { status: res.status, text, ms: Date.now() - t0 };
}

const out = { at: new Date().toISOString(), ym: YM };

/* ── ① 상세(신) 이 다른 코드로는 되는가 ────────────────────── */
console.log("① 실거래가 엔드포인트 비교 (같은 코드로)");
out.endpoints = [];
for (const code of ["11650", "41590", "41135"]) {
  for (const path of ["RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
                      "RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"]) {
    try {
      const r = await get(tradeUrl(path, code));
      const j = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
      const total = j?.response?.body?.totalCount
        ?? /<totalCount>(\d+)<\/totalCount>/.exec(r.text)?.[1] ?? "?";
      const name = j?.response?.body?.items?.item?.estateAgentSggNm
        ?? j?.response?.body?.items?.item?.[0]?.estateAgentSggNm ?? "";
      const row = { code, path: path.split("/")[0], status: r.status, total, name };
      out.endpoints.push(row);
      console.log(`   ${code} · ${row.path.padEnd(24)} HTTP ${r.status} totalCount=${String(total).padStart(5)} ${name}`);
    } catch (e) { console.log(`   ${code} · ${path}: ${String(e.message).slice(0, 60)}`); }
    await sleep(120);
  }
}

/* ── ② 공개 법정동코드 데이터셋 ────────────────────────────── */
console.log("\n② 공개된 법정동코드 데이터셋을 받을 수 있는가");
const DATASETS = [
  ["raw.githubusercontent / vuski",
   "https://raw.githubusercontent.com/vuski/admdongkor/master/README.md"],
  ["npm registry (korea-administrative-area)",
   "https://registry.npmjs.org/korea-administrative-area-geo-json"],
  ["data.go.kr 파일 페이지",
   "https://www.data.go.kr/data/15063424/fileData.do"],
];
out.datasets = [];
for (const [name, url] of DATASETS) {
  try {
    const r = await get(url, 15000);
    out.datasets.push({ name, url, status: r.status, bytes: r.text.length });
    console.log(`   ${name.padEnd(38)} HTTP ${r.status} · ${r.text.length}바이트`);
  } catch (e) {
    out.datasets.push({ name, url, error: String(e.message) });
    console.log(`   ${name.padEnd(38)} ✗ ${String(e.message).slice(0, 50)}`);
  }
}

/* ── ③ 실거래가 API 로 코드를 직접 훑기 ────────────────────
   유효한 코드면 지역명이 응답에 들어옵니다. 한 시도만 재 봅니다.
   전체를 돌 가치가 있는지(=시간·호출수)를 여기서 판단합니다. */
console.log("\n③ 코드 훑기 실현성 — 서울(11xxx) 250개만 시험");
const found = {};
let calls = 0, t0 = Date.now();
const codes = [];
for (let i = 0; i < 250; i++) codes.push(`11${String(i).padStart(3, "0")}`);
const queue = [...codes];
await Promise.all(Array.from({ length: 10 }, async () => {
  while (queue.length) {
    const code = queue.shift();
    try {
      const r = await get(tradeUrl("RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade", code), 15000);
      calls++;
      const j = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
      const it = j?.response?.body?.items?.item;
      const one = Array.isArray(it) ? it[0] : it;
      if (one?.estateAgentSggNm) found[code] = String(one.estateAgentSggNm).trim();
    } catch { /* 무시 */ }
  }
}));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
out.scan = { tried: codes.length, calls, found, secs: +secs };
console.log(`   ${calls}회 호출 ${secs}초 · 찾은 코드 ${Object.keys(found).length}개`);
console.log("   " + Object.entries(found).slice(0, 30).map(([c, n]) => `${c}=${n}`).join("  "));
console.log(`\n   전국(17개 시도 × 1000) 환산: 약 ${Math.round(17000 / calls * secs / 60)}분 · 17,000회 호출`);

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/probe-lawd.json", JSON.stringify(out, null, 2));
console.log("\ndata/probe-lawd.json 저장");
