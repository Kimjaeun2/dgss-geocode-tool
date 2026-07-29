/* =========================================================================
   방제지리정보 주소 지오코딩 도구
   - 엑셀 업로드 -> 카카오 주소검색 -> 실패 시 장소검색 폴백 -> 수동 보정 -> 엑셀 저장
   - DB 저장 없음. 모든 처리는 브라우저 메모리에서만 이루어짐.
   ========================================================================= */

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

/** 카카오가 준 WGS84 경도/위도를 선택된 좌표계로 변환 */
function toProjected(lon, lat) {
  const lo = parseFloat(lon), la = parseFloat(lat);
  if (targetCrs === 'EPSG:4326') return { x: lo, y: la };
  const [x, y] = proj4('EPSG:4326', targetCrs, [lo, la]);
  return { x: round(x, 4), y: round(y, 4) };
}
function round(v, d) { const p = Math.pow(10, d); return Math.round(v * p) / p; }

// ====== 전역 상태 ======
let workbook = null;
let originalFileName = 'geocoded.xlsx';
let sheetName = null;
let aoa = [];   // 선택 시트 데이터 (0행 = 헤더)
let colIdx = {};
let reviewList = [];       // 자동 처리 실패/확인필요 항목
let activeIdx = -1;
let stopRequested = false;

let map = null, marker = null, geocoder = null, places = null;

const $ = (id) => document.getElementById(id);
const isNum = (v) => v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));

// ====== 주소 정규화 ======
/** NBSP(\u00a0) 등 비표준 공백 제거, 연속 공백 축약 */
function normalizeAddress(s) {
  return String(s == null ? '' : s)
    .replace(/[\u00a0\u2007\u202f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    resetRun();
    populateSheetSelect();
    populateCrsSelect();
    $('step-mapping').classList.remove('hidden');
    $('step-crs').classList.remove('hidden');
  };
  reader.readAsArrayBuffer(file);
});

/** 새 파일/새 시트를 고를 때 이전 실행 상태 초기화 */
function resetRun() {
  reviewList = [];
  activeIdx = -1;
  stopRequested = false;
  geocodeCache.clear(); // 다시 실행할 때는 이전 실패 결과를 재사용하지 않고 새로 시도
  $('startBtn').disabled = false;
  $('step-progress').classList.add('hidden');
  $('step-fail').classList.add('hidden');
  $('step-download').classList.add('hidden');
  $('crsResult').innerHTML = '';
}

function populateSheetSelect() {
  const sel = $('sheetSelect');
  sel.innerHTML = '';
  workbook.SheetNames.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  });
  // addEventListener 대신 onchange 로 대입해야 파일을 여러 번 올려도 핸들러가 중복되지 않음
  sel.onchange = () => { resetRun(); loadSheet(sel.value); };
  loadSheet(sel.value);
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

