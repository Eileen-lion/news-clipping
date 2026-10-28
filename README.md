# 뉴스클리핑 웹앱

기존 화면에서 한글 키워드·날짜를 입력하면 Express 백엔드가 Google News RSS를 가져와 JSON으로 반환합니다. Google News 검색에는 가입이나 API 키가 필요 없습니다. 기사 원문 전체를 크롤링하지 않으며 데이터베이스와 localStorage를 사용하지 않습니다.

## 실행 순서

Node.js 22.9 이상을 준비한 뒤 프로젝트 폴더에서 실행하세요.

```sh
cd /Users/eileenyoon/Documents/assignment2
npm install
npm start
```

브라우저에서 **http://localhost:3000**을 엽니다. HTML 파일 직접 열기나 별도 Live Server 대신 이 주소를 사용하세요. 종료하려면 터미널에서 `Ctrl+C`를 누릅니다. 기본 검색에는 `.env` 파일이 없어도 됩니다.

## 파일 구조

```text
frontend/
  index.html       기존 입력 폼과 기사 목록, Google News 안내
  style.css        기존 반응형 디자인 유지
  script.js        우리 백엔드 /api/news 호출, 결과·의견 필터 표시
backend/
  server.js        Express 서버, RSS 가져오기 및 rss-parser XML 파싱
  news.mjs         검색 조건 검증, RSS 검색어 구성, 기사 데이터 변환
  export.mjs       실제 .xlsx 파일 생성
  summary.mjs      선택적 OpenAI 요약·의견 분석과 실패 시 기본 처리
  news.test.mjs    실제 형식의 RSS 샘플을 이용한 테스트
  .env.example     선택적 환경 설정 예시
package.json       설치 패키지와 실행 명령
package-lock.json  설치 버전 고정
```

## 검색 방식

```text
GET /api/news?keyword=인공지능&from=2026-10-01&to=2026-10-24
```

쉼표로 구분한 키워드는 최대 3개이며 모두 포함하는 AND 조건으로 검색합니다. 예: `인공지능,환경`은 두 키워드를 모두 포함해야 합니다. RSS 제목·설명에도 모든 키워드가 있는지 다시 확인하며, RSS에서 확인할 수 없는 본문에만 키워드가 있는 기사는 제외될 수 있습니다. 참고 웹사이트 입력과 사이트 필터는 제거했습니다.

백엔드는 아래 주소를 호출합니다.

```text
https://news.google.com/rss/search?q=검색어&hl=ko&gl=KR&ceid=KR:ko
```

하루 검색에서 시간대 경계로 기사가 누락되지 않도록 RSS에는 `after:시작일하루전 before:종료일다음날`을 보냅니다. 받은 기사는 한국 시간 시작일 00:00:00부터 종료일 23:59:59.999까지만 정확히 필터링합니다. 시작일과 종료일이 같은 하루 검색도 지원합니다. RSS 수집 범위에 따라 기사가 누락될 수 있으며 모든 과거 기사를 보장하지 않습니다.

응답의 `articles`에는 `title`, `date`, `source`, `url`, `description`, `summary`, `summaryType`, `sentiment`가 포함됩니다. 출처는 RSS의 `<source>` 태그를 사용합니다. 링크는 Google News를 경유할 수 있습니다.

RSS 설명에는 본문 요약 대신 제목과 관련 기사 목록만 있을 수 있습니다. 기본 요약은 설명을 짧게 자른 텍스트이며, 설명이 없으면 제목을 표시합니다. 기본 의견은 제목·설명에 포함된 일부 단어를 세는 추정입니다. 결과 카드에 처리 방식을 표시하며 실제 기사 논조와 다를 수 있습니다.

## 선택: AI 요약·감성분석

기존 루트 `.env`의 `OPENAI_API_KEY`를 사용할 수 있습니다. 키 값은 브라우저에 노출하지 않습니다. 키가 있으면 기본으로 GPT 분석을 사용합니다. 기존 설정이 `ENABLE_AI_SUMMARY=false`라면 true로 바꾸고 서버를 재시작하세요.

```dotenv
OPENAI_API_KEY=자신의_키
ENABLE_AI_SUMMARY=true
OPENAI_MODEL=gpt-4.1-mini
```

`backend/.env`도 지원하며 같은 항목은 해당 파일의 값이 우선합니다. 키가 없거나 `ENABLE_AI_SUMMARY=false`이면 기본 단어 추정으로 동작합니다. `PORT=3000`도 선택적으로 지정할 수 있습니다.

AI를 켜면 검색된 기사의 제목과 RSS 설명만 10건씩 묶어 최대 4개 요청을 동시에 보내 한국어 요약과 의견을 생성합니다. 별도 API 이용 요금이 발생할 수 있습니다. 전체 AI 처리에 30초 한도를 두며, 완료하지 못한 기사는 기본 RSS 방식으로 표시합니다. 키 없음·인증 오류·시간 초과·잘못된 AI 응답이 발생해도 검색 결과는 기본 처리로 반환됩니다. AI에는 기사 본문, 로컬 파일, 참고 사이트 원문을 보내지 않습니다.

