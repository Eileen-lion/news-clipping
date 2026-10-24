export class SearchError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validateSearch(params) {
  const keyword = (params.get('keyword') || '').trim();
  if (!keyword || keyword.length > 150) throw new SearchError('키워드를 1~150자로 입력해 주세요.');
  const keywords = keyword.split(',').map(s => s.trim()).filter(Boolean);
  if (!keywords.length || keywords.length > 3) throw new SearchError('키워드는 쉼표로 구분해 최대 3개까지 입력해 주세요.');
  const start = params.get('from') || params.get('start');
  const end = params.get('to') || params.get('end');
  for (const day of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
      throw new SearchError('올바른 시작일과 종료일을 입력해 주세요.');
    }
  }
  if (start > end) throw new SearchError('종료일은 시작일 이후여야 합니다.');
  // UI 날짜는 한국 표준시 기준입니다.
  const startTime = new Date(`${start}T00:00:00+09:00`);
  const endTime = new Date(`${end}T23:59:59.999+09:00`);
  if (startTime > new Date()) throw new SearchError('미래 날짜로는 검색할 수 없습니다.');
  return { keywords, start, end, startTime, endTime };
}

function cleanText(text = '') {
  return String(text).replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => {
    const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/&(quot|apos|amp|lt|gt|nbsp);/g, (_, entity) => ({ quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' })[entity]).trim();
}

export function sentiment(text) {
  const positive = ['성장', '개선', '성공', '회복', '호조', '수상', 'growth', 'success', 'recovery', 'improve', 'gain'];
  const negative = ['피해', '위기', '사망', '하락', '실패', '우려', 'crisis', 'death', 'loss', 'decline', 'risk', 'war'];
  const value = text.toLowerCase();
  const score = positive.filter(word => value.includes(word)).length - negative.filter(word => value.includes(word)).length;
  return score > 0 ? '긍정' : score < 0 ? '부정' : '중립';
}

export function buildRSSURL({ keywords, start, end }) {
  const or = values => values.length === 1 ? values[0] : `(${values.join(' OR ')})`;
  // Google의 날짜 경계와 한국 시간 차이로 하루 검색이 누락되지 않도록
  // 시작일 하루 전부터 받아 온 뒤 한국 시간으로 정확히 걸러냅니다.
  const previousDay = new Date(`${start}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const nextDay = new Date(`${end}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const keywordQuery = or(keywords.map(word => `"${word.replace(/["\\]/g, ' ').trim()}"`));
  const q = [keywordQuery, `after:${previousDay.toISOString().slice(0, 10)}`, `before:${nextDay.toISOString().slice(0, 10)}`].filter(Boolean).join(' ');
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({ q, hl: 'ko', gl: 'KR', ceid: 'KR:ko' });
  return url;
}

export function normalizeArticle(item) {
  try {
    const url = new URL(item.link);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const date = new Date(item.isoDate || item.pubDate);
    if (!Number.isFinite(date.getTime())) return null;
    const rawSource = item.newsSource || item.source;
    const sourceTag = Array.isArray(rawSource) ? rawSource[0] : rawSource;
    const source = cleanText(typeof sourceTag === 'string' ? sourceTag : sourceTag?._ || '출처 미상');
    const sourceURL = typeof sourceTag === 'object' ? sourceTag?.$?.url : '';
    let domain = '';
    try { domain = new URL(sourceURL).hostname.replace(/^www\./, ''); } catch { /* 출처 주소가 없는 피드도 허용합니다. */ }
    let title = cleanText(item.title);
    // Google News 제목 뒤에 붙는 중복 언론사명을 제거합니다.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3);
    if (!title) return null;
    const description = cleanText(item.contentSnippet || item.content || item.description || '').replace(/\s+/g, ' ').trim();
    return { title, date: date.toISOString(), dateType: '기사 날짜', source, domain, url: url.href,
      description, summary: description ? description.slice(0, 280) + (description.length > 280 ? '…' : '') : `제목 기준: ${title}`,
      summaryType: 'RSS 텍스트', sentiment: sentiment(`${title} ${description}`),
      analysisMethod: '단어 기반', confidence: '미평가', insufficient: false,
      sentimentReason: '일부 긍정·부정 단어를 세는 기본 추정입니다. 문맥을 충분히 반영하지 못할 수 있습니다.', sentimentEvidence: '' };
  } catch { return null; }
}

export function collectArticles(feed, { startTime, endTime }) {
  const unique = new Map();
  for (const item of feed.items || []) {
    const article = normalizeArticle(item);
    if (!article) continue;
    const date = new Date(article.date);
    if (date < startTime || date > endTime) continue;
    unique.set(article.url, article);
  }
  return { articles: [...unique.values()].sort((a, b) => b.date.localeCompare(a.date)),
    warnings: ['Google News RSS에 수집된 결과만 표시합니다. 요약·의견은 제목과 RSS 설명 기준이며, 설명이 짧거나 제목과 같을 수 있습니다. 기사 링크는 Google News를 거쳐 원문으로 연결될 수 있습니다.'] };
}
