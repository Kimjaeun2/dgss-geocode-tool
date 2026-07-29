# 지오코딩 정확도 개선 Phase 1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주소를 구조적으로 파싱해 지명형 판정 오류를 없애고, 시·군·구 지역 게이트로 관할 밖 오답이 자동 채택되는 것을 막는다.

**Architecture:** 기존 `app.js` 한 파일에 뒤섞여 있던 주소 처리 로직을 API·DOM 의존이 없는 순수 함수 모듈(`src/address.js`, `src/gate.js`)로 분리한다. 이 두 모듈은 브라우저에서 바로 열리는 `test.html`로 단독 검증한다. 그다음 기존 `app.js`가 이 모듈을 쓰도록 배선하고, 장소검색 결과에 게이트를 적용한다.

**Tech Stack:** 순수 JavaScript (ES5 문법, 빌드 없음), 전역 네임스페이스 방식(`window.Addr`, `window.Gate`), 카카오맵 JS SDK, SheetJS, proj4js

## Global Constraints

- **빌드 과정 없음.** 번들러·트랜스파일러·npm 의존을 도입하지 않는다. 파일을 웹서버 정적 폴더에 두면 그대로 동작해야 한다.
- **ES 모듈(`import`/`export`)을 쓰지 않는다.** `<script>` 태그 + 전역 객체 방식으로 통일한다. 그래야 `test.html`을 서버 없이 더블클릭으로 열 수 있다.
- **신규 순수 모듈은 ES5 문법으로 작성한다.** `var`, `function`, `Array.prototype.indexOf`. 화살표 함수·`let`/`const`·템플릿 리터럴을 쓰지 않는다. (기존 `app.js`는 ES6를 쓰지만, `test.html`은 구형 브라우저에서도 열려야 한다.)
- **좌표계는 EPSG:5181.** 이 도구의 결과를 받는 시스템의 표준이다.
- **작업 브랜치는 `claude`.** `main`을 수정하지 않는다.
- 기존 파일의 줄바꿈은 CRLF다. 편집 시 줄바꿈 스타일을 바꾸지 않는다.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `src/address.js` | 주소 정규화, 행정구역 파싱, 경로 판정, 검색어 변형 생성 | 신규 |
| `src/gate.js` | 시·군·구 관할 판정 | 신규 |
| `tests/address.test.js` | `address.js` 테스트 케이스 | 신규 |
| `tests/gate.test.js` | `gate.js` 테스트 케이스 | 신규 |
| `test.html` | 테스트 하네스 + 러너. 브라우저로 열면 실행됨 | 신규 |
| `index.html` | `src/*.js` 로드 추가 | 수정 |
| `app.js` | 파싱·변형 로직 제거하고 모듈 사용, 게이트 적용 | 수정 |
| `style.css` | 관할 밖 배지 스타일 추가 | 수정 |

`address.js`와 `gate.js`는 **`kakao`, `XLSX`, `proj4`, `document`를 전혀 참조하지 않는다.** 이것이 테스트 가능성의 전제다.

---

## Task 1: 테스트 하네스와 주소 파서

**Files:**
- Create: `test.html`
- Create: `src/address.js`
- Create: `tests/address.test.js`

**Interfaces:**
- Consumes: 없음 (첫 번째 태스크)
- Produces:
  - `window.Addr.normalize(s: string) → string`
  - `window.Addr.parse(addr: string) → {sido, sgg, emd, road, bunji, rest, suffix}` — 각 필드는 `string | null`
  - 전역 테스트 함수 `test(name: string, fn: function)`, `eq(actual: any, expected: any, label: string)`, `contains(arr: array, value: any, label: string)`

---

- [ ] **Step 1: 테스트 하네스를 만든다**

