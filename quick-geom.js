/* =========================================================================
   간편 geom 만들기 (quick-geom.html)
   파일 하나 → 자동 인식 → 버튼 하나 → 원본 서식 그대로 + 결과 열 3개.

   상세 지오코딩(index.html/app.js)과의 차이:
   - 사람이 고르던 것(제목줄·주소 열·보조 주소 열·장소명 열·지역)을 자동 추정
     (src/quickgeo.js, test.html 로 검증)
   - 원본 시트를 다시 만들지 않고 셀에 직접 써서 위쪽 범례·색 채우기·병합·
     열 너비를 그대로 둔다
   - 사전/VWorld/인접지번/지도 보정은 없다. 못 찾은 행은 결과 표에서 주소를
     고쳐 다시 찾는다. 그 이상이 필요하면 상세 지오코딩 페이지를 쓴다.
   공통 부분(업로드 파싱, 카카오 호출+재시도, escapeHtml)은 src/core.js 를 쓴다.
   ========================================================================= */
(function () {
'use strict';

const missing = [];
if (typeof XLSX === 'undefined') missing.push('XLSX (엑셀, cdnjs)');
if (typeof proj4 === 'undefined' || typeof window.CRS_LIST === 'undefined') missing.push('proj4 / src/crs.js');
if (typeof kakao === 'undefined' || !kakao.maps || !kakao.maps.services) missing.push('카카오맵 JS SDK (dapi.kakao.com)');
if (typeof Addr === 'undefined' || typeof Gate === 'undefined' || typeof QuickGeo === 'undefined') missing.push('src/address.js · gate.js · quickgeo.js');
if (missing.length) {
  $('uploadStatus').className = 'status warn';
  $('uploadStatus').textContent = '다음 라이브러리를 불러오지 못해 시작할 수 없습니다: ' + missing.join(', ') +
    '. 사내망이 외부 CDN을 막고 있거나 카카오에 이 주소(도메인)가 등록되지 않았는지 확인해주세요.';
  $('fileInput').disabled = true;
  return;
}

const OUT = { geom: 'geom', level: '좌표결과', found: '찾은주소' };
const FILL = { 실패: 'FFC9C9', 추정: 'FFF3BF' };
const CONCURRENCY = 5;
const ERROR_LIMIT = 10; // 카카오 오류가 연속 이만큼이면 쿼터/도메인 문제로 보고 멈춘다

/* st: 현재 시트 상태. idx 는 모두 aoa 기준(0부터), 엑셀 행번호 = r0 + idx + 1 */
let st = null;
let running = false, stopRequested = false, consecutiveErrors = 0;
const cache = new Map();

const str = (v) => (v == null ? '' : String(v).trim());
const colLetter = (c) => XLSX.utils.encode_col(st.c0 + c);
const colOf = (id) => ($(id).value === '' ? -1 : parseInt($(id).value, 10));

// ====== 좌표계 (마지막 선택을 기억) ======
const crsSel = $('qgCrs');
window.CRS_LIST.forEach((c) => crsSel.add(new Option(c.label, c.code)));
crsSel.value = pref('qgCrs') || 'EPSG:2097';
crsSel.onchange = () => pref('qgCrs', crsSel.value);

function pref(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch (e) { /* 사생활 보호 모드 등 — 기억만 못 할 뿐 동작엔 지장 없음 */ }
  return null;
}

// ====== 끌어다 놓기 ======
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('over')));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!e.dataTransfer.files.length) return;
  $('fileInput').files = e.dataTransfer.files;
  $('fileInput').dispatchEvent(new Event('change'));
});

// ====== 1 → 2: 파일을 읽으면 가장 큰 시트를 고르고 전부 자동 추정 ======
window.onFileLoaded = function () {
  const sel = $('qgSheet');
  sel.innerHTML = '';
  let biggest = 0;
  sheets.forEach((s, i) => {
    sel.add(new Option(`${s.name} (${s.aoa.length}행)`, String(i)));
    if (s.aoa.length > sheets[biggest].aoa.length) biggest = i;
  });
  sel.value = String(biggest);
  $('qgSheetField').classList.toggle('hidden', sheets.length < 2);
  sel.onchange = () => selectSheet(parseInt(sel.value, 10));
  selectSheet(biggest);
};

function selectSheet(i) {
  const s = sheets[i];
  const ws = workbook.Sheets[s.name];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  st = { sheet: s, ws, aoa: s.aoa, r0: range.s.r, c0: range.s.c, headerRow: 0, results: new Map(), issues: [] };
  setHeaderRow(QuickGeo.findHeaderRow(s.aoa));
}

