/* 좌표계 목록 — 지오코딩 페이지(app.js)와 간편 geom 페이지(quick-geom.js)가 함께 쓴다.
   proj4 가 먼저 로드되어 있어야 한다. 좌표계를 추가하려면 이 배열에만 넣으면 된다. */
(function (global) {
  'use strict';

  // 기존 시트의 X/Y는 WGS84 경위도가 아니라 투영좌표계(미터)입니다.
  // 후보들끼리 수백 m씩 어긋나므로 "기존 좌표로 자동 판정" 기능으로 확정하는 것을 권장합니다.
  var CRS_LIST = [
    { code: 'EPSG:5181', label: 'EPSG:5181 - Korea 2000 중부원점 (y_0=500000)',
      def: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs' },
    { code: 'EPSG:5174', label: 'EPSG:5174 - Korean 1985 보정중부원점',
      def: '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43' },
    { code: 'EPSG:2097', label: 'EPSG:2097 - Korean 1985 중부원점',
      def: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43' },
    { code: 'EPSG:5186', label: 'EPSG:5186 - Korea 2000 중부원점 (y_0=600000)',
      def: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs' },
    { code: 'EPSG:5185', label: 'EPSG:5185 - Korea 2000 서부원점',
      def: '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs' },
    { code: 'EPSG:5187', label: 'EPSG:5187 - Korea 2000 동부원점',
      def: '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs' },
    { code: 'EPSG:5179', label: 'EPSG:5179 - UTM-K (통합원점)',
      def: '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs' },
    { code: 'EPSG:4326', label: 'EPSG:4326 - WGS84 경위도 (변환 없이 그대로)', def: null },
  ];
  CRS_LIST.forEach(function (c) { if (c.def) global.proj4.defs(c.code, c.def); });

  global.CRS_LIST = CRS_LIST;
})(window);
