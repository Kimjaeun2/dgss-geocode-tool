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