function setHeaderRow(h) {
  st.headerRow = h;
  $('qgHeaderRow').value = String(st.r0 + h + 1);
  const header = st.aoa[h] || [];
  const ranked = QuickGeo.rankAddressColumns(st.aoa, h);
  const a1 = ranked.length ? ranked[0].col : -1;
  const a2 = ranked.length > 1 && ranked[1].score >= 0.5 ? ranked[1].col : -1;
  const width = st.aoa.reduce((m, r) => Math.max(m, (r || []).length), 0);

  fillColumnSelect('qgAddr', header, width, a1, '(선택하세요)');
  fillColumnSelect('qgAddr2', header, width, a2, '(사용 안 함)');
  fillColumnSelect('qgName', header, width, QuickGeo.guessNameColumn(header, [a1, a2]), '(사용 안 함)');
  $('qgRegion').value = QuickGeo.inferRegion(columnValues(a1));
  refreshCheck();
}

function fillColumnSelect(id, header, width, selected, emptyLabel) {
  const sel = $(id);
  sel.innerHTML = '';
  sel.add(new Option(emptyLabel, ''));
  for (let c = 0; c < width; c++) {
    const h = str(header[c]);
    sel.add(new Option(`${colLetter(c)}열 · ${h || '(제목없음)'}`, String(c)));
  }
  sel.value = selected >= 0 ? String(selected) : '';
}

function columnValues(c) {
  if (c < 0) return [];
  return st.aoa.slice(st.headerRow + 1).map((r) => str((r || [])[c])).filter(Boolean);
}

$('qgHeaderRow').addEventListener('change', () => {
  const n = parseInt($('qgHeaderRow').value, 10) - 1 - st.r0;
  if (n >= 0 && n < st.aoa.length) setHeaderRow(n);
  else $('qgHeaderRow').value = String(st.r0 + st.headerRow + 1);
});
['qgAddr', 'qgAddr2', 'qgName', 'qgRegion'].forEach((id) => $(id).addEventListener('change', refreshCheck));

/** 처리 대상 행: 제목줄 아래에서 주소나 보조 주소가 있는 행 */
function targetRows() {
  const a1 = colOf('qgAddr'), a2 = colOf('qgAddr2');
  const out = [];
  for (let i = st.headerRow + 1; i < st.aoa.length; i++) {
    const r = st.aoa[i] || [];
    if ((a1 >= 0 && str(r[a1])) || (a2 >= 0 && str(r[a2]))) out.push(i);
  }
  return out;
}

/** 이 행을 검색할 때 쓸 주소들 (주 주소 → 보조 주소, 지역 보정 적용) */
function queriesOf(idx) {
  const r = st.aoa[idx] || [];
  const region = str($('qgRegion').value);
  const out = [];
  [colOf('qgAddr'), colOf('qgAddr2')].forEach((c) => {
    if (c < 0) return;
    const q = QuickGeo.withRegion(r[c], region);
    if (q && out.indexOf(q) === -1) out.push(q);
  });
  return out;
}

const nameOf = (idx) => { const c = colOf('qgName'); return c >= 0 ? str((st.aoa[idx] || [])[c]) : ''; };
const excelRow = (idx) => st.r0 + idx + 1;

function refreshCheck() {
  $('qgCheck').classList.remove('hidden');
  $('qgResult').classList.add('hidden');
  st.results = new Map();
  const rows = targetRows();
  const a1 = colOf('qgAddr');

  let html = '<tr><th>행</th><th>장소명</th><th>원래 주소</th><th>이렇게 검색합니다</th></tr>';
  rows.slice(0, 5).forEach((idx) => {
    const r = st.aoa[idx] || [];
    html += `<tr><td>${excelRow(idx)}</td><td>${escapeHtml(nameOf(idx))}</td>` +
      `<td>${escapeHtml(a1 >= 0 ? r[a1] : '')}</td><td><b>${escapeHtml(queriesOf(idx)[0] || '')}</b></td></tr>`;
  });
  $('qgPreview').innerHTML = rows.length ? html : '';

  const note = $('qgCheckNote');
  if (a1 < 0) {
    note.className = 'status warn';
    note.textContent = '주소 열을 찾지 못했습니다. "주소 열"을 직접 골라주세요.';
  } else {
    note.className = 'status';
    note.textContent = rows.length ? `미리보기는 앞 5건입니다. 전체 ${rows.length}건을 처리합니다.` : '처리할 주소가 없습니다.';
  }
  $('qgRun').disabled = a1 < 0 || !rows.length;
  $('qgRun').textContent = `📍 좌표 만들기 (${rows.length}건)`;
}

