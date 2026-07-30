/* =========================================================================
   방제지리정보 주소 지오코딩 도구
   - 엑셀 업로드 -> 사전 조회 -> VWorld/카카오 주소검색 -> 장소검색 폴백
     -> 수동 보정 -> 엑셀 저장
   - 여러 시트를 한 번에 처리하고 검수는 한 화면에서 통합해 진행한다.
   - DB 저장 없음. 모든 처리는 브라우저 메모리에서만 이루어짐.
   ========================================================================= */
(function () {
'use strict';

// ====== 필수 라이브러리 확인 ======
// CDN/사내망 차단으로 스크립트가 안 올라오면 이 파일의 나머지 코드가 실행되자마자
// (예: 아래 proj4.defs 호출) 예외를 던지며 조용히 죽는다. 그래서 다른 어떤 코드보다
// 먼저 확인하고, 없으면 여기서 멈춘 뒤 화면에 어떤 라이브러리가 문제인지 알린다.
const missingLibs = [];
if (typeof XLSX === 'undefined') missingLibs.push('XLSX (엑셀 읽기/쓰기, cdnjs)');
if (typeof proj4 === 'undefined') missingLibs.push('proj4 (좌표계 변환, cdnjs)');
if (typeof kakao === 'undefined' || !kakao.maps || !kakao.maps.services) missingLibs.push('카카오맵 JS SDK (dapi.kakao.com)');
if (typeof Addr === 'undefined') missingLibs.push('src/address.js');
if (typeof Gate === 'undefined') missingLibs.push('src/gate.js');
if (typeof Dict === 'undefined') missingLibs.push('src/dictionary.js');

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
  return; // 아래 코드는 위 라이브러리들에 의존하므로 실행하지 않는다
}

// ====== 좌표계 정의 ======
// 기존 시트의 X/Y는 WGS84 경위도가 아니라 투영좌표계(미터)입니다.
// 후보들끼리 수백 m씩 어긋나므로 "기존 좌표로 자동 판정" 기능으로 확정하는 것을 권장합니다.
const CRS_LIST = [
  { code: 'EPSG:5181', label: 'EPSG:5181 - Korea 2000 중부원점 (y_0=500000)',
    def: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs' },
  { code: 'EPSG:5174', label: 'EPSG:5174 - Korean 1985 보정중부원점',
    def: '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43' },
  { code: 'EPSG:2097', label: 'EPSG:2097 - Korean 1985 중부원점',
    def: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43' },
  { code: 'EPSG:5186', label: 'EPSG:5186 - Korea 2000 중부원점 (y_0=600000)',
    def: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs' },
  { code: 'EPSG:5185', label: 'EPSG:5185 - Korea 2000 서부원점',
    def: '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs' },
  { code: 'EPSG:5187', label: 'EPSG:5187 - Korea 2000 동부원점',
    def: '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs' },
  { code: 'EPSG:5179', label: 'EPSG:5179 - UTM-K (통합원점)',
    def: '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs' },
  { code: 'EPSG:4326', label: 'EPSG:4326 - WGS84 경위도 (변환 없이 그대로)', def: null },
];
CRS_LIST.forEach((c) => { if (c.def) proj4.defs(c.code, c.def); });

let targetCrs = 'EPSG:5181';

/** API가 준 WGS84 경도/위도를 선택된 좌표계로 변환 */
function toProjected(lon, lat) {
  const lo = parseFloat(lon), la = parseFloat(lat);
  if (targetCrs === 'EPSG:4326') return { x: lo, y: la };
  const [x, y] = proj4('EPSG:4326', targetCrs, [lo, la]);
  return { x: round(x, 4), y: round(y, 4) };
}
function round(v, d) { const p = Math.pow(10, d); return Math.round(v * p) / p; }

// ====== 결과 컬럼 이름 ======
// '대체주소' 는 지명형 주소가 실제 주소로 치환된 행에만 채운다.
// '검색어' 는 실제로 API 에 보낸 문자열(추적용)이며 '대체주소' 와 역할이 다르다.
const COL_SOJAEJI = '소재지';
const COL_ALT     = '대체주소';
const COL_JIBUN   = '지번';
const COL_ROAD    = '도로명';
const COL_LON     = '경도(WGS84)';
const COL_LAT     = '위도(WGS84)';
const COL_METHOD  = '매칭방식';
const COL_QUERY   = '검색어';

/* 원본 주소로는 못 찾아 다른 주소로 바꿔 넣은 경우의 매칭방식.
   이 목록에 해당할 때만 '대체주소' 컬럼을 채운다. */
const ALT_METHODS = [
  '사전',
  '장소검색(자동)', '장소검색(선택)', '장소검색(관할밖선택)', '장소검색(VWorld자동)',
  '수동지정',
];
const isAltMethod = (m) => ALT_METHODS.indexOf(m) !== -1;

// ====== 전역 상태 ======
let workbook = null;
let originalFileName = 'geocoded.xlsx';
/* 시트별 상태. { name, aoa, enabled, colIdx, processed, stats } */
let sheets = [];
let reviewList = [];       // { sheetIdx, rowIndex, address, candidates, outside, resolved, reason }
let activeIdx = -1;
let stopRequested = false;

// ====== 연속 API 오류 차단기 ======
// 쿼터가 소진되면 이후 모든 호출이 'error' 를 반환하는데, 이걸 그냥 두면
// 남은 수천 건이 전부 "검색 결과 없음"으로 위장돼 원인을 알 수 없게 된다.
// 연속 10회 오류(성공/무결과가 한 번도 안 섞임)면 전체를 멈추고 명시적으로 알린다.
const ERROR_BREAKER_LIMIT = 10;
let consecutiveErrors = 0;
let breakerTripped = false;

/** API 호출 1회의 결과 상태를 반영한다. 'error' 가 연속되면 실행을 중단시킨다. */
function noteApiResult(state) {
  if (state === 'error') {
    consecutiveErrors++;
    if (consecutiveErrors >= ERROR_BREAKER_LIMIT && !breakerTripped) {
      breakerTripped = true;
      stopRequested = true;
      const box = $('breakerWarning');
      if (box) {
        box.classList.remove('hidden');
        box.textContent =
          `API 오류가 연속 ${ERROR_BREAKER_LIMIT}회 발생해 자동으로 중단했습니다. ` +
          `쿼터 소진이나 네트워크 문제일 수 있습니다 — 카카오/VWorld 콘솔에서 사용량을 확인한 뒤 다시 실행해주세요.`;
      }
    }
  } else {
    consecutiveErrors = 0;
  }
}

let map = null, marker = null, geocoder = null, places = null;

const $ = (id) => document.getElementById(id);
const isNum = (v) => v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));

/** 체크된 시트들 */
const enabledSheets = () => sheets.filter((s) => s.enabled);
/** 컬럼 매핑의 기준이 되는 시트 (첫 번째 체크된 시트) */
const baseSheet = () => enabledSheets()[0] || null;

// ====== 1단계: 파일 업로드 ======
$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  originalFileName = file.name.replace(/\.(xlsx|xls)$/i, '') + '_geocoded.xlsx';

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

    resetRun();
    renderSheetList();
    populateCrsSelect();
    $('step-mapping').classList.remove('hidden');
    $('step-dict').classList.remove('hidden');
    $('step-crs').classList.remove('hidden');
  };
  reader.readAsArrayBuffer(file);
});

