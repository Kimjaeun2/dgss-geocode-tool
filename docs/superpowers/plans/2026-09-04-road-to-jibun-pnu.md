# 도로명 → 지번/PNU 변환 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도로명주소를 기준으로 카카오 API에서 정확한 지번주소와 PNU(19자리 필지고유번호)를 뽑아 새 컬럼에 기록하고, 기존 지번주소 컬럼이 있으면 일치 여부까지 비교하는 독립 기능을 `dgss-geocode-tool`에 추가한다.

**Architecture:** 순수 함수 2개(`src/pnu.js`의 PNU 조립, `src/address.js`의 `sameParcel` 필지 비교)를 먼저 `test.html`로 검증하고, 그 위에 `app.js`의 독립 섹션(컬럼 선택 → 변환 실행 → 실패 목록 → 다운로드)을 배선한다. 기존 좌표 지오코딩 파이프라인(`startBtn` 흐름)과 상태를 전혀 공유하지 않는다 — 캐시, 오류 차단기, 중지 플래그, 다운로드를 모두 별도로 둔다.

**Tech Stack:** 순수 JavaScript (ES6, 빌드 없음), SheetJS(XLSX, CDN), 카카오맵 JS SDK(`geocoder.addressSearch`), 브라우저 전용 테스트 하네스(`test.html`).

## Global Constraints

- 빌드 과정을 추가하지 않는다 — 파일만 늘린다 (설계 §3)
- 좌표(X, Y)는 다루지 않는다 (설계 §2 제외)
- VWorld 프로바이더는 사용하지 않는다 — 카카오 응답만으로 충분하다 (설계 §2 제외)
- 기존 지번주소 컬럼의 값·위치를 변경하지 않는다 (설계 §5.2)
- 기존 지오코딩 실행(`startBtn`)의 우선순위 로직·상태(캐시, 오류 차단기, `stopRequested`)를 건드리지 않는다 (설계 §1, §4.1)
- 실패 건은 지도 기반 수동 보정 UI 없이 텍스트 목록으로만 안내한다 (설계 §2 제외)
- `mountain_yn`은 `'0'`/`'1'` 문자열이다 — `'Y'`/`'N'`이 아니다 (설계 §3.1)
- 새 컬럼은 도로명주소 컬럼 바로 뒤에 삽입한다 (설계 §5.2)
- 다운로드는 기존 지오코딩 다운로드와 별도 버튼·별도 파일로 만든다 (설계 §5.3)

참고: 설계 문서는 `docs/superpowers/specs/2026-09-04-road-to-jibun-pnu-design.md`.

---

## Task 1: PNU 조립 순수 함수 (`src/pnu.js`)

**Files:**
- Create: `src/pnu.js`
- Create: `tests/pnu.test.js`
- Modify: `test.html:72-80` (검사 대상 모듈 / 테스트 케이스 스크립트 태그 추가)

**Interfaces:**
- Produces: `global.Pnu.buildPnu(addressObj)` — `addressObj`는 카카오 `geocoder.addressSearch()` 응답의 `result.address` 객체(`{ b_code, mountain_yn, main_address_no, sub_address_no }`). 반환값은 19자리 PNU 문자열, 조립 불가 시 `''`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pnu.test.js` 파일을 만든다:

```js
/* pnu.js 테스트 */

test('buildPnu — 정상 대지 주소', function () {
  eq(Pnu.buildPnu({
    b_code: '4128510300', mountain_yn: '0',
    main_address_no: '2600', sub_address_no: ''
  }), '4128510300' + '0' + '2600' + '0000', '대지, 부번 없음');
});

test('buildPnu — 산 번지는 11번째 자리가 1', function () {
  var pnu = Pnu.buildPnu({
    b_code: '4128510300', mountain_yn: '1',
    main_address_no: '12', sub_address_no: '3'
  });
  eq(pnu, '4128510300' + '1' + '0012' + '0003', '산 12-3');
  eq(pnu.charAt(10), '1', '11번째 자리(인덱스 10)가 산 여부');
});

