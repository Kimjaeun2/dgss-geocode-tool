# 지오코딩 Phase 2 — 목표 변경 반영 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ① 어떤 쿼리가 어디서 실패했는지 알 수 있는 진단 로그를 남기고, ② 노이즈가 낀 주소도 모든 프로바이더가 깨끗한 재조립본으로 검색하게 하고, ③ 정확한 지번 검색이 실패했을 때 인접 지번(±3)을 대체주소 후보로 찾아 사람이 확정하게 하고, ④ 대체주소 사용 여부와 결과 컬럼 삽입 위치를 사용자가 고를 수 있게 하고, ⑤ VWorld 경로의 좌표계 이중 변환을 없앤다.

**Architecture:** 기존 `src/address.js`(순수 함수)에 구조 재조립·인접 지번 생성 함수를 추가하고, `app.js`의 `geocodeAddressUncached`를 단계적으로 고쳐 나간다. 새 폴백은 절대 자동 확정하지 않고 `reviewList`에 전용 항목으로 쌓여 검수 UI에 새 후보 목록으로 표시된다. 설정값(진단 모드, 대체주소 사용 여부, 컬럼 위치)은 기존 UI 단계에 컨트롤을 추가하고 실행 시작 시점에 한 번 읽어 고정한다.

**Tech Stack:** 기존과 동일 — 순수 JavaScript(ES6, `app.js`) + ES5 순수 모듈(`src/*.js`), 빌드 없음, `test.html`로 순수 모듈만 단독 검증.

## Global Constraints

- **빌드 과정 없음.** 번들러·npm 의존 추가 금지. 모든 파일은 `<script>` 태그 + 전역 객체 방식 유지.
- **작업 브랜치는 `claude`.** `main`은 건드리지 않는다.
- **인접 지번 탐색 범위는 ±3으로 고정한다.** (사용자 확정 사항 — 설정 가능하게 만들지 않는다. YAGNI)
- **인접 지번 대체는 절대 자동 확정하지 않는다.** 몇 건이 나오든 항상 검수 목록에 올리고 사람이 클릭해야 확정된다. (사용자 확정 사항)
- `src/address.js`, `src/gate.js`, `src/dictionary.js`는 계속 API·DOM 비의존 순수 모듈로 유지하고 `test.html`로 검증한다.
- 기존 파일의 줄바꿈(CRLF)과 코드 스타일(`app.js`는 ES6 화살표 함수·`const`/`let`, `src/*.js`는 ES5)을 그대로 따른다.
- 기존 동작을 조용히 바꾸지 않는다 — 새로 추가하는 토글(지명형 대체주소 사용, 인접지번 대체주소 사용)은 **기본값 ON**, 진단 모드는 **기본값 OFF**로 두어 현재 사용자가 체감하는 동작이 그대로 유지되게 한다.
- **Task 1~3을 먼저 끝낸다.** Task 1(진단 로그)이 없으면 이후 태스크의 효과를 측정할 수단이 없다.

---

## 배경: 실측으로 확인된 사실 (2026-08-12)

`'경기도 고양시 일산서구  민원 킨텍스로240'`이 카카오맵 웹에서는 검색되는데 이 도구에서는 실패한다는 제보를 받고, 파서를 Node로 직접 돌려 확인했다.

```
parse : {sido:'경기도', sgg:'고양시 일산서구', emd:null,
         road:'킨텍스로', bunji:'240', rest:null, suffix:null}
route : address

주소검색에 실제로 던지는 쿼리:
  1. "경기도 고양시 일산서구 민원 킨텍스로240"
  2. "경기도 고양시 일산서구 민원 킨텍스로 240"
  3. "경기도 고양시 일산서구 킨텍스로 240"   ← 이미 깨끗함
```

**파싱은 이미 정상이다.** `skipNoiseWords`가 `'민원'`을 걸러내고 3번 변형을 만들어 카카오에 보내고 있다. 따라서 파서를 더 고치는 방향은 틀렸다. 대신 다음 두 결함이 코드에서 확정적으로 확인됐다.

- **`app.js:443` — VWorld에는 깨끗한 변형이 전혀 안 간다.** `window.VWorld.getcoord(addr, t)`가 `addressVariants` 루프 **밖**에 있어 원본 raw만 전달된다. VWorld는 정형 주소만 받는 엔진이라 `'민원'`이 낀 문자열로는 반드시 실패한다. → Task 2에서 해소.
- **`app.js:480` — 주소검색이 전부 실패하면 장소검색에 더러운 원본이 간다.** `rest`가 `null`이라 `keywordCandidates`가 빈 배열을 반환하고, `queries = [Addr.normalize(addr)]`로 원본이 그대로 쓰인다. → Task 3에서 해소.

세 번째 가능성(카카오 `addressSearch`가 웹 통합검색과 다른 엔진이라 `킨텍스로 240`이라는 건물번호가 도로명 DB에 없으면 그냥 실패)은 API 키 없이 검증할 수 없다. Task 1의 진단 로그로 판별하고, 이 경우라면 Task 6의 인접 지번 폴백(`rebuildWithBunji`가 `road`를 살리므로 `킨텍스로 237~243`을 시도)이 커버한다.

**기대치**: 카카오맵 웹 통합검색과 100% 동일한 결과는 어떤 공개 API로도 재현할 수 없다. 웹 검색창은 오타보정·부분일치·자체 랭킹이 들어간 비공개 엔진이다. 이 계획은 격차를 줄이는 것이 목표이며, 남는 건은 검수 목록에서 사람이 처리한다.

---

## File Structure

| 파일 | 변경 내용 |
|---|---|
| `src/address.js` | `rebuild(parsed)`, `bunjiNeighbors(bunji)`, `rebuildWithBunji(parsed, bunji)` 순수 함수 추가 |
| `tests/address.test.js` | 위 세 함수의 회귀 테스트 추가 |
| `src/providers/vworld.js` | `getcoord()`에 `crs` 파라미터 추가, 응답에 `crs` 필드 포함 |
| `app.js` | 진단 로그, 프로바이더 공통 재조립본 적용, 장소검색 쿼리 정리, 설정 토글, 인접 지번 폴백, 전용 검수 UI, 컬럼 삽입 위치, VWorld 이중 변환 제거 |
| `index.html` | 진단 모드 체크박스, 대체주소 토글 2개, 결과 컬럼 삽입 위치 선택, 검수 사유 필터 옵션 |
| `style.css` | 인접 지번 후보 UI 스타일 |
| `DESIGN.md`, `CHANGELOG.md`, `PROGRESS.md`, `DECISIONS.md` | 이번 변경 사항 기록 |

---

## Task 1: 진단 로그 (어디서 실패했는지 남긴다)

지금은 "안 된다"만 알고 어느 프로바이더의 어느 쿼리에서 안 되는지 모른다. 이 태스크 없이 나머지를 고치면 전부 추측 위에 쌓는 것이 된다.

**Files:**
- Modify: `app.js`
- Modify: `index.html`

**Interfaces:**
- Produces:
  - `noteAttempt(original: string, provider: string, query: string, state: string) → void` — 진단 모드가 꺼져 있으면 아무것도 하지 않는다. Task 2·3·6이 호출한다.
  - 결과 워크북에 `진단로그` 시트 (컬럼: `원본주소` / `프로바이더` / `검색어` / `결과`)

---

- [ ] **Step 1: 진단 모드 체크박스를 추가한다**

`index.html`에서 다음 블록을 찾는다:

```html
    <div class="field" style="max-width:280px">
      <label>동시 처리 수 (빠르지만 너무 높이면 오류가 늘 수 있음)</label>
```

바로 **앞에** 다음을 삽입한다:

```html
    <div class="field">
      <label>진단</label>
      <label class="checkbox">
        <input type="checkbox" id="debugMode">
        시도한 검색어와 결과를 전부 기록 (결과 엑셀에 <code>진단로그</code> 시트로 저장됩니다)
      </label>
    </div>
```

- [ ] **Step 2: 로그 수집기를 추가한다**

`app.js`에서 다음 블록을 찾는다:

```js
let map = null, marker = null, geocoder = null, places = null;
```

바로 **앞에** 다음을 삽입한다:

```js
// ====== 진단 로그 ======
// "안 된다"만 알고 어디서 안 되는지 모르는 상태를 없애기 위한 기록이다.
// 어떤 프로바이더에 어떤 검색어를 던져 어떤 결과가 나왔는지 그대로 남긴다.
const DEBUG = { enabled: false, log: [] };
// ponytail: 상한 없는 배열은 대량 처리(2000행 x 시도 10회)에서 메모리를 먹는다.
// 5만 건에서 끊는다 — 진단은 앞부분만 봐도 원인 판별에 충분하다.
const DEBUG_LIMIT = 50000;

/** 지오코딩 시도 1회를 기록한다. 진단 모드가 꺼져 있으면 아무것도 하지 않는다. */
function noteAttempt(original, provider, query, state) {
  if (!DEBUG.enabled || DEBUG.log.length >= DEBUG_LIMIT) return;
  DEBUG.log.push({ original: original, provider: provider, query: query, state: state });
}
```

- [ ] **Step 3: 실행 시작·초기화 시점에 배선한다**

`app.js`의 `resetRun` 함수에서 다음 줄을 찾는다:

```js
  geocodeCache.clear(); // 다시 실행할 때는 이전 결과를 재사용하지 않고 새로 시도
```

바로 **뒤에** 다음을 추가한다:

```js
  DEBUG.log = [];
```

`app.js`의 `startBtn` 핸들러에서 다음 줄을 찾는다:

```js
  targetCrs = $('crsSelect').value;
```

바로 **뒤에** 다음을 추가한다:

```js
  DEBUG.enabled = $('debugMode').checked;
```

- [ ] **Step 4: 기존 카카오 호출부에 기록을 붙인다**

`app.js`의 `geocodeAddressUncached` 안에서 다음 두 줄을 찾는다 (주소검색 루프):

```js
      const r = await callKakaoWithRetry('address', v);
      noteApiResult(r.state);
```

다음으로 교체한다:

```js
      const r = await callKakaoWithRetry('address', v);
      noteApiResult(r.state);
      noteAttempt(addr, 'kakao:address', v, r.state);
```

같은 함수에서 다음 두 줄을 찾는다 (장소검색 루프):

```js
    const r = await callKakaoWithRetry('place', v);
    noteApiResult(r.state);
```

다음으로 교체한다:

```js
    const r = await callKakaoWithRetry('place', v);
    noteApiResult(r.state);
    noteAttempt(addr, 'kakao:place', v, r.state);
```

같은 함수의 VWorld 장소검색 루프에서 다음 두 줄을 찾는다:

```js
      const r = await window.VWorld.search(v);
      // getcoord 와 같은 이유로 VWorld 오류는 차단기에 반영하지 않는다.
```

다음으로 교체한다:

```js
      const r = await window.VWorld.search(v);
      noteAttempt(addr, 'vworld:place', v, r.state);
      // getcoord 와 같은 이유로 VWorld 오류는 차단기에 반영하지 않는다.
```

(VWorld `getcoord` 호출부의 기록은 Task 2에서 그 블록을 재작성하며 함께 넣는다.)

- [ ] **Step 5: 결과 워크북에 진단로그 시트를 붙인다**

`app.js`의 `downloadBtn` 핸들러에서 다음 블록을 찾는다:

```js
  // 처리 요약
  const summary = [['시트', '대상', '주소검색', '장소검색', '사전', '기존값', '미해결', '중복제거']];
```

바로 **앞에** 다음을 삽입한다:

```js
  // 진단 로그 (진단 모드로 실행한 경우에만 쌓인다)
  if (DEBUG.log.length) {
    const dbgRows = [['원본주소', '프로바이더', '검색어', '결과']];
    DEBUG.log.forEach((e) => dbgRows.push([e.original, e.provider, e.query, e.state]));
    const dn3 = uniqueName('진단로그', used);
    used.add(dn3);
    outNames.push(dn3);
    outSheets[dn3] = XLSX.utils.aoa_to_sheet(dbgRows);
  }

```

- [ ] **Step 6: 순수 모듈 테스트가 영향받지 않는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 기존과 동일하게 전체 통과 (이 태스크는 `app.js`/`index.html`만 건드렸다).

- [ ] **Step 7: 브라우저로 확인한다**

`python -m http.server 8090`으로 띄운 뒤 `http://localhost:8090/index.html`에서:
1. 진단 모드를 **켜고** 문제의 주소(`경기도 고양시 일산서구  민원 킨텍스로240`)가 든 엑셀로 실행
2. 다운로드한 결과 엑셀에 `진단로그` 시트가 있고, 그 주소에 대해 `kakao:address` 행이 3건(변형 3종) 있는지 확인
3. **각 행의 `결과` 값을 확인한다.** `경기도 고양시 일산서구 킨텍스로 240`이 `zero`면 → 카카오 도로명 DB에 그 건물번호가 없다는 뜻이고, Task 6의 인접 지번 폴백이 필요한 케이스다. `error`면 → 쿼터/네트워크 문제다. 이 판별이 이 태스크의 목적이다.

- [ ] **Step 8: 커밋한다**

```bash
git add app.js index.html
git commit -m "feat: 지오코딩 시도 진단 로그 추가 (결과 엑셀에 진단로그 시트)"
```

---

## Task 2: 구조 재조립본을 모든 프로바이더에 공통 적용

확인된 결함: VWorld는 `addressVariants` 루프 밖에서 호출돼 노이즈가 낀 원본만 받는다. `parse()`가 이미 구조를 읽어냈으므로 그 결과로 재조립한 정형 주소를 함께 시도한다.

**Files:**
- Modify: `src/address.js`
- Modify: `tests/address.test.js`
- Modify: `app.js`

**Interfaces:**
- Consumes: `noteAttempt` (Task 1)
- Produces: `Addr.rebuild(parsed: object) → string` — `sido/sgg/emd/road/bunji`를 순서대로 이어붙인 정형 주소. `rest`(지명)와 노이즈 단어는 포함하지 않는다. Task 3·4가 재사용한다.

---

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`tests/address.test.js` 파일 **끝에** 추가:

```js
test('rebuild — 노이즈 단어를 뺀 정형 주소를 재조립한다 (실측 결함 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구  민원 킨텍스로240');
  eq(Addr.rebuild(p), '경기도 고양시 일산서구 킨텍스로 240', "'민원' 이 빠지고 번지가 분리된다");
});

test('rebuild — 읍면동 + 번지', function () {
  var p = Addr.parse('경기도 고양시 일산서구 대화동 2600');
  eq(Addr.rebuild(p), '경기도 고양시 일산서구 대화동 2600', '그대로 재조립');
});

test('rebuild — 지명(rest)은 포함하지 않는다', function () {
  var p = Addr.parse('경기도 고양시 일산서구 한뫼공원주변');
  eq(Addr.rebuild(p), '경기도 고양시 일산서구', 'rest 와 suffix 는 빠진다');
});

test('rebuild — 빈 파싱 결과는 빈 문자열', function () {
  eq(Addr.rebuild(Addr.parse('')), '', '빈 입력');
  eq(Addr.rebuild(null), '', 'null 입력');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 위 4개 그룹이 `FAIL ... (예외)`로 실패하고 상세에 `Addr.rebuild is not a function`이 표시된다.

- [ ] **Step 3: `rebuild`를 구현한다**

`src/address.js`에서 `global.Addr = {` 줄 **바로 앞에** 삽입:

```js
  /**
   * parse() 가 읽어낸 구조를 정형 주소 문자열로 재조립한다.
   * canonicalize() 와 달리 시·도를 축약하지 않고 rest(지명)도 붙이지 않는다 —
   * 이건 "같은 주소인가?" 판정용이 아니라 지오코더에 보낼 검색어를 만드는 용도다.
   * parse() 가 노이즈 단어('민원' 등)를 이미 건너뛰었으므로, 이 결과는 원본에
   * 섞여 있던 참고메모가 제거된 깨끗한 주소가 된다.
   */
  function rebuild(parsed) {
    if (!parsed) return '';
    var parts = [];
    if (parsed.sido) parts.push(parsed.sido);
    if (parsed.sgg) parts.push(parsed.sgg);
    if (parsed.emd) parts.push(parsed.emd);
    if (parsed.road) parts.push(parsed.road);
    if (parsed.bunji) parts.push(parsed.bunji);
    return parts.join(' ');
  }

```

export 블록을 다음으로 교체:

```js
  global.Addr = {
    normalize: normalize,
    canonicalize: canonicalize,
    parse: parse,
    route: route,
    rebuild: rebuild,
    addressVariants: addressVariants,
    keywordCandidates: keywordCandidates
  };
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 전체 통과, 실패 0건.

- [ ] **Step 5: VWorld 호출을 재조립본까지 시도하도록 고친다**

`app.js`의 `geocodeAddressUncached`에서 다음 블록을 찾는다:

```js
    if (vworldOn) {
      for (const t of ['PARCEL', 'ROAD']) {
        const r = await window.VWorld.getcoord(addr, t);
        // VWorld 오류는 연속 오류 차단기에 반영하지 않는다 — VWorld는 보조
        // 프로바이더라 서버 장애(502 등)가 있어도 카카오로 계속 진행해야
        // 하는데, 여기서 카운트하면 VWorld만 잠깐 죽어도 카카오는 멀쩡한데
        // 전체 작업이 멈춰버린다.
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
```

다음으로 교체한다:

```js
    if (vworldOn) {
      // VWorld 는 정형 주소만 받는 엔진이라 '민원' 같은 노이즈가 낀 원본으로는
      // 반드시 실패한다. 예전에는 원본만 넘기고 있어서, parse() 가 구조를 이미
      // 읽어냈는데도 VWorld 는 깨끗한 주소를 볼 기회가 없었다.
      // 재조립본이 원본과 같으면 중복 제거되어 호출 횟수는 그대로다.
      const vqueries = [];
      [Addr.normalize(addr), Addr.rebuild(parsed)].forEach((q) => {
        if (q && vqueries.indexOf(q) === -1) vqueries.push(q);
      });

      for (const vq of vqueries) {
        for (const t of ['PARCEL', 'ROAD']) {
          const r = await window.VWorld.getcoord(vq, t);
          noteAttempt(addr, 'vworld:' + t, vq, r.state);
          // VWorld 오류는 연속 오류 차단기에 반영하지 않는다 — VWorld는 보조
          // 프로바이더라 서버 장애(502 등)가 있어도 카카오로 계속 진행해야
          // 하는데, 여기서 카운트하면 VWorld만 잠깐 죽어도 카카오는 멀쩡한데
          // 전체 작업이 멈춰버린다.
          if (r.state === 'ok') {
            return {
              status: 'ok',
              method: t === 'PARCEL' ? '주소검색(VWorld:지번)' : '주소검색(VWorld:도로명)',
              lon: r.lon, lat: r.lat, crs: r.crs,
              jibun: t === 'PARCEL' ? r.refinedText : '',
              road: t === 'ROAD' ? r.refinedText : '',
              usedQuery: vq,
            };
          }
        }
      }
    }
```

(`crs: r.crs`는 Task 9까지는 `undefined`라 `writeRow`의 동작이 지금과 같다. Task 9에서 실제 값이 채워진다.)

**쿼터 영향**: 주소당 VWorld 호출이 최대 2회 → 4회로 늘 수 있다. 다만 원본이 이미 깨끗하면 중복 제거되어 2회 그대로다. VWorld 일 한도는 40,000건이므로, 1회 처리량이 이에 근접한다면 Task 1의 진단로그로 실제 호출 분포를 먼저 확인한다.

- [ ] **Step 6: 커밋한다**

```bash
git add src/address.js tests/address.test.js app.js
git commit -m "fix: VWorld 에도 노이즈 제거된 재조립 주소를 시도하도록 수정"
```

---

## Task 3: 주소검색 실패 시 장소검색 쿼리를 정리

확인된 결함: `rest`가 없는 정형 주소(`킨텍스로 240` 같은)가 주소검색에서 전부 실패하면, 장소검색에 노이즈가 낀 **원본 문자열**이 그대로 들어가 사실상 반드시 0건이 된다.

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `Addr.rebuild` (Task 2)
- Produces: 없음 (기존 `queries` 변수의 내용만 개선)

---

- [ ] **Step 1: 폴백 쿼리 조립을 고친다**

`app.js`의 `geocodeAddressUncached`에서 다음 블록을 찾는다:

```js
  // 주소검색 경로였다가 전부 실패한 경우에도 원본 문자열로 한 번 더 시도한다.
  const keywords = Addr.keywordCandidates(parsed);
  const queries = keywords.length ? keywords : [Addr.normalize(addr)];
```

다음으로 교체한다:

```js
  // 주소검색 경로였다가 전부 실패한 경우에도 한 번 더 시도한다.
  // 예전에는 이때 노이즈가 낀 원본을 그대로 던져서 사실상 반드시 0건이었다
  // ('경기도 고양시 일산서구 민원 킨텍스로240'). 지명(rest)이 없어
  // keywordCandidates 가 빈 배열을 주는 정형 주소가 전부 이 경로를 탄다.
  // 재조립본을 먼저 시도하고, 원본은 뒤에 남겨 최후의 수단으로만 쓴다.
  const keywords = Addr.keywordCandidates(parsed);
  const queries = [];
  (keywords.length ? keywords : [Addr.rebuild(parsed), Addr.normalize(addr)])
    .forEach((q) => { if (q && queries.indexOf(q) === -1) queries.push(q); });
```

- [ ] **Step 2: 순수 모듈 테스트가 영향받지 않는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 전체 통과 (이 태스크는 `app.js`만 건드렸다).

- [ ] **Step 3: 진단로그로 효과를 확인한다**

Task 1 Step 7과 같은 방식으로 진단 모드를 켜고 실행한 뒤, 결과 엑셀의 `진단로그` 시트에서 문제 주소의 `kakao:place` 행 `검색어`가 `경기도 고양시 일산서구 킨텍스로 240`(재조립본)으로 바뀌었는지 확인한다. 예전에는 `경기도 고양시 일산서구 민원 킨텍스로240`이었다.

- [ ] **Step 4: 커밋한다**

```bash
git add app.js
git commit -m "fix: 주소검색 실패 후 장소검색 쿼리에 노이즈 제거된 재조립 주소 사용"
```

---

## Task 4: 인접 지번 생성 순수 함수

**Files:**
- Modify: `src/address.js`
- Modify: `tests/address.test.js`

**Interfaces:**
- Consumes: `Addr.rebuild` (Task 2)
- Produces:
  - `Addr.bunjiNeighbors(bunji: string) → Array<{bunji: string, diff: number}>` — 가까운 순서(diff 1→2→3), 0 이하 제외
  - `Addr.rebuildWithBunji(parsed: object, bunji: string) → string` — `sido/sgg/emd/road`는 그대로 두고 번지만 교체해 재조립

---

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`tests/address.test.js` 파일 **끝에** 추가:

```js
test('bunjiNeighbors — 부번이 있으면 부번만 가까운 순서로 바꾼다', function () {
  eq(Addr.bunjiNeighbors('130-4'), [
    { bunji: '130-3', diff: 1 }, { bunji: '130-5', diff: 1 },
    { bunji: '130-2', diff: 2 }, { bunji: '130-6', diff: 2 },
    { bunji: '130-1', diff: 3 }, { bunji: '130-7', diff: 3 }
  ], '130-4 이웃 6개, 가까운 차이부터');
});

test('bunjiNeighbors — 0 이하가 되는 후보는 제외한다', function () {
  eq(Addr.bunjiNeighbors('130-2'), [
    { bunji: '130-1', diff: 1 }, { bunji: '130-3', diff: 1 },
    { bunji: '130-4', diff: 2 }, { bunji: '130-5', diff: 3 }
  ], '130-2-2=0, 130-2-3=-1 은 제외되고 나머지만 남는다');
});

test('bunjiNeighbors — 부번이 없으면 본번을 바꾼다', function () {
  eq(Addr.bunjiNeighbors('130'), [
    { bunji: '129', diff: 1 }, { bunji: '131', diff: 1 },
    { bunji: '128', diff: 2 }, { bunji: '132', diff: 2 },
    { bunji: '127', diff: 3 }, { bunji: '133', diff: 3 }
  ], '본번 130 이웃');
});

test('bunjiNeighbors — 산 번지도 처리한다', function () {
  eq(Addr.bunjiNeighbors('산 12-3'), [
    { bunji: '산 12-2', diff: 1 }, { bunji: '산 12-4', diff: 1 },
    { bunji: '산 12-1', diff: 2 }, { bunji: '산 12-5', diff: 2 },
    { bunji: '산 12-6', diff: 3 }
  ], '산 12-3-3=0 은 제외, 나머지 5개');
});

test('bunjiNeighbors — 빈 값은 빈 배열', function () {
  eq(Addr.bunjiNeighbors(''), [], '빈 문자열');
  eq(Addr.bunjiNeighbors(null), [], 'null');
});

test('rebuildWithBunji — 행정구역은 두고 번지만 교체한다', function () {
  var p = Addr.parse('경기도 고양시 일산서구 대화동 130-4');
  eq(Addr.rebuildWithBunji(p, '130-3'), '경기도 고양시 일산서구 대화동 130-3', '번지만 교체');
});

test('rebuildWithBunji — 도로명 건물번호도 교체된다 (킨텍스로 케이스)', function () {
  var p = Addr.parse('경기도 고양시 일산서구  민원 킨텍스로240');
  eq(Addr.rebuildWithBunji(p, '237'), '경기도 고양시 일산서구 킨텍스로 237',
     '노이즈가 빠진 채로 건물번호만 교체된다');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 위 7개 그룹이 `FAIL ... (예외)`로 실패하고, 상세에 `Addr.bunjiNeighbors is not a function`이 표시된다.

- [ ] **Step 3: 함수를 구현한다**

`src/address.js`에서 `global.Addr = {` 줄 **바로 앞에** 삽입:

```js
  /** 지번 문자열에서 끝의 숫자 조각(부번, 없으면 본번)과 그 앞부분을 분리한다.
   * '130-4' -> {head:'130-', num:4}, '130' -> {head:'', num:130},
   * '산 12-3' -> {head:'산 12-', num:3} */
  function splitLastNumber(bunji) {
    var m = String(bunji).match(/^(.*?)(\d+)$/);
    if (!m) return null;
    return { head: m[1], num: parseInt(m[2], 10) };
  }

  /**
   * 번지의 마지막 숫자 조각(부번이 있으면 부번, 없으면 본번)을 ±1~±3 범위에서
   * 바꾼 이웃 지번을 가까운 순서로 만든다. 0 이하가 되는 후보는 제외한다.
   * 정확한 지번 검색이 실패했을 때만 쓰는 후보 생성기다.
   *
   * 주의: 지번이 순차적으로 붙어 있다고 해서 실제 필지 위치가 인접하다는
   * 보장은 전혀 없다(분필·합필 이력에 따라 다르다). 여기서 만든 후보는
   * "검색해볼 값"일 뿐이며, 최종 채택은 반드시 사람이 지도에서 확인해야 한다
   * — 이 함수를 쓰는 쪽(app.js)은 절대 자동 확정하면 안 된다.
   */
  function bunjiNeighbors(bunji) {
    if (!bunji) return [];
    var s = splitLastNumber(bunji);
    if (!s) return [];
    var out = [];
    [1, 2, 3].forEach(function (d) {
      if (s.num - d > 0) out.push({ bunji: s.head + (s.num - d), diff: d });
      out.push({ bunji: s.head + (s.num + d), diff: d });
    });
    return out;
  }

  /** rebuild() 와 같되 번지만 다른 값으로 바꿔 재조립한다. */
  function rebuildWithBunji(parsed, bunji) {
    if (!parsed) return '';
    return rebuild({
      sido: parsed.sido, sgg: parsed.sgg, emd: parsed.emd,
      road: parsed.road, bunji: bunji
    });
  }

```

export 블록을 다음으로 교체:

```js
  global.Addr = {
    normalize: normalize,
    canonicalize: canonicalize,
    parse: parse,
    route: route,
    rebuild: rebuild,
    addressVariants: addressVariants,
    keywordCandidates: keywordCandidates,
    bunjiNeighbors: bunjiNeighbors,
    rebuildWithBunji: rebuildWithBunji
  };
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 전체 통과(초록색), 실패 0건.

- [ ] **Step 5: 커밋한다**

```bash
git add src/address.js tests/address.test.js
git commit -m "feat: 인접 지번(±3) 후보 생성 순수 함수 추가"
```

---

## Task 5: 대체주소 사용 여부 토글 (설정 배선)

인접 지번 파이프라인(Task 6)과 기존 장소검색 폴백이 이 설정을 참조하므로 먼저 배선해 둔다.

**Files:**
- Modify: `index.html`
- Modify: `app.js`

**Interfaces:**
- Produces: 전역 `SETTINGS = { placeFallback: boolean, bunjiFallback: boolean }` — `$('startBtn')` 클릭 시 체크박스 값으로 갱신됨. Task 6·7이 이 값을 읽는다.

---

- [ ] **Step 1: 체크박스 UI를 추가한다**

`index.html`에서 Task 1에서 추가한 진단 필드를 찾는다:

```html
    <div class="field">
      <label>진단</label>
```

바로 **앞에** 다음을 삽입한다:

```html
    <div class="field">
      <label>대체주소 사용 여부</label>
      <label class="checkbox">
        <input type="checkbox" id="allowPlaceFallback" checked>
        지명형 주소(공원·시설명 등)를 장소검색으로 대체주소 찾기
      </label>
      <label class="checkbox">
        <input type="checkbox" id="allowBunjiFallback" checked>
        정확한 지번을 못 찾으면 인접 지번(±3)을 대체주소 후보로 찾기 — 자동 확정되지 않고 항상 검수 목록에서 직접 확인 후 선택합니다
      </label>
    </div>
```

- [ ] **Step 2: 전역 설정 객체를 추가한다**

`app.js`에서 다음 줄을 찾는다:

```js
let targetCrs = 'EPSG:2097';
```

바로 뒤에 추가:

```js
/* 대체주소(지명형 장소검색 / 인접 지번) 사용 여부. startBtn 클릭 시 체크박스 값으로 갱신된다.
   기본값 true 는 지금까지의 동작(항상 폴백 시도)을 그대로 유지하기 위함이다. */
let SETTINGS = { placeFallback: true, bunjiFallback: true };
```

- [ ] **Step 3: 시작 시점에 체크박스 값을 읽는다**

`app.js`에서 Task 1 Step 3에서 추가한 줄을 찾는다:

```js
  DEBUG.enabled = $('debugMode').checked;
```

바로 뒤에 추가:

```js
  SETTINGS.placeFallback = $('allowPlaceFallback').checked;
  SETTINGS.bunjiFallback = $('allowBunjiFallback').checked;
```

- [ ] **Step 4: 순수 모듈 테스트가 영향받지 않는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 전체 통과.

- [ ] **Step 5: 커밋한다**

```bash
git add index.html app.js
git commit -m "feat: 대체주소(지명형/인접지번) 사용 여부 토글 추가"
```

---

## Task 6: 지오코딩 파이프라인에 인접 지번 폴백 연결

**주의:** 이 태스크는 `geocodeAddressUncached` 전체를 교체한다. 아래 코드는 Task 1~3의 변경(진단 기록, VWorld 재조립본, 장소검색 쿼리 정리)을 **모두 포함한 최종 상태**다. 그대로 붙여넣으면 앞선 태스크의 결과가 되돌아가지 않는다.

**Files:**
- Modify: `app.js` (`geocodeAddressUncached`, 검수 목록 등록부, `reasonCategory`, `ALT_METHODS`)
- Modify: `index.html` (사유 필터에 옵션 추가)

**Interfaces:**
- Consumes: `noteAttempt` (Task 1), `Addr.rebuild` (Task 2), `Addr.bunjiNeighbors`·`Addr.rebuildWithBunji` (Task 4), `SETTINGS.bunjiFallback`·`SETTINGS.placeFallback` (Task 5)
- Produces: `geocodeAddressUncached()`가 새 상태 `{status: 'bunji-fallback', candidates: Array<{bunji, diff, x, y, crs, jibun, road}>, originalBunji: string}`를 반환할 수 있음
- `reviewList` 항목에 `bunjiCandidates: Array|null`, `originalBunji: string|undefined` 필드가 추가됨 (Task 7이 사용)

---

- [ ] **Step 1: `ALT_METHODS`에 새 매칭방식을 추가한다**

`app.js`에서 다음 블록을 찾는다:

```js
const ALT_METHODS = [
  '사전',
  '장소검색(자동)', '장소검색(선택)', '장소검색(관할밖선택)', '장소검색(VWorld자동)',
  '장소검색(이름일치자동)', '장소검색(VWorld이름일치자동)',
  '수동지정',
];
```

다음으로 교체한다:

```js
const ALT_METHODS = [
  '사전',
  '장소검색(자동)', '장소검색(선택)', '장소검색(관할밖선택)', '장소검색(VWorld자동)',
  '장소검색(이름일치자동)', '장소검색(VWorld이름일치자동)',
  '인접지번(선택)',
  '수동지정',
];
```

- [ ] **Step 2: `geocodeAddressUncached`를 최종 형태로 교체한다**

`app.js`의 `geocodeAddressUncached` 함수 전체(`async function geocodeAddressUncached(addr) {` 부터 그 함수의 마지막 닫는 `}` 까지)를 다음으로 교체한다:

```js
async function geocodeAddressUncached(addr) {
  const parsed = Addr.parse(addr);
  const outside = [];
  const vworldOn = window.VWorld && window.VWorld.isAvailable();

  // --- 주소검색 경로 ---
  if (Addr.route(parsed) === 'address') {
    if (vworldOn) {
      // VWorld 는 정형 주소만 받는 엔진이라 '민원' 같은 노이즈가 낀 원본으로는
      // 반드시 실패한다. 재조립본이 원본과 같으면 중복 제거되어 호출 횟수는 그대로다.
      const vqueries = [];
      [Addr.normalize(addr), Addr.rebuild(parsed)].forEach((q) => {
        if (q && vqueries.indexOf(q) === -1) vqueries.push(q);
      });

      for (const vq of vqueries) {
        for (const t of ['PARCEL', 'ROAD']) {
          const r = await window.VWorld.getcoord(vq, t, targetCrs);
          noteAttempt(addr, 'vworld:' + t, vq, r.state);
          // VWorld 오류는 연속 오류 차단기에 반영하지 않는다 — VWorld는 보조
          // 프로바이더라 서버 장애(502 등)가 있어도 카카오로 계속 진행해야
          // 하는데, 여기서 카운트하면 VWorld만 잠깐 죽어도 카카오는 멀쩡한데
          // 전체 작업이 멈춰버린다.
          if (r.state === 'ok') {
            return {
              status: 'ok',
              method: t === 'PARCEL' ? '주소검색(VWorld:지번)' : '주소검색(VWorld:도로명)',
              lon: r.lon, lat: r.lat, crs: r.crs,
              jibun: t === 'PARCEL' ? r.refinedText : '',
              road: t === 'ROAD' ? r.refinedText : '',
              usedQuery: vq,
            };
          }
        }
      }
    }

    for (const v of Addr.addressVariants(addr)) {
      const r = await callKakaoWithRetry('address', v);
      noteApiResult(r.state);
      noteAttempt(addr, 'kakao:address', v, r.state);
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

    // --- 인접 지번 폴백 (±3) ---
    // 정확한 지번으로 전혀 못 찾았을 때만 시도한다. 지번이 순차적으로 붙어
    // 있다고 실제 필지 위치가 인접하다는 보장은 없으므로, 몇 건이 나오든
    // 절대 자동 확정하지 않고 항상 검수 목록으로 넘긴다.
    // 도로명 건물번호에도 그대로 적용된다 (rebuildWithBunji 가 road 를 살린다).
    if (SETTINGS.bunjiFallback && parsed.bunji) {
      const neighbors = Addr.bunjiNeighbors(parsed.bunji);
      const found = [];
      for (const nb of neighbors) {
        const candAddr = Addr.rebuildWithBunji(parsed, nb.bunji);

        if (vworldOn) {
          const rv = await window.VWorld.getcoord(candAddr, 'PARCEL', targetCrs);
          noteAttempt(addr, 'vworld:인접지번', candAddr, rv.state);
          if (rv.state === 'ok') {
            found.push({
              bunji: nb.bunji, diff: nb.diff,
              x: rv.lon, y: rv.lat, crs: rv.crs,
              jibun: rv.refinedText, road: '',
            });
            continue;
          }
        }
        const rk = await callKakaoWithRetry('address', candAddr);
        noteApiResult(rk.state);
        noteAttempt(addr, 'kakao:인접지번', candAddr, rk.state);
        if (rk.state === 'ok') {
          const t = rk.data[0];
          found.push({
            bunji: nb.bunji, diff: nb.diff,
            x: t.x, y: t.y,
            jibun: t.address ? t.address.address_name : '',
            road: t.road_address ? t.road_address.address_name : '',
          });
        }
      }
      if (found.length) {
        return { status: 'bunji-fallback', candidates: found, originalBunji: parsed.bunji };
      }
    }
  }

  // --- 장소검색 경로 ---
  if (!SETTINGS.placeFallback) {
    return { status: 'fail', outside: outside, reason: '검색 결과 없음' };
  }

  // 주소검색 경로였다가 전부 실패한 경우에도 한 번 더 시도한다.
  // 노이즈가 낀 원본을 그대로 던지면 사실상 반드시 0건이므로, 재조립본을 먼저
  // 시도하고 원본은 최후의 수단으로만 쓴다.
  const keywords = Addr.keywordCandidates(parsed);
  const queries = [];
  (keywords.length ? keywords : [Addr.rebuild(parsed), Addr.normalize(addr)])
    .forEach((q) => { if (q && queries.indexOf(q) === -1) queries.push(q); });

  for (const v of queries) {
    const r = await callKakaoWithRetry('place', v);
    noteApiResult(r.state);
    noteAttempt(addr, 'kakao:place', v, r.state);
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
      const exact = findExactNameMatch(inside, parsed);
      if (exact) {
        return {
          status: 'ok', method: '장소검색(이름일치자동)',
          lon: exact.x, lat: exact.y,
          jibun: exact.address_name || '', road: exact.road_address_name || '',
          usedQuery: v,
        };
      }
      return { status: 'ambiguous', candidates: inside, outside: outside, usedQuery: v };
    }
    // inside 가 0건이면 다음 키워드 후보로 넘어간다
  }

  // 카카오 장소검색으로 전혀 못 찾았을 때만 VWorld 장소검색을 보조로 시도한다.
  if (vworldOn) {
    for (const v of queries) {
      const r = await window.VWorld.search(v);
      noteAttempt(addr, 'vworld:place', v, r.state);
      // getcoord 와 같은 이유로 VWorld 오류는 차단기에 반영하지 않는다.
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
        const exact = findExactNameMatch(inside, parsed);
        if (exact) {
          return {
            status: 'ok', method: '장소검색(VWorld이름일치자동)',
            lon: exact.x, lat: exact.y,
            jibun: exact.address_name || '', road: exact.road_address_name || '',
            usedQuery: v,
          };
        }
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
```

- [ ] **Step 3: 워커 루프에서 새 상태를 검수 목록에 등록한다**

`app.js`에서 다음 블록을 찾는다:

```js
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
```

다음으로 교체한다:

```js
      } else if (r.status === 'ambiguous') {
        reviewList.push({
          sheetIdx, rowIndex, address: addr, candidates: r.candidates,
          outside: r.outside || [], resolved: false, reason: '후보 여러 건',
        });
        fail++; sheet.stats.fail++;
      } else if (r.status === 'bunji-fallback') {
        reviewList.push({
          sheetIdx, rowIndex, address: addr, candidates: null,
          bunjiCandidates: r.candidates, originalBunji: r.originalBunji,
          outside: [], resolved: false, reason: '인접 지번 후보',
        });
        fail++; sheet.stats.fail++;
      } else {
        reviewList.push({
          sheetIdx, rowIndex, address: addr, candidates: null,
          outside: r.outside || [], resolved: false, reason: r.reason || '검색 결과 없음',
        });
        fail++; sheet.stats.fail++;
      }
```

- [ ] **Step 4: 사유 분류와 필터 옵션을 추가한다**

`app.js`에서 다음 함수를 찾는다:

```js
function reasonCategory(item) {
  return item.reason === '후보 여러 건' ? 'multi' : 'none';
}
```

다음으로 교체한다:

```js
function reasonCategory(item) {
  if (item.reason === '후보 여러 건') return 'multi';
  if (item.reason === '인접 지번 후보') return 'bunji';
  return 'none';
}
```

`index.html`에서 다음 블록을 찾는다:

```html
      <select id="reasonFilter">
        <option value="">전체 사유</option>
        <option value="multi">후보 여러 건</option>
        <option value="none">결과 없음</option>
      </select>
```

다음으로 교체한다:

```html
      <select id="reasonFilter">
        <option value="">전체 사유</option>
        <option value="multi">후보 여러 건</option>
        <option value="bunji">인접 지번 후보</option>
        <option value="none">결과 없음</option>
      </select>
```

- [ ] **Step 5: 순수 모듈 테스트가 영향받지 않는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 전체 통과.

- [ ] **Step 6: 커밋한다**

```bash
git add app.js index.html
git commit -m "feat: 인접 지번(±3) 폴백을 지오코딩 파이프라인에 연결"
```

---

## Task 7: 검수 화면에 인접 지번 후보 전용 UI 추가

**Files:**
- Modify: `app.js` (`selectItem`, 신규 `showBunjiCandidates`, `renderFailList`의 배지, `saveCoord`)
- Modify: `style.css`

**Interfaces:**
- Consumes: `reviewList` 항목의 `bunjiCandidates`, `originalBunji` (Task 6)
- Produces: 없음 (화면 전용)

---

- [ ] **Step 1: 목록에 "인접 지번 후보" 건수를 표시한다**

`app.js`의 `renderFailList` 함수에서 다음 줄을 찾는다:

```js
    const outsideCount = (item.outside || []).length;
    const outsideBadge = outsideCount ? `<span class="badge-outside">관할 밖 ${outsideCount}</span>` : '';
```

다음으로 교체한다:

```js
    const outsideCount = (item.outside || []).length;
    const outsideBadge = outsideCount ? `<span class="badge-outside">관할 밖 ${outsideCount}</span>` : '';
    const bunjiBadge = item.bunjiCandidates
      ? `<span class="badge-bunji">인접지번 후보 ${item.bunjiCandidates.length}</span>` : '';
```

바로 아래 줄:

```js
    li.innerHTML = `${sheetBadge}<span class="addr"></span><span class="reason">${escapeHtml(item.reason)}</span>${outsideBadge}`;
```

다음으로 교체한다:

```js
    li.innerHTML = `${sheetBadge}<span class="addr"></span><span class="reason">${escapeHtml(item.reason)}</span>${outsideBadge}${bunjiBadge}`;
```

- [ ] **Step 2: `selectItem`이 인접 지번 후보를 우선 표시하도록 분기한다**

`app.js`에서 다음 블록을 찾는다:

```js
  // 배치 단계에서 이미 후보를 받아둔 경우 API를 다시 부르지 않고 그대로 보여준다.
  if (item.candidates) showCandidates(item.candidates, item.address, item.outside);
  else if (item.outside && item.outside.length) showCandidates([], item.address, item.outside);
  else runKeywordSearch(item.address);
```

다음으로 교체한다:

```js
  // 배치 단계에서 이미 후보를 받아둔 경우 API를 다시 부르지 않고 그대로 보여준다.
  if (item.bunjiCandidates) showBunjiCandidates(item.bunjiCandidates, item.originalBunji);
  else if (item.candidates) showCandidates(item.candidates, item.address, item.outside);
  else if (item.outside && item.outside.length) showCandidates([], item.address, item.outside);
  else runKeywordSearch(item.address);
```

- [ ] **Step 3: 전용 후보 렌더러를 추가한다**

`app.js`에서 `showCandidates` 함수 전체를 찾아 그 함수의 마지막 닫는 `}` **바로 뒤**에 다음 함수를 추가한다:

```js
/**
 * 인접 지번(±3) 폴백 후보를 보여준다. showCandidates 와 달리 후보가 1건이어도
 * 절대 자동 확정하지 않는다 — 지번이 가깝다고 실제 필지가 인접하다는 보장이
 * 없으므로 반드시 사람이 지도에서 확인하고 클릭해야 한다.
 */
function showBunjiCandidates(candidates, originalBunji) {
  const ul = $('searchResults');
  ul.innerHTML = '';

  const head = document.createElement('li');
  head.className = 'bunji-head';
  head.textContent =
    `원래 지번(${originalBunji})을 찾지 못해 인접 지번 후보를 보여줍니다. ` +
    `실제 위치가 맞는지 지도로 확인한 뒤 선택하세요.`;
  ul.appendChild(head);

  candidates.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'bunji-item';
    li.textContent = `${c.bunji} (원래 지번과 ${c.diff} 차이) - ${c.road || c.jibun || '(주소 정보 없음)'}`;
    li.onclick = () => {
      map.setCenter(new kakao.maps.LatLng(c.y, c.x));
      map.setLevel(3);
      saveCoord(c.x, c.y, { jibun: c.jibun, road: c.road, usedQuery: c.bunji, crs: c.crs }, '인접지번(선택)');
    };
    ul.appendChild(li);
  });

  const first = candidates[0];
  if (first) {
    map.setCenter(new kakao.maps.LatLng(first.y, first.x));
    map.setLevel(3);
  }
}
```

- [ ] **Step 4: `saveCoord`가 후보의 `crs`를 결과에 실어 보내도록 한다**

`app.js`의 `saveCoord` 함수에서 다음 블록을 찾는다:

```js
  const payload = {
    lon, lat, method,
    jibun: info ? info.jibun : '',
    road: info ? info.road : '',
    usedQuery: info ? info.usedQuery : '',
    original: active.address,
  };
```

다음으로 교체한다:

```js
  const payload = {
    lon, lat, method,
    jibun: info ? info.jibun : '',
    road: info ? info.road : '',
    usedQuery: info ? info.usedQuery : '',
    crs: info ? info.crs : undefined,
    original: active.address,
  };
```

(`info.crs`가 없는 기존 호출부(장소검색 선택, 지도 직접 클릭)는 `undefined`가 되어 지금처럼 WGS84 기준으로 처리된다 — 동작 변화 없음. Task 9에서 이 필드를 실제로 사용한다.)

- [ ] **Step 5: 스타일을 추가한다**

`style.css` 파일 **끝에** 추가:

```css
/* 인접 지번 후보 배지 */
.badge-bunji {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 10px;
  background: #e3f2fd;
  color: #0d47a1;
  font-size: 11px;
  font-weight: bold;
}
.search-results .bunji-head {
  padding: 8px;
  margin-bottom: 6px;
  background: #fff8e1;
  color: #7a5c00;
  font-size: 12px;
  cursor: default;
  border-radius: 4px;
}
.search-results .bunji-item {
  background: #f3f8ff;
  color: #0d47a1;
}
```

- [ ] **Step 6: 순수 모듈 테스트가 영향받지 않는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 전체 통과.

- [ ] **Step 7: 커밋한다**

```bash
git add app.js style.css
git commit -m "feat: 인접 지번 후보 전용 검수 UI 추가 (자동확정 없음)"
```

---

## Task 8: 결과 컬럼 삽입 위치를 사용자가 선택

**Files:**
- Modify: `index.html`
- Modify: `app.js` (`populateColumnSelects`, `prepareAllSheets`, `reorderForOutput`)

**Interfaces:**
- Produces: `sheet.colIdx.insertAfter: number` (-1이면 기존 기본 동작인 "지번/도로명 컬럼 뒤"를 의미)

---

- [ ] **Step 1: 선택 UI를 추가한다**

`index.html`에서 다음 블록을 찾는다:

```html
      <div class="field">
        <label>결과 Y 컬럼</label>
        <select id="colY"></select>
        <input type="text" id="colYNewName" class="hidden" placeholder="새 컬럼 이름 (예: Y)">
      </div>
    </div>
  </section>
```

다음으로 교체한다:

```html
      <div class="field">
        <label>결과 Y 컬럼</label>
        <select id="colY"></select>
        <input type="text" id="colYNewName" class="hidden" placeholder="새 컬럼 이름 (예: Y)">
      </div>
      <div class="field">
        <label>결과 컬럼을 삽입할 위치</label>
        <select id="insertAfterCol"></select>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: 목록을 채우고 기본값 안내 문구를 설정한다**

`app.js`의 `populateColumnSelects` 함수에서 다음 줄을 찾는다:

```js
  fill('colJibun', true, false);
  fill('colRoad', true, false);
  fill('colX', false, true);
  fill('colY', false, true);
```

다음으로 교체한다:

```js
  fill('colJibun', true, false);
  fill('colRoad', true, false);
  fill('colX', false, true);
  fill('colY', false, true);
  fill('insertAfterCol', true, false);
  $('insertAfterCol').options[0].textContent = '(기본값) 지번/도로명 주소 컬럼 바로 뒤';
```

- [ ] **Step 3: 선택한 컬럼 이름을 시트별 인덱스로 변환한다**

`app.js`의 `prepareAllSheets` 함수에서 다음 줄을 찾는다:

```js
  const jibunName = selectedColumnName('colJibun', null);
  const roadName = selectedColumnName('colRoad', null);
  const xName = selectedColumnName('colX', 'colXNewName');
  const yName = selectedColumnName('colY', 'colYNewName');
```

다음으로 교체한다:

```js
  const jibunName = selectedColumnName('colJibun', null);
  const roadName = selectedColumnName('colRoad', null);
  const xName = selectedColumnName('colX', 'colXNewName');
  const yName = selectedColumnName('colY', 'colYNewName');
  const insertAfterName = selectedColumnName('insertAfterCol', null); // '' 면 기본 동작
```

같은 함수에서 다음 블록을 찾는다:

```js
    s.colIdx = {
      jibun, road, originalLen,
      sojaeji: findOrCreateColumn(s, COL_SOJAEJI),
```

다음으로 교체한다:

```js
    // 사용자가 삽입 위치를 지정했지만 이 시트에 그 이름의 컬럼이 없으면(다중
    // 시트 헤더 불일치) -1이 되어 기본 동작(지번/도로명 뒤)으로 자동 대체된다.
    const insertAfter = insertAfterName ? findColumn(s, insertAfterName) : -1;

    s.colIdx = {
      jibun, road, originalLen, insertAfter,
      sojaeji: findOrCreateColumn(s, COL_SOJAEJI),
```

- [ ] **Step 4: 컬럼 재배치 기준점을 설정값으로 바꾼다**

`app.js`의 `reorderForOutput` 함수에서 다음 줄을 찾는다:

```js
  const insertPoint = Math.max(ci.jibun, ci.road) + 1;
```

다음으로 교체한다:

```js
  const insertPoint = (ci.insertAfter >= 0 ? ci.insertAfter : Math.max(ci.jibun, ci.road)) + 1;
```

- [ ] **Step 5: 순수 모듈 테스트가 영향받지 않는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 전체 통과.

- [ ] **Step 6: 브라우저로 직접 확인한다**

`python -m http.server 8090`으로 띄운 뒤 `http://localhost:8090/index.html`에서:
1. 엑셀 업로드 → "결과 컬럼을 삽입할 위치" 드롭다운에 헤더 목록이 뜨고 기본 선택이 `(기본값) 지번/도로명 주소 컬럼 바로 뒤`인지 확인
2. 아무것도 바꾸지 않고 처리 → 다운로드한 결과가 기존과 동일하게 지번/도로명 뒤에 삽입되는지 확인 (회귀 없음)
3. 다른 컬럼(예: 맨 뒤 컬럼)을 선택 → 결과에서 X/Y 등이 그 컬럼 바로 뒤에 삽입되는지 확인

- [ ] **Step 7: 커밋한다**

```bash
git add index.html app.js
git commit -m "feat: 결과 컬럼 삽입 위치를 사용자가 선택할 수 있게 함"
```

---

## Task 9: VWorld 경로 좌표계 이중 변환 제거

**배경:** `EPSG:2097`은 proj4의 `+towgs84=` 7-파라미터(Bursa-Wolf) 근사 변환으로 계산되는데, 이 방식은 한반도 전역에 평균값 하나를 적용하는 근사치라 실측 대비 수 m 오차가 날 수 있다 — "근접하지만 정확하지 않은" 증상의 원인이다. `DESIGN.md` §12는 애초에 VWorld를 `crs=EPSG:2097`로 직접 요청해 이 근사 변환 자체를 건너뛰려 했지만, 실제 구현(`vworld.js`)은 `crs=EPSG:4326`으로 요청하고 있었다(CHANGELOG 2026-08-03에 이미 기록됨). 이 태스크는 그 구현 누락을 고친다.

**범위 제한:** `VWorld.getcoord()`(정확한 지번/도로명 검색)만 고친다. `VWorld.search()`(장소검색)는 건드리지 않는다 — POI 중심점이라 이미 근사치이므로 이득이 작다. 카카오 경로는 WGS84만 주므로 클라이언트 변환이 계속 필요하다.

**Files:**
- Modify: `src/providers/vworld.js`
- Modify: `app.js` (`toOutputXY` 신규, `writeRow`)

**Interfaces:**
- `VWorld.getcoord(address, type, crs)` — `crs` 파라미터 추가, 반환값에 `crs` 필드 추가 (호출부는 Task 6에서 이미 3번째 인자를 넘기고 있다)
- `toOutputXY(lon, lat, crs) → {x, y}` — `crs === targetCrs`면 반올림만, 아니면 기존 `toProjected` 적용

---

- [ ] **Step 1: `getcoord`가 좌표계를 받아 그대로 요청하게 한다**

`src/providers/vworld.js`에서 다음 함수를 찾는다:

```js
  function getcoord(address, type) {
    if (!isAvailable()) return Promise.resolve({ state: 'error', reason: 'no-key' });

    var url = 'https://api.vworld.kr/req/address'
      + '?service=address&request=getcoord&version=2.0'
      + '&crs=EPSG:4326'
      + '&address=' + encodeURIComponent(address)
      + '&type=' + type
      + '&refine=true&simple=false&format=json'
      + '&key=' + encodeURIComponent(global.VWORLD_API_KEY);
```

다음으로 교체한다 (함수 시그니처와 URL 두 줄만 바뀐다):

```js
  function getcoord(address, type, crs) {
    if (!isAvailable()) return Promise.resolve({ state: 'error', reason: 'no-key' });
    var useCrs = crs || 'EPSG:4326';

    var url = 'https://api.vworld.kr/req/address'
      + '?service=address&request=getcoord&version=2.0'
      + '&crs=' + encodeURIComponent(useCrs)
      + '&address=' + encodeURIComponent(address)
      + '&type=' + type
      + '&refine=true&simple=false&format=json'
      + '&key=' + encodeURIComponent(global.VWORLD_API_KEY);
```

같은 함수의 반환 블록을 찾는다:

```js
      return {
        state: 'ok',
        lon: parseFloat(point.x),
        lat: parseFloat(point.y),
        refinedText: (res.refined && res.refined.text) || '',
      };
```

다음으로 교체한다:

```js
      return {
        state: 'ok',
        lon: parseFloat(point.x),
        lat: parseFloat(point.y),
        crs: useCrs,
        refinedText: (res.refined && res.refined.text) || '',
      };
```

(요청한 `crs`를 VWorld가 지원하지 않으면 `res.status !== 'OK'`로 걸러져 `{state:'error'}`가 되고, 호출부는 기존 규칙대로 카카오로 계속 진행한다 — 안전하게 실패한다.)

- [ ] **Step 2: 이중 변환을 막는 헬퍼를 추가한다**

`app.js`에서 다음 함수를 찾는다:

```js
function round(v, d) { const p = Math.pow(10, d); return Math.round(v * p) / p; }
```

바로 뒤에 추가:

```js
/**
 * VWorld getcoord 는 요청한 crs로 이미 좌표를 돌려줄 수 있다 (targetCrs와
 * 같은 crs로 요청한 경우). 이때는 proj4로 다시 변환하면 안 된다 — 이미
 * 목표 좌표계인 값을 "WGS84 경위도"로 착각해 재변환하면 완전히 틀어진다.
 * crs가 없거나(카카오/사전 출처) targetCrs와 다르면 기존처럼 WGS84 기준으로 변환한다.
 */
function toOutputXY(lon, lat, crs) {
  if (crs && crs === targetCrs) {
    return { x: round(parseFloat(lon), 4), y: round(parseFloat(lat), 4) };
  }
  return toProjected(lon, lat);
}
```

- [ ] **Step 3: 결과를 쓸 때 새 헬퍼를 쓰게 한다**

`app.js`의 `writeRow` 함수에서 다음 줄을 찾는다:

```js
  const proj = toProjected(o.lon, o.lat);
```

다음으로 교체한다:

```js
  const proj = toOutputXY(o.lon, o.lat, o.crs);
```

- [ ] **Step 4: 순수 모듈 테스트가 영향받지 않는지 확인한다**

`test.html`을 새로고침한다. 기대 결과: 전체 통과.

- [ ] **Step 5: 실키로 수동 확인한다 (VWorld 키가 있을 때만)**

`index.html`의 `VWORLD_API_KEY`에 실제 키를 넣고 진단 모드를 켠 채 지번 주소 몇 건을 처리한 뒤:
1. 콘솔에 `[VWorld] getcoord: ...` 경고가 뜨지 않는지 확인 (뜨면 응답 필드명이 문서 추정치와 달라 `vworld.js` 파싱 로직을 실제 응답에 맞게 고쳐야 한다 — 별도 작업)
2. `진단로그` 시트에서 `vworld:PARCEL` 행의 결과가 `ok`인지 확인 (전부 `error`면 VWorld가 그 좌표계를 지원하지 않는 것)
3. 매칭방식이 `주소검색(VWorld:지번)`인 행의 X/Y를 QGIS 등에서 EPSG:2097로 열어 카카오맵 위치와 비교

- [ ] **Step 6: 커밋한다**

```bash
git add src/providers/vworld.js app.js
git commit -m "fix: VWorld 지번/도로명 검색을 목표 좌표계로 직접 요청해 이중 변환 제거"
```

---

## Task 10: 문서 업데이트 및 최종 확인

**Files:**
- Modify: `DESIGN.md`, `CHANGELOG.md`, `PROGRESS.md`, `DECISIONS.md`

---

- [ ] **Step 1: `CHANGELOG.md`에 이번 변경을 기록한다**

`CHANGELOG.md` 맨 위(첫 `#` 제목과 설명 문단 바로 아래)에 추가:

```markdown

## 2026-08-12 — 진단 로그, 프로바이더 공통 재조립본, 인접 지번 대체주소, 대체주소 토글, 컬럼 위치, VWorld 좌표계

### 실측으로 확인한 결함 (`'경기도 고양시 일산서구  민원 킨텍스로240'` 케이스)

파서를 Node 로 직접 돌려 확인한 결과 **파싱은 이미 정상이었다** — `skipNoiseWords`
가 `'민원'` 을 걸러내고 `'경기도 고양시 일산서구 킨텍스로 240'` 을 세 번째 변형으로
만들어 카카오에 보내고 있었다. 대신 다음 두 곳이 문제였다.

- **VWorld 에는 깨끗한 변형이 전혀 안 갔다.** `getcoord` 호출이 `addressVariants`
  루프 밖에 있어 노이즈가 낀 원본만 받고 있었다. VWorld 는 정형 주소만 받는
  엔진이라 이 경우 반드시 실패한다. 재조립본(`Addr.rebuild`)도 함께 시도하도록 고쳤다.
- **주소검색이 전부 실패하면 장소검색에 더러운 원본이 갔다.** 지명(`rest`)이 없는
  정형 주소는 `keywordCandidates` 가 빈 배열을 주므로 원본 문자열이 그대로 쓰였고,
  사실상 반드시 0건이었다. 재조립본을 먼저 쓰도록 고쳤다.

### 추가

- **진단 로그**: 실행 시 진단 모드를 켜면 어떤 프로바이더에 어떤 검색어를 던져
  어떤 결과가 나왔는지 전부 기록하고, 결과 엑셀에 `진단로그` 시트로 저장한다.
  "안 된다"만 알고 어디서 안 되는지 모르던 상태를 없앤다.
- **인접 지번(±3) 대체주소**: 정확한 지번으로 못 찾으면 부번(또는 본번)을 ±1~±3
  범위에서 바꿔 재검색하고, 찾은 후보를 검수 목록에 올린다. 지번이 가깝다고
  실제 필지가 인접하다는 보장이 없으므로 **후보가 몇 건이든 자동 확정하지 않는다**.
  도로명 건물번호에도 그대로 적용된다.
- **대체주소 사용 여부 토글**: 지명형 장소검색 폴백, 인접 지번 폴백을 각각 켜고
  끌 수 있다. 기본값은 둘 다 켜짐(기존 동작 유지).
- **결과 컬럼 삽입 위치 설정**: 기존에는 결과 컬럼이 항상 지번/도로명 컬럼 바로
  뒤에 고정 삽입됐다. 이제 어느 컬럼 뒤에 넣을지 고를 수 있다. 기본값은 기존과 동일.
- **VWorld 이중 변환 제거**: `getcoord` 가 `crs=EPSG:4326` 으로 고정 요청하던 것을
  목표 좌표계로 직접 요청하도록 고쳤다. `DESIGN.md` §12 가 원래 의도했던 동작이며
  실제 구현이 빠뜨리고 있던 부분이다(2026-08-03 기록에 이미 남아있던 불일치).
  카카오 경로는 여전히 WGS84→목표좌표계 근사 변환(Bursa-Wolf)을 거치며, 이건
  proj4 수준에서는 없앨 수 없는 한계다.
```

- [ ] **Step 2: `DESIGN.md`에 신규 결함 항목과 좌표계 정정을 반영한다**

`DESIGN.md` §3의 마지막 항목 뒤에 추가:

```markdown

### 3.12 정확한 지번을 못 찾으면 그대로 실패한다

번지가 하나 다른 이유(예: `130-4`를 찾는데 실제로는 `130-3`만 존재)로 지오코딩이
실패하는 사례가 실사용 중 확인됐다. 번지 주소에는 지명(rest)이 없어 장소검색
키워드 후보도 비어 있어 결국 "검색 결과 없음"으로만 남았다.

**설계 결정**: 부번(없으면 본번)을 ±1~±3 범위에서 바꿔가며 재검색하고, 찾은
후보를 검수 목록에 올린다. 지번이 순차적으로 붙어 있다고 실제 필지가 지리적으로
인접하다는 보장은 전혀 없으므로(분필·합필 이력에 따라 다르다), **자동 확정하지
않는다** — 후보가 1건이어도 사람이 지도로 확인하고 클릭해야 확정된다.

### 3.13 재조립된 정형 주소가 일부 경로에만 전달됐다

`parse()` 가 노이즈 단어를 건너뛰어 구조를 정확히 읽어내고 있었는데도, 그 결과로
재조립한 깨끗한 주소가 카카오 주소검색에만 전달되고 있었다. VWorld `getcoord` 는
변형 루프 밖에서 원본만 받았고, 주소검색 실패 후의 장소검색도 원본을 그대로 썼다.
`Addr.rebuild(parsed)` 를 신설해 두 경로 모두에 적용한다.

### 3.14 어디서 실패했는지 알 방법이 없었다

실패한 행에 남는 정보는 "검색 결과 없음"뿐이라, 어느 프로바이더의 어떤 검색어에서
막혔는지 알 수 없었다. 진단 모드를 켜면 시도 전부를 `진단로그` 시트로 남긴다.
```

`DESIGN.md` §12 끝에 추가:

```markdown

**2026-08-12 정정**: VWorld `getcoord`는 목표 좌표계를 `crs` 파라미터로 직접
요청하도록 구현됐다(이전에는 `EPSG:4326`으로 고정 요청하고 있었다 — 이 문서와
실제 구현이 달랐던 부분, 2026-08-03 CHANGELOG 참고). `VWorld.search`(장소검색)는
범위 밖으로 남겨두고 여전히 WGS84로 받아 변환한다. 카카오 경로는 구조상 WGS84만
받을 수 있어 proj4의 `+towgs84=` 근사 변환(Bursa-Wolf)을 계속 거치며, 이 근사치가
"근접하지만 정확하지 않은" 좌표의 남은 원인이다.
```

- [ ] **Step 3: `PROGRESS.md`를 갱신한다**

"완료" 목록에 추가:

```markdown
- 진단 로그 (진단로그 시트: 프로바이더별 시도 검색어와 결과)
- 재조립 정형 주소(`Addr.rebuild`)를 VWorld·장소검색 폴백에도 공통 적용
- 인접 지번(±3) 대체주소 폴백 (자동확정 없음, 도로명 건물번호 포함)
- 대체주소(지명형/인접지번) 사용 여부 토글
- 결과 컬럼 삽입 위치 사용자 설정
- VWorld 지번/도로명 검색 좌표계 이중 변환 제거
```

"남은 것" 목록에 추가:

```markdown
- [ ] `'민원 킨텍스로240'` 케이스가 실제로 해결되는지 진단로그로 확인 안 됨 —
      카카오 도로명 DB에 `킨텍스로 240` 이 없는 것이 원인이라면 인접 지번
      폴백이 커버하고, VWorld 미전달이 원인이었다면 Task 2 로 해결된다.
      어느 쪽인지는 실행해봐야 안다
- [ ] VWorld가 EPSG:2097(또는 사용자가 고른 좌표계)을 실제로 지원하는지 실키로
      확인 안 됨 — 지원하지 않으면 조용히 카카오로만 폴백되므로 기능은 안전하지만,
      정확도 개선 효과를 실제로 얻는지는 미확인
- [ ] 인접 지번 폴백을 실제 엑셀로 브라우저에서 검증 안 됨
- [ ] 격차가 남으면 행안부 주소 API(`business.juso.go.kr`) 프로바이더 추가 검토 —
      도로명주소 원본 DB라 부분일치 매칭이 카카오보다 강하고, 저장 제약도 없다
      (DESIGN.md §15.1). 어댑터 구조라 프로바이더 하나 추가로 끝난다
```

- [ ] **Step 4: `DECISIONS.md`에 결정사항을 기록한다**

`DECISIONS.md` 끝에 추가:

```markdown

## 12. Phase 2 — 목표 변경 (2026-08-12)

- 도구의 목표를 "정해진 시트 형식 전용"에서 "주소가 있는 엑셀이면 좌표를
  계산해주는 범용 도구"로 넓힌다.
- **진단 먼저**: 어디서 실패했는지 모르는 상태로 고치지 않는다. 진단 로그를
  가장 먼저 넣고, 이후 변경의 효과도 이걸로 측정한다.
- **인접 지번 대체주소**: 부번(또는 본번) ±3까지만 탐색. 지리적 인접성이
  보장되지 않으므로 **자동 확정 금지** — 항상 사람이 확정한다.
- **대체주소 토글**: 지명형 장소검색 폴백과 인접 지번 폴백을 각각 켜고 끌 수 있다.
- **결과 컬럼 위치**: 사용자가 어느 컬럼 뒤에 넣을지 선택 가능하게 한다.
- **좌표 정확도**: `+towgs84=` 근사 변환(Bursa-Wolf)이 "근접하지만 정확하지 않은"
  좌표의 원인. VWorld 경로는 목표 좌표계로 직접 요청해 이를 건너뛴다. 카카오
  경로는 구조상 피할 수 없어 한계로 남긴다.
- **카카오맵 웹 통합검색과의 격차**: 100% 재현은 불가능하다고 결론. 웹 검색창은
  오타보정·부분일치·자체 랭킹이 들어간 비공개 엔진이고 공개 API 로 제공되지
  않는다. 격차를 줄이되, 남는 건은 검수 목록에서 사람이 처리한다.
```

- [ ] **Step 5: 최종 회귀 확인**

`test.html`을 새로고침해 전체 통과를 확인한다. 그다음 `python -m http.server 8090`으로 띄운 `index.html`에서 실제 엑셀로 한 번 돌려:
1. 진단 모드를 켜고 실행 → `진단로그` 시트에서 `'민원 킨텍스로240'`이 어느 단계에서 해결됐는지(또는 여전히 실패인지) 확인
2. 대체주소 토글 둘 다 켠 상태 → 인접 지번 후보가 검수 목록에 뜨고, 클릭해야만 확정되는지 확인
3. 인접 지번 토글을 끄고 실행 → 그 행이 "검색 결과 없음"으로만 남는지 확인
4. 결과 컬럼 삽입 위치를 기본값 그대로 두고 실행 → 기존과 동일 위치인지 확인 (회귀 없음)

- [ ] **Step 6: 커밋하고 `claude` 브랜치에 푸시한다**

```bash
git add DESIGN.md CHANGELOG.md PROGRESS.md DECISIONS.md
git commit -m "docs: Phase 2 변경사항 기록 (진단 로그, 재조립본 공통 적용, 인접지번, 토글, 컬럼 위치, 좌표계)"
git push origin claude
```

(`main` 병합은 지금까지처럼 사용자가 GitHub에서 직접 PR로 진행한다.)

---

## Self-Review 결과

**스펙 커버리지**

| 요구사항 | 대응 태스크 |
|---|---|
| 어디서 실패했는지 알 수 있게 (진단) | Task 1 |
| 노이즈 낀 주소(`민원 킨텍스로240`)도 VWorld가 처리 | Task 2 |
| 주소검색 실패 후 장소검색 쿼리 정리 | Task 3 |
| 인접 지번 ±3 탐색 | Task 4 (`bunjiNeighbors`), Task 6 (파이프라인 연결) |
| 인접 지번 자동확정 금지 | Task 6 (`bunji-fallback`은 항상 `reviewList`로), Task 7 (`showBunjiCandidates`는 1건이어도 클릭 필요) |
| 대체주소 필요 여부 사용자 선택 | Task 5 (`SETTINGS`), Task 6 (게이팅) |
| X/Y가 들어갈 컬럼 위치 설정 | Task 8 |
| EPSG:2097 "근접하지만 부정확" 개선 | Task 9, Task 10 Step 2 (한계 명시) |

**타입/시그니처 일관성 확인**

- `Addr.rebuild(parsed)`가 Task 2(정의·VWorld 호출부), Task 3(장소검색 폴백), Task 4(`rebuildWithBunji`가 위임), Task 6(최종 함수)에서 동일하게 사용됨
- `Addr.bunjiNeighbors` 반환 타입(`{bunji, diff}` 배열)이 Task 4 테스트와 Task 6 파이프라인(`nb.bunji`, `nb.diff`)에서 일치
- `noteAttempt(original, provider, query, state)` 4-인자 시그니처가 Task 1 정의와 Task 2·6의 모든 호출부에서 일치
- `{status:'bunji-fallback', candidates, originalBunji}`가 Task 6 반환부, Task 6 Step 3 등록부, Task 7 `selectItem`/`showBunjiCandidates`에서 일치
- `saveCoord`의 `payload.crs` → `writeRow`의 `o.crs` → `toOutputXY(lon, lat, crs)`에서 필드명 일관됨
- `VWorld.getcoord(address, type, crs)` 3번째 인자가 Task 6의 두 호출부(주소검색·인접지번)와 Task 9의 정의에서 일치. Task 6~8 동안은 `vworld.js`가 3번째 인자를 무시하고 `r.crs`가 `undefined`라 `toOutputXY`가 기존 경로로 폴백된다 — 안전하며 Task 9에서 실제 값이 채워진다

**Task 간 편집 충돌 확인**

- Task 1·2·3이 `geocodeAddressUncached`를 각각 부분 수정하고 Task 6이 전체를 교체한다. Task 6의 교체 코드는 앞선 세 태스크의 변경을 **전부 포함한 최종 상태**로 작성해 되돌아가지 않도록 했다 (Task 6 서두에 명시).
- Task 1과 Task 5가 `index.html`의 같은 영역(`step-crs`)에 필드를 추가한다. Task 5는 Task 1이 넣은 진단 필드를 앵커로 삼아 그 앞에 삽입하므로 순서가 확정된다.

**실현 불가능/한계로 남기는 부분 (문서에만 기록)**

- 카카오맵 웹 통합검색과 동일한 결과는 공개 API로 재현 불가 — 오타보정·부분일치·랭킹이 비공개 엔진이다.
- 인접 지번이 실제로 지리적으로 인접하다는 보장은 만들어낼 수 없음 — 그래서 자동확정을 금지했다.
- 카카오 경로의 좌표 근사 오차(Bursa-Wolf)는 정밀 보정 그리드 없이 proj4만으로 없앨 수 없음.
- `VWorld.search()`(장소검색)의 좌표계 이중 변환은 이번 범위 제외 — POI 중심점이라 우선순위가 낮다.
