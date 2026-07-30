/* dictionary.js 테스트 */

test('lookup — 저장한 항목을 정규화된 주소로 찾는다', function () {
  Dict.clear();
  Dict.add({ original: '경기도 고양시 일산서구 한뫼공원주변',
             altAddress: '경기도 고양시 일산서구 대화동 2600',
             lon: 126.77, lat: 37.65, sgg: '고양시 일산서구', source: '수동지정' });

  var hit = Dict.lookup('경기도 고양시 일산서구 한뫼공원주변');
  eq(hit === null, false, '조회 성공');
  eq(hit.altAddress, '경기도 고양시 일산서구 대화동 2600', '대체주소');
  eq(hit.lon, 126.77, '경도');
  eq(hit.lat, 37.65, '위도');
});

test('lookup — 연속 공백이 달라도 같은 항목으로 본다', function () {
  Dict.clear();
  Dict.add({ original: '경기도  고양시   일산서구 한뫼공원주변',
             altAddress: 'A', lon: 1, lat: 2 });
  eq(Dict.lookup('경기도 고양시 일산서구 한뫼공원주변') !== null, true, '정규화 후 일치');
});

test('lookup — 없는 주소는 null', function () {
  Dict.clear();
  eq(Dict.lookup('없는 주소'), null, 'miss');
  eq(Dict.lookup(''), null, '빈 문자열');
});

test('add — 좌표가 숫자가 아니면 저장하지 않는다', function () {
  Dict.clear();
  eq(Dict.add({ original: 'A', lon: '', lat: '' }), false, '빈 좌표');
  eq(Dict.add({ original: 'A', lon: 'abc', lat: 'def' }), false, '숫자 아님');
  eq(Dict.add({ original: '', lon: 1, lat: 2 }), false, '주소 없음');
  eq(Dict.size(), 0, '아무것도 저장 안 됨');
});

test('loadFromAOA — 헤더 이름으로 컬럼을 찾는다 (순서가 달라도 동작)', function () {
  Dict.clear();
  var aoa = [
    ['비고', '원본주소', '위도(WGS84)', '경도(WGS84)', '대체주소', '시군구', '출처', '등록일'],
    ['메모', '□□공원주변', 37.6, 127.0, '◇◇동 1000', '○○시 △△구', '수동지정', '2026-07-30']
  ];
  var r = Dict.loadFromAOA(aoa);
  eq(r.loaded, 1, '1건 로드');
  eq(r.skipped, 0, '건너뛴 행 없음');

  var hit = Dict.lookup('□□공원주변');
  eq(hit.altAddress, '◇◇동 1000', '대체주소');
  eq(hit.lon, 127.0, '경도');
  eq(hit.addedAt, '2026-07-30', '등록일');
});

test('loadFromAOA — 형식이 어긋난 행은 건너뛰고 개수만 보고한다', function () {
  Dict.clear();
  var aoa = [
    ['원본주소', '대체주소', '경도(WGS84)', '위도(WGS84)'],
    ['정상', 'A', 127.0, 37.6],
    ['좌표없음', 'B', '', ''],
    ['', 'C', 127.0, 37.6]
  ];
  var r = Dict.loadFromAOA(aoa);
  eq(r.loaded, 1, '정상 1건만');
  eq(r.skipped, 2, '2건 건너뜀');
});

test('loadFromAOA — 원본주소 컬럼이 없으면 전부 건너뛴다', function () {
  Dict.clear();
  var r = Dict.loadFromAOA([['엉뚱한', '헤더'], ['a', 'b']]);
  eq(r.loaded, 0, '로드 0');
  eq(Dict.size(), 0, '사전 비어있음');
});

test('toAOA — 헤더 + 정렬된 항목을 만든다', function () {
  Dict.clear();
  Dict.add({ original: 'B주소', altAddress: 'b', lon: 2, lat: 2, addedAt: '2026-07-30' });
  Dict.add({ original: 'A주소', altAddress: 'a', lon: 1, lat: 1, addedAt: '2026-07-30' });

  var aoa = Dict.toAOA();
  eq(aoa[0], ['원본주소', '대체주소', '경도(WGS84)', '위도(WGS84)', '시군구', '출처', '등록일', '비고'], '헤더');
  eq(aoa[1][0], 'A주소', '정렬 첫 행');
  eq(aoa[2][0], 'B주소', '정렬 둘째 행');
  eq(aoa.length, 3, '헤더 + 2건');
});

test('내보내기 -> 불러오기 왕복이 값을 보존한다', function () {
  Dict.clear();
  Dict.add({ original: '□□공원주변', altAddress: '◇◇동 1000',
             lon: 127.0001234, lat: 37.6001234,
             sgg: '○○시 △△구', source: '수동지정', addedAt: '2026-07-30', note: '검수확정' });
  var exported = Dict.toAOA();

  Dict.clear();
  eq(Dict.size(), 0, '비운 상태');
  Dict.loadFromAOA(exported);

  var hit = Dict.lookup('□□공원주변');
  eq(hit.altAddress, '◇◇동 1000', '대체주소 보존');
  eq(hit.lon, 127.0001234, '경도 보존');
  eq(hit.sgg, '○○시 △△구', '시군구 보존');
  eq(hit.source, '수동지정', '출처 보존');
  eq(hit.note, '검수확정', '비고 보존');
});