`test.html` 생성:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>지오코딩 도구 테스트</title>
<style>
  body { font-family: Consolas, monospace; padding: 20px; line-height: 1.6; }
  #summary { font-size: 20px; font-weight: bold; margin-bottom: 16px; padding: 12px;
             border-radius: 6px; }
  #summary.ok  { background: #e8f5e9; color: #1b5e20; }
  #summary.bad { background: #ffebee; color: #b71c1c; }
  ul { list-style: none; padding: 0; }
  li { padding: 3px 0; }
  .pass { color: #2e7d32; }
  .fail { color: #c62828; font-weight: bold; }
  .detail { color: #555; margin-left: 24px; font-size: 13px; }
</style>
</head>
<body>
<div id="summary">실행 중...</div>
<ul id="results"></ul>

<script>
/* 최소 테스트 하네스. 러너·설치 없이 이 파일을 브라우저로 열면 실행된다. */
var __passed = 0, __failed = 0;

function __show(cls, text, detail) {
  var li = document.createElement('li');
  li.className = cls;
  li.textContent = text;
  document.getElementById('results').appendChild(li);
  if (detail) {
    var d = document.createElement('li');
    d.className = 'detail';
    d.textContent = detail;
    document.getElementById('results').appendChild(d);
  }
}

/** 깊은 비교. 객체·배열은 JSON 직렬화로 비교한다. */
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { __passed++; __show('pass', 'PASS  ' + label); }
  else { __failed++; __show('fail', 'FAIL  ' + label, '기대: ' + e + '  /  실제: ' + a); }
}

/** 배열이 특정 값을 포함하는지 검사한다. */
function contains(arr, value, label) {
  if (arr && arr.indexOf(value) !== -1) { __passed++; __show('pass', 'PASS  ' + label); }
  else {
    __failed++;
    __show('fail', 'FAIL  ' + label, '포함되어야 함: ' + JSON.stringify(value) +
           '  /  실제 배열: ' + JSON.stringify(arr));
  }
}

function test(name, fn) {
  __show('', '── ' + name);
  try { fn(); }
  catch (err) { __failed++; __show('fail', 'FAIL  ' + name + ' (예외)', String(err)); }
}

function __finish() {
  var el = document.getElementById('summary');
  el.className = __failed === 0 ? 'ok' : 'bad';
  el.textContent = __failed === 0
    ? '전체 통과 — ' + __passed + '건'
    : '실패 ' + __failed + '건 / 통과 ' + __passed + '건';
}
</script>

<!-- 검사 대상 모듈 -->
<script src="src/address.js"></script>

<!-- 테스트 케이스 -->
<script src="tests/address.test.js"></script>

<script>__finish();</script>
</body>
</html>
```

---

- [ ] **Step 2: 실패하는 파싱 테스트를 작성한다**

`tests/address.test.js` 생성:

```js
/* address.js 테스트 */

test('normalize — 비표준 공백과 연속 공백을 정리한다', function () {
  eq(Addr.normalize('경기도 고양시   일산서구 '), '경기도 고양시 일산서구', '연속공백');
  eq(Addr.normalize('  대화동  '), '대화동', '앞뒤 공백');
  eq(Addr.normalize(null), '', 'null 입력');
  eq(Addr.normalize(undefined), '', 'undefined 입력');
});

test('parse — 시·도 + 2단 시·군·구 + 읍면동 + 번지', function () {
  eq(Addr.parse('경기도 고양시 일산서구 대화동 2600'), {
    sido: '경기도', sgg: '고양시 일산서구', emd: '대화동',
    road: null, bunji: '2600', rest: null, suffix: null
  }, '고양시 일산서구 (2단 시군구)');
});

test('parse — 읍면동까지만 있는 주소는 rest 가 없다 (결함 3.1 회귀)', function () {
  eq(Addr.parse('경기도 고양시 일산서구 대화동'), {
    sido: '경기도', sgg: '고양시 일산서구', emd: '대화동',
    road: null, bunji: null, rest: null, suffix: null
  }, '대화동 — rest 없음');
});

test('parse — 지명형 + 위치 접미어', function () {
  eq(Addr.parse('경기도 고양시 일산서구 한뫼공원주변'), {
    sido: '경기도', sgg: '고양시 일산서구', emd: null,
    road: null, bunji: null, rest: '한뫼공원', suffix: '주변'
  }, '한뫼공원주변 — 접미어 분리');
});

test('parse — 숫자가 섞인 지명도 지명형이다 (결함 3.1 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 제1공원');
  eq(p.rest, '제1공원', '제1공원은 rest');
  eq(p.bunji, null, '제1공원은 번지가 아님');
});

test('parse — 세종특별자치시는 시군구 단계가 없다', function () {
  var p = Addr.parse('세종특별자치시 조치원읍 123');
  eq(p.sido, '세종특별자치시', 'sido');
  eq(p.sgg, '세종특별자치시', 'sgg 는 sido 로 대체');
  eq(p.emd, '조치원읍', 'emd');
  eq(p.bunji, '123', 'bunji');
});

test('parse — 도로명 + 건물번호', function () {
  var p = Addr.parse('경기도 고양시 일산서구 킨텍스로 217');
  eq(p.road, '킨텍스로', 'road');
  eq(p.bunji, '217', 'bunji');
  eq(p.rest, null, 'rest 없음');
});

test('parse — 산 번지', function () {
  var p = Addr.parse('경기도 고양시 일산서구 대화동 산 12-3');
  eq(p.bunji, '산 12-3', '산 번지');
  eq(p.rest, null, 'rest 없음');
});

test('parse — 시·도가 생략된 주소', function () {
  var p = Addr.parse('고양시 일산서구 대화동 2600');
  eq(p.sido, null, 'sido 없음');
  eq(p.sgg, '고양시 일산서구', 'sgg 는 정상 파싱');
});