// ====== 지오코딩 ======
async function kakao_(method, q) {
  const r = await callKakaoWithRetry(method, q);
  if (r.state === 'error') {
    if (++consecutiveErrors >= ERROR_LIMIT && !stopRequested) {
      stopRequested = true;
      $('qgWarn').classList.remove('hidden');
      $('qgWarn').textContent = '카카오 API 오류가 계속 나서 멈췄습니다. 하루 사용량 초과이거나 이 주소(도메인)가 카카오에 등록되지 않았을 수 있습니다. 처리된 행까지는 다운로드할 수 있습니다.';
    }
  } else consecutiveErrors = 0;
  return r;
}

/**
 * 한 행을 찾는다. 1) 주소들(주 → 보조)을 변형까지 주소검색 → '정확'
 * 2) 그래도 없으면 '지역 + 장소명' 장소검색 → '추정' (사람이 확인해야 함)
 * 지역의 시군구와 다른 결과는 버린다 (동명 지번이 다른 군에 있는 경우).
 */
async function geocode(queries, name) {
  const key = queries.join('|') + '#' + name;
  if (cache.has(key)) return cache.get(key);

  const region = str($('qgRegion').value);
  const sgg = Addr.parse(region).sgg;
  const inRegion = (addr) => Gate.check(addr, sgg) !== 'out';
  let res = null;

  outer:
  for (const q of queries) {
    for (const v of Addr.addressVariants(q)) {
      const r = await kakao_('address', v);
      if (stopRequested) break outer;
      if (r.state !== 'ok') continue;
      const hit = r.data.find((d) => inRegion(d.address_name));
      if (hit) { res = { level: '정확', lon: hit.x, lat: hit.y, found: hit.address_name }; break outer; }
    }
  }

  if (!res && name && !stopRequested) {
    const r = await kakao_('place', region ? region + ' ' + name : name);
    if (r.state === 'ok') {
      const inside = r.data.filter((p) => inRegion(p.address_name));
      // ponytail: 이름이 정확히 같은 후보가 없으면 1순위를 '추정'으로 채택 — 결과 표에서 사람이 확인
      const p = inside.find((x) => Addr.normalize(x.place_name) === Addr.normalize(name)) || inside[0];
      if (p) res = { level: '추정', lon: p.x, lat: p.y, found: `${p.place_name} (${p.road_address_name || p.address_name})` };
    }
  }

  if (!res) res = { level: '실패', found: '' };
  // 중지/오류로 끊긴 결과는 캐시하지 않는다 — 다시 실행하면 재시도되도록
  if (!stopRequested) cache.set(key, res);
  return res;
}

// ====== 2 → 3: 실행 ======
$('qgRun').addEventListener('click', async () => {
  if (running) return;
  running = true; stopRequested = false; consecutiveErrors = 0;
  ensureServices();
  const rows = targetRows();
  st.results = new Map();

  $('qgResult').classList.remove('hidden');
  $('qgDone').classList.add('hidden');
  $('qgWarn').classList.add('hidden');
  $('qgStop').classList.remove('hidden');
  $('qgRun').disabled = true;
  $('qgResult').scrollIntoView({ behavior: 'smooth', block: 'start' });

  let next = 0, done = 0;
  const worker = async () => {
    while (!stopRequested && next < rows.length) {
      const idx = rows[next++];
      const res = await geocode(queriesOf(idx), nameOf(idx));
      if (!stopRequested || res.level !== '실패') st.results.set(idx, res);
      done++;
      renderProgress(done, rows.length);
    }
  };
  renderProgress(0, rows.length);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  running = false;
  $('qgRun').disabled = false;
  $('qgStop').classList.add('hidden');
  if (stopRequested && $('qgWarn').classList.contains('hidden')) {
    $('qgWarn').classList.remove('hidden');
    $('qgWarn').textContent = `중지했습니다. 처리된 ${st.results.size}건까지만 결과에 들어갑니다.`;
  }
  st.issues = rows.filter((i) => st.results.has(i) && st.results.get(i).level !== '정확');
  renderSummary();
  renderIssues();
  $('qgDone').classList.remove('hidden');
});

$('qgStop').addEventListener('click', () => { stopRequested = true; });

function renderProgress(done, total) {
  $('qgFill').style.width = total ? (done / total * 100) + '%' : '0%';
  $('qgProgressText').textContent = `${done} / ${total}`;
}

function renderSummary() {
  const n = { 정확: 0, 추정: 0, 실패: 0 };
  st.results.forEach((r) => { n[r.level]++; });
  $('qgSummary').innerHTML =
    `<span class="ok">✔ 정확 ${n.정확}</span><span class="place">◐ 추정 ${n.추정}</span><span class="fail">✖ 실패 ${n.실패}</span>`;
}