function loadSheet(name) {
  sheetName = name;
  aoa = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
  if (aoa.length === 0) aoa = [[]];
  populateColumnSelects(aoa[0] || []);
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

function findOrCreateColumn(name) {
  const header = aoa[0];
  const idx = header.findIndex((h) => String(h).trim() === name);
  if (idx >= 0) return idx;
  header.push(name);
  return header.length - 1;
}

function resolveOutputColumn(selectId, inputId) {
  const val = $(selectId).value;
  if (val !== '__new__') return val === '' ? null : parseInt(val, 10);
  const name = $(inputId).value.trim();
  if (!name) return null;
  return findOrCreateColumn(name);
}

function getAddress(row) {
  const jibun = colIdx.jibun >= 0 ? normalizeAddress(row[colIdx.jibun]) : '';
  const road = colIdx.road >= 0 ? normalizeAddress(row[colIdx.road]) : '';
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

// 같은 주소를 여러 행에서 쓰는 경우 API를 다시 부르지 않도록 결과를 캐시
const geocodeCache = new Map();

/**
 * 한 주소를 지오코딩한다.
 * 지명형: 장소검색만 시도
 * 그 외 : 주소검색(원본) -> 주소검색(변형) -> 장소검색 폴백
 * 장소검색 결과가 1건이면 자동 채택, 여러 건이면 확인 대상으로 넘긴다.
 */
async function geocodeAddress(addr) {
  if (geocodeCache.has(addr)) return geocodeCache.get(addr);
  const result = await geocodeAddressUncached(addr);
  geocodeCache.set(addr, result);
  return result;
}

async function geocodeAddressUncached(addr) {
  const parsed = Addr.parse(addr);
  const outside = [];

  // --- 주소검색 경로 ---
  if (Addr.route(parsed) === 'address') {
    for (const v of Addr.addressVariants(addr)) {
      const r = await callKakaoWithRetry('address', v);
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

  return {
    status: 'fail',
    outside: outside,
    reason: outside.length ? '관할 내 결과 없음' : '검색 결과 없음',
  };
}

// ====== 좌표계 자동 판정 ======
$('detectCrsBtn').addEventListener('click', async () => {
  if (!prepareColumns()) return;
  ensureServices();

  const btn = $('detectCrsBtn');
  btn.disabled = true;
  const out = $('crsResult');
  out.innerHTML = '<div class="status">기존 좌표가 있는 행을 표본으로 검사하는 중...</div>';

  // 기존 x,y 가 숫자이고 주소도 있는 행을 표본으로 수집
  const samples = [];
  for (let i = 1; i < aoa.length && samples.length < 15; i++) {
    const row = aoa[i];
    const addr = getAddress(row);
    if (addr && isNum(row[colIdx.x]) && isNum(row[colIdx.y])) {
      samples.push({ addr, x: parseFloat(row[colIdx.x]), y: parseFloat(row[colIdx.y]) });
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

// ====== 컬럼 준비 ======
function prepareColumns() {
  colIdx.jibun = $('colJibun').value === '' ? -1 : parseInt($('colJibun').value, 10);
  colIdx.road = $('colRoad').value === '' ? -1 : parseInt($('colRoad').value, 10);
  colIdx.x = resolveOutputColumn('colX', 'colXNewName');
  colIdx.y = resolveOutputColumn('colY', 'colYNewName');

  if (colIdx.jibun === -1 && colIdx.road === -1) {
    alert('지번주소 또는 도로명주소 컬럼 중 하나는 선택해야 합니다.'); return false;
  }
  if (colIdx.x === null || colIdx.y === null) {
    alert('결과 X, Y 컬럼을 지정해주세요 (새 컬럼 추가 시 이름도 입력해야 합니다).'); return false;
  }
  if (colIdx.x === colIdx.y) {
    alert('X 컬럼과 Y 컬럼이 같습니다. 다르게 지정해주세요.'); return false;
  }

  colIdx.sojaeji = findOrCreateColumn('소재지');
  colIdx.jibunResult = findOrCreateColumn('지번');
  colIdx.roadResult = findOrCreateColumn('도로명');
  colIdx.supplement = findOrCreateColumn('지오코딩 안된 주소 보충');
  colIdx.lon = findOrCreateColumn('경도(WGS84)');
  colIdx.lat = findOrCreateColumn('위도(WGS84)');
  colIdx.method = findOrCreateColumn('매칭방식');
  return true;
}

function ensureServices() {
  if (!geocoder) geocoder = new kakao.maps.services.Geocoder();
  if (!places) places = new kakao.maps.services.Places();
}

/** 행에 좌표와 주소 정보를 기록 */
function writeRow(row, o) {
  const proj = toProjected(o.lon, o.lat);
  row[colIdx.x] = proj.x;
  row[colIdx.y] = proj.y;
  row[colIdx.lon] = round(parseFloat(o.lon), 7);
  row[colIdx.lat] = round(parseFloat(o.lat), 7);
  if (o.jibun) row[colIdx.jibunResult] = o.jibun;
  if (o.road) row[colIdx.roadResult] = o.road;
  row[colIdx.method] = o.method;
  if (o.usedQuery && o.usedQuery !== o.original) row[colIdx.supplement] = o.usedQuery;
}

// ====== 2단계: 지오코딩 실행 ======
$('stopBtn').addEventListener('click', () => { stopRequested = true; });

$('startBtn').addEventListener('click', async () => {
  if (!prepareColumns()) return;
  ensureServices();
  targetCrs = $('crsSelect').value;

  stopRequested = false;
  reviewList = [];
  geocodeCache.clear();
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  $('step-progress').classList.remove('hidden');

  const targets = [];
  for (let i = 1; i < aoa.length; i++) {
    if (getAddress(aoa[i]) !== '') targets.push(i);
  }
  const total = targets.length;
  let done = 0, ok = 0, place = 0, fail = 0, skip = 0;
  const tick = () => updateProgress(done, total, ok, place, fail, skip);
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

      const rowIndex = targets[myIndex];
      const row = aoa[rowIndex];
      const addr = getAddress(row);

      // 이미 좌표가 "숫자로" 채워진 행은 건너뛴다 (주소 텍스트가 든 컬럼을 오인하지 않도록 숫자 검사)
      if (isNum(row[colIdx.x]) && isNum(row[colIdx.y])) {
        if (!row[colIdx.sojaeji]) row[colIdx.sojaeji] = addr;
        if (!row[colIdx.method]) row[colIdx.method] = '기존값';
        skip++; done++; tick();
        continue;
      }

      row[colIdx.sojaeji] = addr;
      const r = await geocodeAddress(addr);

      if (r.status === 'ok') {
        writeRow(row, Object.assign({}, r, { original: addr }));
        if (r.method === '장소검색(자동)') place++; else ok++;
      } else if (r.status === 'ambiguous') {
        reviewList.push({
          rowIndex, address: addr, candidates: r.candidates,
          outside: r.outside || [], resolved: false, reason: '후보 여러 건',
        });
        fail++;
      } else {
        reviewList.push({
          rowIndex, address: addr, candidates: null,
          outside: r.outside || [], resolved: false, reason: r.reason || '검색 결과 없음',
        });
        fail++;
      }
      done++; tick();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // 병렬 처리라 완료 순서가 뒤섞이므로 보정 목록을 원래 행 순서대로 정렬
  reviewList.sort((a, b) => a.rowIndex - b.rowIndex);

  $('stopBtn').disabled = true;
  $('startBtn').disabled = false;
  $('step-fail').classList.remove('hidden');
  $('step-download').classList.remove('hidden');
  renderFailList();

  if (reviewList.length === 0) {
    $('step-fail').querySelector('.hint').textContent =
      stopRequested ? '중지되었습니다. 처리된 부분까지 저장할 수 있습니다.' : '모든 주소가 자동으로 처리되었습니다.';
  }
});

function updateProgress(done, total, ok, place, fail, skip) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  $('progressFill').style.width = pct + '%';
  $('progressText').textContent = `${done} / ${total}`;
  $('cntOk').textContent = ok;
  $('cntPlace').textContent = place;
  $('cntSkip').textContent = skip;
  $('cntFail').textContent = fail;
}

// ====== 3단계: 미해결 건 보정 ======
$('onlyUnresolved').addEventListener('change', renderFailList);

function renderFailList() {
  const ul = $('failList');
  const onlyUnresolved = $('onlyUnresolved').checked;
  ul.innerHTML = '';

  reviewList.forEach((item, idx) => {
    if (onlyUnresolved && item.resolved) return;
    const li = document.createElement('li');
    li.className = item.resolved ? 'resolved' : '';
    if (idx === activeIdx) li.classList.add('active');
    const outsideCount = (item.outside || []).length;
    const outsideBadge = outsideCount ? `<span class="badge-outside">관할 밖 ${outsideCount}</span>` : '';
    li.innerHTML = `<span class="addr"></span><span class="reason">${item.reason}</span>${outsideBadge}`;
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
  document.querySelectorAll('#failList li').forEach((li) => li.classList.remove('active'));
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
  lis.forEach((li) => li.classList.remove('active'));
  // 필터가 걸려 있을 수 있어 인덱스 대신 주소로 다시 찾음
  const item = reviewList[activeIdx];
  if (!item) return;
  lis.forEach((li) => {
    if (li.querySelector('.addr').textContent === item.address) li.classList.add('active');
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

/** 지도/후보에서 확정한 좌표를 해당 행에 기록 */
function saveCoord(lon, lat, info, method) {
  if (marker) marker.setMap(null);
  marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(lat, lon), map });

  if (activeIdx < 0) return;
  const item = reviewList[activeIdx];
  const row = aoa[item.rowIndex];

  writeRow(row, {
    lon, lat, method,
    jibun: info ? info.jibun : '',
    road: info ? info.road : '',
    usedQuery: info ? info.usedQuery : '',
    original: item.address,
  });

  // 지도를 직접 클릭한 경우 좌표를 역으로 주소로 변환해 지번/도로명을 채운다
  if (!info) {
    geocoder.coord2Address(lon, lat, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result.length) {
        const r = result[0];
        if (r.address) row[colIdx.jibunResult] = r.address.address_name;
        if (r.road_address) row[colIdx.roadResult] = r.road_address.address_name;
      }
    });
  }

  item.resolved = true;
  renderFailList();
}

// ====== 4단계: 다운로드 ======
$('downloadBtn').addEventListener('click', () => {
  const oldWs = workbook.Sheets[sheetName];
  const newWs = XLSX.utils.aoa_to_sheet(aoa);
  // 열 너비/병합 등 기존 시트 속성은 최대한 유지
  if (oldWs['!cols']) newWs['!cols'] = oldWs['!cols'];
  if (oldWs['!merges']) newWs['!merges'] = oldWs['!merges'];
  if (oldWs['!freeze']) newWs['!freeze'] = oldWs['!freeze'];
  workbook.Sheets[sheetName] = newWs;
  XLSX.writeFile(workbook, originalFileName);
});
