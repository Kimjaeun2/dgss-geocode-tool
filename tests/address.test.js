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

test('parse — 읍면동+번지 뒤에 공백 없이 시설명이 붙어도 번지를 인식한다 (실제 데이터 다수 발견, 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 대화동1449-1송포공원');
  eq(p.emd, '대화동', 'emd');
  eq(p.bunji, '1449-1', 'bunji');
  eq(p.rest, '송포공원', '붙어있던 시설명은 rest로 넘어감');
  eq(Addr.route(p), 'address', '번지가 확정됐으므로 address 경로');

  var p2 = Addr.parse('경기도 고양시 일산서구 탄현동1472탄현공원(DMS)');
  eq(p2.emd, '탄현동', 'emd — 괄호 참고메모는 구조 판정 전에 먼저 제거됨');
  eq(p2.bunji, '1472', 'bunji');
  eq(p2.rest, '탄현공원', 'rest');
  eq(Addr.route(p2), 'address', '(DMS) 표기가 붙어도 address 경로');
});

test('parse — 도로명+번지 뒤에 공백 없이 시설명이 붙어도 번지를 인식한다 (경의로790한산천, 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 경의로790한산천');
  eq(p.road, '경의로', 'road');
  eq(p.bunji, '790', 'bunji');
  eq(p.rest, '한산천', 'rest');
  eq(Addr.route(p), 'address', 'route');
});

test('parse — 도로명+번지 뒤에 시설명과 위치접미어가 함께 공백 없이 붙는 경우 (송산로486-28선인장연구소주변, 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 송산로486-28선인장연구소주변');
  eq(p.road, '송산로', 'road');
  eq(p.bunji, '486-28', 'bunji');
  eq(p.suffix, '주변', '접미어는 구조 판정 전에 먼저 분리됨');
  eq(p.rest, '선인장연구소', 'rest');
  eq(Addr.route(p), 'address', 'route');
});

test('parse — 번지 뒤 글루드 시설명 확장 이후에도 순수 지명형은 여전히 place 로 남는다 (회귀 방지)', function () {
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 제1공원')), 'place', '숫자 섞인 순수 지명 (기존 회귀 유지)');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 킨텍스4번게이트주변')), 'place', '번지 구조가 아닌 지명 (기존 회귀 유지)');
  eq(Addr.route(Addr.parse('경기도 고양시 일산서구 덕이동 하이파크2단지 옆 수로')), 'place', '공백으로 분리된 지명은 여전히 place (덕이동만 번지 없이 확정)');
});

test('parse — 콤마로 번지가 여러 개 나열돼도 첫 번째 번지로 주소검색 경로를 잡는다 (실제 데이터 발견, 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 주엽동3,142');
  eq(p.emd, '주엽동', 'emd');
  eq(p.bunji, '3', '첫 번째 번지만 확정');
  eq(Addr.route(p), 'address', '번지가 확정됐으므로 address 경로');

  var p2 = Addr.parse('경기도 고양시 일산서구 일산동1042,1043');
  eq(p2.bunji, '1042', '첫 번째 번지만 확정');
  eq(Addr.route(p2), 'address', 'route');
});

test('parse — 콤마 나열 번지 뒤에 시설명까지 공백 없이 붙어도 처리한다 (주엽동127,129문촌18단지백암공원, 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 주엽동127,129문촌18단지백암공원');
  eq(p.emd, '주엽동', 'emd');
  eq(p.bunji, '127', '첫 번째 번지만 확정');
  eq(p.rest, '문촌18단지백암공원', 'rest — 두 번째 번지 이후 시설명');
  eq(Addr.route(p), 'address', 'route');
});

test('addressVariants — 콤마로 나열된 두 번째 번지를 버린 변형이 후보에 포함된다 (회귀)', function () {
  var v = Addr.addressVariants('경기도 고양시 일산서구 주엽동3,142');
  contains(v, '경기도 고양시 일산서구 주엽동3', '첫 번째 번지만 남긴 변형 포함');
});

test('parse — 참고메모 괄호가 문자열 중간에 있어도 뒤에 이어지는 진짜 주소를 찾는다 (실제 데이터 발견, 회귀)', function () {
  var p = Addr.parse('경기도 고양시 일산서구 종합운동장주변(민원)대화동2325-3');
  eq(p.emd, '대화동', 'emd — 괄호 뒤에 이어지는 진짜 주소를 인식');
  eq(p.bunji, '2325-3', 'bunji');
  eq(Addr.route(p), 'address', '괄호 앞의 지명(종합운동장주변)은 잃더라도 정확한 주소를 우선한다');

  var p2 = Addr.parse('경기도 고양시 일산서구 덕이로220-10(10번홪자)5회');
  eq(p2.road, '덕이로', 'road');
  eq(p2.bunji, '220-10', 'bunji — 괄호를 지우면서 숫자가 섞이지 않아야 함 (220-105 아님)');
  eq(p2.rest, '5회', 'rest');
  eq(Addr.route(p2), 'address', 'route');
});
