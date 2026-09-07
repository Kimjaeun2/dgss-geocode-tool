/* =========================================================================
   공유 코어 모듈 — 지오코딩 페이지(app.js)와 지번/PNU 변환 페이지(pnu-app.js)
   가 함께 쓰는 부분만 모은다: 엑셀 업로드, 시트 선택 UI, 카카오 저수준 호출,
   컬럼 찾기/이름 유틸.

   일부러 IIFE로 감싸지 않는다 — app.js/pnu-app.js가 자기 스코프에서 이 파일의
   top-level let/const/function을 그대로 참조해야 하기 때문이다(클로저로 접근).
   각 페이지는 이 파일이 끝난 뒤 자기 스크립트에서 onFileLoaded()/onSheetsChanged()
   전역 함수를 정의해 페이지 고유의 동작(카드 노출, 컬럼 select 채우기, 실행
   상태 초기화)을 훅으로 연결한다. 이 파일 자체는 두 함수의 존재 여부를
   확인만 하고 호출한다 — 어느 페이지가 로드됐는지 core.js는 알 필요가 없다.
   ========================================================================= */
'use strict';

const $ = (id) => document.getElementById(id);
const isNum = (v) => v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));

// ====== 전역 상태 (두 페이지가 각자 자기 파일을 업로드해 따로 채운다) ======
let workbook = null;
let originalFileName = 'geocoded.xlsx';
let originalBaseName = 'geocoded';
/* 시트별 상태. { name, aoa, enabled, colIdx, processed, stats, ... } */
let sheets = [];

/** 체크된 시트들 */
const enabledSheets = () => sheets.filter((s) => s.enabled);
/** 컬럼 매핑의 기준이 되는 시트 (첫 번째 체크된 시트) */
const baseSheet = () => enabledSheets()[0] || null;

let geocoder = null, places = null;
function ensureServices() {
  if (!geocoder) geocoder = new kakao.maps.services.Geocoder();
  if (!places) places = new kakao.maps.services.Places();
}

// ====== 카카오 API 호출 (일시적 오류 재시도 포함) ======
const KAKAO_OK = () => kakao.maps.services.Status.OK;
const KAKAO_ZERO = () => kakao.maps.services.Status.ZERO_RESULT;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 카카오 검색 1회 실행.
 * 결과: { state: 'ok' | 'zero' | 'error', data }
 * 네트워크/쿼터 오류(error)는 호출부에서 재시도한다.
 */
function callKakao(method, query) {
  return new Promise((resolve) => {
    const cb = (data, status) => {
      if (status === KAKAO_OK() && data && data.length) resolve({ state: 'ok', data });
      else if (status === KAKAO_ZERO()) resolve({ state: 'zero' });
      else resolve({ state: 'error' });
    };
    if (method === 'address') geocoder.addressSearch(query, cb);
    else places.keywordSearch(query, cb);
  });
}

async function callKakaoWithRetry(method, query, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await callKakao(method, query);
    if (r.state !== 'error') return r;
    await sleep(400 * (i + 1)); // 지수적으로 대기 후 재시도
  }
  return { state: 'error' };
}

// ====== 공통 유틸 ======
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uniqueName(base, used) {
  let name = base.slice(0, 31);
  let n = 2;
  while (used.has(name)) {
    const tail = '_' + n;
    name = base.slice(0, 31 - tail.length) + tail;
    n++;
  }
  return name;
}

/** 엑셀 시트명은 31자 제한. suffix(기본 '_완료')를 붙일 수 있도록 앞을 자른다. */
function doneSheetName(base, used, suffix) {
  suffix = suffix || '_완료';
  const MAX = 31;
  let name = base.slice(0, MAX - suffix.length) + suffix;
  let n = 2;
  while (used.has(name)) {
    const tail = '_' + n + suffix;
    name = base.slice(0, MAX - tail.length) + tail;
    n++;
  }
  return name;
}