test('buildPnu — 본번이 한 자리여도 4자리로 zero-pad', function () {
  eq(Pnu.buildPnu({
    b_code: '1111010100', mountain_yn: '0',
    main_address_no: '5', sub_address_no: '0'
  }), '1111010100' + '0' + '0005' + '0000', '본번 5 -> 0005');
});

test('buildPnu — b_code 없으면 빈 문자열', function () {
  eq(Pnu.buildPnu({ mountain_yn: '0', main_address_no: '5', sub_address_no: '0' }), '', 'b_code 없음');
  eq(Pnu.buildPnu(null), '', 'null 입력');
  eq(Pnu.buildPnu(undefined), '', 'undefined 입력');
});

test('buildPnu — mountain_yn이 없으면 대지(0)로 취급', function () {
  var pnu = Pnu.buildPnu({ b_code: '1111010100', main_address_no: '1', sub_address_no: '1' });
  eq(pnu.charAt(10), '0', 'mountain_yn 없음 -> 0');
});
```

`test.html`의 다음 두 블록을 수정한다:

```html
<!-- 검사 대상 모듈 -->
<script src="src/address.js"></script>
<script src="src/gate.js"></script>
<script src="src/dictionary.js"></script>
<script src="src/pnu.js"></script>
```

```html
<!-- 테스트 케이스 -->
<script src="tests/address.test.js"></script>
<script src="tests/gate.test.js"></script>
<script src="tests/dictionary.test.js"></script>
<script src="tests/pnu.test.js"></script>
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

`test.html`을 브라우저로 연다(파일 경로: `C:\Users\PC\git\dgss-geocode-tool\test.html`). `src/pnu.js`가 아직 없으므로 `Pnu is not defined` 예외로 전부 실패해야 한다. 요약 박스가 "실패 N건"으로 빨갛게 뜨는지 확인한다.

- [ ] **Step 3: 최소 구현 작성**

`src/pnu.js`를 만든다:

```js
/* PNU(필지고유번호) 조립
   카카오 geocoder.addressSearch() 응답의 result.address 객체가 이미 갖고 있는
   필드(b_code, mountain_yn, main_address_no, sub_address_no)만으로 19자리
   PNU를 조립한다. 추가 API 호출이 필요 없다.
   API·DOM 의존 없는 순수 함수. test.html 에서 단독 검증한다. */
(function (global) {
  'use strict';

  function pad4(v) {
    var s = String(v == null || v === '' ? '0' : v);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  /**
   * addressObj: 카카오 result.address 객체.
   * b_code(법정동코드 10자리)가 없으면 조립할 수 없으므로 빈 문자열을 반환한다.
   * mountain_yn 은 카카오 문서상 '0'(대지) / '1'(산) 문자열이다.
   */
  function buildPnu(addressObj) {
    if (!addressObj || !addressObj.b_code) return '';
    var mountain = addressObj.mountain_yn === '1' ? '1' : '0';
    var main = pad4(addressObj.main_address_no);
    var sub = pad4(addressObj.sub_address_no);
    return addressObj.b_code + mountain + main + sub;
  }

  global.Pnu = { buildPnu: buildPnu };
})(window);
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

`test.html`을 새로고침한다. 요약 박스가 "전체 통과 — N건"으로 초록색이어야 한다. 이전 테스트(address/gate/dictionary)도 여전히 통과해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/pnu.js tests/pnu.test.js test.html
git commit -m "feat: PNU 조립 순수 함수 추가"
```

---

## Task 2: 기존 지번과의 일치 판정 (`src/address.js`에 `sameParcel` 추가)

**Files:**
- Modify: `src/address.js:268-275` (exports 블록에 `sameParcel` 추가, 함수 정의는 `keywordCandidates` 뒤에 추가)
- Modify: `tests/address.test.js` (파일 끝에 테스트 추가)

**Interfaces:**
- Consumes: `Addr.parse(addr)` (기존 함수, `src/address.js:84`) — 반환 필드 `sgg`, `emd`, `bunji` 사용
- Produces: `global.Addr.sameParcel(addrA, addrB)` — `true`(같은 필지) / `false`(다른 필지) / `null`(판정 보류, 파싱 실패)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/address.test.js` 파일 끝(283번째 줄 뒤)에 추가:

```js