/** 새 파일/새 시트 선택 시 이전 실행 상태 초기화 */
function resetRun() {
  reviewList = [];
  activeIdx = -1;
  stopRequested = false;
  consecutiveErrors = 0;
  breakerTripped = false;
  geocodeCache.clear(); // 다시 실행할 때는 이전 결과를 재사용하지 않고 새로 시도
  sheets.forEach((s) => { s.processed = false; s.stats = null; s.colIdx = null; });
  $('startBtn').disabled = false;
  $('step-progress').classList.add('hidden');
  $('step-fail').classList.add('hidden');
  $('step-download').classList.add('hidden');
  $('crsResult').innerHTML = '';
  $('sheetProgress').innerHTML = '';
  const box = $('breakerWarning');
  if (box) { box.classList.add('hidden'); box.textContent = ''; }
}

// ====== 시트 선택 ======
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
      resetRun();
      refreshMappingFromBase();
      syncSelectAll();
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
    resetRun();
    refreshMappingFromBase();
  };

  syncSelectAll();
  refreshMappingFromBase();
}

function syncSelectAll() {
  const on = sheets.length > 0 && sheets.every((s) => s.enabled);
  $('sheetAll').checked = on;
}

/**
 * 컬럼 매핑 UI 를 기준 시트의 헤더로 다시 채운다.
 * 여러 시트는 헤더 "이름"으로 컬럼을 찾으므로, 헤더가 같은 시트끼리는
 * 한 번만 매핑하면 전부 적용된다. 이름이 없는 시트는 실행 시 건너뛰고 알린다.
 */
function refreshMappingFromBase() {
  const base = baseSheet();
  const note = $('sheetMapNote');
  if (!base) {
    note.textContent = '처리할 시트를 최소 하나는 선택해주세요.';
    populateColumnSelects([]);
    return;
  }
  const n = enabledSheets().length;
  note.textContent = n === 1
    ? `컬럼 매핑 기준: "${base.name}"`
    : `컬럼 매핑 기준: "${base.name}" — 나머지 ${n - 1}개 시트는 같은 이름의 컬럼을 찾아 적용합니다.`;
  populateColumnSelects(base.aoa[0] || []);
}

function populateCrsSelect() {
  const sel = $('crsSelect');
  sel.innerHTML = '';
  CRS_LIST.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.code; opt.textContent = c.label;
    sel.appendChild(opt);
  });
  sel.value = targetCrs;
  sel.onchange = () => { targetCrs = sel.value; };
}

