import { chromium } from "playwright";
import fs from "node:fs";

/* 수집된 실제 공고 스냅샷에서 기대값을 직접 계산해 화면과 대조합니다.
   (하드코딩한 기대값이 아니라 규칙을 다시 적용해 비교) */
const SNAP = JSON.parse(fs.readFileSync("src/data/notices.json", "utf8"));

const delta = (t) => { const n = parseInt(t, 10); if (!n) return 0;
  return n >= 70 && n < 80 ? -8 : n < 70 ? -3 : 0; };
const rank = (s) => [...s.types]
  .map((t) => ({ ...t, estCut: Math.max(0, s.cut + delta(t.t)) }))
  .sort((a, b) => a.estCut - b.estCut || b.n - a.n || a.price - b.price);
const statusRank = (s) => (s.status === "접수 중" ? 0 : s.status === "접수 예정" ? 1 : 2);

const expected = SNAP.sites
  .filter((s) => s.supply === "민영" && !s.scoreless)
  .sort((a, b) => statusRank(a) - statusRank(b) || a.cut - b.cut)
  .map((s) => ({ n: s.n, top3: rank(s).slice(0, 3).map((t) => [t.t, t.estCut]) }));

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(e.message));
pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await pg.goto("file://" + process.cwd() + "/standalone.html");
await pg.waitForSelector(".mv-subsum");
await pg.getByRole("button", { name: /모의청약/ }).click();
await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForSelector(".mv-gauge");
/* 목록은 기본으로 접수 마감을 숨기므로, 전건 대조를 위해 켭니다 */
await pg.locator('button:has-text("접수 마감 숨김")').first().click();
await pg.waitForTimeout(700);
const score = parseInt((await pg.locator(".mv-num").first().innerText()).match(/\d+/)[0], 10);

const rows = await pg.locator(".mv-listrow").evaluateAll((els) =>
  els.map((e) => e.innerText).filter((t) => t.includes("유리한 타입")));

let pass = 0, fail = 0;
console.log(`내 가점 ${score}점 · 민영 공고 ${expected.length}건 대조\n`);

/* 순서 검증 */
const domOrder = rows.map((t) => t.split("\n")[0].replace(/^실시간\s*/, "").trim());
const expOrder = expected.map((e) => e.n);
const orderOk = expOrder.every((n, i) => domOrder[i] === n);
orderOk ? pass++ : fail++;
console.log(`${orderOk ? "PASS" : "FAIL"} 정렬 (접수상태 → 예상 당첨선)`);
if (!orderOk) {
  console.log("   기대:", expOrder.slice(0, 5).join(" > "));
  console.log("   실제:", domOrder.slice(0, 5).join(" > "));
}

/* 단지별 상위 3개 타입 검증 */
for (const exp of expected) {
  /* "더샵 신길센트럴시티" 와 "더샵 신길센트럴시티(조합원 취소분)" 처럼 접두가 겹치는
     공고가 10쌍 있어서, 부분일치로 찾으면 엉뚱한 행과 비교하게 됩니다. */
  const row = rows.find((t) => t.split("\n")[0].replace(/^실시간\s*/, "").trim() === exp.n);
  if (!row) { fail++; console.log(`FAIL ${exp.n} — 목록에 없음`); continue; }
  const got = [...row.matchAll(/(\d+㎡[A-Z가-힣]*)\s*~(\d+)점\((-?\+?\d+)\)/g)]
    .map((m) => [m[1], +m[2], +m[3].replace("+", "")]);
  const okLen = got.length === Math.min(3, exp.top3.length);
  const okSeq = got.every((g, i) => exp.top3[i] && g[0] === exp.top3[i][0] && g[1] === exp.top3[i][1]);
  const okGap = got.every((g) => g[2] === score - g[1]);
  const ok = okLen && okSeq && okGap;
  ok ? pass++ : fail++;
  if (!ok) {
    console.log(`FAIL ${exp.n}`);
    console.log("   기대", exp.top3.map((t) => `${t[0]}~${t[1]}`).join(" > "));
    console.log("   실제", got.map((g) => `${g[0]}~${g[1]}(${g[2]})`).join(" > "));
  }
}
console.log(`\n타입 랭킹: ${expected.length}건 중 ${expected.length - (fail - (orderOk ? 0 : 1))}건 일치`);

/* 지역 필터 */
for (const [chip] of [["경남"], ["충남"], ["서울"], ["경기"]]) {
  await pg.locator(`.mv-chip:text-is("${chip}")`).first().click();
  await pg.waitForTimeout(150);
  const n = (await pg.locator(".mv-listrow").allInnerTexts()).filter((t) => t.includes("유리한 타입")).length;
  const priv = SNAP.sites.filter((s) => s.supply === "민영").length;
  const ok = n > 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} 지역 필터 ${chip} — ${n}건 표시`);
}

await b.close();
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
console.log(errs.length ? "에러:\n" + errs.join("\n") : "콘솔 에러 없음");
