/* quickgeo.js 테스트 — 표본은 실제 울진 공중화장실 엑셀 구조(위쪽 범례 + 아래쪽 헤더) */

var QG_AOA = [
  ['', '', '', '', '* 개방화장실'],
  ['', '', '', '', '신규설치'],
  ['화장실'],
  ['', '주소', '세부주소', '세부용도', '화장실명', '관리전화'],
  [210, '울진군 북면 울진북로 2092 (부구리, 부구주유소)', '울진군 북면 부구리 143-6', '개방화장실', 'GS칼텍스주유소', '054-783-0345'],
  [1, '근남면 행곡리 677전', '울진군 근남면 행곡리 677', '간이화장실', '행곡2리', '054-789-4412'],
  [8, '울진군 후포면 후포리 산 141-9', '울진군 후포면 후포리 산141-9', '공중화장실', '후포등기산공원', ''],
  ['', '울진군 근남면 구산리 1111-1', '', '간이화장실', '구산4리', '054-789-4412']
];

test('findHeaderRow — 위쪽 범례/제목줄을 건너뛰고 실제 헤더를 찾는다', function () {
  eq(QuickGeo.findHeaderRow(QG_AOA), 3, '4번째 행(인덱스 3)이 헤더');
  eq(QuickGeo.findHeaderRow([['이름', '주소'], ['a', 'b']]), 0, '평범한 1행 헤더');
});

test('cleanAddress — 지목 한 글자와 꼬리 표현 제거', function () {
  eq(QuickGeo.cleanAddress('근남면 행곡리 677전'), '근남면 행곡리 677', '677전 -> 677');
  eq(QuickGeo.cleanAddress('후포면 금음리 9-3 대'), '후포면 금음리 9-3', '9-3 대 -> 9-3');
  eq(QuickGeo.cleanAddress('울진읍 읍내리 100 외 3필지'), '울진읍 읍내리 100', '외 3필지 제거');
  eq(QuickGeo.cleanAddress('울진군 북면 울진북로 2092'), '울진군 북면 울진북로 2092', '정상 주소는 그대로');
});

test('rankAddressColumns — 주 주소/보조 주소 열 추정', function () {
  var r = QuickGeo.rankAddressColumns(QG_AOA, 3);
  eq(r[0].col, 1, '주 주소 = 주소(B)');
  eq(r[1].col, 2, '보조 주소 = 세부주소(C)');
  eq(r.some(function (x) { return x.col === 5; }), false, '전화번호 열은 후보 아님');
});

test('guessNameColumn — 장소명 열 추정 (주소 열 제외)', function () {
  eq(QuickGeo.guessNameColumn(QG_AOA[3], [1, 2]), 4, '화장실명(E)');
  eq(QuickGeo.guessNameColumn(['주소', '값'], [0]), -1, '없으면 -1');
});

test('inferRegion / withRegion — 시군구 빠진 주소 보정', function () {
  var vals = QG_AOA.slice(4).map(function (r) { return r[1]; });
  eq(QuickGeo.inferRegion(vals), '울진군', '가장 흔한 시군구');
  eq(QuickGeo.withRegion('근남면 행곡리 677전', '울진군'), '울진군 근남면 행곡리 677', '지역 붙임 + 지목 제거');
  eq(QuickGeo.withRegion('울진군 근남면 구산리 1111-1', '울진군'), '울진군 근남면 구산리 1111-1', '이미 있으면 그대로');
});

test('toEwkt — SRID 포함 EWKT', function () {
  eq(QuickGeo.toEwkt(1.5, 2, 'EPSG:5186'), 'SRID=5186;POINT(1.5 2)', '5186');
});
