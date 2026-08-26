/* ============================================================
   분양 예정 단지 — 뉴스 기반 수집
   ------------------------------------------------------------
   공고가 나기 전 단계의 단지는 공공 API 로 제공되지 않습니다.
   (청약홈은 모집공고가 게시된 건만 공개)
   그래서 차선책으로, 뉴스에 언급된 단지명을 모아 "후보"로 제시합니다.

   ⚠️ 이건 공식 데이터가 아닙니다.
      · 기사 제목에서 뽑아낸 추정이라 오탐·누락이 있습니다
      · 분양 시기·세대수·분양가는 기사마다 다르고 자주 바뀝니다
      · 그래서 세대수·가격은 아예 만들지 않고, 단지명과 출처만 남깁니다
   저장하는 것은 기사 제목·링크·매체·날짜(메타데이터)뿐이고
   본문은 가져오지도 저장하지도 않습니다.

   출력: data/upcoming-news.json
   ============================================================ */

import fs from "node:fs";

const OUT = "data";

/* 여러 각도로 검색해야 한쪽에만 걸리는 단지를 놓치지 않습니다 */
const QUERIES = [
  "아파트 분양 예정",
  "분양 예정 단지",
  "이달 분양 아파트",
  "다음달 분양 아파트",
  "청약 예정 아파트",
  "분양 일정 아파트",
  "선착순 분양 예정",
  "재건축 일반분양 예정",
];

/* 국내 아파트 브랜드 — 단지명 경계를 잡는 데 씁니다.
   긴 것부터 매칭해야 "힐스테이트"가 "포레나힐스테이트"를 잘라먹지 않습니다. */
const BRANDS = [
  "자이르네", "포레나힐스테이트", "힐스테이트", "푸르지오", "래미안", "e편한세상", "이편한세상",
  "아이파크", "롯데캐슬", "더샵", "포레나", "데시앙", "한신더휴", "서희스타힐스",
  "우미린", "중흥S클래스", "중흥에스클래스", "대방디에트르", "리슈빌", "베르디움",
  "센트레빌", "위브더제니스", "위브", "자이", "SK뷰", "에스케이뷰", "호반써밋",
  "반도유보라", "동원로얄듀크", "제일풍경채", "한양수자인", "쌍용예가", "코오롱하늘채",
  "금호어울림", "calla", "칼라", "해링턴플레이스", "해링턴", "드파인", "라클래시",
  "디에이치", "아크로", "써밋", "트리마제", "오티에르", "블레스티지", "원베일리",
  "휴먼빌", "스타힐스", "파밀리에", "엘리프", "라온프라이빗", "예미지", "이안",
  "모아엘가", "골드클래스", "더플래티넘", "플래티넘", "프라디움", "유탑유블레스",
];
const BRAND_RE = new RegExp(`(${BRANDS.sort((a, b) => b.length - a.length).join("|")})`);

const cleanTitle = (t) =>
  String(t ?? "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .trim();

/* 구글뉴스 RSS 제목은 "기사제목 - 매체명" 형태입니다 */
const splitSource = (title) => {
  const i = title.lastIndexOf(" - ");
  return i > 0 ? [title.slice(0, i).trim(), title.slice(i + 3).trim()] : [title, ""];
};

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      if (!r) return "";
      return cleanTitle(r[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, ""));
    };
    const rawTitle = pick("title");
    const [title, srcFromTitle] = splitSource(rawTitle);
    items.push({
      title,
      source: pick("source") || srcFromTitle,
      link: pick("link"),
      pubDate: pick("pubDate"),
    });
  }
  return items;
}

/* 기사 제목에서 단지명 후보를 뽑습니다.
   브랜드명을 축으로 앞뒤 토큰을 붙여 "OO 힐스테이트 OO" 같은 형태를 만듭니다. */
function extractComplexNames(title) {
  const out = new Set();

  /* 1) 따옴표로 묶인 이름 — 기사에서 단지명을 인용할 때 가장 정확합니다 */
  for (const m of title.matchAll(/[‘'"“]([^’'"”]{3,30})[’'"”]/g)) {
    const name = m[1].trim();
    if (BRAND_RE.test(name)) out.add(name);
  }

  /* 2) 브랜드명 주변 토큰 결합 */
  const tokens = title.split(/[\s,·]+/).filter(Boolean);
  tokens.forEach((tok, i) => {
    if (!BRAND_RE.test(tok)) return;
    const around = [tokens[i - 1], tok, tokens[i + 1]]
      .filter(Boolean)
      .map((t) => t.replace(/[^가-힣A-Za-z0-9]/g, ""))
      .filter((t) => t.length >= 1);
    /* 앞뒤 토큰이 조사·서술어면 붙이지 않습니다 */
    const STOP = /^(분양|청약|예정|아파트|단지|공급|물량|일반|특별|접수|모집|공고|오는|이달|다음달|전국|수도권|지방|신규|올해|내년|최고|대단지|브랜드|시공|건설|착공|입주)$/;
    const parts = around.filter((t) => !STOP.test(t));
    if (parts.length >= 2) out.add(parts.join(" "));
    out.add(tok.replace(/[^가-힣A-Za-z0-9]/g, ""));
  });

  return [...out]
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 30);
}

