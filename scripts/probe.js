/* ============================================================
   "분양 예정 단지" 소스 탐침
   ------------------------------------------------------------
   공고가 나기 전 단계의 단지를 알 수 있는 경로가 실제로 있는지,
   그리고 지금 인증키로 열리는지 러너에서 직접 두드려 봅니다.
   결과는 data/probe.json 과 Actions 요약에 남습니다.

   여기서 아무것도 저장하거나 커밋하지 않습니다 — 접근 가능 여부만 봅니다.
   ============================================================ */

import fs from "node:fs";

const KEY = process.env.ODCLOUD_KEY || "";
const OUT = "data";

const short = (s, n = 220) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

async function probe(name, url, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: opts.accept || "application/json,text/html;q=0.9,*/*;q=0.8",
                 "User-Agent": "jipdang-probe/1.0" },
    });
    const text = await res.text();
    let shape = null;
    try {
      const j = JSON.parse(text);
      shape = {
        keys: Object.keys(j).slice(0, 12),
        count: Array.isArray(j?.data) ? j.data.length : undefined,
        totalCount: j?.totalCount, matchCount: j?.matchCount,
        firstRowKeys: Array.isArray(j?.data) && j.data[0] ? Object.keys(j.data[0]).slice(0, 25) : undefined,
      };
    } catch { /* HTML/XML */ }
    return {
      name, url: url.replace(KEY, "«KEY»"), ok: res.ok, status: res.status,
      ms: Date.now() - t0, contentType: res.headers.get("content-type"),
      bytes: text.length, shape, preview: shape ? null : short(text),
      /* 검색해야 확인되는 힌트들 */
      hints: {
        hasOdcloud: /api\.odcloud\.kr\/api\/[A-Za-z0-9_\-/]+/.exec(text)?.[0] ?? null,
        hasSwagger: /infuser\.odcloud\.kr\/api\/stages\/\d+\/api-docs/.exec(text)?.[0] ?? null,
        errMsg: /<returnAuthMsg>(.*?)<\/returnAuthMsg>|"returnAuthMsg"\s*:\s*"(.*?)"/.exec(text)?.slice(1).find(Boolean) ?? null,
        rssItems: (text.match(/<item>/g) || []).length || undefined,
      },
    };
  } catch (e) {
    return { name, url: url.replace(KEY, "«KEY»"), ok: false, status: 0,
             ms: Date.now() - t0, error: String(e?.message || e) };
  }
}

const q = (o) => new URLSearchParams(o).toString();

const TARGETS = [
  /* ── 1. 청약홈 계열: 지금 키로 다른 서비스도 열리는지 ── */
  ["청약홈 분양정보(대조군)",
   `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail?${q({ serviceKey: KEY, page: 1, perPage: 1 })}`],

  /* 경쟁률·당첨가점 — 추정 당첨선을 실제 값으로 바꿀 수 있는 후보 */
  ["청약홈 경쟁률 서비스 안내페이지",
   "https://www.data.go.kr/data/15098905/openapi.do", { accept: "text/html" }],
  ["청약홈 당첨자정보 서비스 안내페이지",
   "https://www.data.go.kr/data/15110812/openapi.do", { accept: "text/html" }],

  /* ── 2. HUG 분양보증: 공고 전 단계의 공식 선행지표 후보 ── */
  ["HUG OPEN API 목록",
   "https://www.khug.or.kr/openapi/web/se/ap/seap000002.jsp", { accept: "text/html" }],
  ["HUG 분양보증 분양이행 현황 안내페이지",
   "https://www.data.go.kr/data/15056833/openapi.do", { accept: "text/html" }],

  /* ── 3. 청약홈 웹의 분양캘린더 (API 아님, 페이지 접근만 확인) ── */
  ["청약홈 APT분양정보 페이지",
   "https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancListView.do", { accept: "text/html" }],

  /* ── 4. 뉴스 기반: 구글뉴스 RSS 로 "분양 예정" 수집이 가능한지 ── */
  ["구글뉴스 RSS · 아파트 분양 예정",
   `https://news.google.com/rss/search?${q({ q: "아파트 분양 예정", hl: "ko", gl: "KR", ceid: "KR:ko" })}`,
   { accept: "application/rss+xml" }],
  ["구글뉴스 RSS · 분양 일정 단지",
   `https://news.google.com/rss/search?${q({ q: "분양 일정 아파트 단지 9월", hl: "ko", gl: "KR", ceid: "KR:ko" })}`,
   { accept: "application/rss+xml" }],
];

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`인증키 ${KEY ? `설정됨 (${KEY.length}자)` : "(없음)"}\n`);

  const results = [];
  for (const [name, url, opts] of TARGETS) {
    const r = await probe(name, url, opts);
    results.push(r);
    const mark = r.ok ? "✅" : "❌";
    console.log(`${mark} ${name}  [${r.status || r.error}]  ${r.ms}ms  ${r.bytes ?? 0}B`);
    if (r.hints?.hasOdcloud) console.log(`     → odcloud 경로 발견: ${r.hints.hasOdcloud}`);
    if (r.hints?.hasSwagger) console.log(`     → swagger 발견: ${r.hints.hasSwagger}`);
    if (r.hints?.errMsg) console.log(`     → API 메시지: ${r.hints.errMsg}`);
    if (r.hints?.rssItems) console.log(`     → RSS 아이템 ${r.hints.rssItems}건`);
    if (r.shape?.firstRowKeys) console.log(`     → 필드: ${r.shape.firstRowKeys.slice(0, 10).join(", ")}…`);
  }

  fs.writeFileSync(`${OUT}/probe.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + "\n");

  const md = ["## 분양 예정 소스 탐침", "", "| 대상 | 결과 | 크기 | 메모 |", "|---|---|---|---|"];
  for (const r of results) {
    const memo = [r.hints?.hasOdcloud && `경로 \`${r.hints.hasOdcloud}\``,
                  r.hints?.hasSwagger && `swagger \`${r.hints.hasSwagger}\``,
                  r.hints?.errMsg && `\`${r.hints.errMsg}\``,
                  r.hints?.rssItems && `RSS ${r.hints.rssItems}건`,
                  r.error && `\`${short(r.error, 80)}\``].filter(Boolean).join(" · ");
    md.push(`| ${r.name} | ${r.ok ? "✅ " + r.status : "❌ " + (r.status || "실패")} | ${r.bytes ?? 0}B | ${memo || "-"} |`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n"));
  console.log("\n" + md.join("\n"));
};

main().catch((e) => { console.error(e); process.exit(1); });
