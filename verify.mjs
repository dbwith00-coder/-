import { chromium } from "playwright";
const errs = [];
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 1000 } });
pg.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
pg.on("pageerror", e => errs.push("pageerror: " + e.message));
await pg.goto("file://" + process.cwd() + "/standalone.html");
await pg.waitForSelector(".mv-subsum");
await pg.getByRole("button", { name: /모의청약/ }).click();
await pg.waitForSelector("#sc-bk");
await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForSelector(".mv-gauge");

// 내 가점
const score = parseInt((await pg.locator(".mv-num").first().innerText()).match(/\d+/)[0], 10);

// 목록 행에서 "유리한 타입" 줄 수집
const rows = await pg.locator(".mv-listrow").evaluateAll(els =>
  els.map(e => e.innerText).filter(t => t.includes("유리한 타입"))
     .map(t => {
       const name = t.split("\n")[0].trim();
       const line = t.split("\n").find(l => l.includes("유리한 타입")).trim();
       return { name, line };
     }));

const EXPECT = {
  "반포 디에이치 클래스트": [["59㎡",71],["84㎡",74],["114㎡",74]],
  "청담 써밋 클라비온":    [["59㎡",69],["84㎡",72],["101㎡",72]],
  "충정로역 자이르네":      [["74㎡",53],["59㎡",58],["39㎡",58]],
  "중화역 라온프라이빗 센트로": [["59㎡",52],["84㎡",55]],
  "힐스테이트 송파 더 그리드": [["59㎡",64],["84㎡",67]],
  "고덕 강일 3단지":        [["59㎡",55],["49㎡",55]],
  "광명 자이 힐스테이트":    [["59㎡",61],["84㎡",64],["101㎡",64]],
  "검단신도시 리버뷰파크":   [["74㎡",40],["59㎡",45],["84㎡",48]],
};

let pass = 0, fail = 0;
console.log(`내 가점 = ${score}점\n`);
for (const { name, line } of rows) {
  const exp = EXPECT[name];
  if (!exp) { console.log(`? 예상값 없음: ${name}`); continue; }
  const got = [...line.matchAll(/(\d+㎡)\s*~(\d+)점\((-?\+?\d+)\)/g)].map(m => [m[1], +m[2], +m[3].replace("+","")]);
  const okCount = got.length === Math.min(3, exp.length);
  const okOrder = got.every((g, i) => exp[i] && g[0] === exp[i][0] && g[1] === exp[i][1]);
  const okGap = got.every(g => g[2] === score - g[1]);
  const ok = okCount && okOrder && okGap;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  console.log(`     기대 ${exp.slice(0,3).map(e=>e[0]+"~"+e[1]).join(" > ")}`);
  console.log(`     실제 ${got.map(g=>g[0]+"~"+g[1]+"("+g[2]+")").join(" > ")}`);
  if (!ok) console.log(`     개수${okCount} 순서${okOrder} 여유분${okGap}`);
}

// 모달에서도 3개 나오는지
await pg.locator('.mv-sitecard:has-text("검단신도시 리버뷰파크")').first().click();
await pg.waitForSelector(".mv-sheet");
const modal = await pg.locator(".mv-note:has-text('유리한 타입')").first().innerText();
console.log("\n[모달 · 검단신도시 리버뷰파크]\n" + modal.split("순위 기준은")[0].trim());
await pg.screenshot({ path: "shots/11-modal-3types.png", fullPage: true });
await pg.locator(".mv-x").click();
await pg.screenshot({ path: "shots/12-list-3types.png", fullPage: true });

// 공공 단지에는 유리한 타입 줄이 없어야 함
await pg.getByRole("button", { name: "← 조건 다시 입력" }).click();
await pg.getByRole("button", { name: "다음 · 일반분양 →" }).click();
await pg.locator('button:has-text("공공주택")').first().click();
await pg.getByRole("button", { name: "제출하고 공고 보기" }).click();
await pg.waitForTimeout(400);
const pubHas = (await pg.locator(".mv-listrow").allInnerTexts()).some(t => t.includes("유리한 타입"));
console.log(`\n공공주택 목록에 '유리한 타입' 노출: ${pubHas ? "있음 (의도와 다름)" : "없음 (정상 — 공공은 인정액 순차제)"}`);

await b.close();
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "콘솔 에러 없음");