// ====== 컬럼 매핑 ======
function populateColumnSelects(header) {
  const fill = (id, withEmpty, withNew) => {
    const sel = $(id);
    sel.innerHTML = withEmpty ? '<option value="">(없음)</option>' : '';
    header.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${XLSX.utils.encode_col(i)} : ${h || '(제목없음)'}`;
      sel.appendChild(opt);
    });
    if (withNew) {
      const opt = document.createElement('option');
      opt.value = '__new__'; opt.textContent = '+ 새 컬럼 추가 (직접 입력)';
      sel.appendChild(opt);
    }
  };
  fill('colJibun', true, false);
  fill('colRoad', true, false);
  fill('colX', false, true);
  fill('colY', false, true);

  autoGuess(header, 'colJibun', ['소재지(지번주소)', '지번주소'], ['지번주소']);
  autoGuess(header, 'colRoad', ['소재지(도로명주소)', '도로명주소'], ['도로명주소']);

  // 정확히 일치하는 헤더를 먼저 찾는다.
  // (부분 일치만 쓰면 'x' 가 'locx' 를 먼저 잡아 엉뚱한 컬럼이 선택됨)
  const foundX = autoGuess(header, 'colX', ['x', 'X', '경도'], []);
  const foundY = autoGuess(header, 'colY', ['y', 'Y', '위도'], []);
  if (!foundX) { $('colX').value = '__new__'; $('colXNewName').value = 'X'; }
  if (!foundY) { $('colY').value = '__new__'; $('colYNewName').value = 'Y'; }

  toggleNewColInput('colX', 'colXNewName');
  toggleNewColInput('colY', 'colYNewName');
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

function toggleNewColInput(selectId, inputId) {
  const sel = $(selectId), input = $(inputId);
  const sync = () => input.classList.toggle('hidden', sel.value !== '__new__');
  sync();
  sel.onchange = sync;
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

function getAddress(sheet, row) {
  const ci = sheet.colIdx;
  const jibun = ci.jibun >= 0 ? Addr.normalize(row[ci.jibun]) : '';
  const road = ci.road >= 0 ? Addr.normalize(row[ci.road]) : '';
  return jibun !== '' ? jibun : road;
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

// 같은 주소를 여러 행에서 쓰는 경우 API를 다시 부르지 않도록 결과를 캐시.
// 실행을 다시 시작하면 resetRun() 이 비우므로 일시적 오류도 다음 실행에서 재시도된다.
const geocodeCache = new Map();

/**
 * 한 주소를 지오코딩한다.
 * 0) 대체주소 사전 (네트워크 없음)
 * 1) 주소검색 경로: VWorld(지번->도로명) -> 카카오 주소검색(변형 4종)
 * 2) 장소검색 경로: 카카오 -> VWorld, 시·군·구 게이트 적용
 */
async function geocodeAddress(addr) {
  const hit = Dict.lookup(addr);
  if (hit) {
    return {
      status: 'ok', method: '사전',
      lon: hit.lon, lat: hit.lat,
      jibun: hit.altAddress || '', road: '',
      usedQuery: '',
    };
  }
  if (geocodeCache.has(addr)) return geocodeCache.get(addr);
  const result = await geocodeAddressUncached(addr);
  geocodeCache.set(addr, result);
  return result;
}

async function geocodeAddressUncached(addr) {
  const parsed = Addr.parse(addr);
  const outside = [];
  const vworldOn = window.VWorld && window.VWorld.isAvailable();

  // --- 주소검색 경로 ---
  if (Addr.route(parsed) === 'address') {
    // VWorld 를 키가 있을 때 먼저 시도한다 (지번 -> 도로명 순). 어떤 표기인지
    // 미리 알 수 없어 둘 다 시도하되, 실패해도 카카오로 계속 진행한다.
    if (vworldOn) {
      for (const t of ['PARCEL', 'ROAD']) {
        const r = await window.VWorld.getcoord(addr, t);
        noteApiResult(r.state);
        if (r.state === 'ok') {
          return {
            status: 'ok',
            method: t === 'PARCEL' ? '주소검색(VWorld:지번)' : '주소검색(VWorld:도로명)',
            lon: r.lon, lat: r.lat,
            jibun: t === 'PARCEL' ? r.refinedText : '',
            road: t === 'ROAD' ? r.refinedText : '',
            usedQuery: addr,
          };
        }
      }
    }

    for (const v of Addr.addressVariants(addr)) {
      const r = await callKakaoWithRetry('address', v);
      noteApiResult(r.state);
      if (r.state === 'ok') {
        const t = r.data[0];
        return {
          status: 'ok',
          method: v === addr ? '주소검색' : '주소검색(보정)',
          lon: t.x, lat: t.y,
          jibun: t.address ? t.address.address_name : '',
          road: t.road_address ? t.road_address.address_name : '',
          usedQuery: v,
        };
      }
    }
  }

  // --- 장소검색 경로 ---
  // 주소검색 경로였다가 전부 실패한 경우에도 원본 문자열로 한 번 더 시도한다.
  const keywords = Addr.keywordCandidates(parsed);
  const queries = keywords.length ? keywords : [Addr.normalize(addr)];

  for (const v of queries) {
    const r = await callKakaoWithRetry('place', v);
    noteApiResult(r.state);
    if (r.state !== 'ok') continue;

    const inside = [];
    for (const p of r.data) {
      const verdict = Gate.check(p.address_name, parsed.sgg);
      if (verdict === 'out') outside.push(p);
      else inside.push(p);   // 'in' 과 'skip' 은 후보로 인정한다
    }

    if (inside.length === 1) {
      const p = inside[0];
      return {
        status: 'ok', method: '장소검색(자동)',
        lon: p.x, lat: p.y,
        jibun: p.address_name || '', road: p.road_address_name || '',
        usedQuery: v,
      };
    }
    if (inside.length > 1) {
      return { status: 'ambiguous', candidates: inside, outside: outside, usedQuery: v };
    }
    // inside 가 0건이면 다음 키워드 후보로 넘어간다
  }

  // 카카오 장소검색으로 전혀 못 찾았을 때만 VWorld 장소검색을 보조로 시도한다.
  if (vworldOn) {
    for (const v of queries) {
      const r = await window.VWorld.search(v);
      noteApiResult(r.state);
      if (r.state !== 'ok') continue;

      const inside = [];
      for (const p of r.data) {
        const verdict = Gate.check(p.address_name, parsed.sgg);
        if (verdict === 'out') outside.push(p);
        else inside.push(p);
      }

      if (inside.length === 1) {
        const p = inside[0];
        return {
          status: 'ok', method: '장소검색(VWorld자동)',
          lon: p.x, lat: p.y,
          jibun: p.address_name || '', road: p.road_address_name || '',
          usedQuery: v,
        };
      }
      if (inside.length > 1) {
        return { status: 'ambiguous', candidates: inside, outside: outside, usedQuery: v };
      }
    }
  }

  return {
    status: 'fail',
    outside: outside,
    reason: outside.length ? '관할 내 결과 없음' : '검색 결과 없음',
  };
}

// ====== 대체주소 사전 불러오기 ======
$('dictInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const first = wb.SheetNames.find((n) => n === '대체주소사전') || wb.SheetNames[0];
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, defval: '' });
      const r = Dict.loadFromAOA(aoa);
      $('dictStatus').textContent =
        `사전 ${r.loaded}건 불러옴` + (r.skipped ? ` (형식이 맞지 않아 건너뛴 행 ${r.skipped}개)` : '') +
        ` — 현재 사전 총 ${Dict.size()}건`;
    } catch (err) {
      $('dictStatus').textContent = '사전 파일을 읽지 못했습니다: ' + err.message;
    }
  };
  reader.readAsArrayBuffer(file);
});

// ====== 좌표계 자동 판정 ======
$('detectCrsBtn').addEventListener('click', async () => {
  if (!prepareAllSheets()) return;
  ensureServices();

  const base = baseSheet();
  const btn = $('detectCrsBtn');
  btn.disabled = true;
  const out = $('crsResult');
  out.innerHTML = '<div class="status">기존 좌표가 있는 행을 표본으로 검사하는 중...</div>';

  // 기존 x,y 가 숫자이고 주소도 있는 행을 표본으로 수집 (기준 시트에서)
  const ci = base.colIdx;
  const samples = [];
  for (let i = 1; i < base.aoa.length && samples.length < 15; i++) {
    const row = base.aoa[i];
    const addr = getAddress(base, row);
    if (addr && isNum(row[ci.x]) && isNum(row[ci.y])) {
      samples.push({ addr, x: parseFloat(row[ci.x]), y: parseFloat(row[ci.y]) });
    }
  }
  if (samples.length === 0) {
    out.innerHTML = '<div class="status warn">기존 좌표가 있는 행이 없어 판정할 수 없습니다. 좌표계를 직접 선택해주세요.</div>';
    btn.disabled = false;
    return;
  }

  // 표본 주소를 지오코딩해서 WGS84 기준점을 확보
  const points = [];
  for (const s of samples) {
    const r = await callKakaoWithRetry('address', s.addr);
    if (r.state === 'ok') points.push({ lon: parseFloat(r.data[0].x), lat: parseFloat(r.data[0].y), x: s.x, y: s.y });
    await sleep(150);
  }
  if (points.length === 0) {
    out.innerHTML = '<div class="status warn">표본 주소를 지오코딩하지 못했습니다. 좌표계를 직접 선택해주세요.</div>';
    btn.disabled = false;
    return;
  }

  // 후보 좌표계별 평균 오차 계산
  const scores = CRS_LIST.map((c) => {
    let sum = 0, n = 0;
    for (const p of points) {
      let px, py;
      if (c.code === 'EPSG:4326') { px = p.lon; py = p.lat; }
      else { [px, py] = proj4('EPSG:4326', c.code, [p.lon, p.lat]); }
      const d = Math.hypot(px - p.x, py - p.y);
      if (isFinite(d)) { sum += d; n++; }
    }
    return { code: c.code, label: c.label, avg: n ? sum / n : Infinity };
  }).sort((a, b) => a.avg - b.avg);

  const best = scores[0];
  targetCrs = best.code;
  $('crsSelect').value = best.code;

  const unit = (code) => (code === 'EPSG:4326' ? '도' : 'm');
  let html = `<table class="crs-table"><tr><th>좌표계</th><th>평균 오차</th><th></th></tr>`;
  scores.slice(0, 5).forEach((s, i) => {
    const val = isFinite(s.avg) ? s.avg.toFixed(1) + ' ' + unit(s.code) : '-';
    html += `<tr class="${i === 0 ? 'best' : ''}"><td>${s.code}</td><td>${val}</td><td>${i === 0 ? '← 선택됨' : ''}</td></tr>`;
  });
  html += `</table><div class="status">표본 ${points.length}건 기준. 오차가 수십 m 이내면 신뢰할 만하고, 후보 간 차이가 크지 않으면 GIS 담당자에게 확인하세요.</div>`;
  out.innerHTML = html;
  btn.disabled = false;
});

// ====== 컬럼 준비 (선택된 모든 시트) ======
/**
 * 매핑 UI 에서 고른 컬럼 "이름"을 모든 선택 시트에 적용한다.
 * 이름이 없는 시트는 처리 대상에서 빼고 사용자에게 알린다.
 * 반환: 처리 가능한 시트가 하나라도 있으면 true.
 */
function prepareAllSheets() {
  const base = baseSheet();
  if (!base) { alert('처리할 시트를 최소 하나는 선택해주세요.'); return false; }

  const jibunName = selectedColumnName('colJibun', null);
  const roadName = selectedColumnName('colRoad', null);
  const xName = selectedColumnName('colX', 'colXNewName');
  const yName = selectedColumnName('colY', 'colYNewName');

  if (!jibunName && !roadName) {
    alert('지번주소 또는 도로명주소 컬럼 중 하나는 선택해야 합니다.'); return false;
  }
  if (!xName || !yName) {
    alert('결과 X, Y 컬럼을 지정해주세요 (새 컬럼 추가 시 이름도 입력해야 합니다).'); return false;
  }
  if (xName === yName) {
    alert('X 컬럼과 Y 컬럼이 같습니다. 다르게 지정해주세요.'); return false;
  }

  const skipped = [];
  enabledSheets().forEach((s) => {
    const jibun = findColumn(s, jibunName);
    const road = findColumn(s, roadName);
    if (jibun < 0 && road < 0) { skipped.push(s.name); s.colIdx = null; return; }

    s.colIdx = {
      jibun, road,
      x: findOrCreateColumn(s, xName),
      y: findOrCreateColumn(s, yName),
      sojaeji: findOrCreateColumn(s, COL_SOJAEJI),
      alt: findOrCreateColumn(s, COL_ALT),
      jibunResult: findOrCreateColumn(s, COL_JIBUN),
      roadResult: findOrCreateColumn(s, COL_ROAD),
      lon: findOrCreateColumn(s, COL_LON),
      lat: findOrCreateColumn(s, COL_LAT),
      method: findOrCreateColumn(s, COL_METHOD),
      query: findOrCreateColumn(s, COL_QUERY),
    };
  });

  const usable = enabledSheets().filter((s) => s.colIdx);
  if (usable.length === 0) {
    alert(`선택한 시트에서 "${jibunName || roadName}" 컬럼을 찾지 못했습니다. 시트 선택이나 컬럼 지정을 확인해주세요.`);
    return false;
  }
  if (skipped.length) {
    $('sheetMapNote').textContent =
      `주소 컬럼이 없어 건너뛰는 시트: ${skipped.join(', ')} — 나머지 ${usable.length}개 시트만 처리합니다.`;
  }
  return true;
}

function ensureServices() {
  if (!geocoder) geocoder = new kakao.maps.services.Geocoder();
  if (!places) places = new kakao.maps.services.Places();
}

/**
 * 행에 좌표와 주소 정보를 기록한다.
 * '대체주소' 는 원본으로 못 찾아 다른 주소로 치환된 경우에만 채운다 (isAltMethod).
 * 내용은 지번 우선, 없으면 도로명.
 */
function writeRow(sheet, row, o) {
  const ci = sheet.colIdx;
  const proj = toProjected(o.lon, o.lat);
  row[ci.x] = proj.x;
  row[ci.y] = proj.y;
  row[ci.lon] = round(parseFloat(o.lon), 7);
  row[ci.lat] = round(parseFloat(o.lat), 7);
  if (o.jibun) row[ci.jibunResult] = o.jibun;
  if (o.road) row[ci.roadResult] = o.road;
  row[ci.method] = o.method;

  if (isAltMethod(o.method)) {
    const alt = o.jibun || o.road || '';
    if (alt) row[ci.alt] = alt;
  }
  if (o.usedQuery && o.usedQuery !== o.original) row[ci.query] = o.usedQuery;
}

/** 치환으로 확정된 결과를 사전에 등록한다. */
function rememberInDict(address, o) {
  if (!isAltMethod(o.method)) return;
  Dict.add({
    original: address,
    altAddress: o.jibun || o.road || '',
    lon: o.lon, lat: o.lat,
    sgg: Addr.parse(address).sgg || '',
    source: o.method,
  });
}

// ====== 2단계: 지오코딩 실행 ======
$('stopBtn').addEventListener('click', () => { stopRequested = true; });

$('startBtn').addEventListener('click', async () => {
  if (!prepareAllSheets()) return;
  ensureServices();
  targetCrs = $('crsSelect').value;

  stopRequested = false;
  reviewList = [];
  geocodeCache.clear();
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  $('step-progress').classList.remove('hidden');

  // 선택된 모든 시트의 처리 대상 행을 하나의 큐로 만든다.
  const targets = [];
  sheets.forEach((s, sheetIdx) => {
    if (!s.enabled || !s.colIdx) return;
    s.processed = true;
    s.stats = { total: 0, ok: 0, place: 0, dict: 0, skip: 0, fail: 0 };
    for (let i = 1; i < s.aoa.length; i++) {
      if (getAddress(s, s.aoa[i]) !== '') {
        targets.push({ sheetIdx, rowIndex: i });
        s.stats.total++;
      }
    }
  });

  const total = targets.length;
  let done = 0, ok = 0, place = 0, dict = 0, fail = 0, skip = 0;
  const tick = () => updateProgress(done, total, ok, place, dict, fail, skip);
  tick();

  // 여러 건을 동시에 처리한다. 워커들이 공유 큐(cursor)에서 하나씩 꺼내 가는 방식.
  // JS는 단일 스레드라 카운터 증감에 경쟁 상태가 생기지 않는다.
  const concurrency = parseInt($('concurrency').value, 10) || 6;
  let cursor = 0;

  async function worker() {
    while (true) {
      if (stopRequested) return;
      const myIndex = cursor++;
      if (myIndex >= targets.length) return;

      const { sheetIdx, rowIndex } = targets[myIndex];
      const sheet = sheets[sheetIdx];
      const ci = sheet.colIdx;
      const row = sheet.aoa[rowIndex];
      const addr = getAddress(sheet, row);

      // 이미 좌표가 "숫자로" 채워진 행은 건너뛴다 (주소 텍스트가 든 컬럼을 오인하지 않도록 숫자 검사)
      if (isNum(row[ci.x]) && isNum(row[ci.y])) {
        if (!row[ci.sojaeji]) row[ci.sojaeji] = addr;
        if (!row[ci.method]) row[ci.method] = '기존값';
        skip++; sheet.stats.skip++; done++; tick();
        continue;
      }

      row[ci.sojaeji] = addr;
      const r = await geocodeAddress(addr);

      if (r.status === 'ok') {
        writeRow(sheet, row, Object.assign({}, r, { original: addr }));
        rememberInDict(addr, r);
        if (r.method === '사전') { dict++; sheet.stats.dict++; }
        else if (r.method.indexOf('장소검색') === 0) { place++; sheet.stats.place++; }
        else { ok++; sheet.stats.ok++; }
      } else if (r.status === 'ambiguous') {
        reviewList.push({
          sheetIdx, rowIndex, address: addr, candidates: r.candidates,
          outside: r.outside || [], resolved: false, reason: '후보 여러 건',
        });
        fail++; sheet.stats.fail++;
      } else {
        reviewList.push({
          sheetIdx, rowIndex, address: addr, candidates: null,
          outside: r.outside || [], resolved: false, reason: r.reason || '검색 결과 없음',
        });
        fail++; sheet.stats.fail++;
      }
      done++; tick();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // 병렬 처리라 완료 순서가 뒤섞이므로 보정 목록을 시트 -> 행 순서대로 정렬
  reviewList.sort((a, b) => (a.sheetIdx - b.sheetIdx) || (a.rowIndex - b.rowIndex));

  $('stopBtn').disabled = true;
  $('startBtn').disabled = false;
  $('step-fail').classList.remove('hidden');
  $('step-download').classList.remove('hidden');
  renderSheetFilter();
  renderFailList();
  renderSheetProgress();

  const untouched = total - done;
  const hint = $('step-fail').querySelector('.hint');
  if (breakerTripped) {
    hint.textContent =
      `API 오류 연속 발생으로 자동 중단됐습니다. ${untouched}건은 아예 시도되지 않았습니다 ` +
      `(대량 "검색 결과 없음"으로 위장되는 것을 막기 위한 안전장치입니다). ` +
      `쿼터를 확인한 뒤 나머지를 다시 실행해주세요. 처리된 부분까지는 저장할 수 있습니다.`;
  } else if (stopRequested) {
    hint.textContent = `중지되었습니다. ${untouched}건이 남았습니다. 처리된 부분까지 저장할 수 있습니다.`;
  } else if (reviewList.length === 0) {
    hint.textContent = '모든 주소가 자동으로 처리되었습니다.';
  }
});

function updateProgress(done, total, ok, place, dict, fail, skip) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  $('progressFill').style.width = pct + '%';
  $('progressText').textContent = `${done} / ${total}`;
  $('cntOk').textContent = ok;
  $('cntPlace').textContent = place;
  $('cntDict').textContent = dict;
  $('cntSkip').textContent = skip;
  $('cntFail').textContent = fail;
}

/** 시트별 처리 소계 */
function renderSheetProgress() {
  const box = $('sheetProgress');
  const processed = sheets.filter((s) => s.processed && s.stats);
  if (processed.length <= 1) { box.innerHTML = ''; return; }

  let html = '<table class="crs-table"><tr><th>시트</th><th>대상</th><th>주소검색</th><th>장소검색</th><th>사전</th><th>기존값</th><th>미해결</th></tr>';
  processed.forEach((s) => {
    const t = s.stats;
    html += `<tr><td>${escapeHtml(s.name)}</td><td>${t.total}</td><td>${t.ok}</td><td>${t.place}</td><td>${t.dict}</td><td>${t.skip}</td><td>${t.fail}</td></tr>`;
  });
  html += '</table>';
  box.innerHTML = html;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ====== 3단계: 미해결 건 보정 ======
$('onlyUnresolved').addEventListener('change', renderFailList);

/** 검수 목록의 시트 필터를 채운다 (처리한 시트가 2개 이상일 때만 노출) */
function renderSheetFilter() {
  const sel = $('sheetFilter');
  if (!sel) return;
  const used = [];
  reviewList.forEach((it) => { if (used.indexOf(it.sheetIdx) === -1) used.push(it.sheetIdx); });

  sel.innerHTML = '<option value="">전체 시트</option>';
  used.forEach((i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = sheets[i].name;
    sel.appendChild(opt);
  });
  sel.parentElement.classList.toggle('hidden', used.length <= 1);
  sel.onchange = renderFailList;
}

function renderFailList() {
  const ul = $('failList');
  const onlyUnresolved = $('onlyUnresolved').checked;
  const filterEl = $('sheetFilter');
  const filter = filterEl && filterEl.value !== '' ? parseInt(filterEl.value, 10) : null;
  ul.innerHTML = '';

  reviewList.forEach((item, idx) => {
    if (onlyUnresolved && item.resolved) return;
    if (filter !== null && item.sheetIdx !== filter) return;

    const li = document.createElement('li');
    li.className = item.resolved ? 'resolved' : '';
    if (idx === activeIdx) li.classList.add('active');
    li.dataset.idx = String(idx);

    const outsideCount = (item.outside || []).length;
    const outsideBadge = outsideCount ? `<span class="badge-outside">관할 밖 ${outsideCount}</span>` : '';
    const sheetBadge = sheets.length > 1
      ? `<span class="badge-sheet">${escapeHtml(sheets[item.sheetIdx].name)}</span>` : '';

    li.innerHTML = `${sheetBadge}<span class="addr"></span><span class="reason">${escapeHtml(item.reason)}</span>${outsideBadge}`;
    li.querySelector('.addr').textContent = item.address; // XSS 방지: 주소는 textContent 로
    li.onclick = () => selectItem(idx);
    ul.appendChild(li);
  });

  const remain = reviewList.filter((i) => !i.resolved).length;
  $('remainBadge').textContent = `미해결 ${remain} / 전체 ${reviewList.length}`;

  if (activeIdx < 0 && reviewList.length > 0) selectItem(0);
}

function selectItem(idx) {
  activeIdx = idx;
  const item = reviewList[idx];
  renderHighlight();

  ensureMap();
  $('searchBox').value = item.address;

  // 배치 단계에서 이미 후보를 받아둔 경우 API를 다시 부르지 않고 그대로 보여준다.
  if (item.candidates) showCandidates(item.candidates, item.address, item.outside);
  else if (item.outside && item.outside.length) showCandidates([], item.address, item.outside);
  else runKeywordSearch(item.address);
}

function renderHighlight() {
  const lis = $('failList').querySelectorAll('li');
  lis.forEach((li) => {
    li.classList.toggle('active', parseInt(li.dataset.idx, 10) === activeIdx);
  });
}

function ensureMap() {
  if (map) { kakao.maps.event.trigger(map, 'relayout'); return; }
  map = new kakao.maps.Map($('map'), {
    center: new kakao.maps.LatLng(37.6584, 126.7756),
    level: 5,
  });
  kakao.maps.event.trigger(map, 'relayout');
  kakao.maps.event.addListener(map, 'click', (e) => {
    saveCoord(e.latLng.getLng(), e.latLng.getLat(), null, '수동지정');
  });
}

$('searchBtn').addEventListener('click', () => {
  const kw = $('searchBox').value.trim();
  if (kw) runKeywordSearch(kw);
});

function runKeywordSearch(keyword) {
  places.keywordSearch(keyword, (data, status) => {
    if (status !== kakao.maps.services.Status.OK || !data || data.length === 0) {
      showMessage('검색 결과가 없습니다. 지도를 직접 클릭해서 좌표를 지정하세요.');
      return;
    }
    showCandidates(data, keyword);
  });
}

function showMessage(msg) {
  const ul = $('searchResults');
  ul.innerHTML = '';
  const li = document.createElement('li');
  li.textContent = msg;
  ul.appendChild(li);
}

function showCandidates(data, keyword, outside) {
  const ul = $('searchResults');
  ul.innerHTML = '';
  outside = outside || [];

  const apply = (p, isOutside) => {
    map.setCenter(new kakao.maps.LatLng(p.y, p.x));
    map.setLevel(3);
    saveCoord(p.x, p.y, {
      jibun: p.address_name || '', road: p.road_address_name || '', usedQuery: keyword,
    }, isOutside ? '장소검색(관할밖선택)' : '장소검색(선택)');
  };

  // 관할 내 후보가 정확히 1건이고 관할 밖 후보가 없으면 기존처럼 바로 채택한다.
  if (data.length === 1 && outside.length === 0) {
    const p = data[0];
    map.setCenter(new kakao.maps.LatLng(p.y, p.x));
    map.setLevel(3);
    saveCoord(p.x, p.y, {
      jibun: p.address_name || '', road: p.road_address_name || '', usedQuery: keyword,
    }, '장소검색(자동)');
    const li = document.createElement('li');
    li.className = 'auto-picked';
    li.textContent = `자동 선택됨: ${p.place_name} - ${p.road_address_name || p.address_name}`;
    ul.appendChild(li);
    return;
  }

  data.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = `${p.place_name} - ${p.road_address_name || p.address_name}`;
    li.onclick = () => apply(p, false);
    ul.appendChild(li);
  });

  // 관할 밖 후보는 구분선 아래에 따로 보여준다. 버리지 않되 눈에 띄게 구분한다.
  if (outside.length) {
    const head = document.createElement('li');
    head.className = 'outside-head';
    head.textContent = `── 관할 밖 후보 ${outside.length}건 (다른 시·군·구)`;
    ul.appendChild(head);

    outside.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'outside-item';
      li.textContent = `${p.place_name} - ${p.road_address_name || p.address_name}`;
      li.onclick = () => apply(p, true);
      ul.appendChild(li);
    });
  }

  const first = data[0] || outside[0];
  if (first) map.setCenter(new kakao.maps.LatLng(first.y, first.x));
}

/**
 * 지도/후보에서 확정한 좌표를 기록한다.
 * 같은 원본 주소를 가진 미해결 항목은 시트를 넘나들며 한 번에 반영한다 —
 * '한뫼공원주변' 이 3개 시트 12행에 있으면 클릭 한 번으로 12행이 끝난다.
 */
function saveCoord(lon, lat, info, method) {
  if (marker) marker.setMap(null);
  marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(lat, lon), map });

  if (activeIdx < 0) return;
  const active = reviewList[activeIdx];
  const key = Addr.normalize(active.address);

  const payload = {
    lon, lat, method,
    jibun: info ? info.jibun : '',
    road: info ? info.road : '',
    usedQuery: info ? info.usedQuery : '',
    original: active.address,
  };

  // 같은 주소를 가진 미해결 항목 전부에 반영 (시트를 넘나든다)
  const affected = reviewList.filter(
    (it) => !it.resolved && Addr.normalize(it.address) === key
  );

  affected.forEach((it) => {
    const sheet = sheets[it.sheetIdx];
    writeRow(sheet, sheet.aoa[it.rowIndex], payload);
    it.resolved = true;
  });

  rememberInDict(active.address, payload);

  // 지도를 직접 클릭한 경우 좌표를 역으로 주소로 변환해 지번/도로명/대체주소를 채운다
  if (!info) {
    geocoder.coord2Address(lon, lat, (result, status) => {
      if (status !== kakao.maps.services.Status.OK || !result.length) return;
      const r = result[0];
      const jibun = r.address ? r.address.address_name : '';
      const road = r.road_address ? r.road_address.address_name : '';

      affected.forEach((it) => {
        const sheet = sheets[it.sheetIdx];
        const ci = sheet.colIdx;
        const row = sheet.aoa[it.rowIndex];
        if (jibun) row[ci.jibunResult] = jibun;
        if (road) row[ci.roadResult] = road;
        const alt = jibun || road;
        if (alt) row[ci.alt] = alt;
      });

      // 역지오코딩으로 알아낸 주소를 사전에도 반영
      Dict.add({
        original: active.address,
        altAddress: jibun || road || '',
        lon, lat,
        sgg: Addr.parse(active.address).sgg || '',
        source: method,
      });
      renderFailList();
    });
  }

  renderFailList();
}

// ====== 4단계: 다운로드 ======
/** 엑셀 시트명은 31자 제한. '_완료' 를 붙일 수 있도록 앞을 자른다. */
function doneSheetName(base, used) {
  const SUFFIX = '_완료';
  const MAX = 31;
  let name = base.slice(0, MAX - SUFFIX.length) + SUFFIX;
  let n = 2;
  while (used.has(name)) {
    const tail = '_' + n + SUFFIX;
    name = base.slice(0, MAX - tail.length) + tail;
    n++;
  }
  return name;
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

$('downloadBtn').addEventListener('click', () => {
  const used = new Set();
  const outNames = [];
  const outSheets = {};
  const renamed = [];

  workbook.SheetNames.forEach((name) => {
    // 원본 시트는 값·구조를 그대로 통과시킨다.
    const origName = uniqueName(name, used);
    used.add(origName);
    outNames.push(origName);
    outSheets[origName] = workbook.Sheets[name];

    const s = sheets.find((x) => x.name === name);
    if (!s || !s.processed || !s.colIdx) return;

    // 바로 뒤에 결과 시트를 붙인다 (A / A_완료 / B / B_완료)
    const dName = doneSheetName(name, used);
    used.add(dName);
    if (dName !== name + '_완료') renamed.push(`${name} -> ${dName}`);

    const ws = XLSX.utils.aoa_to_sheet(s.aoa);
    const oldWs = workbook.Sheets[name];
    if (oldWs['!cols']) ws['!cols'] = oldWs['!cols'];
    if (oldWs['!merges']) ws['!merges'] = oldWs['!merges'];
    if (oldWs['!freeze']) ws['!freeze'] = oldWs['!freeze'];

    outNames.push(dName);
    outSheets[dName] = ws;
  });

  // 대체주소 사전 사본
  if (Dict.size() > 0) {
    const dn = uniqueName('대체주소사전', used);
    used.add(dn);
    outNames.push(dn);
    outSheets[dn] = XLSX.utils.aoa_to_sheet(Dict.toAOA());
  }

  // 처리 요약
  const summary = [['시트', '대상', '주소검색', '장소검색', '사전', '기존값', '미해결']];
  sheets.forEach((s) => {
    if (!s.processed || !s.stats) return;
    const t = s.stats;
    summary.push([s.name, t.total, t.ok, t.place, t.dict, t.skip, t.fail]);
  });
  if (renamed.length) {
    summary.push([]);
    summary.push(['시트명이 31자를 넘어 축약됨']);
    renamed.forEach((r) => summary.push([r]));
  }
  const sn = uniqueName('처리요약', used);
  used.add(sn);
  outNames.push(sn);
  outSheets[sn] = XLSX.utils.aoa_to_sheet(summary);

  XLSX.writeFile({ SheetNames: outNames, Sheets: outSheets }, originalFileName);
});

// ====== 대체주소 사전만 따로 저장 ======
$('dictDownloadBtn').addEventListener('click', () => {
  if (Dict.size() === 0) {
    alert('저장할 사전 항목이 없습니다. 지오코딩을 실행하거나 미해결 건을 보정하면 쌓입니다.');
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet(Dict.toAOA());
  XLSX.writeFile({ SheetNames: ['대체주소사전'], Sheets: { '대체주소사전': ws } }, '대체주소사전.xlsx');
});

})();
