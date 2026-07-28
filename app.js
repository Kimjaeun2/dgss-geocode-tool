// ====== 전역 상태 ======
let workbook = null;
let originalFileName = 'geocoded.xlsx';
let sheetName = null;
let aoa = [];          // 선택 시트의 원본 데이터 (배열의 배열, 0행 = 헤더)
let colIdx = { jibun: -1, road: -1, x: -1, y: -1 };
let failList = [];     // [{ rowIndex, address }]
let activeFailIndex = -1;

let map = null;
let marker = null;
let geocoder = null;
let places = null;

const $ = (id) => document.getElementById(id);

// ====== 1단계: 파일 업로드 ======
$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  originalFileName = file.name.replace(/\.(xlsx|xls)$/i, '') + '_geocoded.xlsx';

  const reader = new FileReader();
  reader.onload = (evt) => {
    const data = new Uint8Array(evt.target.result);
    workbook = XLSX.read(data, { type: 'array' });
    $('uploadStatus').textContent = `업로드 완료: ${file.name} (시트 ${workbook.SheetNames.length}개)`;
    populateSheetSelect();
    $('step-mapping').classList.remove('hidden');
  };
  reader.readAsArrayBuffer(file);
});

function populateSheetSelect() {
  const sel = $('sheetSelect');
  sel.innerHTML = '';
  workbook.SheetNames.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => loadSheet(sel.value));
  loadSheet(sel.value);
}

function loadSheet(name) {
  sheetName = name;
  const ws = workbook.Sheets[name];
  aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const header = aoa[0] || [];
  populateColumnSelects(header);
}