test('parse — 빈 문자열은 모든 필드가 null', function () {
  eq(Addr.parse(''), {
    sido: null, sgg: null, emd: null,
    road: null, bunji: null, rest: null, suffix: null
  }, '빈 입력');
});
```

---

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

`test.html`을 브라우저로 연다 (더블클릭 가능 — ES 모듈이 아니므로 `file://`에서도 동작한다).

기대 결과: 상단 요약이 붉은색이고, 모든 케이스가 `FAIL ... (예외)`로 나오며 상세에 `Addr is not defined`가 표시된다.

---

- [ ] **Step 4: 파서를 구현한다**

`src/address.js` 생성:

```js
/* 주소 정규화 · 행정구역 파싱 · 검색어 변형 생성
   API·DOM 의존이 없는 순수 모듈. test.html 에서 단독 검증한다. */
(function (global) {
  'use strict';

  /* 지명 뒤에 붙는 위치 표현. 검색 전에 떼어낸다. */
  var SUFFIX_RE = /\s*(주변|일대|인근|부근|옆|앞|뒤)$/;

  /* 시·도. '~특별시/광역시/특별자치시/특별자치도' 또는 '경기도'처럼 '도'로 끝나는 첫 토큰. */
  var SIDO_RE = /(특별시|광역시|특별자치시|특별자치도|[가-힣]도)$/;

  /* 시·군·구. 단, '~읍/면/동/가/리'로 끝나면 제외한다. */
  var SGG_RE = /(시|군|구)$/;
  var EMD_RE = /(읍|면|동|가|리)$/;

  /* 번지: '2600', '12-3', '산12-3' */
  var BUNJI_RE = /^산?\d+(-\d+)?$/;
  var NUM_RE = /^\d+(-\d+)?$/;

  /* 도로명: '킨텍스로', '가좌길' */
  var ROAD_RE = /(로|길)$/;

  /** NBSP 등 비표준 공백을 일반 공백으로 바꾸고 연속 공백을 축약한다. */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[   　]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 주소를 행정구역 단위로 분해한다.
   * 반환 필드는 모두 string 또는 null.
   */
  function parse(addr) {
    var out = {
      sido: null, sgg: null, emd: null,
      road: null, bunji: null, rest: null, suffix: null
    };

    var norm = normalize(addr);
    if (!norm) return out;

    var t = norm.split(' ');
    var i = 0;

    // 1) 시·도
    if (i < t.length && SIDO_RE.test(t[i])) { out.sido = t[i]; i++; }

    // 2) 시·군·구 — '고양시 일산서구'처럼 연속된 토큰을 묶는다
    var sgg = [];
    while (i < t.length && SGG_RE.test(t[i]) && !EMD_RE.test(t[i])) { sgg.push(t[i]); i++; }
    if (sgg.length) out.sgg = sgg.join(' ');

    // 세종특별자치시처럼 시·군·구 단계가 없는 경우 시·도를 시·군·구로 취급한다
    if (!out.sgg && out.sido && /(특별시|광역시|특별자치시)$/.test(out.sido)) {
      out.sgg = out.sido;
    }

    // 3) 읍·면·동·리
    while (i < t.length && EMD_RE.test(t[i]) && !/^\d/.test(t[i])) {
      out.emd = out.emd ? out.emd + ' ' + t[i] : t[i];
      i++;
    }

    // 4) 도로명 + 건물번호
    if (i < t.length && ROAD_RE.test(t[i]) && !BUNJI_RE.test(t[i])) {
      out.road = t[i]; i++;
      if (i < t.length && NUM_RE.test(t[i])) { out.bunji = t[i]; i++; }
    }

    // 5) 지번 — '산 12-3' (분리형) 또는 '2600' / '산12-3' (결합형)
    if (!out.bunji && i < t.length) {
      if (t[i] === '산' && i + 1 < t.length && NUM_RE.test(t[i + 1])) {
        out.bunji = '산 ' + t[i + 1]; i += 2;
      } else if (BUNJI_RE.test(t[i])) {
        out.bunji = t[i]; i++;
      }
    }

    // 6) 남은 토큰은 지명 후보. 위치 접미어를 떼어낸다.
    if (i < t.length) {
      var rest = t.slice(i).join(' ');
      var m = rest.match(SUFFIX_RE);
      if (m) { out.suffix = m[1]; rest = rest.replace(SUFFIX_RE, '').trim(); }
      out.rest = rest || null;
    }

    return out;
  }

  global.Addr = { normalize: normalize, parse: parse };
})(window);
```

---

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

`test.html`을 새로고침한다.

기대 결과: 상단 요약이 초록색 `전체 통과 — 21건`. 실패 0건.

---

