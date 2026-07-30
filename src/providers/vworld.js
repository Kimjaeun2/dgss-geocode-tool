/* VWorld Open API 프로바이더 (지오코더 2.0 / 검색 2.0)
   JSONP 로 호출한다 (VWorld 는 CORS 대신 callback 파라미터를 지원한다).
   API 키가 없거나 플레이스홀더 상태면 isAvailable() 이 false 를 반환하고,
   호출부(app.js)는 이 경우 VWorld 단계를 건너뛰고 카카오만으로 동작한다.

   주의: 응답 필드명(response.result.point 등)은 VWorld 공식 문서 요약을 바탕으로
   작성했고, 실제 키로 호출한 원본 응답을 아직 확인하지 못했다. 첫 실제 호출에서
   기대한 필드가 없으면 콘솔에 원본 응답을 그대로 찍는다 — 그 로그를 보고
   parseGetcoordResponse / parseSearchResponse 의 필드 경로를 맞춰야 할 수 있다. */
(function (global) {
  'use strict';

  var PLACEHOLDER = '24BF2E1D-35E5-321D-BCFC-B953984C1D4A';

  function isAvailable() {
    var key = global.VWORLD_API_KEY;
    return !!key && key !== PLACEHOLDER;
  }

  /** <script> 태그로 JSONP 요청을 보낸다. */
  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve) {
      var cbName = 'vworldCb' + Date.now() + Math.floor(Math.random() * 1e6);
      var script = document.createElement('script');
      var done = false;

      function cleanup() {
        delete global[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        resolve({ state: 'error', reason: 'timeout' });
      }, timeoutMs || 8000);

      global[cbName] = function (data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve({ state: 'ok', data: data });
      };

      script.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve({ state: 'error', reason: 'network' });
      };

      script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + cbName;
      document.head.appendChild(script);
    });
  }

  /** 응답이 기대한 모양이 아닐 때 원인 진단을 돕기 위해 원본을 한 번 찍는다. */
  function warnUnexpected(label, raw) {
    if (global.console && global.console.warn) {
      global.console.warn(
        '[VWorld] ' + label + ' — 예상한 필드를 찾지 못했습니다. ' +
        'src/providers/vworld.js 의 파싱 로직을 이 응답에 맞춰 확인하세요.',
        raw
      );
    }
  }

  /**
   * 지번(PARCEL) 또는 도로명(ROAD) 주소를 WGS84 좌표로 변환한다.
   * type: 'PARCEL' | 'ROAD'
   * 반환: { state: 'ok', lon, lat, refinedText } | { state: 'zero' } | { state: 'error' }
   */
  function getcoord(address, type) {
    if (!isAvailable()) return Promise.resolve({ state: 'error', reason: 'no-key' });

    var url = 'https://api.vworld.kr/req/address'
      + '?service=address&request=getcoord&version=2.0'
      + '&crs=EPSG:4326'
      + '&address=' + encodeURIComponent(address)
      + '&type=' + type
      + '&refine=true&simple=false&format=json'
      + '&key=' + encodeURIComponent(global.VWORLD_API_KEY);

    return jsonp(url, 8000).then(function (r) {
      if (r.state !== 'ok') return { state: 'error' };

      var res = r.data && r.data.response;
      if (!res || !res.status) { warnUnexpected('getcoord: response.status 없음', r.data); return { state: 'error' }; }
      if (res.status === 'NOT_FOUND') return { state: 'zero' };
      if (res.status !== 'OK') return { state: 'error' };

      var point = res.result && res.result.point;
      if (!point || point.x == null || point.y == null) {
        warnUnexpected('getcoord: result.point 없음', r.data);
        return { state: 'error' };
      }

      return {
        state: 'ok',
        lon: parseFloat(point.x),
        lat: parseFloat(point.y),
        refinedText: (res.refined && res.refined.text) || '',
      };
    });
  }

  /**
   * 키워드로 장소를 검색한다. 카카오 keywordSearch 결과와 같은 모양으로
   * 정규화해서 반환한다 — 기존 app.js 의 Gate.check / showCandidates / saveCoord 가
   * 그대로 재사용된다 (x, y, place_name, address_name, road_address_name).
   * 반환: { state: 'ok', data: [...] } | { state: 'zero' } | { state: 'error' }
   */
  function search(keyword) {
    if (!isAvailable()) return Promise.resolve({ state: 'error', reason: 'no-key' });

    var url = 'https://api.vworld.kr/req/search'
      + '?service=search&request=search&version=2.0'
      + '&query=' + encodeURIComponent(keyword)
      + '&type=place&category=&format=json&size=10&page=1'
      + '&key=' + encodeURIComponent(global.VWORLD_API_KEY);

    return jsonp(url, 8000).then(function (r) {
      if (r.state !== 'ok') return { state: 'error' };

      var res = r.data && r.data.response;
      if (!res || !res.status) { warnUnexpected('search: response.status 없음', r.data); return { state: 'error' }; }
      if (res.status === 'NOT_FOUND') return { state: 'zero' };
      if (res.status !== 'OK') return { state: 'error' };

      var items = res.result && res.result.items;
      if (!items || !items.length) { warnUnexpected('search: result.items 없음', r.data); return { state: 'zero' }; }

      var data = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var pt = it.point || {};
        var addr = it.address || {};
        data.push({
          x: parseFloat(pt.x),
          y: parseFloat(pt.y),
          place_name: it.title || '',
          address_name: addr.parcel || '',
          road_address_name: addr.road || '',
        });
      }
      return { state: 'ok', data: data };
    });
  }

  global.VWorld = { isAvailable: isAvailable, getcoord: getcoord, search: search };
})(window);
