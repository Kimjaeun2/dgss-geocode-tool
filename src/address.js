/* 주소 정규화 · 행정구역 파싱 · 검색어 변형 생성
   API·DOM 의존이 없는 순수 모듈. test.html 에서 단독 검증한다. */
(function (global) {
  'use strict';

  /* 지명 뒤에 붙는 위치 표현. 검색 전에 떼어낸다. */
  var SUFFIX_RE = /\s*(주변|일대|인근|부근|옆|앞|뒤)$/;

  /* 시·도. '~특별시/광역시/특별자치시/특별자치도' 또는 '경기도'처럼 '도'로 끝나는 첫 토큰. */
  var SIDO_RE = /(특별시|광역시|특별자치시|특별자치도|[가-힣]도)$/;

  /* 시·도 축약형. '경기도' 대신 '경기'만 쓰는 표기도 카카오맵 등에서 실제로 인정된다.
     정확히 일치할 때만 시·도로 본다 (부분 일치 시 다른 지명과 오인 위험). */
  var SIDO_SHORT = [
    '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
    '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
  ];

  /* 시·군·구. 단, '~읍/면/동/가/리'로 끝나면 제외한다. */
  var SGG_RE = /(시|군|구)$/;
  var EMD_RE = /(읍|면|동|가|리)$/;

  /* 번지: '2600', '12-3', '산12-3' */
  var BUNJI_RE = /^산?\d+(-\d+)?$/;
  var NUM_RE = /^\d+(-\d+)?$/;

  /* 도로명: '킨텍스로', '가좌길' */
  var ROAD_RE = /(로|길)$/;

  /* 도로명과 건물번호 사이에 공백이 없는 경우 ('곳산길157-24', '산덕로24번길12-2').
     비탐욕 매칭이 로/길이 여러 번 나오는 '~로24번길' 같은 이름에서도 건물번호 앞
     마지막 로/길 지점을 찾아낸다. */
  var ROAD_BUNJI_RE = /^(.+?(?:로|길))(\d+(?:-\d+)?)$/;

  /* 위 정규식은 문자열 끝이 정확히 숫자여야 한다. 건물번호 뒤에 시설명이 공백
     없이 더 붙으면('경의로790한산천') 위 정규식이 실패해 통째로 지명(rest)이
     된다 — 실제 데이터 다수가 이 패턴이었다. 이 경우를 위한 완화형이며,
     ROAD_BUNJI_RE 가 실패했을 때만 시도한다. group1을 탐욕적으로 매칭해
     '~로24번길' 처럼 로/길이 여러 번 나오는 이름에서도 마지막 지점을 찾는다
     (비탐욕 + 3번째 그룹이 있으면 첫 로/길에서 바로 매칭이 성사돼버려
     마지막 지점을 찾는 효과가 사라지기 때문에 ROAD_BUNJI_RE 와 탐욕 방향을
     다르게 가져간다). */
  var ROAD_BUNJI_NOTE_RE = /^(.+(?:로|길))(\d+(?:-\d+)?)([가-힣].*)$/;

  /* 읍/면/동/가/리 와 번지 사이에 공백이 없는 경우 ('구산동1071', '덕이동산207').
     도로명과 같은 이유로 공백이 없으면 그대로 지명(rest)으로 빠져 장소검색으로
     잘못 보내진다 — 도로명 결합 처리와 동일한 패턴을 행정구역에도 적용한다.
     '산'(임야 지번) 접두어와, 번지 뒤에 붙는 '번지'라는 글자(예: '930번지')도
     함께 처리한다. */
  var EMD_BUNJI_RE = /^(.+?(?:읍|면|동|가|리))(산?\d+(?:-\d+)?)(?:번지)?$/;

  /* ROAD_BUNJI_NOTE_RE 와 같은 이유. 번지 뒤에 시설명이 공백 없이 더 붙는 경우
     ('대화동1449-1송포공원')를 위한 완화형이며, EMD_BUNJI_RE 가 실패했을 때만
     시도한다. */
  var EMD_BUNJI_NOTE_RE = /^(.+(?:읍|면|동|가|리))(산?\d+(?:-\d+)?)(?:번지)?([가-힣].*)$/;

  /* 한 필지에 번지가 콤마로 여러 개 나열된 경우 ('주엽동3,142', '일산동1042,1043').
     공동 소유·연접 필지로 보이며, 검색에는 첫 번째 번지만 쓴다 — 나머지를 넣으면
     대부분의 지오코더가 아예 인식하지 못한다. 원본 주소 전체는 '소재지' 컬럼에
     그대로 남으므로 정보가 사라지지는 않는다. */
  var EMD_MULTI_BUNJI_RE = /^(.+?(?:읍|면|동|가|리))(산?\d+(?:-\d+)?)\s*,\s*\d+(?:-\d+)?([가-힣].*)?$/;

  /* 담당자가 붙인 참고메모 괄호 ('대산로58(민원)', '한뫼공원(환가주변)',
     '종합운동장주변(민원)대화동2325-3'처럼 문자열 중간에 낀 경우도 있음).
     구조 판정 전에 떼어낸다 — 안 떼면 ROAD_BUNJI_RE/EMD_BUNJI_RE 가 "끝이
     숫자여야 함" 조건 때문에 완전히 유효한 도로명+번지도 통째로 놓친다.
     삭제가 아니라 공백으로 치환한다 — 괄호 앞뒤가 원래 서로 다른 토큰이었는데
     그냥 지워버리면 숫자끼리 붙어 번지가 깨질 수 있다 ('220-10(메모)5회'를
     그냥 지우면 '220-105회'가 되어 번지가 '220-105'로 오염된다). */
  var NOTE_PAREN_RE = /\s*\([^()]*\)\s*/g;

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

    // 참고메모 괄호는 위치에 관계없이 구조 판정 전에 떼어낸다 ('대산로58(민원)' -> '대산로58')
    norm = normalize(norm.replace(NOTE_PAREN_RE, ' '));
    if (!norm) return out;

    // 위치 접미어도 구조 판정 전에 미리 떼어낸다. 번지 뒤에 공백 없이 바로
    // 붙어도('일청로12번길28주변') 구조 인식을 방해하지 않도록 하기 위함.
    var suffixMatch = norm.match(SUFFIX_RE);
    if (suffixMatch) {
      out.suffix = suffixMatch[1];
      norm = normalize(norm.replace(SUFFIX_RE, ''));
    }
    if (!norm) return out;

    var t = norm.split(' ');
    var i = 0;
    // 번지(읍면동/도로명 결합형) 뒤에 공백 없이 붙은 시설명. rest 계산에 합쳐진다.
    var glueNote = null;

    // 1) 시·도 (축약형도 인정: '경기도' 뿐 아니라 '경기'도 시·도로 본다)
    if (i < t.length && (SIDO_RE.test(t[i]) || SIDO_SHORT.indexOf(t[i]) !== -1)) {
      out.sido = t[i]; i++;
    }

    // 2) 시·군·구 — '고양시 일산서구'처럼 연속된 토큰을 묶는다
    var sgg = [];
    while (i < t.length && SGG_RE.test(t[i]) && !EMD_RE.test(t[i])) { sgg.push(t[i]); i++; }
    if (sgg.length) out.sgg = sgg.join(' ');

    // 세종특별자치시처럼 시·군·구 단계가 없는 경우 시·도를 시·군·구로 취급한다
    if (!out.sgg && out.sido && /(특별시|광역시|특별자치시)$/.test(out.sido)) {
      out.sgg = out.sido;
    }

    // 시군구와 실제 주소 사이에 낀 무관한 단어를 건너뛴다 (예: '민원 킨텍스로240').
    // 최대 2개까지만 건너뛰고, 그 안에서 도로명/읍면동+번지 구조를 못 찾으면
    // 원래 위치로 되돌린다 — 진짜 지명(landmark)까지 잘못 건드리지 않기 위함.
    (function skipNoiseWords() {
      var saved = i, skipped = 0;
      while (i < t.length && skipped <= 2) {
        var tok = t[i];
        var isAnchor = EMD_BUNJI_RE.test(tok) || EMD_BUNJI_NOTE_RE.test(tok) ||
          EMD_MULTI_BUNJI_RE.test(tok) ||
          ROAD_BUNJI_RE.test(tok) || ROAD_BUNJI_NOTE_RE.test(tok) ||
          (EMD_RE.test(tok) && !/^\d/.test(tok)) ||
          (ROAD_RE.test(tok) && !BUNJI_RE.test(tok));
        if (isAnchor) return;
        i++; skipped++;
      }
      i = saved; // 못 찾음 - 지명 처리로 넘어가도록 원위치
    })();

    // 3) 읍·면·동·리 (번지가 공백 없이 붙어 있으면 여기서 분리하고 끝낸다)
    while (i < t.length) {
      // '대화동' 처럼 깨끗하게 끝나고 바로 다음 토큰이 번지라면(공백으로 분리된
      // 정상 케이스) NOTE 완화형을 시도하지 않는다 — 그렇지 않으면 '신덕로24번길'
      // 처럼 이름 안에 우연히 위치 표현이 들어있는 경우 잘못된 지점에서 끊길 수 있다.
      var hasSeparateBunjiNextEmd = EMD_RE.test(t[i]) && !/^\d/.test(t[i]) &&
        (i + 1 < t.length) && NUM_RE.test(t[i + 1]);
      var strictEmd = t[i].match(EMD_BUNJI_RE);
      var noteEmd = (!strictEmd && !hasSeparateBunjiNextEmd) ? t[i].match(EMD_BUNJI_NOTE_RE) : null;
      var multiEmd = (!strictEmd && !noteEmd && !hasSeparateBunjiNextEmd) ? t[i].match(EMD_MULTI_BUNJI_RE) : null;
      var combinedEmd = strictEmd || noteEmd || multiEmd;
      if (combinedEmd) {
        out.emd = out.emd ? out.emd + ' ' + combinedEmd[1] : combinedEmd[1];
        out.bunji = combinedEmd[2];
        if (combinedEmd[3]) glueNote = combinedEmd[3];
        i++;
        break;
      }
      if (EMD_RE.test(t[i]) && !/^\d/.test(t[i])) {
        out.emd = out.emd ? out.emd + ' ' + t[i] : t[i];
        i++;
      } else {
        break;
      }
    }

    // 4) 도로명 + 건물번호
    if (i < t.length) {
      // EMD 케이스와 동일한 이유로, 공백으로 분리된 정상적인 다음 토큰이
      // 번지라면 NOTE 완화형을 시도하지 않는다.
      var hasSeparateBunjiNextRoad = ROAD_RE.test(t[i]) && !BUNJI_RE.test(t[i]) &&
        (i + 1 < t.length) && NUM_RE.test(t[i + 1]);
      var strictRoad = t[i].match(ROAD_BUNJI_RE);
      var noteRoad = (!strictRoad && !hasSeparateBunjiNextRoad) ? t[i].match(ROAD_BUNJI_NOTE_RE) : null;
      var combined = strictRoad || noteRoad;
      if (combined) {
        // 도로명과 건물번호가 공백 없이 붙어 있는 경우 (결함: 관할 게이트 회귀 원인)
        out.road = combined[1];
        out.bunji = combined[2];
        if (combined[3]) glueNote = combined[3];
        i++;
      } else if (ROAD_RE.test(t[i]) && !BUNJI_RE.test(t[i])) {
        out.road = t[i]; i++;
        if (i < t.length && NUM_RE.test(t[i])) { out.bunji = t[i]; i++; }
      }
    }

    // 5) 지번 — '산 12-3' (분리형) 또는 '2600' / '산12-3' (결합형)
    if (!out.bunji && i < t.length) {
      if (t[i] === '산' && i + 1 < t.length && NUM_RE.test(t[i + 1])) {
        out.bunji = '산 ' + t[i + 1]; i += 2;
      } else if (BUNJI_RE.test(t[i])) {
        out.bunji = t[i]; i++;
      }
    }

    // 6) 남은 토큰 + 번지에 공백 없이 붙어 있던 시설명(glueNote)은 지명 후보.
    // 위치 접미어를 떼어낸다.
    var restParts = [];
    if (glueNote) restParts.push(glueNote);
    if (i < t.length) restParts.push(t.slice(i).join(' '));
    if (restParts.length) {
      var rest = restParts.join(' ');
      var m = rest.match(SUFFIX_RE);
      if (m) { out.suffix = m[1]; rest = rest.replace(SUFFIX_RE, '').trim(); }
      out.rest = rest || null;
    }

    return out;
  }

  /**
   * 파싱 결과로 검색 경로를 정한다.
   * 번지가 이미 확정됐으면(예: '대화동1974-5 유충'에서 '유충'만 남은 경우) 뒤에
   * 남은 텍스트는 참고메모로 보고 무조건 주소검색으로 보낸다 — 번지 확정이
   * rest 유무보다 더 강한 신호다. 번지가 없을 때만 rest 유무로 판단한다.
   */
  function route(parsed) {
    if (!parsed) return 'address';
    if (parsed.bunji) return 'address';
    return parsed.rest ? 'place' : 'address';
  }

  /** 배열에 정규화한 값을 중복 없이 넣는다. */
  function pushUniq(arr, value) {
    var v = normalize(value);
    if (v && arr.indexOf(v) === -1) arr.push(v);
  }

  /**
   * 주소검색용 변형을 만든다. 원본 · 숫자분리 · 괄호제거 · 둘 다 적용.
   * 기존 구현은 변형을 조합하지 않아 '숫자분리 + 괄호제거'가 누락되어 있었다.
   */
  function addressVariants(addr) {
    var base = normalize(addr);
    var spaced = base.replace(/([가-힣])(\d)/g, '$1 $2');
    var stripParen = function (s) { return s.replace(/\([^)]*\)/g, ''); };
    // 콤마로 나열된 두 번째 이후 번지는 대부분의 지오코더가 인식하지 못하므로
    // 버리고 첫 번째 번지만 남긴다 ('주엽동3,142' -> '주엽동3').
    var dropExtraBunji = function (s) { return s.replace(/(\d)\s*,\s*\d+(?:-\d+)?/g, '$1'); };

    var out = [];
    pushUniq(out, base);
    pushUniq(out, spaced);
    pushUniq(out, stripParen(base));
    pushUniq(out, stripParen(spaced));
    pushUniq(out, dropExtraBunji(base));
    pushUniq(out, dropExtraBunji(stripParen(base)));
    return out;
  }

  /**
   * 장소검색용 키워드 후보를 넓은 순서로 만든다.
   * 접미어가 제거된 rest 를 기준으로 조립하므로 조합 누락이 없다.
   */
  function keywordCandidates(parsed) {
    if (!parsed || !parsed.rest) return [];
    var out = [];
    if (parsed.sgg && parsed.emd) pushUniq(out, parsed.sgg + ' ' + parsed.emd + ' ' + parsed.rest);
    if (parsed.sgg) pushUniq(out, parsed.sgg + ' ' + parsed.rest);
    pushUniq(out, parsed.rest);
    return out;
  }

  global.Addr = {
    normalize: normalize,
    parse: parse,
    route: route,
    addressVariants: addressVariants,
    keywordCandidates: keywordCandidates
  };
})(window);
