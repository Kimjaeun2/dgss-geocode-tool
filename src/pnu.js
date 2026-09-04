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
    if (addressObj.main_address_no == null || addressObj.main_address_no === '') return '';
    var mountain = addressObj.mountain_yn === '1' ? '1' : '0';
    var main = pad4(addressObj.main_address_no);
    var sub = pad4(addressObj.sub_address_no);
    return addressObj.b_code + mountain + main + sub;
  }

  global.Pnu = { buildPnu: buildPnu };
})(window);