[OpenAI Docs: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)를 참고해 Responses API의 JSON 스키마 응답을 사용했습니다.

## 검증

```sh
npm test
```

외부 네트워크와 실제 API 키에 의존하지 않는 RSS 샘플로 한글 검색어·종료일 포함·출처 파싱·기간 필터·오류 응답·AI 실패 시 검색 유지·정적 파일 접근 제한을 검사합니다. 실제 RSS 검색에는 Google News에 연결할 수 있는 네트워크가 필요합니다.


## 엑셀 다운로드

검색을 완료한 뒤 **엑셀 다운로드** 버튼을 누르면 현재 의견 필터로 화면에 표시된 결과를 `.xlsx`로 받습니다. 검색 결과가 없거나 검색 중이면 버튼이 비활성화됩니다. 날짜(한국 시간), 언론사, 제목, 클릭 가능한 기사 링크, 요약, 의견, 요약 방식이 포함됩니다. 입력 조건을 바꾸더라도 새로 검색하기 전에는 마지막 검색 결과를 내보냅니다. 서버는 전달받은 결과를 메모리에서 파일로 생성하며 다시 뉴스 검색을 하지 않습니다.

## Vercel 배포

`vercel.json`은 `frontend`를 정적 화면 경로로 지정하고, `api/news.js`와 `api/export.js`는 기존 Express 코드를 Vercel 함수로 실행합니다. 로컬 `npm start` 방식도 유지됩니다.

GitHub 저장소를 연결한 프로젝트에서 다음 설정을 확인하세요.

- Root Directory: 저장소 루트 (`.`). `frontend` 또는 `backend`로 지정하지 않습니다.
- Framework Preset: Other
- Install Command: 기본값 (`npm install`)
- Build Command / Output Directory: 저장소의 `vercel.json` 설정 사용

최신 `main` 커밋을 배포한 뒤 Deployments에서 성공한 배포의 **Visit** 주소로 접속합니다. 이전 배포의 404 주소가 계속 보이면 최신 배포 URL 및 연결 도메인을 확인하세요.

Google News 검색에는 환경변수가 필요 없습니다. 선택적 AI 분석을 사용할 때만 Vercel의 Settings → Environment Variables에 `OPENAI_API_KEY`, `ENABLE_AI_SUMMARY=true`, 필요하면 `OPENAI_MODEL`을 등록하고 재배포합니다. 로컬 `.env`는 Git과 Vercel 업로드에서 제외되며 정적 화면 폴더에도 포함되지 않습니다.

[Vercel 공식 문서: Node.js 함수](https://vercel.com/docs/functions/runtimes/node-js), [정적 출력 경로 설정](https://vercel.com/docs/project-configuration/vercel-json#outputdirectory)


## GPT 의견 분석 개선

- 긍정·중립·부정은 기사에서 중심적으로 다루는 사건/정책/제품 등의 영향과 평가를 기준으로 판단합니다. 부정어, 비교, 인용 주체, 긍정·부정 혼재를 구분하도록 기준을 명시했습니다.
- 각 결과에 분석 방식, 판단 이유, 근거 문구, 모델 자체 확실성(높음/보통/낮음)을 표시합니다. 확실성은 실제 정확도 확률이나 측정된 성능 수치가 아닙니다.
- 근거 문구가 실제 입력 제목 또는 RSS 설명에 포함되어 있는지 서버가 검증합니다. 검증 실패 시 해당 묶음은 기본 추정으로 남깁니다. 이는 인용 출처 확인이며, 의미 해석의 정확성을 보증하지 않습니다.
- 정보 부족 시 중립에 '판단 유보'를 표시하여 단순 중립 기사와 구분합니다.
- 최신 10건 제한을 제거했습니다. 시간 한도 또는 API 오류로 처리하지 못한 건수는 화면에 표시합니다. 100건 검색은 최대 10회 API 요청이 발생합니다(RSS 결과 수에 따라 더 많을 수 있음).
- 엑셀에도 분석 방식, 확실성, 이유, 근거, 판단 유보 여부가 함께 포함됩니다.
- Vercel에서는 `OPENAI_API_KEY`를 Settings → Environment Variables에 등록해야 합니다. 로컬 키는 배포되지 않습니다. 기존에 `ENABLE_AI_SUMMARY=false`를 설정했다면 true로 바꾼 뒤 재배포하세요.

실제 의견 분류 정확도는 정답이 있는 기사 표본으로 별도 평가해야 합니다. RSS가 제목만 반복하면 문맥에 한계가 있으며, 이 변경만으로 정확도 향상 수치를 주장하지 않습니다.