- [ ] **Step 6: 커밋한다**

```bash
git add test.html src/address.js tests/address.test.js
git commit -m "feat: 주소 파서와 브라우저 테스트 하네스 추가"
```

---

## Task 2: 경로 판정과 검색어 변형 생성

**Files:**
- Modify: `src/address.js` (모듈에 함수 4개 추가, export 목록 교체)
- Modify: `tests/address.test.js` (파일 끝에 케이스 추가)

**Interfaces:**
- Consumes: `Addr.normalize`, `Addr.parse` (Task 1)
- Produces:
  - `Addr.route(parsed: object) → 'address' | 'place'`
  - `Addr.addressVariants(addr: string) → string[]` — 최대 4개, 중복 제거, 원본이 항상 첫 번째
  - `Addr.keywordCandidates(parsed: object) → string[]` — 넓은 것부터. `rest`가 없으면 빈 배열

---

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`tests/address.test.js` 파일 **끝에** 다음을 덧붙인다:

```js
test('route — 지명이 있으면 장소검색, 없으면 주소검색', function () {
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 대화동 2600')), 'address', '번지 있음');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 대화동')), 'address', '읍면동까지만 (결함 3.1)');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 킨텍스로 217')), 'address', '도로명');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 한뫼공원주변')), 'place', '지명형');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 제1공원')), 'place', '숫자 섞인 지명');
});

test('addressVariants — 4가지 조합을 모두 만든다', function () {
  eq(Addr.addressVariants('고양시 가좌로128'),
     ['고양시 가좌로128', '고양시 가좌로 128'],
     '한글+숫자 분리');

  eq(Addr.addressVariants('고양시 가좌로128 (구청앞)'),
     ['고양시 가좌로128 (구청앞)', '고양시 가좌로 128 (구청앞)',
      '고양시 가좌로128', '고양시 가좌로 128'],
     '숫자분리 · 괄호제거 · 둘 다 적용');

  eq(Addr.addressVariants('고양시 대화동 2600'),
     ['고양시 대화동 2600'],
     '변형할 것이 없으면 원본 1개');
});

test('keywordCandidates — 접미어 제거와 축약이 조합된다 (결함 3.2 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 한뫼공원주변');
  contains(Addr.keywordCandidates(p), '고양시 일산서구 한뫼공원',
           '시군구 + 지명 조합이 반드시 생성됨');
  eq(Addr.keywordCandidates(p),
     ['고양시 일산서구 한뫼공원', '한뫼공원'],
     '넓은 것부터 좁은 순서');
});

test('keywordCandidates — 읍면동이 있으면 가장 넓은 후보에 포함된다', function () {
  var p = Addr.parse('경기도 고양시 일산서구 대화동 한뫼공원');
  eq(Addr.keywordCandidates(p),
     ['고양시 일산서구 대화동 한뫼공원', '고양시 일산서구 한뫼공원', '한뫼공원'],
     '3단계 후보');
});

test('keywordCandidates — 지명이 없으면 빈 배열', function () {
  eq(Addr.keywordCandidates(Addr.parse('경기도 고양시 일산서구 대화동 2600')), [],
     '주소검색 경로는 후보 없음');
});
```

---

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

`test.html`을 새로고침한다.

기대 결과: Task 1의 21건은 통과하고, 새로 추가한 5개 그룹이 `FAIL ... (예외)`로 실패한다. 상세에 `Addr.route is not a function`이 표시된다.

---

- [ ] **Step 3: 함수 4개를 구현한다**

`src/address.js`에서 `global.Addr = { normalize: normalize, parse: parse };` 줄 **바로 앞에** 다음을 삽입한다:

```js
  /** 파싱 결과로 검색 경로를 정한다. 지명(rest)이 남아 있으면 장소검색이다. */
  function route(parsed) {
    return parsed && parsed.rest ? 'place' : 'address';
  }

  /** 배열에 정규화한 값을 중복 없이 넣는다. */
  function pushUniq(arr, value) {
    var v = normalize(value);
    if (v && arr.indexOf(v) === -1) arr.push(v);
  }

  /**
   * 주소검색용 변형을 만든다. 원본 · 숫자분리 · 괄호제거 · 둘 다 적용.
   * 기존 구현은 변형을 조합하지 않아 '숫자분리 + 괄호제거'가 누락되어 있었다.
   */
  function addressVariants(addr) {
    var base = normalize(addr);
    var spaced = base.replace(/([가-힣])(\d)/g, '$1 $2');
    var stripParen = function (s) { return s.replace(/\([^)]*\)/g, ''); };

    var out = [];
    pushUniq(out, base);
    pushUniq(out, spaced);
    pushUniq(out, stripParen(base));
    pushUniq(out, stripParen(spaced));
    return out;
  }

  /**
   * 장소검색용 키워드 후보를 넓은 순서로 만든다.
   * 접미어가 제거된 rest 를 기준으로 조립하므로 조합 누락이 없다.
   */
  function keywordCandidates(parsed) {
    if (!parsed || !parsed.rest) return [];
    var out = [];
    if (parsed.sgg && parsed.emd) pushUniq(out, parsed.sgg + ' ' + parsed.emd + ' ' + parsed.rest);
    if (parsed.sgg) pushUniq(out, parsed.sgg + ' ' + parsed.rest);
    pushUniq(out, parsed.rest);
    return out;
  }
```