function populateColumnSelects(header) {
  const fillSelect = (id, withEmpty) => {
    const sel = $(id);
    sel.innerHTML = withEmpty ? '<option value="">(없음)</option>' : '';
    header.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${XLSX.utils.encode_col(i)} : ${h || '(제목없음)'}`;
      sel.appendChild(opt);
    });
  };
  fillSelect('colJibun', true);
  fillSelect('colRoad', true);
  fillSelect('colX', false);
  fillSelect('colY', false);

  // 헤더 이름으로 자동 추정 매핑 (있으면 편의상 미리 선택해줌)
  autoGuess(header, 'colJibun', ['지번주소', '지번']);
  autoGuess(header, 'colRoad', ['도로명주소', '도로명']);
  autoGuess(header, 'colX', ['x', 'X', '경도']);
  autoGuess(header, 'colY', ['y', 'Y', '위도']);
}

function autoGuess(header, selectId, keywords) {
  const idx = header.findIndex((h) => keywords.some((k) => String(h).includes(k)));
  if (idx >= 0) $(selectId).value = String(idx);
}

// ====== 2단계: 지오코딩 시작 ======
$('startBtn').addEventListener('click', async () => {
  colIdx.jibun = $('colJibun').value === '' ? -1 : parseInt($('colJibun').value, 10);
  colIdx.road = $('colRoad').value === '' ? -1 : parseInt($('colRoad').value, 10);
  colIdx.x = parseInt($('colX').value, 10);
  colIdx.y = parseInt($('colY').value, 10);

  if (colIdx.jibun === -1 && colIdx.road === -1) {
    alert('지번주소 또는 도로명주소 컬럼 중 하나는 선택해야 합니다.');
    return;
  }

  $('startBtn').disabled = true;
  $('step-progress').classList.remove('hidden');
  failList = [];

  if (!geocoder) geocoder = new kakao.maps.services.Geocoder();
  if (!places) places = new kakao.maps.services.Places();

  const dataRows = aoa.slice(1);
  const total = dataRows.filter((r) => getAddress(r) !== '').length;
  let done = 0, ok = 0, fail = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const addr = getAddress(row);
    if (addr === '') continue;

    const result = await geocodeOne(addr);
    if (result.ok) {
      row[colIdx.x] = result.x;
      row[colIdx.y] = result.y;
      ok++;
    } else {
      failList.push({ rowIndex: i + 1, address: addr }); // +1 -> aoa 상의 실제 인덱스(헤더 포함)
      fail++;
    }
    done++;
    updateProgress(done, total, ok, fail);
    await sleep(150); // 카카오 API 호출 제한 대응
  }

  renderFailList();
  $('step-fail').classList.remove('hidden');
  $('step-download').classList.remove('hidden');
  if (failList.length === 0) {
    $('step-fail').querySelector('.hint').textContent = '모든 주소가 자동으로 지오코딩되었습니다.';
  }
});

function getAddress(row) {
  const jibun = colIdx.jibun >= 0 ? String(row[colIdx.jibun] || '').trim() : '';
  const road = colIdx.road >= 0 ? String(row[colIdx.road] || '').trim() : '';
  return jibun !== '' ? jibun : road;
}

function geocodeOne(address) {
  return new Promise((resolve) => {
    geocoder.addressSearch(address, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result.length > 0) {
        resolve({ ok: true, x: result[0].x, y: result[0].y });
      } else {
        resolve({ ok: false });
      }
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function updateProgress(done, total, ok, fail) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  $('progressFill').style.width = pct + '%';
  $('progressText').textContent = `${done} / ${total}`;
  $('cntOk').textContent = ok;
  $('cntFail').textContent = fail;
}

// ====== 3단계: 실패 목록 + 지도 보정 ======
function renderFailList() {
  const ul = $('failList');
  ul.innerHTML = '';
  failList.forEach((item, idx) => {
    const li = document.createElement('li');
    li.textContent = item.address;
    li.dataset.idx = idx;
    li.addEventListener('click', () => selectFailItem(idx));
    ul.appendChild(li);
  });
  if (failList.length > 0) selectFailItem(0);
}

function selectFailItem(idx) {
  activeFailIndex = idx;
  document.querySelectorAll('#failList li').forEach((li) => li.classList.remove('active'));
  document.querySelectorAll('#failList li')[idx].classList.add('active');

  ensureMap();
  const addr = failList[idx].address;
  $('searchBox').value = addr;
  runKeywordSearch(addr);
}

function ensureMap() {
  if (map) return;
  const container = $('map');
  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.6584, 126.7756), // 기본: 고양시 일산서구 부근
    level: 5,
  });
  kakao.maps.event.addListener(map, 'click', (mouseEvent) => {
    const latlng = mouseEvent.latLng;
    setMarkerAndSave(latlng.getLng(), latlng.getLat());
  });
}

$('searchBtn').addEventListener('click', () => {
  const kw = $('searchBox').value.trim();
  if (kw) runKeywordSearch(kw);
});

function runKeywordSearch(keyword) {
  places.keywordSearch(keyword, (data, status) => {
    const ul = $('searchResults');
    ul.innerHTML = '';
    if (status !== kakao.maps.services.Status.OK || data.length === 0) {
      const li = document.createElement('li');
      li.textContent = '검색 결과가 없습니다. 지도를 직접 클릭해서 좌표를 지정하세요.';
      ul.appendChild(li);
      return;
    }
    data.forEach((place) => {
      const li = document.createElement('li');
      li.textContent = `${place.place_name} - ${place.road_address_name || place.address_name}`;
      li.addEventListener('click', () => {
        map.setCenter(new kakao.maps.LatLng(place.y, place.x));
        map.setLevel(3);
        setMarkerAndSave(place.x, place.y);
      });
      ul.appendChild(li);
    });
    // 첫 결과로 지도 중심 이동
    map.setCenter(new kakao.maps.LatLng(data[0].y, data[0].x));
  });
}

function setMarkerAndSave(x, y) {
  if (marker) marker.setMap(null);
  marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(y, x), map });

  if (activeFailIndex < 0) return;
  const item = failList[activeFailIndex];
  const row = aoa[item.rowIndex];
  row[colIdx.x] = x;
  row[colIdx.y] = y;

  const li = document.querySelectorAll('#failList li')[activeFailIndex];
  li.classList.add('resolved');
}

// ====== 4단계: 다운로드 ======
$('downloadBtn').addEventListener('click', () => {
  const newWs = XLSX.utils.aoa_to_sheet(aoa);
  workbook.Sheets[sheetName] = newWs;
  XLSX.writeFile(workbook, originalFileName);
});
