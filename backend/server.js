import express from 'express';
import Parser from 'rss-parser';
import { fileURLToPath } from 'node:url';
import { SearchError, validateSearch, buildRSSURL, collectArticles } from './news.mjs';
import { enhanceArticles } from './summary.mjs';
import { createExcel } from './export.mjs';

// source 태그의 언론사 이름과 주소도 함께 읽습니다.
const parser = new Parser({ customFields: { item: [['source', 'newsSource', { keepArray: true }]] } });
export async function fetchRSS(url, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  } catch { throw new SearchError('Google News RSS에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.', 502); }
  if (!response.ok) throw new SearchError(`Google News RSS 요청에 실패했습니다 (${response.status}). 잠시 후 다시 시도해 주세요.`, 502);
  try {
    const xml = await response.text();
    return await parser.parseString(xml);
  } catch { throw new SearchError('RSS 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.', 502); }
}

export function createApp({ fetcher = fetch, env = process.env } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.post('/api/export', express.json({ limit: '3mb' }), async (req, res) => {
    try {
      const buffer = await createExcel(req.body?.articles);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="news-clipping.xlsx"',
        'Cache-Control': 'no-store'
      });
      res.send(Buffer.from(buffer));
    } catch (error) {
      res.status(error instanceof SearchError ? error.status : 500).json({ error: error instanceof SearchError ? error.message : '엑셀 파일 생성에 실패했습니다.' });
    }
  });
  app.get('/api/news', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const options = validateSearch(new URL(req.originalUrl, 'http://localhost').searchParams);
      const feed = await fetchRSS(buildRSSURL(options), fetcher);
      const data = collectArticles(feed, options);
      // AI 호출이 실패해도 RSS 검색 결과를 그대로 반환합니다.
      await enhanceArticles(data, { fetcher, env });
      res.json(data);
    } catch (error) {
      res.status(error instanceof SearchError ? error.status : 500).json({ error: error instanceof SearchError ? error.message : '서버에서 오류가 발생했습니다.' });
    }
  });
  // frontend 폴더만 공개하므로 .env와 백엔드 코드는 제공되지 않습니다.
  app.use(express.static(fileURLToPath(new URL('../frontend/', import.meta.url)), { dotfiles: 'deny' }));
  app.use((req, res) => res.status(404).json({ error: '페이지를 찾을 수 없습니다.' }));
  app.use((error, req, res, next) => {
    res.status(error.status === 413 ? 413 : 400).json({ error: '요청 데이터가 올바르지 않거나 너무 큽니다.' });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '127.0.0.1', () => console.log(`뉴스클리핑: http://localhost:${port}`));
}
