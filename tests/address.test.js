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