/** 시트에서 헤더 이름으로 컬럼을 찾고, 없으면 새로 만든다. */
function findOrCreateColumn(sheet, name) {
  const header = sheet.aoa[0];
  const idx = header.findIndex((h) => String(h).trim() === name);
  if (idx >= 0) return idx;
  header.push(name);
  return header.length - 1;
}

/** 시트에서 헤더 이름으로 컬럼을 찾는다. 없으면 -1. */
function findColumn(sheet, name) {
  if (!name) return -1;
  return sheet.aoa[0].findIndex((h) => String(h).trim() === name);
}

/** select 에서 고른 컬럼의 "이름"을 얻는다 (인덱스가 아니라 이름으로 시트 간 매칭) */
function selectedColumnName(selectId, newNameId) {
  const val = $(selectId).value;
  if (val === '') return '';
  if (val === '__new__') return (newNameId && $(newNameId) ? $(newNameId).value.trim() : '');
  const base = baseSheet();
  if (!base) return '';
  const h = base.aoa[0][parseInt(val, 10)];
  return String(h == null ? '' : h).trim();
}

/**
 * 헤더 자동 추정. exactKeys 로 완전 일치를 먼저 시도하고,
 * 없을 때만 partialKeys 로 부분 일치를 시도한다.
 */
function autoGuess(header, selectId, exactKeys, partialKeys) {
  let idx = header.findIndex((h) => exactKeys.some((k) => String(h).trim() === k));
  if (idx < 0 && partialKeys && partialKeys.length) {
    idx = header.findIndex((h) => partialKeys.some((k) => String(h).includes(k)));
  }
  if (idx >= 0) { $(selectId).value = String(idx); return true; }
  return false;
}

// ====== 1단계: 파일 업로드 (공통) ======
// 실제 파싱만 여기서 하고, 이후 화면 갱신은 페이지별 onFileLoaded() 훅에 맡긴다.
$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  originalFileName = file.name.replace(/\.(xlsx|xls)$/i, '') + '_geocoded.xlsx';
  originalBaseName = file.name.replace(/\.(xlsx|xls)$/i, '');

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      workbook = XLSX.read(new Uint8Array(evt.target.result), { type: 'array', cellStyles: true });
    } catch (err) {
      $('uploadStatus').textContent = '엑셀을 읽지 못했습니다: ' + err.message;
      return;
    }
    $('uploadStatus').textContent = `업로드 완료: ${file.name} (시트 ${workbook.SheetNames.length}개)`;

    // 모든 시트를 읽어두고 기본으로 전부 선택한다.
    sheets = workbook.SheetNames.map((name) => {
      let aoa = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
      if (aoa.length === 0) aoa = [[]];
      return { name, aoa, enabled: true, colIdx: null, processed: false, stats: null };
    });

    if (typeof window.onFileLoaded === 'function') window.onFileLoaded();
  };
  reader.readAsArrayBuffer(file);
});

// ====== 시트 선택 UI (공통) ======
function renderSheetList() {
  const box = $('sheetList');
  box.innerHTML = '';

  sheets.forEach((s) => {
    const rows = Math.max(0, s.aoa.length - 1);
    const label = document.createElement('label');
    label.className = 'checkbox sheet-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.enabled;
    cb.onchange = () => {
      s.enabled = cb.checked;
      syncSelectAll();
      if (typeof window.onSheetsChanged === 'function') window.onSheetsChanged();
    };

    const text = document.createElement('span');
    text.textContent = `${s.name} (${rows}행)`;

    label.appendChild(cb);
    label.appendChild(text);
    box.appendChild(label);
  });

  $('sheetAll').onchange = () => {
    const on = $('sheetAll').checked;
    sheets.forEach((s) => { s.enabled = on; });
    renderSheetList();
    if (typeof window.onSheetsChanged === 'function') window.onSheetsChanged();
  };

  syncSelectAll();
  if (typeof window.onSheetsChanged === 'function') window.onSheetsChanged();
}

function syncSelectAll() {
  const on = sheets.length > 0 && sheets.every((s) => s.enabled);
  $('sheetAll').checked = on;
}