function renderIssues() {
  $('qgIssuesWrap').classList.toggle('hidden', !st.issues.length);
  $('qgIssuesBadge').textContent = st.issues.length + '건';
  let html = '<tr><th>행</th><th>장소명</th><th>검색할 주소 (고쳐 쓰기)</th><th>결과</th><th></th></tr>';
  st.issues.forEach((idx) => {
    const r = st.results.get(idx);
    const cls = r.level === '정확' ? 'ok' : r.level === '추정' ? 'guess' : 'fail';
    html += `<tr data-idx="${idx}"><td>${excelRow(idx)}</td><td>${escapeHtml(nameOf(idx))}</td>` +
      `<td><input type="text" value="${escapeHtml(r.input || queriesOf(idx)[0] || nameOf(idx))}"></td>` +
      `<td><span class="qg-level ${cls}">${r.level}</span><div class="qg-found">${escapeHtml(r.found)}</div></td>` +
      `<td><button class="secondary qg-retry">다시 찾기</button></td></tr>`;
  });
  $('qgIssues').innerHTML = html;
}

/* 다시 찾기: 입력한 글자를 주소로 먼저, 안 되면 장소 이름으로 검색 */
$('qgIssues').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('qg-retry')) return;
  const tr = e.target.closest('tr');
  const idx = parseInt(tr.dataset.idx, 10);
  const text = str(tr.querySelector('input').value);
  if (!text) return;
  ensureServices();
  stopRequested = false; consecutiveErrors = 0;
  e.target.disabled = true;
  e.target.textContent = '찾는 중…';
  const res = await geocode([QuickGeo.withRegion(text, str($('qgRegion').value))], text);
  st.results.set(idx, Object.assign({ input: text }, res));
  renderSummary();
  renderIssues();
});

// ====== 다운로드: 원본 시트 셀에 직접 쓴다 ======
$('qgDownload').addEventListener('click', () => {
  const ws = st.ws, crs = crsSel.value;
  const writer = window.XLSXStyle || XLSX;
  workbook.SheetNames.forEach((n) => toWritableStyles(workbook.Sheets[n]));

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const hr = st.r0 + st.headerRow;
  const cols = {};
  Object.keys(OUT).forEach((k) => {
    cols[k] = findHeaderCell(ws, hr, range, OUT[k]);
    if (cols[k] < 0) {
      cols[k] = ++range.e.c;
      ws[XLSX.utils.encode_cell({ r: hr, c: cols[k] })] = { t: 's', v: OUT[k] };
    }
  });

  st.results.forEach((res, idx) => {
    const r = st.r0 + idx;
    const xy = res.lon ? project(res.lon, res.lat, crs) : null;
    const fill = FILL[res.level] ? { fill: { patternType: 'solid', fgColor: { rgb: FILL[res.level] } } } : undefined;
    const put = (c, v) => { ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: v, s: fill }; };
    put(cols.geom, xy ? QuickGeo.toEwkt(xy.x, xy.y, crs) : '');
    put(cols.level, res.level);
    put(cols.found, res.found || '');
    if (r > range.e.r) range.e.r = r;
  });
  ws['!ref'] = XLSX.utils.encode_range(range);
  ws['!cols'] = ws['!cols'] || [];
  ws['!cols'][cols.geom] = { wch: 44 };
  ws['!cols'][cols.found] = { wch: 36 };

  writer.writeFile(workbook, originalBaseName + '_geom.xlsx', { cellStyles: true });
  if (!window.XLSXStyle) {
    $('qgWarn').classList.remove('hidden');
    $('qgWarn').textContent = '서식 라이브러리를 못 불러와 색 채우기 없이 저장했습니다 (좌표 값은 정상).';
  }
});

function findHeaderCell(ws, r, range, name) {
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell && str(cell.v) === name) return c;
  }
  return -1;
}

function project(lon, lat, crs) {
  const lo = parseFloat(lon), la = parseFloat(lat);
  if (crs === 'EPSG:4326') return { x: lo, y: la };
  const [x, y] = proj4('EPSG:4326', crs, [lo, la]);
  return { x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4 };
}

/* 읽을 때의 스타일 형식({patternType, fgColor})을 xlsx-js-style 이 쓰는 형식
   ({fill:{...}})으로 바꾼다. 원본의 색 채우기를 살리기 위함 — 글꼴·테두리는
   커뮤니티판이 읽어오지 않아 유지되지 않는다. 두 번 불러도 안전하다. */
function toWritableStyles(ws) {
  Object.keys(ws).forEach((a) => {
    if (a[0] === '!') return;
    const s = ws[a].s;
    if (!s || s.fill) return;
    if (s.patternType && s.patternType !== 'none' && s.fgColor && s.fgColor.rgb) {
      ws[a].s = { fill: { patternType: 'solid', fgColor: { rgb: s.fgColor.rgb } } };
    } else delete ws[a].s;
  });
}

})();
