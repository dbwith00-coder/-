# 집당 — 청약 · 입주설계 (실시간 공고 연동)

공공데이터 오픈API 2종을 붙여 분양 공고를 실시간으로 받아옵니다.

| 구분 | 엔드포인트 | 앱에서 분류 |
|---|---|---|
| LH 분양임대공고별 공급정보 | `https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1` | 공공주택 |
| 청약홈 APT 분양정보 (한국부동산원) | `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/...` | 민영/공공 (HOUSE_DTL_SECD로 판별) |

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

## 청약홈 API 구성

두 오퍼레이션을 조인해서 씁니다.

| 경로 | 단위 | 얻는 것 |
|---|---|---|
| `/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail` | 공고 | 주택명, 공급위치, 공급규모, 접수일정, 시공사, 규제지역 플래그, 공고 URL |
| `/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl` | 주택형 | 주택형, 일반/특별공급 세대수, **특별공급 유형별 세대수**, 공급금액 |

조인 키는 `HOUSE_MANAGE_NO` + `PBLANC_NO`.
공고 목록은 `cond[RCRIT_PBLANC_DE::GTE]` 로 기간을 자르고(기본 365일),
`matchCount` 를 채울 때까지 페이지를 넘겨 **전국 전량**을 받습니다.
각 공고의 주택형은 동시성 6으로 이어서 조회합니다.

### 수집 세트

| 키 | 내용 | 기본 |
|---|---|---|
| `apt` | APT 분양 (민영/국민) | ✅ |
| `remndr` | 무순위·잔여세대 (추첨, 가점 무관) | ✅ |
| `urbty` | 오피스텔·도시형·민간임대·생숙 | ✖ |
| `pblpvt` | 공공지원 민간임대 | ✖ |
| `opt` | 임의공급 | ✖ |

기본 꺼둔 셋은 가점제 대상이 아니라 목록에 섞으면 오해를 부릅니다.
워크플로 실행 시 `sets` 입력에 `apt,remndr,urbty` 처럼 넣으면 켜집니다.

### "분양 예정 단지"에 대해

**공고가 아직 안 난 단지는 공공 API 로 제공되지 않습니다.** 청약홈은 모집공고가
게시된 건만 공개합니다. 그래서 앱의 "접수 예정 공고" 섹션은 *공고는 났고 접수가
시작되지 않은* 건을 보여주고, 진짜 공고 전 단계는 `PRE_SITES` 에 택지비·건축비를
직접 넣어 원가식으로 추정합니다 (API 데이터가 아님을 화면에 명시).

## 필드 매핑

**청약홈 쪽은 Swagger 확정 스키마 기준으로 매핑돼 있습니다.**

| 앱 | 청약홈 필드 |
|---|---|
| 공고명 | `HOUSE_NM` |
| 민영/공공 | `HOUSE_DTL_SECD` (01 민영 / 03 국민) |
| 지역 | `HSSPLY_ADRES` 앞 3토큰, 없으면 `SUBSCRPT_AREA_CODE_NM` |
| 시공사 | `CNSTRCT_ENTRPS_NM` → 없으면 `BSNS_MBY_NM`(시행사) |
| 총 세대수 | `TOT_SUPLY_HSHLDCO` |
| 주택형 | `HOUSE_TY` (`084.9500A` → `84㎡A`) |
| 분양가 | `LTTOT_TOP_AMOUNT` (문서상 이미 **만원** 단위 — 환산하지 않음) |
| 특별공급 | `NWWDS_/LFE_FRST_/MNYCH_/OLD_PARNTS_SUPORT_/INSTT_RECOMEND_/NWBB_/YGMN_HSHLDCO` |
| 규제 태그 | `PARCPRC_ULS_AT`, `SPECLT_RDN_EARTH_AT`, `MDAT_TRGET_AREA_SECD`, `IMPRMN_BSNS_AT` 등 Y 플래그 |
| 진행 상태 | 필드가 없어 `RCEPT_BGNDE`/`RCEPT_ENDDE` 로 파생 |

LH 쪽은 아직 실제 응답을 확인하지 못해 후보 이름을 나열해 두는 방식입니다
(`src/lib/notices-core.js` 의 `FIELDS`). 수집 결과 `status.json` 의 `fields` 를 보고
확정하면 됩니다.

## 데이터 처리 규칙

- **금액**: 원/만원 혼재 → 만원 단위로 정규화 (`toManwon`)
- **전용면적**: `59.98` → `59㎡` (반올림 아닌 절사 — 국내 표기 관행)
- **금액 단위**: 청약홈 `LTTOT_TOP_AMOUNT` 는 이미 만원 단위라 그대로, LH 계열은 원 단위 추정 후 환산
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
