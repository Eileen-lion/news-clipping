const form = document.querySelector('#search-form');
const startInput = document.querySelector('#start-date');
const endInput = document.querySelector('#end-date');
const keywordInput = document.querySelector('#keyword');
const sentimentFilter = document.querySelector('#sentiment-filter');
const error = document.querySelector('#form-error');
const list = document.querySelector('#article-list');
const status = document.querySelector('#result-status');
const details = document.querySelector('#search-details');
const submit = form.querySelector('[type="submit"]');
const empty = document.querySelector('#empty-state');
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
let articles = [];
let controller;
let searched = false;
let completedSearch = null;
let exporting = false;
const exportButton = document.querySelector('#export-button');

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function visibleArticles() {
  return articles.filter(article => sentimentFilter.value === 'all' || article.sentiment === sentimentFilter.value);
}

function renderArticles() {
  const filtered = visibleArticles();
  exportButton.disabled = exporting || !searched || filtered.length === 0;
  list.replaceChildren();
  const classes = { '긍정': 'positive', '중립': 'neutral', '부정': 'negative' };
  filtered.forEach(article => {
    const card = makeElement('li', 'article-card');
    const meta = makeElement('div', 'article-meta');
    const date = new Date(article.date);
    const formatted = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const time = makeElement('time', '', `${article.dateType} ${formatted}`);
    time.dateTime = article.date;
    meta.append(makeElement('span', 'source', article.source), time, makeElement('span', `sentiment ${classes[article.sentiment]}`, `의견 추정 · ${article.sentiment}`));
    const link = makeElement('a', 'article-link', '기사 원문 보기 ↗');
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${article.title} 원문 보기 (새 탭)`);
    // RSS나 AI 결과를 HTML로 삽입하지 않고 텍스트로 표시합니다.
    card.append(meta, makeElement('h3', '', article.title), makeElement('p', '', article.summary), makeElement('small', 'summary-label', article.summaryType), link);
    list.append(card);
  });
  document.querySelector('#result-count').textContent = filtered.length;
  empty.hidden = !searched || filtered.length > 0;
  if (searched) status.textContent = `가져온 기사 ${articles.length}건 중 ${filtered.length}건을 표시합니다.`;
}

function setLoading(loading) {
  submit.disabled = loading;
  submit.textContent = loading ? '검색 중…' : '기사 검색 ↗';
  list.setAttribute('aria-busy', String(loading));
}

async function search(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  error.textContent = '';
  if (startInput.value > endInput.value) {
    error.textContent = '종료일은 시작일과 같거나 이후여야 합니다.';
    endInput.focus();
    return;
  }
  controller?.abort();
  const request = new AbortController();
  controller = request;
  articles = [];
  completedSearch = null;
  searched = false;
  renderArticles();
  details.textContent = '';
  status.textContent = 'Google News RSS에서 기사를 검색하고 있습니다. 잠시 기다려 주세요.';
  setLoading(true);
  try {
    if (location.protocol === 'file:') throw new Error('npm start로 서버를 실행한 뒤 http://localhost:3000에서 접속해 주세요.');
    // 브라우저에서는 외부 RSS 대신 우리 서버에만 요청합니다.
    const params = new URLSearchParams({ from: startInput.value, to: endInput.value, keyword: keywordInput.value });
    const response = await fetch(`/api/news?${params}`, { signal: request.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '기사를 가져오지 못했습니다.');
    completedSearch = { from: params.get('from'), to: params.get('to'), keyword: params.get('keyword') };
    articles = data.articles;
    searched = true;
    sentimentFilter.value = 'all';
    details.textContent = `Google News RSS · ${data.warnings.join(' ')}`;
    renderArticles();
  } catch (failure) {
    if (request.signal.aborted) return;
    error.textContent = failure instanceof TypeError ? '백엔드에 연결할 수 없습니다. npm start 실행 여부와 서버 주소를 확인해 주세요.' : failure.message;
    status.textContent = '검색에 실패했습니다. 오류 메시지를 확인해 주세요.';
  } finally {
    if (controller === request) {
      controller = null;
      setLoading(false);
    }
  }
}

function reset() {
  controller?.abort();
  controller = null;
  form.reset();
  startInput.value = `${today.slice(0, 7)}-01`;
  endInput.value = today;
  startInput.max = today;
  endInput.max = today;
  sentimentFilter.value = 'all';
  articles = [];
  completedSearch = null;
  searched = false;
  error.textContent = '';
  details.textContent = '';
  renderArticles();
  status.textContent = '키워드와 검색 조건을 입력한 뒤 기사 검색을 눌러 주세요.';
  setLoading(false);
}

// 재검색하지 않고 현재 표시된 결과를 서버에서 실제 .xlsx 파일로 만듭니다.
async function downloadExcel() {
  const rows = visibleArticles();
  if (!rows.length || !completedSearch || exporting) return;
  const criteria = { ...completedSearch };
  exporting = true;
  exportButton.disabled = true;
  exportButton.textContent = '엑셀 생성 중…';
  error.textContent = '';
  try {
    const response = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles: rows })
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || '엑셀 파일 생성에 실패했습니다.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `뉴스클리핑_${criteria.from}_${criteria.to}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (failure) {
    error.textContent = failure.message || '엑셀 파일을 다운로드하지 못했습니다.';
  } finally {
    exporting = false;
    exportButton.textContent = '엑셀 다운로드';
    exportButton.disabled = !searched || visibleArticles().length === 0;
  }
}

exportButton.addEventListener('click', downloadExcel);
form.addEventListener('submit', search);
sentimentFilter.addEventListener('change', renderArticles);
document.querySelector('#reset-button').addEventListener('click', reset);
reset();