그리고 그 아래 export 줄을 다음으로 교체한다:

```js
  global.Addr = {
    normalize: normalize,
    parse: parse,
    route: route,
    addressVariants: addressVariants,
    keywordCandidates: keywordCandidates
  };
```

---

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

`test.html`을 새로고침한다.

기대 결과: 초록색 `전체 통과 — 33건`. 실패 0건. 특히 `시군구 + 지명 조합이 반드시 생성됨`이 PASS여야 한다 — 이것이 결함 3.2의 회귀 방지선이다.

---

- [ ] **Step 5: 커밋한다**

```bash
git add src/address.js tests/address.test.js
git commit -m "feat: 경로 판정과 검색어 변형 조합 생성 추가"
```

---

## Task 3: 시·군·구 지역 게이트

**Files:**
- Create: `src/gate.js`
- Create: `tests/gate.test.js`
- Modify: `test.html` (스크립트 2줄 추가)

**Interfaces:**
- Consumes: `Addr.parse` (Task 1)
- Produces:
  - `window.Gate.check(resultJibun: string, parsedSgg: string|null) → 'in' | 'out' | 'skip'`
    - `'in'` = 관할 내, `'out'` = 관할 밖, `'skip'` = 판정 불가(게이트 미적용)

---

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`tests/gate.test.js` 생성:

```js
/* gate.js 테스트 */

test('check — 같은 시·군·구면 관할 내', function () {
  eq(Gate.check('경기도 고양시 일산서구 대화동 2600', '고양시 일산서구'), 'in', '완전 일치');
});

test('check — 다른 시·군·구면 관할 밖', function () {
  eq(Gate.check('강원특별자치도 춘천시 효자동 100', '고양시 일산서구'), 'out', '다른 시');
  eq(Gate.check('경기도 고양시 덕양구 행신동 50', '고양시 일산서구'), 'out', '같은 시 다른 구');
});

test('check — 띄어쓰기 차이를 흡수한다', function () {
  eq(Gate.check('경기도 고양시일산서구 대화동 2600', '고양시 일산서구'), 'in', '결과에 공백 없음');
  eq(Gate.check('경기도 고양시 일산서구 대화동 2600', '고양시일산서구'), 'in', '원본에 공백 없음');
});

test('check — 판정할 수 없으면 skip (게이트 미적용)', function () {
  eq(Gate.check('경기도 고양시 일산서구 대화동 2600', null), 'skip', '원본 시군구 파싱 실패');
  eq(Gate.check('', '고양시 일산서구'), 'skip', '결과 주소가 빔');
  eq(Gate.check(null, '고양시 일산서구'), 'skip', '결과 주소가 null');
  eq(Gate.check('한뫼공원', '고양시 일산서구'), 'skip', '결과에서 시군구를 못 뽑음');
});

test('check — 시·군·구까지만 비교하고 읍면동은 보지 않는다', function () {
  eq(Gate.check('경기도 고양시 일산서구 주엽동 10', '고양시 일산서구'), 'in',
     '동이 달라도 관할 내 (공원·하천이 동 경계를 넘나들기 때문)');
});
```

---

- [ ] **Step 2: `test.html`에 게이트 모듈과 테스트를 등록한다**

`test.html`에서 다음 블록을 찾는다:

```html
<!-- 검사 대상 모듈 -->
<script src="src/address.js"></script>

<!-- 테스트 케이스 -->
<script src="tests/address.test.js"></script>
```

다음으로 교체한다:

```html
<!-- 검사 대상 모듈 -->
<script src="src/address.js"></script>
<script src="src/gate.js"></script>

<!-- 테스트 케이스 -->
<script src="tests/address.test.js"></script>
<script src="tests/gate.test.js"></script>
```

---

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

`test.html`을 새로고침한다.

기대 결과: Task 1·2의 33건은 통과하고, 게이트 5개 그룹이 `FAIL ... (예외)`로 실패한다. 상세에 `Gate is not defined`가 표시된다.

---

- [ ] **Step 4: 게이트를 구현한다**

`src/gate.js` 생성:

