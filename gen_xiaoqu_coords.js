// 生成小区坐标：先楼栋匹配（buildings.geojson），匹配不到用高德 place 搜索兜底
// 坐标统一存 WGS84（报告页用高德底图，前端会 wgs2gcj 转换）
const fs = require('fs');
const path = require('path');
const https = require('https');

const buildings = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
const dir = 'data/ke_xiaoqu';
const listFile = path.join(dir, 'xiaoqu_list.json');
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));

// 清洗名称
const clean = s => (s || '').replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').replace(/[·\s·]/g, '');
const stripQi = s => s.replace(/[一二三四五六七八九十\d]+期$/, '');

// GCJ02 → WGS84
function gcj2wgs(gcjLon, gcjLat) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }
  function transformLon(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return ret;
  }
  const dLat = transformLat(gcjLon - 105.0, gcjLat - 35.0);
  const dLon = transformLon(gcjLon - 105.0, gcjLat - 35.0);
  const radLat = gcjLat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const wgsLat = gcjLat - (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  const wgsLon = gcjLon - (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [wgsLon, wgsLat];
}

// 高德 place 搜索（返回住宅类 POI 的 location）
function amapSearch(kw) {
  return new Promise((resolve) => {
    const url = 'https://restapi.amap.com/v3/place/text?keywords=' + encodeURIComponent(kw) + '&city=' + encodeURIComponent('成都') + '&key=9cb8fd71a6e7324e80f1fcd82ef8ee73';
    https.get(url, res => {
      let s = '';
      res.on('data', d => s += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(s);
          const pois = (j.pois || []).filter(p => p.type && /住宅|小区|公寓/.test(p.type));
          const p = pois[0] || (j.pois || [])[0];
          resolve(p ? { name: p.name, location: p.location } : null);
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

(async () => {
  for (const item of list.files) {
    const q = stripQi(clean(item.name));
    if (!q) { item.lon = null; item.lat = null; continue; }
    // 楼栋匹配（精确 + 常见后缀："院/号院/号"）
    let sumLon = 0, sumLat = 0, n = 0;
    for (const f of buildings.features) {
      const bn = stripQi(clean(f.properties.name));
      if (!bn) continue;
      if (bn === q || bn === q + '院' || bn === q + '号院' || bn === q + '号') {
        const ring = f.geometry.coordinates[0];
        let lon = 0, lat = 0;
        for (const [x, y] of ring) { lon += x; lat += y; }
        sumLon += lon / ring.length; sumLat += lat / ring.length;
        n++;
      }
    }
    if (n > 0) {
      item.lon = +(sumLon / n).toFixed(6);
      item.lat = +(sumLat / n).toFixed(6);
      item.count = n;
      console.log('✓', item.name, '→', item.lon, item.lat, '（', n, '栋）');
    } else {
      // 高德兜底
      const r = await amapSearch(item.name);
      if (r && r.location) {
        const [glon, glat] = r.location.split(',').map(Number);
        const [wlon, wlat] = gcj2wgs(glon, glat);
        item.lon = +wlon.toFixed(6);
        item.lat = +wlat.toFixed(6);
        item.count = 0;
        console.log('🔍', item.name, '→ 高德', item.lon, item.lat, '（', r.name, '）');
      } else {
        item.lon = null; item.lat = null; item.count = 0;
        console.log('✗', item.name, '→ 无法定位');
      }
    }
  }

  fs.writeFileSync(listFile, JSON.stringify(list, null, 2));
  console.log('\n已更新', listFile);
})();
