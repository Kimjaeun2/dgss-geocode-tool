/* =========================================================================
   도로명 -> 지번/PNU 변환 도구
   - 도로명주소를 기준으로 카카오 API에서 지번주소와 PNU(19자리 필지고유번호)를
     뽑아 새 컬럼에 기록한다. 좌표(X, Y)는 다루지 않는다.
   - 기존 지번주소 컬럼을 함께 지정하면 새로 뽑은 지번과 일치 여부도 비교한다.
   - 엑셀 업로드/시트 선택/카카오 저수준 호출 등 공통 부분은 src/core.js를
     그대로 쓴다. 좌표 지오코딩(주소검색·장소검색·지도 보정)은 이 페이지에
     없다 — 그건 index.html + app.js의 몫이다.
   ========================================================================= */
(function () {
'use strict';

// ====== 필수 라이브러리 확인 ======
const missingLibs = [];
if (typeof XLSX === 'undefined') missingLibs.push('XLSX (엑셀 읽기/쓰기, cdnjs)');
if (typeof kakao === 'undefined' || !kakao.maps || !kakao.maps.services) missingLibs.push('카카오맵 JS SDK (dapi.kakao.com)');
if (typeof Addr === 'undefined') missingLibs.push('src/address.js');
if (typeof Pnu === 'undefined') missingLibs.push('src/pnu.js');

if (missingLibs.length) {
  const box = document.getElementById('uploadStatus');
  if (box) {
    box.className = 'status warn';
    box.textContent =
      '다음 라이브러리를 불러오지 못해 도구를 시작할 수 없습니다: ' + missingLibs.join(', ') + '. ' +
      '사내 네트워크가 외부 CDN을 막고 있거나, 파일 경로/도메인 등록이 바뀌지 않았는지 확인해주세요.';
  }
  const fi = document.getElementById('fileInput');
  if (fi) fi.disabled = true;
  return;
}

// ====== 결과 컬럼 이름 ======
const COL_PNU_JIBUN = '도로명기준지번';
const COL_PNU_CODE  = 'PNU';
const COL_PNU_MATCH = '지번일치여부';

// ====== 오류 차단기 ======
// 쿼터가 소진되면 이후 모든 호출이 'error' 를 반환하는데, 이걸 그냥 두면
// 남은 수천 건이 전부 "검색 결과 없음"으로 위장돼 원인을 알 수 없게 된다.
const PNU_ERROR_BREAKER_LIMIT = 10;
let pnuConsecutiveErrors = 0;
let pnuBreakerTripped = false;
let pnuStopRequested = false;
let pnuReviewList = []; // { sheetIdx, rowIndex, address, reason }

function notePnuApiResult(state) {
  if (state === 'error') {
    pnuConsecutiveErrors++;
    if (pnuConsecutiveErrors >= PNU_ERROR_BREAKER_LIMIT && !pnuBreakerTripped) {
      pnuBreakerTripped = true;
      pnuStopRequested = true;
      const box = $('pnuBreakerWarning');
      if (box) {
        box.classList.remove('hidden');
        box.textContent =
          `API 오류가 연속 ${PNU_ERROR_BREAKER_LIMIT}회 발생해 자동으로 중단했습니다. ` +
          `쿼터 소진이나 네트워크 문제일 수 있습니다 — 카카오 콘솔에서 사용량을 확인한 뒤 다시 실행해주세요.`;
      }
    }
  } else {
    pnuConsecutiveErrors = 0;
  }
}

const pnuCache = new Map(); // 성공만 캐시한다 (실패는 재시도 여지를 남긴다)

/** 도로명주소 1건을 지번주소+PNU로 변환한다. 좌표는 다루지 않는다. */
async function convertRoadToJibunPnu(addr) {
  if (pnuCache.has(addr)) return pnuCache.get(addr);
  const result = await convertRoadToJibunPnuUncached(addr);
  if (result.status === 'ok') pnuCache.set(addr, result);
  return result;
}

async function convertRoadToJibunPnuUncached(addr) {
  for (const v of Addr.addressVariants(addr)) {
    const r = await callKakaoWithRetry('address', v);
    notePnuApiResult(r.state);
    if (r.state === 'ok') {
      const t = r.data[0];
      const jibun = t.address ? t.address.address_name : '';
      if (!jibun) return { status: 'fail', reason: '지번 매핑 없음' };
      return { status: 'ok', jibun, pnu: Pnu.buildPnu(t.address) };
    }
  }
  return { status: 'fail', reason: '검색 결과 없음' };
}

// ====== 업로드/시트 선택 완료 훅 (core.js가 호출) ======
// core.js는 IIFE로 감싸지 않은 이 파일 밖 스코프에서 window.onFileLoaded /
// window.onSheetsChanged 를 찾아 호출한다 — 이 IIFE 안에서 그냥
// function으로만 선언하면 지역 바인딩이라 core.js 쪽에서 안 보이므로
// 반드시 window에 명시적으로 걸어줘야 한다.
function onFileLoaded() {
  resetPnuRun();
  renderSheetList();
  $('step-sheets').classList.remove('hidden');
  $('step-pnu').classList.remove('hidden');
}

function onSheetsChanged() {
  resetPnuRun();
  refreshPnuMapping();
}

window.onFileLoaded = onFileLoaded;
window.onSheetsChanged = onSheetsChanged;

/** 새 파일/새 시트 선택 시 이전 실행 상태 초기화 */
function resetPnuRun() {
  pnuReviewList = [];
  pnuStopRequested = false;
  pnuConsecutiveErrors = 0;
  pnuBreakerTripped = false;
  pnuCache.clear();
  sheets.forEach((s) => { s.pnuProcessed = false; s.pnuStats = null; s.pnuColIdx = null; });
  $('pnuStartBtn').disabled = false;
  $('pnuStopBtn').disabled = true;
  $('pnuProgressWrap').classList.add('hidden');
  $('pnuFailWrap').classList.add('hidden');
  $('pnuDownloadWrap').classList.add('hidden');
  $('pnuNote').textContent = '';
  $('pnuProgressText').textContent = '0 / 0';
  const pnuBox = $('pnuBreakerWarning');
  if (pnuBox) { pnuBox.classList.add('hidden'); pnuBox.textContent = ''; }
}

function refreshPnuMapping() {
  const base = baseSheet();
  const note = $('sheetMapNote');
  if (!base) {
    note.textContent = '처리할 시트를 최소 하나는 선택해주세요.';
    populatePnuColumnSelects([]);
    return;
  }
  const n = enabledSheets().length;
  note.textContent = n === 1
    ? `컬럼 매핑 기준: "${base.name}"`
    : `컬럼 매핑 기준: "${base.name}" — 나머지 ${n - 1}개 시트는 같은 이름의 컬럼을 찾아 적용합니다.`;
  populatePnuColumnSelects(base.aoa[0] || []);
}

/**
 * 컬럼 선택지를 채운다.
 * 도로명주소 컬럼은 필수(자동 인식 실패 시 "(선택하세요)"로 남아 실행을 막는다),
 * 지번주소 컬럼은 선택("(없음)" 포함).
 */
function populatePnuColumnSelects(header) {
  const fill = (id, withEmpty, emptyLabel) => {
    const sel = $(id);
    sel.innerHTML = withEmpty ? `<option value="">${emptyLabel}</option>` : '';
    header.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${XLSX.utils.encode_col(i)} : ${h || '(제목없음)'}`;
      sel.appendChild(opt);
    });
  };
  fill('pnuColRoad', true, '(선택하세요)');
  fill('pnuColJibun', true, '(없음)');

  autoGuess(header, 'pnuColRoad', ['소재지(도로명주소)', '도로명주소'], ['도로명주소']);
  autoGuess(header, 'pnuColJibun', ['소재지(지번주소)', '지번주소'], ['지번주소']);
}

/**
 * 컬럼 선택을 모든 선택 시트에 적용한다.
 * 반환: 처리 가능한 시트가 하나라도 있으면 true.
 */
function prepareAllSheetsForPnu() {
  const base = baseSheet();
  if (!base) { alert('처리할 시트를 최소 하나는 선택해주세요.'); return false; }

  const roadName = selectedColumnName('pnuColRoad', null);
  const jibunName = selectedColumnName('pnuColJibun', null);

  if (!roadName) { alert('도로명주소 컬럼을 선택해주세요.'); return false; }

  const skipped = [];
  enabledSheets().forEach((s) => {
    const road = findColumn(s, roadName);
    if (road < 0) { skipped.push(s.name); s.pnuColIdx = null; return; }
    const jibun = jibunName ? findColumn(s, jibunName) : -1;

    const originalLen = s.aoa[0].length;
    s.pnuColIdx = {
      road, jibun, originalLen,
      roadResult: findOrCreateColumn(s, COL_PNU_JIBUN),
      pnuResult: findOrCreateColumn(s, COL_PNU_CODE),
      matchResult: jibun >= 0 ? findOrCreateColumn(s, COL_PNU_MATCH) : -1,
    };
  });

  const usable = enabledSheets().filter((s) => s.pnuColIdx);
  if (usable.length === 0) {
    alert(`선택한 시트에서 "${roadName}" 컬럼을 찾지 못했습니다. 컬럼 지정을 확인해주세요.`);
    return false;
  }
  if (skipped.length) {
    $('pnuNote').textContent =
      `도로명주소 컬럼이 없어 건너뛰는 시트: ${skipped.join(', ')} — 나머지 ${usable.length}개 시트만 처리합니다.`;
  } else {
    $('pnuNote').textContent = '';
  }
  return true;
}

// ====== 변환 실행 ======
$('pnuStopBtn').addEventListener('click', () => { pnuStopRequested = true; });

$('pnuStartBtn').addEventListener('click', async () => {
  if (!prepareAllSheetsForPnu()) return;
  ensureServices();

  pnuStopRequested = false;
  pnuConsecutiveErrors = 0;
  pnuBreakerTripped = false;
  pnuReviewList = [];
  pnuCache.clear();
  $('pnuStartBtn').disabled = true;
  $('pnuStopBtn').disabled = false;
  $('pnuProgressWrap').classList.remove('hidden');
  $('pnuBreakerWarning').classList.add('hidden');
  $('pnuBreakerWarning').textContent = '';
  $('pnuFailWrap').classList.add('hidden');
  $('pnuDownloadWrap').classList.add('hidden');

  const targets = [];
  sheets.forEach((s, sheetIdx) => {
    if (!s.enabled || !s.pnuColIdx) return;
    s.pnuProcessed = true;
    s.pnuStats = { total: 0, ok: 0, fail: 0, pnuMissing: 0 };
    for (let i = 1; i < s.aoa.length; i++) {
      const addr = Addr.normalize(s.aoa[i][s.pnuColIdx.road]);
      if (addr !== '') { targets.push({ sheetIdx, rowIndex: i }); s.pnuStats.total++; }
    }
  });

  const total = targets.length;
  let done = 0;
  const tick = () => { $('pnuProgressText').textContent = `${done} / ${total}`; };
  tick();

  const concurrency = parseInt($('concurrency').value, 10) || 6;
  let cursor = 0;

  async function worker() {
    while (true) {
      if (pnuStopRequested) return;
      const myIndex = cursor++;
      if (myIndex >= targets.length) return;

      const { sheetIdx, rowIndex } = targets[myIndex];
      const sheet = sheets[sheetIdx];
      const ci = sheet.pnuColIdx;
      const row = sheet.aoa[rowIndex];
      const addr = Addr.normalize(row[ci.road]);

      const r = await convertRoadToJibunPnu(addr);

      if (r.status === 'ok') {
        row[ci.roadResult] = r.jibun;
        row[ci.pnuResult] = r.pnu;
        if (!r.pnu) sheet.pnuStats.pnuMissing++;
        if (ci.matchResult >= 0) {
          const existing = Addr.normalize(row[ci.jibun]);
          if (existing) {
            const same = Addr.sameParcel(existing, r.jibun);
            row[ci.matchResult] = same === null ? '판정불가' : (same ? '일치' : '불일치');
          }
        }
        sheet.pnuStats.ok++;
      } else {
        pnuReviewList.push({ sheetIdx, rowIndex, address: addr, reason: r.reason });
        sheet.pnuStats.fail++;
      }
      done++; tick();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  $('pnuStopBtn').disabled = true;
  $('pnuStartBtn').disabled = false;
  pnuReviewList.sort((a, b) => (a.sheetIdx - b.sheetIdx) || (a.rowIndex - b.rowIndex));
  renderPnuFailList();
  $('pnuDownloadWrap').classList.remove('hidden');

  const pnuMissingTotal = sheets.reduce((sum, s) => sum + (s.pnuStats ? s.pnuStats.pnuMissing : 0), 0);
  if (pnuMissingTotal > 0) {
    const note = $('pnuNote');
    const msg = `PNU를 확정하지 못한 행 ${pnuMissingTotal}건 (지번은 채워졌으나 PNU만 비어있음) — 처리요약 시트에서 확인하세요.`;
    note.textContent = note.textContent ? note.textContent + ' ' + msg : msg;
  }
});

function renderPnuFailList() {
  const ul = $('pnuFailList');
  ul.innerHTML = '';
  pnuReviewList.forEach((item) => {
    const li = document.createElement('li');
    const sheetBadge = sheets.length > 1
      ? `<span class="badge-sheet">${escapeHtml(sheets[item.sheetIdx].name)}</span>` : '';
    li.innerHTML = `${sheetBadge}<span class="addr"></span><span class="reason">${escapeHtml(item.reason)}</span>`;
    li.querySelector('.addr').textContent = item.address; // XSS 방지: 주소는 textContent 로
    ul.appendChild(li);
  });
  $('pnuFailBadge').textContent = `실패 ${pnuReviewList.length}건`;
  $('pnuFailWrap').classList.toggle('hidden', pnuReviewList.length === 0);
}

// ====== 다운로드 ======
/**
 * 결과 컬럼을 도로명주소 컬럼 바로 뒤에 삽입하도록 재배치한다.
 * 재실행 시 결과 컬럼이 이미 헤더 중간에 있어도(재실행이라 원래 위치를
 * 유지해야 함) 항상 road+1 자리로 다시 모아준다.
 */
function reorderForPnuOutput(sheet) {
  const ci = sheet.pnuColIdx;
  const total = sheet.aoa[0].length;
  const insertPoint = ci.road + 1;
  const resultCols = [ci.roadResult, ci.pnuResult, ci.matchResult].filter((idx) => idx >= 0);
  const resultSet = new Set(resultCols);

  const order = [];
  for (let i = 0; i < total; i++) {
    if (i === insertPoint) resultCols.forEach((idx) => order.push(idx));
    if (!resultSet.has(i)) order.push(i);
  }
  if (insertPoint >= total) resultCols.forEach((idx) => order.push(idx));

  return sheet.aoa.map((row) => order.map((idx) => (idx < row.length ? row[idx] : '')));
}

/**
 * "불일치" 행 전체에 배경색을 칠한다. aoa(재배치된 원본 배열)에서 지번일치여부
 * 컬럼 위치를 헤더 이름으로 찾으므로 컬럼이 어디로 재배치됐는지와 무관하게
 * 동작한다. window.XLSXStyle이 없으면(로드 실패) 조용히 아무것도 하지 않는다
 * — 색만 빠질 뿐 다운로드 자체는 정상 진행된다.
 */
function highlightMismatchRows(ws, aoa) {
  if (!window.XLSXStyle) return;
  const matchColIdx = aoa[0].indexOf(COL_PNU_MATCH);
  if (matchColIdx < 0) return;
  const fill = { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFC7CE' } } };
  for (let r = 1; r < aoa.length; r++) {
    if (aoa[r][matchColIdx] !== '불일치') continue;
    for (let c = 0; c < aoa[r].length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr]) ws[addr].s = fill;
    }
  }
}

$('pnuDownloadBtn').addEventListener('click', () => {
  const used = new Set();
  const outNames = [];
  const outSheets = {};

  workbook.SheetNames.forEach((name) => {
    const origName = uniqueName(name, used);
    used.add(origName);
    outNames.push(origName);
    outSheets[origName] = workbook.Sheets[name];

    const s = sheets.find((x) => x.name === name);
    if (!s || !s.pnuProcessed || !s.pnuColIdx) return;

    const dName = doneSheetName(name, used, '_지번PNU');
    used.add(dName);

    const aoa = reorderForPnuOutput(s);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    highlightMismatchRows(ws, aoa);
    const oldWs = workbook.Sheets[name];
    if (oldWs['!freeze']) ws['!freeze'] = oldWs['!freeze'];

    outNames.push(dName);
    outSheets[dName] = ws;
  });

  const summary = [['시트', '대상', '성공', '실패', '미처리', 'PNU미확정']];
  sheets.forEach((s) => {
    if (!s.pnuProcessed || !s.pnuStats) return;
    const t = s.pnuStats;
    const unprocessed = t.total - t.ok - t.fail;
    summary.push([s.name, t.total, t.ok, t.fail, unprocessed, t.pnuMissing]);
  });
  if (pnuBreakerTripped || pnuStopRequested) {
    summary.push([]);
    summary.push(['⚠ 이 실행은 중간에 중단되었습니다 (중지 버튼 또는 오류 연속 발생). "미처리" 행은 비어있는 채로 저장되었습니다.']);
  }
  const sn = uniqueName('처리요약', used);
  used.add(sn);
  outNames.push(sn);
  outSheets[sn] = XLSX.utils.aoa_to_sheet(summary);

  const writer = window.XLSXStyle || XLSX; // 색칠된 셀은 스타일 지원 라이브러리로 써야 실제로 저장된다
  writer.writeFile({ SheetNames: outNames, Sheets: outSheets }, originalBaseName + '_지번PNU.xlsx');
});

})();
