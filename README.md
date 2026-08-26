# 집당 — 청약 · 입주설계 (실시간 공고 연동)

공공데이터 오픈API 2종을 붙여 분양 공고를 실시간으로 받아옵니다.

| 구분 | 엔드포인트 | 앱에서 분류 |
|---|---|---|
| LH 분양임대공고별 공급정보 | `https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1` | 공공주택 |
| odcloud 청약 데이터셋 (stage 37000) | `https://api.odcloud.kr/api` + Swagger에서 확인한 경로 | 민영주택 |

## 실행

```bash
npm install
cp .env.example .env.local     # VITE_ODCLOUD_KEY 에 인증키(Decoding) 입력
npm run dev                    # http://localhost:5173
```

인증키는 `.env.local` 대신 화면의 **API 설정** 패널에 직접 넣어도 됩니다
(브라우저 localStorage 에만 저장, 서버로 전송하지 않음).

## CORS — 왜 프록시를 거치나

`apis.data.go.kr` / `api.odcloud.kr` 는 `Access-Control-Allow-Origin` 헤더를 주지
않습니다. 브라우저에서 직접 `fetch` 하면 반드시 CORS 로 차단됩니다.

그래서 앱은 **상대경로**로 호출하고, 개발 서버가 중계합니다 (`vite.config.js`):

```
/openapi/lh/*       → https://apis.data.go.kr/B552555/*
/openapi/odcloud/*  → https://api.odcloud.kr/api/*
```

배포할 때도 같은 두 경로를 서버에서 프록시하면 코드 수정 없이 그대로 동작합니다.

<details><summary>nginx 예시</summary>

```nginx
location /openapi/lh/      { proxy_pass https://apis.data.go.kr/B552555/; }
location /openapi/odcloud/ { proxy_pass https://api.odcloud.kr/api/; }
```
</details>

정적 호스팅(GitHub Pages 등)처럼 서버가 없는 곳에는 올릴 수 없습니다 —
Cloudflare Worker / Vercel Edge Function 같은 얇은 중계 하나가 반드시 필요합니다.

## odcloud 경로 설정

odcloud 는 데이터셋마다 오퍼레이션 경로가 달라서 기본값을 비워뒀습니다.
Swagger(`https://infuser.odcloud.kr/api/stages/37000/api-docs`)에서 실제 path 를
확인해 `.env.local` 의 `VITE_ODC_PATH` 또는 **API 설정** 패널에 넣으세요.
비어 있으면 LH 만 조회하고 odcloud 는 "경로 없음"으로 표시됩니다.

## 필드 매핑

공공데이터는 같은 뜻의 필드를 기관마다 다르게 부릅니다(`PAN_NM` / `HOUSE_NM` …).
`src/lib/openapi.js` 의 `FIELDS` 에 후보 이름을 나열해두고 먼저 잡히는 값을 씁니다.

**실제 응답을 아직 확인하지 못한 상태라 이 후보 목록은 확정본이 아닙니다.**
앱 실행 후 **API 설정 → 응답 첫 건 필드 보기**에서 실제 키 이름을 확인하고,
`FIELDS` 에 추가하면 매핑이 정확해집니다. 어떤 경로에서 레코드를 꺼냈는지도
패널에 `응답 경로 dsList` 처럼 표시됩니다.

## 데이터 처리 규칙

- **금액**: 원/만원 혼재 → 만원 단위로 정규화 (`toManwon`)
- **전용면적**: `59.98` → `59㎡` (반올림 아닌 절사 — 국내 표기 관행)
- **주택형 병합**: 같은 공고가 주택형별로 여러 행으로 오면 1건으로 합쳐 타입 배열 구성
- **예상 당첨선**: API가 주지 않으므로 지역 기준 추정값을 넣고 화면에 `(지역 기준 추정)` 표기
- **부분 실패**: 두 API를 독립 호출 → 한쪽이 죽어도 다른 쪽은 표시
- **전체 실패**: 내장 샘플 데이터로 폴백하고 배너로 안내

## PC 없이 실시간 수집 — GitHub Actions

로컬 개발환경 없이도 실제 API 응답을 받아올 수 있습니다.
`.github/workflows/collect-notices.yml` 이 러너에서 두 API 를 호출해
결과를 `data/` 에 커밋합니다. (브라우저·아티팩트는 CORS·CSP 로 직접 호출 불가지만
GitHub 러너는 제약이 없습니다.)

### 최초 1회 설정 — 브라우저만으로

1. **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `ODCLOUD_KEY`
   - Secret: 공공데이터포털 일반 인증키(Decoding)
2. **Actions → 분양공고 수집 → Run workflow**
   - `odc_path` 에 odcloud 오퍼레이션 경로를 넣으면 두 API 모두 수집합니다.
     비워두면 LH 만 수집합니다.

이후 매일 06:00 / 12:00 KST 에 자동 실행됩니다.

> ⚠️ 워크플로는 **기본 브랜치에 있어야** 실행됩니다. 다른 브랜치에 있다면
> 기본 브랜치로 먼저 합쳐 주세요.

### 생성되는 파일

| 파일 | 내용 |
|---|---|
| `data/status.json` | 소스별 성공/실패, 건수, 오류, **응답에서 감지된 실제 필드명** |
| `data/lh-raw.json` | LH 응답 원문 앞 3건 |
| `data/odc-raw.json` | odcloud 응답 원문 앞 3건 |
| `data/notices.json` | 앱이 바로 쓰는 정규화 결과 |

실행 결과 요약은 Actions 실행 화면에도 표로 표시됩니다.
`status.json` 의 `fields` 를 보면 실제 필드명을 알 수 있으니,
`src/lib/notices-core.js` 의 `FIELDS` 후보 목록을 그에 맞춰 확정하면 됩니다.

### 로컬에서 같은 수집 실행

```bash
ODCLOUD_KEY=키 ODC_PATH=/경로 npm run collect
```

## 테스트

```bash
node mock.mjs &      # 두 API 응답 봉투를 흉내 낸 목 서버 (:8899)
npm run build
node livetest.mjs    # 연동 시나리오 5종 20항목
node verify.mjs      # 유리한 타입 랭킹 8단지 대조
```
