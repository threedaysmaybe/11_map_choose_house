const puppeteer = require('puppeteer-core');
const fs = require('fs');

// BD09 → GCJ02
function bd09ToGcj02(lon, lat) {
  const x = lon - 0.0065, y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000 / 180);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000 / 180);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}
// GCJ02 → WGS84
function gcj02ToWgs84(lon, lat) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  const tLat = (x, y) => { let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x)); r += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; r += (20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3; r += (160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3; return r; };
  const tLon = (x, y) => { let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x)); r += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; r += (20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3; r += (150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3; return r; };
  const dLat = tLat(lon-105, lat-35), dLon = tLon(lon-105, lat-35);
  const radLat = lat/180*Math.PI; let m = Math.sin(radLat); m = 1-ee*m*m; const sq = Math.sqrt(m);
  const dLat2 = (dLat*180)/((a*(1-ee))/(m*sq)*Math.PI);
  const dLon2 = (dLon*180)/(a/sq*Math.cos(radLat)*Math.PI);
  return [lon-dLon2, lat-dLat2];
}
function bd09ToWgs84(lon, lat) { const [g1, g2] = bd09ToGcj02(lon, lat); return gcj02ToWgs84(g1, g2); }

async function main() {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  } catch (e) {
    console.error('❌ 无法连接调试 Chrome，请先启动调试 Chrome 并登录贝壳地图页');
    process.exit(1);
  }
  const pages = await browser.pages();
  const beike = pages.find(p => p.url().includes('map.ke.com'));
  if (!beike) { console.error('❌ 未找到贝壳地图页，请在调试 Chrome 打开 map.ke.com/map/510100/ESF/'); process.exit(1); }

  const raw = await beike.evaluate(async () => {
    const resp = await fetch('/proxyApi/i.c-pc-webapi.ke.com/map/initdata?cityId=510100&dataSource=ESF', { credentials: 'include' });
    return await resp.text();
  });
  const j = JSON.parse(raw);
  if (j.errno !== 0 || !j.data) { console.error('❌ 接口返回异常，可能未登录:', j.errmsg || ''); process.exit(1); }

  const region = j.data.filters.region;
  const features = [];
  for (const dist of region.options || []) {
    if (dist.name === '不限') continue;
    for (const b of (dist.options || [])) {
      if (!b.border || !b.name || b.name === '不限') continue;
      const coords = b.border.split(';').map(p => {
        const [lon, lat] = p.split(',').map(Number);
        if (!isFinite(lon) || !isFinite(lat)) return null;
        return bd09ToWgs84(lon, lat);
      }).filter(Boolean);
      if (coords.length < 3) continue;
      coords.push(coords[0]);
      features.push({ type: 'Feature', properties: { name: b.name, district: dist.name }, geometry: { type: 'Polygon', coordinates: [coords] } });
    }
  }
  fs.writeFileSync('data/boards_voronoi.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
  const boards = features.map(f => {
    const ring = f.geometry.coordinates[0];
    let lon = 0, lat = 0;
    for (const [l, a] of ring) { lon += l; lat += a; }
    const n = ring.length - 1 || 1;
    return { name: f.properties.name, district: f.properties.district, location: (lon / n).toFixed(6) + ',' + (lat / n).toFixed(6), count: 10 };
  });
  fs.writeFileSync('data/boards.json', JSON.stringify(boards, null, 2));
  console.log(`✅ 更新成功，共 ${features.length} 个板块`);
  browser.disconnect();
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
