import ExcelJS from 'exceljs';
import { SearchError } from './news.mjs';

export async function createExcel(articles) {
  if (!Array.isArray(articles) || !articles.length || articles.length > 500) {
    throw new SearchError('다운로드할 검색 결과가 없거나 최대 500건을 초과했습니다.');
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('뉴스클리핑', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '기사 날짜 (한국 시간)', key: 'date', width: 23 },
    { header: '언론사', key: 'source', width: 20 },
    { header: '기사 제목', key: 'title', width: 55 },
    { header: '기사 링크', key: 'url', width: 45 },
    { header: '요약', key: 'summary', width: 70 },
    { header: '의견 (추정)', key: 'sentiment', width: 14 },
    { header: '요약 방식', key: 'summaryType', width: 22 }
  ];
  for (const article of articles) {
    if (!article || typeof article !== 'object') throw new SearchError('기사 데이터가 올바르지 않습니다.');
    const date = new Date(article.date);
    if (!Number.isFinite(date.getTime()) || !['긍정', '중립', '부정'].includes(article.sentiment)) throw new SearchError('기사 날짜 또는 의견이 올바르지 않습니다.');
    let url;
    try {
      url = new URL(article.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch { throw new SearchError('기사 링크가 올바르지 않습니다.'); }
    const text = key => {
      if (typeof article[key] !== 'string' || article[key].length > 10000) throw new SearchError('기사 텍스트가 올바르지 않습니다.');
      return article[key];
    };
    const row = sheet.addRow({
      date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(date),
      source: text('source'), title: text('title'), summary: text('summary'),
      sentiment: article.sentiment, summaryType: text('summaryType'), url: url.href
    });
    // 제목·요약은 수식으로 처리하지 않고 일반 문자열로 저장합니다.
    row.getCell('url').value = { text: url.href, hyperlink: url.href };
    row.getCell('url').font = { color: { argb: 'FF176957' }, underline: true };
    row.alignment = { vertical: 'top', wrapText: true };
  }
  sheet.autoFilter = { from: 'A1', to: 'G1' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176957' } };
  return workbook.xlsx.writeBuffer();
}
