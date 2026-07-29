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