const normName = (s) => String(s).replace(/[\s()（）\-–—·.]/g, "").toLowerCase();

async function fetchRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "jipdang-news/1.0", Accept: "application/rss+xml,application/xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRss(await res.text());
}

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });

  /* 이미 공고가 난 단지는 후보에서 뺍니다 — 그건 API 로 정확히 알고 있습니다 */
  let announced = new Set();
  try {
    const snap = JSON.parse(fs.readFileSync(`${OUT}/notices.json`, "utf8"));
    announced = new Set(snap.sites.map((s) => normName(s.n)));
    console.log(`이미 공고된 단지 ${announced.size}건 제외 대상으로 로드`);
  } catch {
    console.log("notices.json 없음 — 공고 대조 없이 진행");
  }

  const articles = [];
  const perQuery = [];
  for (const q of QUERIES) {
    try {
      const items = await fetchRss(q);
      perQuery.push({ query: q, count: items.length, error: null });
      articles.push(...items.map((a) => ({ ...a, query: q })));
      console.log(`  "${q}" → ${items.length}건`);
    } catch (e) {
      perQuery.push({ query: q, count: 0, error: String(e?.message || e) });
      console.log(`  "${q}" → 실패: ${e?.message || e}`);
    }
  }

  /* 기사 중복 제거 (같은 기사가 여러 검색어에 걸립니다) */
  const seenLink = new Set();
  const uniq = articles.filter((a) => {
    const k = a.link || a.title;
    if (seenLink.has(k)) return false;
    seenLink.add(k);
    return true;
  });

  /* 단지 후보 집계 */
  const byName = new Map();
  for (const a of uniq) {
    for (const name of extractComplexNames(a.title)) {
      const key = normName(name);
      if (announced.has(key)) continue;          /* 이미 공고남 */
      if (key.length < 4) continue;              /* 브랜드명 단독은 단지가 아님 */
      const hit = byName.get(key) || { name, mentions: 0, articles: [], aliases: new Set() };
      hit.aliases.add(name);
      /* 더 긴 표기를 대표 이름으로 */
      if (name.length > hit.name.length) hit.name = name;
      hit.mentions += 1;
      if (hit.articles.length < 5) {
        hit.articles.push({ title: a.title, source: a.source, link: a.link, pubDate: a.pubDate });
      }
      byName.set(key, hit);
    }
  }

  const candidates = [...byName.values()]
    .filter((c) => c.mentions >= 2)              /* 1회 언급은 노이즈일 확률이 높습니다 */
    .map((c) => ({ ...c, aliases: [...c.aliases] }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));

  const out = {
    collectedAt: new Date().toISOString(),
    source: "Google News RSS",
    disclaimer: "공고 전 분양예정 단지는 공공 API 로 제공되지 않아, 뉴스 기사 제목에서 추출한 후보입니다. 공식 확정 정보가 아니며 오탐이 있을 수 있습니다.",
    queries: perQuery,
    articleCount: uniq.length,
    count: candidates.length,
    candidates: candidates.slice(0, 60),
  };
  fs.writeFileSync(`${OUT}/upcoming-news.json`, JSON.stringify(out, null, 1) + "\n", "utf8");

  const md = [
    "## 분양 예정 단지 후보 (뉴스 기반)", "",
    `기사 ${uniq.length}건에서 후보 ${candidates.length}건 추출 (2회 이상 언급)`, "",
    "| 단지 후보 | 언급 | 최근 기사 |", "|---|---|---|",
    ...candidates.slice(0, 25).map((c) =>
      `| ${c.name} | ${c.mentions} | ${(c.articles[0]?.title || "").slice(0, 60)} |`),
    "", "> 뉴스 제목에서 뽑은 추정입니다. 공식 공고가 아닙니다.",
  ];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n"));
  console.log("\n" + md.join("\n"));
};

main().catch((e) => { console.error(e); process.exit(1); });
