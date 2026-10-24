import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createExcel } from './export.mjs';
import { validateSearch, buildRSSURL, collectArticles, normalizeArticle } from './news.mjs';
import { createApp, fetchRSS } from './server.js';
import { enhanceArticles } from './summary.mjs';

const params = (extra = {}) => new URLSearchParams({ keyword: '인공지능', from: '2026-01-01', to: '2026-01-02', ...extra });
const options = () => validateSearch(params());
// Google News RSS의 source 태그와 HTML 설명 형태를 재현합니다.
const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>뉴스 검색</title><link>https://news.google.com</link><description>검색 결과</description>
<item><title>인공지능 성장 소식 - 한겨레</title><link>https://news.google.com/rss/articles/example1</link><pubDate>Fri, 02 Jan 2026 14:59:59 GMT</pubDate><description>&lt;a href="https://news.google.com/"&gt;인공지능 성장 및 교육 개선&lt;/a&gt;</description><source url="https://www.hani.co.kr">한겨레</source></item>
<item><title>기간 밖 기사</title><link>https://news.google.com/rss/articles/example2</link><pubDate>Fri, 02 Jan 2026 15:00:00 GMT</pubDate><source url="https://other.com">다른 언론사</source></item>
</channel></rss>`;
const rssFetcher = async () => ({ ok: true, text: async () => xml });

test('한글 OR 키워드와 넉넉한 날짜 경계를 RSS q에 반영', () => {
  const url = buildRSSURL(validateSearch(params({ keyword: '인공지능,환경' })));
  assert.equal(url.origin, 'https://news.google.com');
  assert.equal(url.pathname, '/rss/search');
  assert.equal(url.searchParams.get('q'), '("인공지능" OR "환경") after:2025-12-31 before:2026-01-03');
  assert.equal(url.searchParams.get('ceid'), 'KR:ko');
  assert.equal(url.searchParams.get('hl'), 'ko');
  assert.equal(url.searchParams.get('gl'), 'KR');
});

test('잘못된 키워드/날짜 입력 차단', () => {
  for (const changes of [{ keyword: '' }, { keyword: 'a,b,c,d' }, { from: '2026-02-30' }, { from: '2026-01-03' }]) assert.throws(() => validateSearch(params(changes)));
});

test('RSS XML에서 제목, 날짜, 출처명/도메인, 설명을 파싱', async () => {
  const feed = await fetchRSS(buildRSSURL(options()), rssFetcher);
  const data = collectArticles(feed, options());
  assert.equal(data.articles.length, 1);
  const article = data.articles[0];
  assert.equal(article.title, '인공지능 성장 소식');
  assert.equal(article.source, '한겨레');
  assert.equal(article.domain, 'hani.co.kr');
  assert.equal(article.description, '인공지능 성장 및 교육 개선');
  assert.equal(article.sentiment, '긍정');
  assert.equal(article.url, 'https://news.google.com/rss/articles/example1');
  assert.equal(article.date, '2026-01-02T14:59:59.000Z');
});

test('중복 제거 및 안전하지 않은 링크 제외', async () => {
  const feed = await fetchRSS(buildRSSURL(options()), rssFetcher);
  feed.items.push(feed.items[0]);
  assert.equal(collectArticles(feed, options()).articles.length, 1);
  assert.equal(normalizeArticle({ ...feed.items[0], link: 'javascript:alert(1)' }), null);
  const article = normalizeArticle({ title: '제목만 있는 기사', link: 'https://example.com/news', pubDate: '2026-01-02' });
  assert.equal(article.source, '출처 미상');
  assert.equal(article.summary, '제목 기준: 제목만 있는 기사');
});

test('RSS 접속 실패, HTTP 오류와 XML 파싱 실패는 검색 오류로 반환', async () => {
  const url = buildRSSURL(options());
  await assert.rejects(fetchRSS(url, async () => { throw new Error(); }), /연결/);
  await assert.rejects(fetchRSS(url, async () => ({ ok: false, status: 429 })), /429/);
  await assert.rejects(fetchRSS(url, async () => ({ ok: true, text: async () => '<bad>' })), /RSS 응답/);
});

test('AI 키 없거나 사용 안 함이면 외부 AI 호출 없이 검색 유지', async () => {
  for (const env of [{}, { OPENAI_API_KEY: 'test' }]) {
    const data = collectArticles(await fetchRSS(buildRSSURL(options()), rssFetcher), options());
    await enhanceArticles(data, { env, fetcher: async () => { assert.fail('AI를 호출하면 안 됩니다.'); } });
    assert.equal(data.articles.length, 1);
    assert.equal(data.articles[0].summaryType, 'RSS 텍스트');
  }
});

test('AI 실패/잘못된 응답이면 RSS 검색 결과와 기본 요약을 유지', async () => {
  for (const fetcher of [async () => { throw new Error(); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ output: [] }) })]) {
    const data = collectArticles(await fetchRSS(buildRSSURL(options()), rssFetcher), options());
    const previous = JSON.stringify(data.articles);
    await enhanceArticles(data, { env: { OPENAI_API_KEY: 'test', ENABLE_AI_SUMMARY: 'true' }, fetcher });
    assert.equal(JSON.stringify(data.articles), previous);
    assert.match(data.warnings.at(-1), /기본 의견/);
  }
});

test('AI에는 RSS 제목/설명만 보내고 검증된 요약/의견만 적용', async () => {
  const data = collectArticles(await fetchRSS(buildRSSURL(options()), rssFetcher), options());
  await enhanceArticles(data, { env: { OPENAI_API_KEY: 'test', ENABLE_AI_SUMMARY: 'true' }, fetcher: async (url, request) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const input = JSON.parse(JSON.parse(request.body).input);
    assert.deepEqual(Object.keys(input[0]), ['id', 'title', 'description']);
    return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ articles: [{ id: 0, summary: 'RSS 기준 인공지능 교육의 성장과 개선 소식입니다.', sentiment: '긍정' }] }) }] }] }) };
  } });
  assert.equal(data.articles[0].summaryType, 'AI 요약 (RSS 기준)');
});

test('Express API는 JSON 결과를 제공하고 비공개 파일은 차단', async () => {
  const app = createApp({ fetcher: rssFetcher, env: {} });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const root = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(root)).status, 200);
    for (const path of ['/.env', '/backend/.env', '/backend/server.js']) assert.equal((await fetch(root + path)).status, 404);
    assert.equal((await fetch(root + '/api/news')).status, 400);
    const response = await fetch(`${root}/api/news?${params()}`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.articles[0].source, '한겨레');
    const exported = await fetch(root + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articles: data.articles }) });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /spreadsheetml/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
    assert.equal(workbook.getWorksheet('뉴스클리핑').getCell('B2').value, '한겨레');
    const invalid = await fetch(root + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articles: [] }) });
    assert.equal(invalid.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('하루 검색은 한국 시간 00:00:00부터 23:59:59.999까지 포함', () => {
  const range = validateSearch(params({ from: '2026-01-02', to: '2026-01-02' }));
  assert.equal(buildRSSURL(range).searchParams.get('q'), '"인공지능" after:2026-01-01 before:2026-01-03');
  const items = ['2026-01-01T14:59:59.999Z', '2026-01-01T15:00:00.000Z', '2026-01-02T14:59:59.999Z', '2026-01-02T15:00:00.000Z'].map((pubDate, i) => ({ title: `기사 ${i}`, pubDate, link: `https://example.com/${i}` }));
  assert.deepEqual(collectArticles({ items }, range).articles.map(a => a.title), ['기사 2', '기사 1']);
});

test('엑셀은 한국어 데이터와 클릭 가능한 링크를 보존하고 제목을 수식으로 실행하지 않음', async () => {
  const rows = [{ title: '=1+1', date: '2026-01-01T15:00:00Z', source: '한국 언론사', url: 'https://example.com/news', summary: '한글 요약', sentiment: '중립', summaryType: 'RSS 텍스트' }];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createExcel(rows));
  const sheet = workbook.getWorksheet('뉴스클리핑');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell('A2').value, '2026-01-02 00:00:00');
  assert.equal(sheet.getCell('C2').value, '=1+1');
  assert.equal(sheet.getCell('C2').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('D2').value.hyperlink, rows[0].url);
  assert.equal(sheet.getCell('E2').value, '한글 요약');
  await assert.rejects(createExcel([]));
  await assert.rejects(createExcel([{ ...rows[0], url: 'javascript:alert(1)' }]));
});