test('sameParcel — 완전히 같은 주소는 true', function () {
  eq(Addr.sameParcel('경기도 고양시 일산서구 대화동 2600', '경기도 고양시 일산서구 대화동 2600'), true, '동일 문자열');
});

test('sameParcel — 시·도 표기 차이는 흡수한다 (경기도 vs 경기)', function () {
  eq(Addr.sameParcel('경기도 고양시 일산서구 대화동 2600', '경기 고양시 일산서구 대화동 2600'), true, '시도 축약형 차이는 무시');
});

test('sameParcel — 번지가 실제로 다르면 false', function () {
  eq(Addr.sameParcel('경기도 고양시 일산서구 대화동 2600', '경기도 고양시 일산서구 대화동 2601'), false, '번지 다름');
});

test('sameParcel — 읍면동이 다르면 false', function () {
  eq(Addr.sameParcel('경기도 고양시 일산서구 대화동 2600', '경기도 고양시 일산서구 주엽동 2600'), false, '동 다름');
});

test('sameParcel — 한쪽이라도 구조를 못 읽으면 null (판정 보류)', function () {
  eq(Addr.sameParcel('', '경기도 고양시 일산서구 대화동 2600'), null, '빈 문자열');
  eq(Addr.sameParcel('한뫼공원', '경기도 고양시 일산서구 대화동 2600'), null, '지명형이라 sgg/emd/bunji가 전부 없음');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

`test.html`을 새로고침한다. `sameParcel` 테스트들이 `Addr.sameParcel is not a function` 예외로 실패해야 한다.

- [ ] **Step 3: 최소 구현 작성**

`src/address.js`의 `keywordCandidates` 함수(약 259~266번째 줄) 바로 뒤, `global.Addr = {...}` 블록(268번째 줄) 바로 앞에 추가:

```js
  /**
   * 두 주소가 같은 필지를 가리키는지 판정한다.
   * 문자열 완전일치 대신 parse() 로 분해한 시·군·구+읍면동+번지만 비교한다 —
   * 시·도 축약형, 공백 같은 표기 차이를 흡수하면서 실제로 다른 필지는
   * 정확히 걸러낸다. 반환: true(같은 필지) / false(다른 필지) / null(판정 보류).
   */
  function sameParcel(addrA, addrB) {
    var key = function (addr) {
      var p = parse(addr);
      return [p.sgg, p.emd, p.bunji].filter(Boolean).join(' ');
    };
    var ka = key(addrA), kb = key(addrB);
    if (!ka || !kb) return null;
    return ka === kb;
  }

```

`global.Addr = {...}` 블록을 다음과 같이 수정한다:

```js
  global.Addr = {
    normalize: normalize,
    parse: parse,
    route: route,
    addressVariants: addressVariants,
    keywordCandidates: keywordCandidates,
    sameParcel: sameParcel
  };
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

`test.html`을 새로고침한다. 요약 박스가 "전체 통과"여야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/address.js tests/address.test.js
git commit -m "feat: 지번 일치 판정 함수(sameParcel) 추가"
```

---

## Task 3: `index.html`에 새 섹션 마크업 추가

**Files:**
- Modify: `index.html:22` (스크립트 태그 추가)
- Modify: `index.html:47` (step-upload 섹션 뒤에 새 섹션 삽입)
- Modify: `app.js:11-21` (missingLibs 검사에 `Pnu` 추가)

**Interfaces:**
- Produces: DOM 요소 `#pnuColRoad`, `#pnuColJibun`, `#pnuNote`, `#pnuStartBtn`, `#pnuStopBtn`, `#pnuProgressWrap`, `#pnuProgressText`, `#pnuBreakerWarning`, `#pnuFailWrap`, `#pnuFailBadge`, `#pnuFailList`, `#pnuDownloadWrap`, `#pnuDownloadBtn` — Task 4~6에서 이 id들로 참조한다.

- [ ] **Step 1: 스크립트 태그 추가**

`index.html:20-22`:

```html
<script src="src/address.js"></script>
<script src="src/gate.js"></script>
<script src="src/dictionary.js"></script>
<script src="src/pnu.js"></script>
```

- [ ] **Step 2: missingLibs 검사에 Pnu 추가**

`app.js:19-21`을 다음과 같이 수정:

```js
if (typeof Addr === 'undefined') missingLibs.push('src/address.js');
if (typeof Gate === 'undefined') missingLibs.push('src/gate.js');
if (typeof Dict === 'undefined') missingLibs.push('src/dictionary.js');
if (typeof Pnu === 'undefined') missingLibs.push('src/pnu.js');
```

- [ ] **Step 3: 새 섹션 마크업 추가**

`index.html`의 `<!-- 1단계: 파일 업로드 -->` 섹션(현재 43~47번째 줄) 바로 뒤에 삽입:

```html
  <!-- 부가 기능: 도로명 -> 지번/PNU 변환 (아래 지오코딩 단계와 완전히 독립) -->
  <section class="card hidden" id="step-pnu">
    <h2>도로명 → 지번/PNU 변환 <span class="badge">독립 기능</span></h2>
    <p class="hint">
      도로명주소는 정확한데 지번주소가 부정확하거나 모호할 때, 도로명주소를 기준으로
      카카오 API에서 지번주소와 PNU(19자리 필지고유번호)를 뽑아 새 컬럼에 기록합니다.
      좌표(X, Y)는 다루지 않으며, 아래 지오코딩 단계와는 별개로 동작합니다.
    </p>
    <div class="grid2">
      <div class="field">
        <label>도로명주소 컬럼</label>
        <select id="pnuColRoad"></select>
      </div>
      <div class="field">
        <label>기존 지번주소 컬럼 <span class="badge">선택 — 일치 여부 비교용</span></label>
        <select id="pnuColJibun"><option value="">(없음)</option></select>
      </div>
    </div>
    <div id="pnuNote" class="status"></div>
    <button id="pnuStartBtn">변환 실행</button>
    <button id="pnuStopBtn" class="danger" disabled>중지</button>

    <div id="pnuProgressWrap" class="hidden">
      <div id="pnuProgressText" class="status">0 / 0</div>
      <div id="pnuBreakerWarning" class="status warn hidden"></div>
    </div>

    <div id="pnuFailWrap" class="hidden">
      <h3>실패 목록 <span id="pnuFailBadge" class="badge"></span></h3>
      <ul id="pnuFailList" class="fail-list"></ul>
    </div>

    <div id="pnuDownloadWrap" class="hidden">
      <button id="pnuDownloadBtn">지번/PNU 결과 다운로드</button>
    </div>
  </section>

```

- [ ] **Step 4: 육안 확인**

로컬 정적 서버를 띄운다 (README 방법 C):

```bash
cd /c/Users/PC/git/dgss-geocode-tool && python -m http.server 8090
```

브라우저로 `http://localhost:8090`을 열고, 페이지 하단 콘솔에 `Pnu is not defined` 등의 오류가 없는지 확인한다. 새 섹션은 아직 `hidden` 클래스가 있어 보이지 않는 것이 정상이다(Task 4에서 업로드 시 노출).

- [ ] **Step 5: 커밋**

```bash
git add index.html app.js
git commit -m "feat: 도로명->지번/PNU 변환 섹션 마크업 추가"
```

---

## Task 4: 컬럼 선택 UI 배선

**Files:**
- Modify: `app.js:150-167` (fileInput 핸들러 — 새 섹션 노출)
- Modify: `app.js:238-251` (`refreshMappingFromBase` 확장)
- Modify: `app.js` (269번째 줄 부근 `populateColumnSelects` 뒤에 `populatePnuColumnSelects` 추가)

**Interfaces:**
- Consumes: `autoGuess(header, selectId, exactKeys, partialKeys)` (`app.js:308`), `baseSheet()` (`app.js:134`), `selectedColumnName(selectId, newNameId)` (`app.js:340`) — 전부 기존 함수 그대로 재사용
- Produces: `populatePnuColumnSelects(header)` — Task 5의 `prepareAllSheetsForPnu()`가 채워진 select 값을 읽는다

- [ ] **Step 1: 파일 업로드 시 섹션 노출**

`app.js:162-164`:

```js
    $('step-mapping').classList.remove('hidden');
    $('step-dict').classList.remove('hidden');
    $('step-crs').classList.remove('hidden');
    $('step-pnu').classList.remove('hidden');
```

- [ ] **Step 2: `populatePnuColumnSelects` 함수 추가**

`app.js`의 `populateColumnSelects` 함수(약 269~302번째 줄) 바로 뒤에 추가:

```js
/**
 * "도로명 -> 지번/PNU 변환" 섹션의 컬럼 선택지를 채운다.
 * 도로명주소 컬럼은 필수(빈 옵션 없음), 지번주소 컬럼은 선택("(없음)" 포함).
 */
function populatePnuColumnSelects(header) {
  const fill = (id, withEmpty) => {
    const sel = $(id);
    sel.innerHTML = withEmpty ? '<option value="">(없음)</option>' : '';
    header.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${XLSX.utils.encode_col(i)} : ${h || '(제목없음)'}`;
      sel.appendChild(opt);
    });
  };
  fill('pnuColRoad', false);
  fill('pnuColJibun', true);

  autoGuess(header, 'pnuColRoad', ['소재지(도로명주소)', '도로명주소'], ['도로명주소']);
  autoGuess(header, 'pnuColJibun', ['소재지(지번주소)', '지번주소'], ['지번주소']);
}
```

- [ ] **Step 3: `refreshMappingFromBase`에서 함께 호출**

`app.js:238-251`을 다음과 같이 수정:

```js
function refreshMappingFromBase() {
  const base = baseSheet();
  const note = $('sheetMapNote');
  if (!base) {
    note.textContent = '처리할 시트를 최소 하나는 선택해주세요.';
    populateColumnSelects([]);
    populatePnuColumnSelects([]);
    return;
  }
  const n = enabledSheets().length;
  note.textContent = n === 1
    ? `컬럼 매핑 기준: "${base.name}"`
    : `컬럼 매핑 기준: "${base.name}" — 나머지 ${n - 1}개 시트는 같은 이름의 컬럼을 찾아 적용합니다.`;
  populateColumnSelects(base.aoa[0] || []);
  populatePnuColumnSelects(base.aoa[0] || []);
}
```

- [ ] **Step 4: 실제 파일로 육안 확인**

`http://localhost:8090`에서 실제 대상지 xlsx 파일(도로명주소 컬럼 포함)을 업로드한다. "도로명 → 지번/PNU 변환" 섹션이 나타나고, "도로명주소 컬럼" select에 "도로명주소"라는 이름의 헤더가 자동으로 선택되어 있는지 확인한다. "기존 지번주소 컬럼"도 "지번주소" 헤더가 있으면 자동 선택되는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add app.js
git commit -m "feat: 도로명->지번/PNU 컬럼 선택 UI 배선"
```

---

## Task 5: 변환 파이프라인 (오류 차단기, 캐시, 실행)

**Files:**
- Modify: `app.js:74-78` (결과 컬럼 이름 상수 추가)
- Modify: `app.js:98-124` (기존 오류 차단기 블록 뒤에 PNU 전용 블록 추가)
- Modify: `app.js:170-186` (`resetRun`에 PNU 상태 초기화 추가)
- Modify: `app.js` (`prepareAllSheets` 뒤에 `prepareAllSheetsForPnu` 추가)
- Modify: `app.js` (`downloadBtn` 핸들러 앞에 `pnuStartBtn`/`pnuStopBtn` 핸들러 추가)

**Interfaces:**
- Consumes: `callKakaoWithRetry(method, query, tries)` (`app.js:380`), `Addr.addressVariants(addr)`, `Addr.normalize(v)`, `Addr.sameParcel(a, b)` (Task 2), `Pnu.buildPnu(addressObj)` (Task 1), `escapeHtml(s)` (`app.js:848`), `selectedColumnName`, `findColumn`, `findOrCreateColumn`, `baseSheet`, `enabledSheets`
- Produces: `sheet.pnuColIdx = { road, jibun, originalLen, roadResult, pnuResult, matchResult }`, `sheet.pnuProcessed`, `sheet.pnuStats = { total, ok, fail }`, 전역 `pnuReviewList = [{ sheetIdx, rowIndex, address, reason }]` — Task 6의 다운로드 로직이 이 값들을 읽는다

- [ ] **Step 1: 결과 컬럼 이름 상수 추가**

`app.js:78` (`const COL_ROAD = '도로명';` 바로 뒤)에 추가:

```js
const COL_PNU_JIBUN = '도로명기준지번';
const COL_PNU_CODE  = 'PNU';
const COL_PNU_MATCH = '지번일치여부';
```

- [ ] **Step 2: 독립 오류 차단기·캐시·변환 함수 추가**

`app.js`의 기존 `noteApiResult` 함수 블록(약 106~124번째 줄) 바로 뒤에 추가:

```js
// ====== 도로명 -> 지번/PNU 변환 전용 상태 (기존 지오코딩과 완전히 독립) ======
const PNU_ERROR_BREAKER_LIMIT = 10;
let pnuConsecutiveErrors = 0;
let pnuBreakerTripped = false;
let pnuStopRequested = false;
let pnuReviewList = []; // { sheetIdx, rowIndex, address, reason }

