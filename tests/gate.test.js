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
