/* 간편 geom 만들기 (quick-geom.html) 전용 순수 로직.
   API·DOM 의존 없음 — test.html 에서 단독 검증한다. Addr(address.js)에만 의존.

   이 페이지의 목표는 "설정 없이 파일만 넣으면 된다"이다. 그래서 사람이 고르던
   것들(제목줄 위치, 주소 열, 보조 주소 열, 장소명 열, 지역)을 전부 데이터로
   추정한다. 추정이 틀리면 화면에서 바꿀 수 있으니, 여기 함수들은 "그럴듯한
   기본값"만 책임진다. */
(function (global) {
  'use strict';

  var Addr = global.Addr;

  /* 주소 열로 볼 만한 헤더 이름 */
  var ADDR_HEADER_RE = /주소|소재지|지번|도로명|위치|address|addr/i;
  /* 장소명 열로 볼 만한 헤더 이름 ('화장실명', '시설명', '명칭', '이름') */
  var NAME_HEADER_RE = /명$|명칭|이름|name/i;

  /* 지번 뒤에 붙는 지목 한 글자 ('행곡리 677전', '금음리 9-3 대').
     안 떼면 parse() 가 '677전'을 번지로 못 읽어 장소검색으로 잘못 보낸다. */
  var JIMOK_RE = /(\d)\s*(전|답|과|목|임|광|염|대|장|학|차|주|창|도|철|제|천|구|유|양|수|공|체|원|종|사|묘|잡)$/;
  /* '외 3필지', '일원' 같은 꼬리 */
  var TAIL_RE = /\s*(외\s*\d+\s*필지|일원)$/;

  function str(v) { return v == null ? '' : String(v).trim(); }

  /**
   * 제목줄(헤더) 위치를 찾는다. 위쪽에 제목·범례가 몇 줄 있는 실무 엑셀이 흔해서
   * 1행을 헤더로 가정하면 안 된다. 앞 30행 중 "숫자가 아닌 글자 칸"이 가장 많은
   * 행을 헤더로 본다(동점이면 위쪽) — 데이터 행은 숫자가 섞이므로 보통 진다.
   */
  function findHeaderRow(aoa) {
    var best = 0, bestScore = -1;
    var n = Math.min(aoa.length, 30);
    for (var i = 0; i < n; i++) {
      var score = 0;
      (aoa[i] || []).forEach(function (v) {
        var s = str(v);
        if (s && isNaN(Number(s))) score++;
      });
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  /** 검색 전에 주소를 다듬는다: 지목 한 글자, '외 n필지', '일원' 제거. */
  function cleanAddress(s) {
    var t = Addr.normalize(s);
    var prev;
    do { prev = t; t = t.replace(TAIL_RE, '').replace(JIMOK_RE, '$1').trim(); } while (t !== prev);
    return t;
  }

  /** 주소처럼 생겼나: 읍면동 또는 도로명이 있고 번지까지 있다. */
  function looksLikeAddress(s) {
    var p = Addr.parse(cleanAddress(s));
    return !!((p.emd || p.road) && p.bunji);
  }

  /**
   * 주소 열 후보를 점수 순으로 돌려준다: [{ col, score }].
   * 점수 = (데이터 표본 중 주소처럼 생긴 비율) + 헤더 이름 가산점 0.5.
   * 첫 번째가 주 주소 열, 두 번째(점수 0.5 이상)가 보조 주소 열 후보다.
   */
  function rankAddressColumns(aoa, headerRow) {
    var header = aoa[headerRow] || [];
    var width = 0;
    for (var r = headerRow; r < aoa.length; r++) width = Math.max(width, (aoa[r] || []).length);
    var out = [];
    for (var c = 0; c < width; c++) {
      var seen = 0, hits = 0;
      for (var i = headerRow + 1; i < aoa.length && seen < 60; i++) {
        var v = str((aoa[i] || [])[c]);
        if (!v) continue;
        seen++;
        if (looksLikeAddress(v)) hits++;
      }
      var score = (seen ? hits / seen : 0) + (ADDR_HEADER_RE.test(str(header[c])) ? 0.5 : 0);
      if (score > 0) out.push({ col: c, score: score });
    }
    // 동점이면 왼쪽 열 우선 (sort 는 안정 정렬)
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  /** 장소명 열 추정. 주소 열은 제외. 없으면 -1. */
  function guessNameColumn(header, exclude) {
    for (var c = 0; c < header.length; c++) {
      if (exclude.indexOf(c) !== -1) continue;
      var h = str(header[c]);
      if (h && NAME_HEADER_RE.test(h) && !ADDR_HEADER_RE.test(h)) return c;
    }
    return -1;
  }

  /**
   * 파일 전체에서 가장 많이 나온 '시도 시군구'를 지역으로 추정한다.
   * '근남면 행곡리 677'처럼 시군구가 빠진 주소에 붙여 검색 정확도를 올린다.
   */
  function inferRegion(values) {
    var count = {};
    values.forEach(function (v) {
      var p = Addr.parse(cleanAddress(v));
      if (!p.sgg) return;
      var key = (p.sido ? p.sido + ' ' : '') + p.sgg;
      count[key] = (count[key] || 0) + 1;
    });
    var best = '', n = 0;
    Object.keys(count).forEach(function (k) { if (count[k] > n) { best = k; n = count[k]; } });
    return best;
  }

  /** 시군구가 없는 주소 앞에 지역을 붙인다. */
  function withRegion(addr, region) {
    var a = cleanAddress(addr);
    if (!a || !region) return a;
    var p = Addr.parse(a);
    return p.sgg ? a : region + ' ' + a;
  }

  /** PostGIS ST_GeomFromEWKT 로 바로 읽히는 형식 */
  function toEwkt(x, y, crsCode) {
    return 'SRID=' + String(crsCode).replace(/^EPSG:/i, '') + ';POINT(' + x + ' ' + y + ')';
  }

  global.QuickGeo = {
    findHeaderRow: findHeaderRow,
    cleanAddress: cleanAddress,
    looksLikeAddress: looksLikeAddress,
    rankAddressColumns: rankAddressColumns,
    guessNameColumn: guessNameColumn,
    inferRegion: inferRegion,
    withRegion: withRegion,
    toEwkt: toEwkt
  };
})(window);