/** noteApiResult 와 동일한 역할이지만 이 기능 전용 카운터·경고창을 쓴다. */
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
```

- [ ] **Step 3: `resetRun`에 PNU 상태 초기화 추가**

`app.js:170-186`의 `resetRun` 함수 끝부분(`const box = $('breakerWarning'); ...` 다음)에 추가:

```js
function resetRun() {
  reviewList = [];
  activeIdx = -1;
  stopRequested = false;
  consecutiveErrors = 0;
  breakerTripped = false;
  geocodeCache.clear();
  sheets.forEach((s) => { s.processed = false; s.stats = null; s.colIdx = null; });
  $('startBtn').disabled = false;
  $('step-progress').classList.add('hidden');
  $('step-fail').classList.add('hidden');
  $('step-download').classList.add('hidden');
  $('crsResult').innerHTML = '';
  $('sheetProgress').innerHTML = '';
  const box = $('breakerWarning');
  if (box) { box.classList.add('hidden'); box.textContent = ''; }

  // 도로명 -> 지번/PNU 변환 상태도 함께 초기화 (별도 파일/시트 선택 시)
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
  const pnuBox = $('pnuBreakerWarning');
  if (pnuBox) { pnuBox.classList.add('hidden'); pnuBox.textContent = ''; }
}
```

- [ ] **Step 4: `prepareAllSheetsForPnu` 추가**

`app.js`의 `prepareAllSheets` 함수(약 621~672번째 줄) 바로 뒤에 추가:

```js
/**
 * "도로명 -> 지번/PNU 변환" 섹션의 컬럼 선택을 모든 선택 시트에 적용한다.
 * prepareAllSheets 와 같은 패턴이지만 완전히 별도의 sheet.pnuColIdx 에 기록한다.
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
```

- [ ] **Step 5: 실행/중지 버튼 핸들러 추가**

`app.js`의 `downloadBtn` 클릭 핸들러(약 1193번째 줄) 바로 앞에 추가:

```js
// ====== 도로명 -> 지번/PNU 변환 실행 ======
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
    s.pnuStats = { total: 0, ok: 0, fail: 0 };
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
```

- [ ] **Step 6: 실제 파일로 육안 확인**

`http://localhost:8090`에서 파일을 업로드하고 "변환 실행"을 누른다. 콘솔에 JS 예외가 없는지, 진행률 텍스트(`N / M`)가 올라가는지 확인한다. (카카오 도메인이 등록되지 않은 로컬 서버라면 API 호출 자체가 실패해 전부 "검색 결과 없음"으로 실패 목록에 쌓일 수 있다 — 이 경우에도 예외 없이 실패 목록이 정상적으로 렌더링되는지, 연속 10회 오류 시 `pnuBreakerWarning`이 뜨는지를 확인하는 것이 이 단계의 목적이다. 실제 지번/PNU 값이 채워지는지는 Task 7에서 확인한다.)

- [ ] **Step 7: 커밋**

```bash
git add app.js
git commit -m "feat: 도로명->지번/PNU 변환 실행 파이프라인 추가"
```

---

## Task 6: 다운로드

**Files:**
- Modify: `app.js` (`doneSheetName` 함수에 `suffix` 매개변수 추가)
- Modify: `app.js:137-167` (fileInput 핸들러 — `originalBaseName` 저장)
- Modify: `app.js:89-91` (전역 상태에 `originalBaseName` 추가)
- Modify: `app.js` (다운로드 버튼 핸들러 뒤에 `reorderForPnuOutput` + `pnuDownloadBtn` 핸들러 추가)

**Interfaces:**
- Consumes: `sheet.pnuColIdx`, `sheet.pnuProcessed`, `sheet.pnuStats` (Task 5), `uniqueName(base, used)` (`app.js:1182`)
- Produces: 없음 (최종 다운로드 트리거)

- [ ] **Step 1: `doneSheetName`에 `suffix` 매개변수 추가**

기존 `app.js`의 `doneSheetName` 함수(약 1169~1180번째 줄)를 다음으로 교체:

```js
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
```

(기존 `downloadBtn` 핸들러의 `doneSheetName(name, used)` 호출은 세 번째 인자가 없어도 `suffix || '_완료'`로 그대로 동작하므로 수정할 필요 없다.)

- [ ] **Step 2: `originalBaseName` 전역 상태 추가**

`app.js:91` (`let originalFileName = 'geocoded.xlsx';` 바로 뒤)에 추가:

```js
let originalBaseName = 'geocoded'; // 확장자 없는 원본 파일명. PNU 결과 파일명에 사용.
```

`app.js:140` (`originalFileName = file.name.replace(...)` 바로 뒤)에 추가:

```js
  originalFileName = file.name.replace(/\.(xlsx|xls)$/i, '') + '_geocoded.xlsx';
  originalBaseName = file.name.replace(/\.(xlsx|xls)$/i, '');
```

- [ ] **Step 3: `reorderForPnuOutput` + 다운로드 핸들러 추가**

`app.js`의 기존 `$('dictDownloadBtn')` 핸들러(파일 맨 끝, `})();` 바로 앞) 다음에 추가:

```js
// ====== 도로명 -> 지번/PNU 결과만 별도로 다운로드 ======
/**
 * 결과 컬럼을 도로명주소 컬럼 바로 뒤에 삽입하도록 재배치한다.
 * reorderForOutput 과 같은 패턴이지만 sheet.pnuColIdx 를 대상으로 한다.
 */
