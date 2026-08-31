const fs = require('fs');
const KEY = '9cb8fd71a6e7324e80f1fcd82ef8ee73';

// GCJ02（火星坐标）→ WGS84（标准坐标）
function gcj02ToWgs84(lon, lat) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  const tLat = (x, y) => {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  };
  const tLon = (x, y) => {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  };
  const dLat = tLat(lon - 105, lat - 35);
  const dLon = tLon(lon - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat); magic = 1 - ee * magic * magic;
  const sq = Math.sqrt(magic);
  const dLat2 = (dLat * 180) / ((a * (1 - ee)) / (magic * sq) * Math.PI);
  const dLon2 = (dLon * 180) / (a / sq * Math.cos(radLat) * Math.PI);
  return [lon - dLon2, lat - dLat2];
}

// 贝壳区名 → 高德 district 关键词
const DISTRICTS = [
  ['武侯区', '武侯区'], ['锦江区', '锦江区'], ['青羊区', '青羊区'], ['金牛区', '金牛区'], ['成华区', '成华区'],
  ['高新区', '高新区'], ['高新区西区', '高新区'], ['天府新区', '天府新区'], ['天府新区南区', '天府新区'],
  ['双流区', '双流区'], ['温江区', '温江区'], ['郫都区', '郫都区'], ['龙泉驿区', '龙泉驿区'],
  ['新都', '新都区'], ['青白江', '青白江区'],
  ['都江堰', '都江堰市'], ['彭州', '彭州市'], ['简阳', '简阳市'], ['新津区', '新津区'],
  ['崇州', '崇州市'], ['大邑', '大邑县'], ['金堂', '金堂县'], ['蒲江', '蒲江县'], ['邛崃', '邛崃市'],
];

(async () => {
  const features = [];
  const missing = [];
  for (const [displayName, kw] of DISTRICTS) {
    const url = `https://restapi.amap.com/v3/config/district?keywords=${encodeURIComponent(kw)}&subdistrict=0&extensions=all&city=成都&key=${KEY}`;
    try {
      const r = await fetch(url);
      const d = await r.json();
      const dist = d.districts && d.districts[0];
      if (!dist || !dist.polyline) { missing.push(displayName); continue; }
      const rings = dist.polyline.split('|').map(ring =>
        ring.split(';').map(p => {
          const [lon, lat] = p.split(',').map(Number);
          if (!isFinite(lon) || !isFinite(lat)) return null;
          if (lon < 102 || lon > 106 || lat < 29 || lat > 32) return null; // 成都范围过滤，避免同名区
          return gcj02ToWgs84(lon, lat);
        }).filter(Boolean)
      ).filter(r => r.length >= 3);
      if (!rings.length) { missing.push(displayName); continue; }
      rings.forEach(r => r.push(r[0]));
      for (const ring of rings) {
        features.push({ type: 'Feature', properties: { name: displayName }, geometry: { type: 'LineString', coordinates: ring } });
      }
      console.log(displayName, '→', kw, '环数', rings.length, '点', rings.reduce((a, r) => a + r.length, 0));
    } catch (e) { missing.push(displayName); console.log(displayName, '失败', e.message); }
    await new Promise(r => setTimeout(r, 250));
  }
  fs.writeFileSync('data/districts.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
  console.log('\n完成，共', features.length, '个区边界（feature）');
  console.log('没抓到的区:', missing.length ? missing.join('、') : '无');
})();