```js
/* 시·군·구 관할 판정
   장소검색 결과가 원본 주소의 관할 안에 있는지 확인한다.
   Addr.parse 에만 의존하며 API·DOM 의존은 없다. */
(function (global) {
  'use strict';

  /** 비교용 표준형. 공백을 제거해 '고양시 일산서구'와 '고양시일산서구'를 같게 본다. */
  function canon(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '');
  }

  /**
   * 결과 주소가 관할 안인지 판정한다.
   *   'in'   관할 내
   *   'out'  관할 밖 — 폐기하지 말고 검수 목록에 함께 넘긴다
   *   'skip' 판정 불가 — 게이트를 적용하지 않고 검수 우선순위를 높인다
   */
  function check(resultJibun, parsedSgg) {
    if (!parsedSgg) return 'skip';
    if (!resultJibun) return 'skip';

    var resultSgg = global.Addr.parse(resultJibun).sgg;
    if (!resultSgg) return 'skip';

    return canon(resultSgg) === canon(parsedSgg) ? 'in' : 'out';
  }

  global.Gate = { check: check };
})(window);
```

---

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

`test.html`을 새로고침한다.

기대 결과: 초록색 `전체 통과 — 43건`. 실패 0건.

---

- [ ] **Step 6: 커밋한다**

```bash
git add src/gate.js tests/gate.test.js test.html
git commit -m "feat: 시군구 지역 게이트 추가"
```

---

## Task 4: 기존 도구에 파서와 게이트를 배선한다

이 태스크가 끝나면 **도구의 실제 동작이 바뀐다.** 결함 3.1·3.2·3.3이 여기서 해소된다.

**Files:**
- Modify: `index.html` (카카오 SDK `<script>` 아래에 2줄 추가)
- Modify: `app.js:64-84` (변형 함수 2개 삭제)
- Modify: `app.js:265-273` (`isLandmarkAddress` 삭제)
- Modify: `app.js:291-326` (`geocodeAddressUncached` 재작성)
- Modify: `app.js:492-498` (검수 목록 등록부)
- Modify: `app.js:543-544` (`renderFailList` — 배지 표시)
- Modify: `app.js:565-566` (`selectItem` — 관할 밖만 있는 경우 처리)
- Modify: `app.js:615-644` (`showCandidates` 재작성)
- Modify: `style.css` (파일 끝에 배지 스타일 추가)

**Interfaces:**
- Consumes: `Addr.parse`, `Addr.route`, `Addr.addressVariants`, `Addr.keywordCandidates` (Task 1·2), `Gate.check` (Task 3)
- Produces: `geocodeAddressUncached(addr)` 반환값
  - `{status: 'ok', method, lon, lat, jibun, road, usedQuery}` — 기존과 동일
  - `{status: 'ambiguous', candidates: Array, outside: Array, usedQuery}` — `outside`는 관할 밖 후보
  - `{status: 'fail', outside: Array, reason: string}` — `reason`은 `'검색 결과 없음'` 또는 `'관할 내 결과 없음'`
- `reviewList` 항목에 `outside: Array` 필드가 추가된다

---

- [ ] **Step 1: 모듈을 로드한다**

`index.html`에서 다음 두 줄을 찾는다:

```html
<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=e15236035f91c232bbfe80eb5d65e417&libraries=services"></script>
</head>
```

다음으로 교체한다:

```html
<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=e15236035f91c232bbfe80eb5d65e417&libraries=services"></script>
<!-- 주소 파싱 · 지역 게이트 (순수 모듈, test.html 로 검증됨) -->
<script src="src/address.js"></script>
<script src="src/gate.js"></script>
</head>
```

---

- [ ] **Step 2: 낡은 변형 함수와 지명형 판정을 삭제한다**

`app.js`에서 아래 두 블록을 삭제한다. `normalizeAddress` 함수는 **남긴다** — 다른 곳에서 계속 쓰인다.

삭제 대상 1 — `addressVariants`와 `keywordVariants` (기존 64~84행):

```js
/** 주소검색 실패 시 순차적으로 시도할 변형들 */
function addressVariants(addr) {
  const out = [addr];
  const push = (v) => { const t = normalizeAddress(v); if (t && !out.includes(t)) out.push(t); };
  // '가좌로128' -> '가좌로 128' (한글 뒤에 숫자가 바로 붙은 경우 공백 삽입)
  push(addr.replace(/([가-힣])(\d)/g, '$1 $2'));
  // 괄호 안 부가정보 제거
  push(addr.replace(/\([^)]*\)/g, ''));
  return out;
}

/** 장소검색용 키워드 변형: '한뫼공원주변' -> '한뫼공원' 처럼 위치 접미어 제거 */
function keywordVariants(addr) {
  const out = [addr];
  const push = (v) => { const t = normalizeAddress(v); if (t && !out.includes(t)) out.push(t); };
  push(addr.replace(/\s*(주변|일대|인근|부근|옆|앞|뒤)\s*$/, ''));
  // 시도/시군구 접두어를 떼고 마지막 지명만 (예: '경기도 고양시 일산서구 한뫼공원' -> '고양시 한뫼공원')
  const parts = addr.split(' ');
  if (parts.length >= 3) push(parts.slice(-2).join(' '));
  return out;
}
```

