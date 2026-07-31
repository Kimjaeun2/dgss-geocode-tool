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

test('parse — 도로명+건물번호가 공백 없이 붙은 경우 (배포 후 발견된 회귀)', function () {
  eq(Addr.parse('경기도 고양시 일산서구 곳산길157-24'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: null, road: '곳산길', bunji: '157-24', rest: null, suffix: null },
     '곳산길157-24');

  eq(Addr.parse('경기도 고양시 일산서구 대화로54-6'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: null, road: '대화로', bunji: '54-6', rest: null, suffix: null },
     '대화로54-6');

  eq(Addr.parse('경기도 고양시 일산서구 산덕로24번길12-2'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: null, road: '산덕로24번길', bunji: '12-2', rest: null, suffix: null },
     '산덕로24번길12-2 — 로/길이 두 번 나오는 이름');

  eq(Addr.parse('경기도 고양시 일산서구 송포로113번길191-87'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: null, road: '송포로113번길', bunji: '191-87', rest: null, suffix: null },
     '송포로113번길191-87');
});

test('route — 결합형 도로명 주소는 반드시 address 경로여야 한다 (회귀 방지)', function () {
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 곳산길157-24')), 'address', '곳산길157-24');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 송산로197번길9')), 'address', '송산로197번길9');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 법곳길136번길30')), 'address', '법곳길136번길30');
});

test('parse — 읍면동+번지가 공백 없이 붙은 경우 (구산동1071, 회귀)', function () {
  eq(Addr.parse('경기도 고양시 일산서구 구산동1071'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: '구산동', road: null, bunji: '1071', rest: null, suffix: null },
     '구산동1071');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 구산동1071')), 'address', '구산동1071 route');

  eq(Addr.parse('경기도 고양시 일산서구 가좌동941'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: '가좌동', road: null, bunji: '941', rest: null, suffix: null },
     '가좌동941');
});

test('parse — 시군구와 실제 주소 사이에 낀 무관한 단어를 건너뛴다 (민원 킨텍스로240, 회귀)', function () {
  eq(Addr.parse('경기도 고양시 일산서구 민원 킨텍스로240'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: null, road: '킨텍스로', bunji: '240', rest: null, suffix: null },
     '민원 킨텍스로240 — 잡음 단어 건너뛰고 도로명+번지 인식');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 민원 킨텍스로240')), 'address', '민원 킨텍스로240 route');
});

test('parse — 실제 지명(landmark)까지 건드리지 않는다 (잡음 건너뛰기 회귀 방지)', function () {
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 한뫼공원주변')), 'place', '한뫼공원주변은 여전히 지명형');
  eq(Addr.parse('경기도 고양시 일산서구 한뫼공원 주변').rest, '한뫼공원', '한뫼공원 주변도 정상');
});

test('parse — 시도 축약형도 인정한다 (경기도 대신 경기, 회귀)', function () {
  eq(Addr.parse('경기 고양시 일산서구 신덕로24번길 12-2'),
     { sido: '경기', sgg: '고양시 일산서구', emd: null, road: '신덕로24번길', bunji: '12-2', rest: null, suffix: null },
     '경기(축약) — 카카오맵도 인정하는 표기');
  eq(Addr.route(Addr.parse('경기 고양시 일산서구 신덕로24번길 12-2')), 'address', '경기(축약) route');

  eq(Addr.parse('대구 중구 동성로 1').sido, '대구', '대구(광역시 축약)도 인정');
  eq(Addr.parse('대구 중구 동성로 1').sgg, '중구', '대구 다음 중구는 sgg로 정상 파싱');
});

test('parse — 괄호 참고메모가 붙은 도로명/읍면동+번지도 인식한다 (실사용 데이터 발견, 회귀)', function () {
  eq(Addr.parse('경기도 고양시 일산서구 대산로58(민원)'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: null, road: '대산로', bunji: '58', rest: null, suffix: null },
     '대산로58(민원)');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 대화동1499-1(민원)')), 'address', '대화동1499-1(민원) route');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 한뫼공원(환가주변)')), 'place',
     '한뫼공원(환가주변)은 여전히 지명형 (회귀 방지)');
});

test('route — 번지가 확정되면 뒤에 남은 설명은 무시하고 주소검색으로 보낸다 (회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 대화동1974-5 유충');
  eq(p.emd, '대화동', 'emd');
  eq(p.bunji, '1974-5', 'bunji');
  eq(p.rest, '유충', 'rest에는 남지만');
  eq(Addr.route(p), 'address', 'route는 address (번지 확정이 rest보다 우선)');
});

test('parse — 동 이름에 산+번지가 붙은 경우 (덕이동산207, 회귀)', function () {
  eq(Addr.parse('경기도 고양시 일산서구 덕이동산207'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: '덕이동', road: null, bunji: '산207', rest: null, suffix: null },
     '덕이동산207');
});

test('parse — 번지 뒤에 "번지"라는 글자가 붙어도 인식한다 (구산동930번지, 회귀)', function () {
  eq(Addr.parse('경기도 고양시 일산서구 구산동930번지'),
     { sido: '경기도', sgg: '고양시 일산서구', emd: '구산동', road: null, bunji: '930', rest: null, suffix: null },
     '구산동930번지');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 일산동1104번지')), 'address', '일산동1104번지 route');
});

test('parse — 번지 뒤에 공백 없이 위치접미어가 붙어도 구조를 먼저 인식한다 (일청로12번길28주변, 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 일청로12번길28주변');
  eq(p.road, '일청로12번길', 'road');
  eq(p.bunji, '28', 'bunji');
  eq(p.suffix, '주변', 'suffix로 분리됨');
  eq(Addr.route(p), 'address', 'route');
});