function reorderForPnuOutput(sheet) {
  const ci = sheet.pnuColIdx;
  const originalLen = ci.originalLen;
  const insertPoint = ci.road + 1;

  const candidates = [ci.roadResult, ci.pnuResult, ci.matchResult]
    .filter((idx) => idx >= 0 && idx >= originalLen);

  const order = [];
  for (let i = 0; i < insertPoint; i++) order.push(i);
  candidates.forEach((idx) => order.push(idx));
  for (let i = insertPoint; i < originalLen; i++) order.push(i);

  return sheet.aoa.map((row) => order.map((idx) => (idx < row.length ? row[idx] : '')));
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

    const ws = XLSX.utils.aoa_to_sheet(reorderForPnuOutput(s));
    const oldWs = workbook.Sheets[name];
    if (oldWs['!freeze']) ws['!freeze'] = oldWs['!freeze'];

    outNames.push(dName);
    outSheets[dName] = ws;
  });

  const summary = [['시트', '대상', '성공', '실패']];
  sheets.forEach((s) => {
    if (!s.pnuProcessed || !s.pnuStats) return;
    const t = s.pnuStats;
    summary.push([s.name, t.total, t.ok, t.fail]);
  });
  const sn = uniqueName('처리요약', used);
  used.add(sn);
  outNames.push(sn);
  outSheets[sn] = XLSX.utils.aoa_to_sheet(summary);

  XLSX.writeFile({ SheetNames: outNames, Sheets: outSheets }, originalBaseName + '_지번PNU.xlsx');
});
```

- [ ] **Step 4: 실제 파일로 육안 확인**

`http://localhost:8090`에서 변환 실행 후 "지번/PNU 결과 다운로드"를 클릭한다. `<원본파일명>_지번PNU.xlsx`가 내려받아지고, 엑셀로 열었을 때:
- 원본 시트 뒤에 `_지번PNU` 시트가 붙어 있고
- 도로명주소 컬럼 바로 뒤에 `도로명기준지번`, `PNU`(, 기존 지번 컬럼을 지정했다면 `지번일치여부`) 컬럼이 삽입돼 있고
- 원본 지번주소 컬럼 값은 그대로인지

