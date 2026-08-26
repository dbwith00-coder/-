/* ============================================================
   분양공고 수집 스크립트 (GitHub Actions 에서 실행)
   ------------------------------------------------------------
   GitHub 러너는 공공데이터 API 에 직접 나갈 수 있어서, 여기서 받아
   저장소에 커밋해 둡니다. 앱과 같은 파싱·정규화 규칙(notices-core.js)을
   쓰므로 결과가 화면에 나오는 것과 동일합니다.

   환경변수
     ODCLOUD_KEY  공공데이터포털 일반 인증키(Decoding)  ← 저장소 시크릿
     ODC_PATH     odcloud 오퍼레이션 경로 (없으면 odcloud 건너뜀)
     ROWS         조회 건수 (기본 100)

   출력 (data/)
     lh-raw.json      LH 응답 원문 (앞 3건만 — 필드명 확인용)
     odc-raw.json     odcloud 응답 원문 (앞 3건만)
     notices.json     앱이 바로 쓰는 정규화 결과
     status.json      소스별 성공/실패·건수·오류·감지된 필드명
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fetchLh, fetchApplyhome, normalizeRows, normalizeApplyhome, APPLYHOME }
  from "../src/lib/notices-core.js";

const OUT = "data";
const KEY = process.env.ODCLOUD_KEY || "";
const ROWS = Number(process.env.ROWS || 100) || 100;

const cfg = {
  serviceKey: KEY,
  /* 러너에서는 프록시가 필요 없으므로 실제 호스트를 그대로 씁니다 */
  lhBase: process.env.LH_BASE || "https://apis.data.go.kr/B552555",
  lhPath: process.env.LH_PATH || "/lhLeaseNoticeSplInfo1",
  odcBase: process.env.ODC_BASE || "https://api.odcloud.kr/api",
  /* 청약홈 APT 분양정보 — Swagger 확정 경로 */
  odcPath: process.env.ODC_PATH || APPLYHOME.detail,
  odcModelPath: process.env.ODC_MODEL_PATH || APPLYHOME.model,
  detailLimit: Number(process.env.DETAIL_LIMIT || 30) || 30,
  sinceDays: Number(process.env.SINCE_DAYS || 240) || 240,
  rows: ROWS,
};

/* 공개 저장소의 Actions 로그에 남으므로 키는 길이만 찍습니다.
   GitHub 은 시크릿 전체 문자열만 마스킹하고 일부만 잘라 쓴 값은 마스킹하지 않습니다. */
const mask = (s) => (s ? `설정됨 (${s.length}자)` : "(없음)");

async function one(label, mode) {
  const t0 = Date.now();
  try {
    if (!cfg.serviceKey) throw new Error("ODCLOUD_KEY 시크릿이 비어 있습니다");
    let rows, pickedFrom, sites;
    if (mode === "applyhome") {
      /* 공고(Detail) + 주택형(Mdl) 을 조인해 타입·특별공급 물량까지 채웁니다 */
      const r = await fetchApplyhome(cfg);
      rows = r.rows;
      pickedFrom = r.pickedFrom;
      sites = r.rows.map((d, i) => normalizeApplyhome(d, r.models[i] || []));
      console.log(`  ${label}: 공고 ${rows.length}건 (전체 매칭 ${r.totalMatched}건), 주택형 ${r.models.reduce((a, m) => a + m.length, 0)}행`);
    } else {
      const r = await fetchLh(cfg);
      rows = r.rows;
      pickedFrom = r.pickedFrom;
      sites = normalizeRows(rows, "lh");
    }
    return {
      ok: true, count: sites.length, rawCount: rows.length, pickedFrom,
      ms: Date.now() - t0, error: null,
      fields: rows[0] ? Object.keys(rows[0]) : [],
      sample: rows.slice(0, 3),
      sites,
    };
  } catch (e) {
    return {
      ok: false, count: 0, rawCount: 0, pickedFrom: null,
      ms: Date.now() - t0, error: String(e?.message || e),
      fields: [], sample: [], sites: [],
    };
  }
}

const write = (name, obj) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`인증키 ${mask(cfg.serviceKey)}`);
  console.log(`LH      ${cfg.lhBase}${cfg.lhPath}`);
  console.log(`odcloud ${cfg.odcBase}${cfg.odcPath || " (경로 미설정 — 건너뜀)"}`);

  const lh = await one("LH", "generic");
  const odc = cfg.odcPath
    ? await one("청약홈", "applyhome")
    : { ok: false, count: 0, rawCount: 0, pickedFrom: null, ms: 0,
        error: "ODC_PATH 미설정 — Swagger(stage 37000)에서 경로 확인 후 워크플로 입력값으로 지정",
        fields: [], sample: [], sites: [] };

  const at = new Date().toISOString();
  const status = {
    collectedAt: at,
    sources: {
      lh:  { ok: lh.ok,  count: lh.count,  rawCount: lh.rawCount,  pickedFrom: lh.pickedFrom,  ms: lh.ms,  error: lh.error,  fields: lh.fields },
      odc: { ok: odc.ok, count: odc.count, rawCount: odc.rawCount, pickedFrom: odc.pickedFrom, ms: odc.ms, error: odc.error, fields: odc.fields },
    },
  };

  write("status.json", status);
  write("lh-raw.json", { collectedAt: at, pickedFrom: lh.pickedFrom, note: "필드명 확인용 앞 3건", sample: lh.sample });
  write("odc-raw.json", { collectedAt: at, pickedFrom: odc.pickedFrom, note: "필드명 확인용 앞 3건", sample: odc.sample });
  /* notices.json 에는 원문(raw)을 빼서 파일이 불필요하게 커지지 않게 합니다.
     원문 확인은 lh-raw.json / odc-raw.json 에서 하세요. */
  const strip = ({ raw, ...rest }) => rest;
  write("notices.json", {
    collectedAt: at,
    count: lh.sites.length + odc.sites.length,
    sites: [...lh.sites, ...odc.sites].map(strip),
  });

  /* Actions 요약 화면에 결과를 띄웁니다 */
  const md = [
    "## 분양공고 수집 결과",
    "",
    `수집 시각: \`${at}\``,
    "",
    "| 소스 | 결과 | 원문 행 | 공고 | 응답 경로 | 소요 |",
    "|---|---|---|---|---|---|",
    `| LH | ${lh.ok ? "✅" : "❌"} | ${lh.rawCount} | ${lh.count} | \`${lh.pickedFrom || "-"}\` | ${lh.ms}ms |`,
    `| odcloud | ${odc.ok ? "✅" : "❌"} | ${odc.rawCount} | ${odc.count} | \`${odc.pickedFrom || "-"}\` | ${odc.ms}ms |`,
    "",
  ];
  for (const [k, r] of [["LH", lh], ["odcloud", odc]]) {
    if (!r.ok) md.push(`**${k} 오류**: \`${r.error}\``, "");
    else md.push(`**${k} 응답 필드**: \`${r.fields.join("`, `") || "(없음)"}\``, "");
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n"));
  console.log(md.join("\n"));

  /* 둘 다 실패하면 실패로 끝내서 Actions 에서 빨갛게 보이도록 */
  if (!lh.ok && !odc.ok) {
    console.error("두 API 모두 실패했습니다.");
    process.exit(1);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
