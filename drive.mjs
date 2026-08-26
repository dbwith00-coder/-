import { chromium } from "playwright";
const errs = [];
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 1000 } });
pg.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
pg.on("pageerror", e => errs.push("pageerror: " + e.message));
await pg.goto("file://" + process.cwd() + "/standalone.html");
await pg.waitForSelector(".mv-subsum", { timeout: 10000 });
const shot = async (n) => pg.screenshot({ path: `shots/${n}.png`, fullPage: true });
await shot("01-hub");
console.log("HUB:", await pg.locator(".mv-subsum .mv-num").allInnerTexts());

await pg.getByRole("button", { name: /모의청약/ }).click();
await pg.waitForSelector("#sc-bk");
await shot("02-step1");

await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.waitForSelector("#sc-fam");
await shot("03-step2");

await pg.getByRole("button", { name: "특별공급도 입력 →" }).click();
await pg.waitForSelector("#sc-marry");
// 특공 조건 몇 개 채워보기
await pg.fill("#sc-marry", "2021-05-20");
await pg.locator('button:has-text("맞벌이")').first().click();
await shot("04-step3");
console.log("특공판정:", (await pg.locator(".mv-card").last().innerText()).split("\n").slice(0,20).join(" | "));

await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForSelector(".mv-gauge");
await shot("05-result");

// 공고 전 단지 산출과정 펼치기
await pg.locator('.mv-listrow:has-text("검단 센트럴포레")').first().click();
await pg.waitForTimeout(300);
await shot("06-pre-expand");

// 단지 모달
await pg.locator('.mv-sitecard:has-text("반포 디에이치")').first().click();
await pg.waitForSelector(".mv-sheet");
await pg.waitForTimeout(400);
await shot("07-modal");
await pg.locator(".mv-x").click();

// 공공 전환 확인
await pg.getByRole("button", { name: "← 조건 다시 입력" }).click();
await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.locator('button:has-text("공공주택")').first().click();
await pg.waitForTimeout(200);
await shot("08-public");
await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForTimeout(400);
await shot("09-public-result");

// 커뮤니티
await pg.getByRole("button", { name: "← 청약 전체" }).click();
await pg.waitForSelector(".mv-subsum");
await pg.getByRole("button", { name: /커뮤니티/ }).click();
await pg.waitForTimeout(500);
await pg.fill('input[placeholder="닉네임"]', "테스터");
await pg.fill('input[placeholder="제목"]', "동탄 아크메르 어떻게 보세요?");
await pg.fill("textarea", "가점 62점인데 넣어볼만 할까요?");
await pg.getByRole("button", { name: "등록", exact: true }).click();
await pg.waitForTimeout(500);
await shot("10-community");
console.log("게시판:", (await pg.locator(".mv-card").last().innerText()).slice(0, 200));

await b.close();
console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "✅ 콘솔 에러 없음");
