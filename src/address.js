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
      .replace(/[   　]/g, ' ')
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
