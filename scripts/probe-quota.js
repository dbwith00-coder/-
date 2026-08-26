/* ============================================================
   호출 한도 확인 — 값싼 진단
   ------------------------------------------------------------
   코드 훑기에서 11·26·27·28·29·30·31·36·41·43 까지는 시군구를 찾다가
   44(충남) 부터 51·52 까지 전부 0개가 나왔습니다. 실패는 0건이었고요.

   충남·전남·경북·경남·제주에 아파트 거래가 없을 리는 없습니다.
   앞 10개 시도 × 900 ≈ 9,900회 — 공공데이터포털 개발계정 일일 한도
   10,000회와 정확히 맞아떨어집니다.

   한도 초과 응답은 형식이 다릅니다.
     정상   {"response":{"body":{"items":{...}}}}
     초과   {"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"..."}}}
   앞의 수집기는 뒤엣것도 JSON 으로 잘 파싱해 버려서 "빈 결과"로 오해했습니다.
   그래서 실패 0건으로 조용히 지나갔습니다.

   여기서는 잘 되는 코드 하나로 3번만 불러 응답 원문을 봅니다.
   ============================================================ */

import fs from "node:fs";

const KEY = process.env.ODCLOUD_KEY || "";
const q = (o) => new URLSearchParams(o).toString();
const d = new Date();
d.setMonth(d.getMonth() - 2);
const YM = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

const out = [];
for (const code of ["11650", "44200", "48170"]) {
  const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?${q(
    { serviceKey: KEY, LAWD_CD: code, DEAL_YMD: YM, numOfRows: 3, pageNo: 1, _type: "json" })}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch { /* XML */ }
    const err = j?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg
      ?? j?.response?.header?.resultMsg
      ?? /<errMsg>(.*?)<\/errMsg>/.exec(text)?.[1] ?? null;
    const total = j?.response?.body?.totalCount ?? null;
    out.push({ code, status: res.status, err, total, raw: text.slice(0, 300) });
    console.log(`\n▸ ${code}  HTTP ${res.status}`);
    console.log(`   errMsg/resultMsg: ${err}`);
    console.log(`   totalCount: ${total}`);
    console.log(`   원문: ${text.replace(/\s+/g, " ").slice(0, 260)}`);
  } catch (e) {
    out.push({ code, error: String(e.message) });
    console.log(`\n▸ ${code}  ✗ ${e.message}`);
  }
}
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/probe-quota.json", JSON.stringify({ at: new Date().toISOString(), ym: YM, out }, null, 2));
console.log("\ndata/probe-quota.json 저장");