확인한다.

- [ ] **Step 5: 커밋**

```bash
git add app.js
git commit -m "feat: 도로명->지번/PNU 결과 별도 다운로드 추가"
```

---

## Task 7: 실사용 환경 스모크 테스트 (사용자 수행)

이 태스크는 코드 변경이 없다 — 카카오 JS SDK가 `http://` 또는 `https://`의 **등록된 도메인**에서만 정상 동작하므로(README 참고), 실제 지번/PNU 값이 올바르게 채워지는지는 이미 좌표 지오코딩이 동작 중인 실제 배포 환경(사내 서버 등)에서 확인해야 한다.

**Files:** 없음 (체크리스트)

- [ ] **Step 1: 실제 배포 환경에 배포**

기존 지오코딩 도구를 이미 쓰고 있는 서버/경로에 이번에 수정된 `index.html`, `app.js`, `src/`, `style.css`를 그대로 덮어쓴다.

- [ ] **Step 2: 도로명주소가 명확한 실제 대상지 xlsx로 실행**

도로명주소가 정확하고 지번주소가 다소 부정확한 실제 행이 섞인 파일로 "도로명 → 지번/PNU 변환"을 실행한다.

- [ ] **Step 3: 결과 확인**

다운로드한 `_지번PNU.xlsx`에서:
- `도로명기준지번` 값이 실제로 맞는 지번주소인지 몇 건 표본으로 대조
- `PNU` 값이 19자리인지, 앞 10자리(법정동코드)가 해당 지역과 맞는지 확인 (법정동코드는 행정안전부 법정동코드 조회 서비스로 대조 가능)
- 지번주소 컬럼을 지정했을 때 `지번일치여부`가 실제로 다른 행(원래 지번이 틀렸던 행)에서 `불일치`로 뜨는지, 맞는 행에서는 `일치`로 뜨는지 확인

