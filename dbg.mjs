import { chromium } from "playwright";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 1000 } });
pg.on("pageerror", e => console.log("PAGEERROR:", e.message));
await pg.addInitScript(c => localStorage.setItem("jipdang:apiConfig", c), JSON.stringify({
  serviceKey: "TESTKEY", lhBase: "", lhPath: "/lh", odcBase: "", odcPath: "/odc", rows: 50, enabled: true }));
await pg.goto("http://localhost:8899/");
await pg.waitForSelector(".mv-subsum");
await pg.getByRole("button", { name: /모의청약/ }).click();
await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForTimeout(900);
console.log("=== 민영 목록 행 (기본 상태) ===");
for (const t of await pg.locator(".mv-listrow").allInnerTexts()) console.log("  •", t.split("\n")[0]);
console.log("\n=== 패널 요약 ===");
console.log((await pg.locator(".mv-card:has-text('실시간 분양공고 연동')").first().innerText()).slice(0, 600));
await b.close();