삭제 대상 2 — `isLandmarkAddress` (기존 265~273행, 주석 포함):

```js
/**
 * 번지/건물번호가 전혀 없는 지명형 주소인지 판별.
 * 예) '경기도 고양시 일산서구 한뫼공원주변', '... 멱절마을 한류천'
 * 이런 주소는 주소검색이 100% 실패하므로 곧바로 장소검색으로 보낸다. (호출 1~2회 절약)
 */
function isLandmarkAddress(addr) {
  const tail = addr.split(' ').pop() || '';
  return !/\d/.test(tail);
}
```

---

- [ ] **Step 3: 지오코딩 본체를 재작성한다**

`app.js`의 `geocodeAddressUncached` 함수 전체를 다음으로 교체한다:

```js
/**
 * 한 주소를 지오코딩한다.
 * - 주소검색 경로: 변형 4종을 순차 시도
 * - 장소검색 경로: 키워드 후보 3종을 순차 시도하되 시·군·구 게이트를 적용
 * 관할 밖 후보는 폐기하지 않고 outside 로 넘겨 담당자가 판단하게 한다.
 */
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
```

**주의:** 캐시 래퍼 `geocodeAddress`는 이 태스크에서 수정하지 않는다. 캐시 정책 변경(성공만 캐시)은 Phase 2의 오류 처리 태스크에서 다룬다.

---

- [ ] **Step 4: 검수 목록에 관할 밖 후보를 넘긴다**

`app.js`의 `startBtn` 핸들러 안에서 다음 블록을 찾는다:

```js
      } else if (r.status === 'ambiguous') {
        reviewList.push({ rowIndex, address: addr, candidates: r.candidates, resolved: false, reason: '후보 여러 건' });
        fail++;
      } else {
        reviewList.push({ rowIndex, address: addr, candidates: null, resolved: false, reason: '검색 결과 없음' });
        fail++;
      }
```

다음으로 교체한다:

```js
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
```

---

- [ ] **Step 5: 검수 목록에서 관할 밖 후보가 있는 항목을 표시한다**

`app.js`의 `renderFailList` 안에서 다음 두 줄을 찾는다:

```js
    li.innerHTML = `<span class="addr"></span><span class="reason">${item.reason}</span>`;
    li.querySelector('.addr').textContent = item.address; // XSS 방지: 주소는 textContent 로
```

다음으로 교체한다:

```js
    const outsideCount = (item.outside || []).length;
    const outsideBadge = outsideCount ? `<span class="badge-outside">관할 밖 ${outsideCount}</span>` : '';
    li.innerHTML = `<span class="addr"></span><span class="reason">${item.reason}</span>${outsideBadge}`;
    li.querySelector('.addr').textContent = item.address; // XSS 방지: 주소는 textContent 로
```

---

- [ ] **Step 6: 관할 밖 후보만 있는 항목도 지도에 띄운다**

`app.js`의 `selectItem` 함수에서 다음 두 줄을 찾는다:

```js
  if (item.candidates) showCandidates(item.candidates, item.address);
  else runKeywordSearch(item.address);
```

다음으로 교체한다:

```js
  if (item.candidates) showCandidates(item.candidates, item.address, item.outside);
  else if (item.outside && item.outside.length) showCandidates([], item.address, item.outside);
  else runKeywordSearch(item.address);
```

---

- [ ] **Step 7: 후보 목록에 관할 밖 항목을 구분해서 보여준다**

`app.js`의 `showCandidates` 함수 전체를 다음으로 교체한다:

```js
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
```

---

- [ ] **Step 8: 배지 스타일을 추가한다**

`style.css` 파일 **끝에** 다음을 덧붙인다:

```css
/* 관할 밖 후보 표시 */
.badge-outside {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 10px;
  background: #fff3e0;
  color: #e65100;
  font-size: 11px;
  font-weight: bold;
}
.search-results .outside-head {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #ccc;
  color: #e65100;
  font-size: 12px;
  cursor: default;
}
.search-results .outside-item {
  background: #fff8f0;
  color: #8d4b00;
}
```

---

- [ ] **Step 9: 순수 모듈 테스트가 여전히 통과하는지 확인한다**

`test.html`을 새로고침한다.

기대 결과: 초록색 `전체 통과 — 43건`. (이 태스크는 `app.js` / `index.html` / `style.css`만 건드렸으므로 변화가 없어야 한다.)

