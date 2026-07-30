/* 대체주소 사전
   한 번 확정한 "지명형 주소 -> 실제 주소 + 좌표" 매핑을 누적해 재사용한다.
   같은 대상지를 매년 반복 처리하므로 회차를 거듭할수록 수동 보정이 줄어든다.

   좌표는 WGS84 경위도만 저장한다. X/Y(투영좌표)는 사용 시점에 선택된 좌표계로
   다시 계산한다 — 사전을 만들 때와 쓸 때 좌표계가 달라도 어긋나지 않게 하기 위함.

   API·DOM 의존 없음. Addr.normalize 만 사용한다. */
(function (global) {
  'use strict';

  /* 사전 엑셀의 컬럼 순서. 내보내기/불러오기가 이 순서를 공유한다. */
  var HEADERS = ['원본주소', '대체주소', '경도(WGS84)', '위도(WGS84)', '시군구', '출처', '등록일', '비고'];

  /* 정규화된 원본주소 -> 항목. 완전일치 조회만 지원한다(부분일치는 오답 위험). */
  var store = Object.create(null);

  function norm(s) {
    return global.Addr ? global.Addr.normalize(s) : String(s == null ? '' : s).trim();
  }

  function today() {
    var d = new Date();
    var mm = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
  }

  function isNum(v) {
    return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));
  }

  function clear() {
    store = Object.create(null);
  }

  function size() {
    return Object.keys(store).length;
  }

  /** 완전일치 조회. 없으면 null. */
  function lookup(addr) {
    var k = norm(addr);
    if (!k) return null;
    return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
  }

  /**
   * 항목 추가/갱신.
   * entry: { original, altAddress, lon, lat, sgg, source, addedAt, note }
   * 좌표가 숫자가 아니면 저장하지 않는다 — 쓸모없는 항목이 사전을 오염시키지 않게.
   */
  function add(entry) {
    var k = norm(entry && entry.original);
    if (!k) return false;
    if (!isNum(entry.lon) || !isNum(entry.lat)) return false;

    store[k] = {
      original: k,
      altAddress: entry.altAddress || '',
      lon: parseFloat(entry.lon),
      lat: parseFloat(entry.lat),
      sgg: entry.sgg || '',
      source: entry.source || '',
      addedAt: entry.addedAt || today(),
      note: entry.note || ''
    };
    return true;
  }

  /**
   * 엑셀에서 읽은 AOA(0행=헤더)로 사전을 채운다. 기존 내용은 유지하고 덮어쓴다.
   * 헤더 이름으로 컬럼을 찾으므로 컬럼 순서가 바뀌어도 동작한다.
   * 반환: { loaded, skipped } — 형식이 어긋난 행은 건너뛰고 개수만 보고한다.
   */
  function loadFromAOA(aoa) {
    var result = { loaded: 0, skipped: 0 };
    if (!aoa || aoa.length < 2) return result;

    var header = aoa[0].map(function (h) { return String(h == null ? '' : h).trim(); });
    var col = {};
    HEADERS.forEach(function (name) { col[name] = header.indexOf(name); });

    if (col['원본주소'] < 0) { result.skipped = aoa.length - 1; return result; }

    for (var i = 1; i < aoa.length; i++) {
      var row = aoa[i];
      if (!row) { result.skipped++; continue; }
      var pick = (function (r) {
        return function (name) { return col[name] >= 0 ? r[col[name]] : ''; };
      })(row);

      var ok = add({
        original: pick('원본주소'),
        altAddress: pick('대체주소'),
        lon: pick('경도(WGS84)'),
        lat: pick('위도(WGS84)'),
        sgg: pick('시군구'),
        source: pick('출처'),
        addedAt: pick('등록일'),
        note: pick('비고')
      });
      if (ok) result.loaded++; else result.skipped++;
    }
    return result;
  }

  /** 사전 전체를 엑셀 저장용 AOA(0행=헤더)로 만든다. 원본주소 순으로 정렬한다. */
  function toAOA() {
    var keys = Object.keys(store).sort();
    var out = [HEADERS.slice()];
    for (var i = 0; i < keys.length; i++) {
      var e = store[keys[i]];
      out.push([e.original, e.altAddress, e.lon, e.lat, e.sgg, e.source, e.addedAt, e.note]);
    }
    return out;
  }

  global.Dict = {
    HEADERS: HEADERS,
    clear: clear,
    size: size,
    lookup: lookup,
    add: add,
    loadFromAOA: loadFromAOA,
    toAOA: toAOA
  };
})(window);