- [ ] **Step 4: 문제 발견 시 새 이슈로 기록**

표기 차이(예: 새로운 도로명 패턴)로 오탐/누락이 있으면 `DECISIONS.md` 또는 새 GitHub 이슈에 실제 실패 사례 주소를 기록한다 — `src/address.js`의 회귀 테스트 패턴과 동일하게, 실패한 실제 주소를 테스트 케이스로 고정해야 재발을 막을 수 있다.

---

## Self-Review 메모

- **스펙 커버리지**: 설계 문서 §2(포함 항목) 5개 전부 Task 1, 5, 6에서 구현됨. §3.1(PNU 조립)→Task1, §3.2(일치판정)→Task2, §4(데이터흐름)→Task5, §5(컬럼매핑/출력)→Task4/6, §6(오류처리)→Task5(검색실패/지번매핑없음/일치판정 보류/연속오류), Task5 Step5(기존 지번 없음 시 컬럼 미기록)이 모두 반영됨.
- **타입 일관성**: `sheet.pnuColIdx`의 필드명(`road`, `jibun`, `originalLen`, `roadResult`, `pnuResult`, `matchResult`)이 Task 5(생성)와 Task 6(소비)에서 동일하게 쓰임을 확인함. `Pnu.buildPnu`, `Addr.sameParcel` 시그니처가 Task 1/2(정의)와 Task 5(사용)에서 일치함.
- **플레이스홀더 없음**: 모든 스텝에 실제 코드/명령을 포함시킴 (TODO·TBD 없음).