---

- [ ] **Step 10: 도구를 실제로 띄워 손으로 확인한다**

정적 서버가 필요하다. 파이썬이 있으면 프로젝트 폴더에서:

```bash
python -m http.server 8090
```

브라우저에서 `http://localhost:8090/index.html`을 연다.
(카카오 SDK는 `file://`에서 동작하지 않으므로 반드시 `http://`로 열어야 한다. 카카오 디벨로퍼스의 JavaScript SDK 도메인에 `http://localhost:8090`이 등록되어 있어야 한다.)

확인 항목:
1. 개발자도구 콘솔에 `Addr is not defined` / `Gate is not defined` 오류가 없다
2. 지번주소 컬럼이 있는 엑셀을 올려 지오코딩을 실행하면 진행률이 정상 증가한다
3. 읍·면·동까지만 있는 주소(예: `'경기도 고양시 일산서구 대화동'`)가 결과의 `매칭방식` 컬럼에 `주소검색`으로 기록된다 — 기존에는 `장소검색` 경로로 빠졌다
4. 검수 목록에서 관할 밖 후보가 있는 항목에 주황색 `관할 밖 N` 배지가 보인다
5. 그 항목을 클릭하면 후보 목록 아래에 `── 관할 밖 후보 N건` 구분선과 항목이 보이고, 클릭하면 좌표가 기록되며 `매칭방식`이 `장소검색(관할밖선택)`이 된다

---

- [ ] **Step 11: 커밋한다**

```bash
git add index.html app.js style.css
git commit -m "feat: 구조적 주소 파싱과 지역 게이트를 지오코딩 경로에 적용"
```

---

## Self-Review 결과

**스펙 커버리지 (DESIGN.md 기준)**

| 스펙 항목 | 대응 태스크 |
|---|---|
| §3.1 지명형 판정 오류 | Task 1 Step 4 (파서), Task 2 Step 3 (`route`), Task 4 Step 2 (`isLandmarkAddress` 삭제) |
| §3.2 변형 조합 누락 | Task 2 Step 3 (`addressVariants` 4조합, `keywordCandidates` 조립) |
| §3.3 지역 제한 없는 자동채택 | Task 3 (게이트), Task 4 Step 3 (적용) |
| §6 주소 파싱 규칙 1~9 | Task 1 Step 4 |
| §6 경로 판정 | Task 2 Step 3 |
| §6 변형 생성 (4조합 / 키워드 3단계) | Task 2 Step 3 |
| §8 지역 게이트 — 시군구 기준 | Task 3 Step 4 |
| §8 관할 밖 후보 보존 | Task 4 Step 3·6·7 |
| §8 sgg 파싱 실패 시 미적용 | Task 3 Step 4 (`'skip'` 반환), Task 4 Step 3 (`skip`을 후보로 인정) |
| §14 회귀 케이스 5종 | Task 1·2·3 테스트에 전부 포함 |

**타입 일관성 확인**

- `Addr.parse` 반환 필드명(`sido`/`sgg`/`emd`/`road`/`bunji`/`rest`/`suffix`)이 Task 1·2·3·4에서 동일하게 사용됨
- `Gate.check` 반환값 `'in'`/`'out'`/`'skip'`이 Task 3 정의와 Task 4 Step 3 사용처에서 일치
- `reviewList` 항목의 `outside` 필드가 Task 4 Step 4(생성) → Step 5(배지) → Step 6(전달) → Step 7(표시)에서 일관되게 사용됨
- `showCandidates(data, keyword, outside)` 3-인자 시그니처가 Step 6의 두 호출부와 Step 7의 정의에서 일치

---

## 이 계획에서 다루지 않은 것 — Phase 2로 이월

DESIGN.md의 다음 항목은 이 계획 범위 밖이며, Phase 1 완료 후 별도 계획으로 작성한다. 각각 독립적으로 동작·검증 가능하다.

1. **출력 컬럼 개편 + 좌표계 5181 고정** — §3.5, §3.6, §11, §12
2. **오류 처리** — 연속 실패 차단기, 성공만 캐시, 라이브러리 로드 확인 — §3.7, §3.8, §3.10, §13
3. **대체주소 사전** — §9
4. **다중 시트** — §3.4, §10
5. **결과 워크북 인터리브** (`A` / `A_완료`) — §11
6. **VWorld 프로바이더** — §5.1. **§15.1 약관 확인이 끝나기 전에는 착수하지 않는다**

**Phase 1만으로 성립하는 이유:** 이 계획이 끝나면 도구는 지금과 동일한 입출력으로 동작하되, 지명형 오판이 사라지고 관할 밖 오답이 자동 채택되지 않는다. 요청의 핵심인 대체주소 품질이 여기서 개선된다.
