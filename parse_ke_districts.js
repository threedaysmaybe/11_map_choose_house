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

const j = JSON.parse(fs.readFileSync('data/ke_initdata.json', 'utf8'));
const region = j.data.filters.region;

// 区名规范化（和前端一致）
const DIST_NAME = { 锦江: '锦江区', 青羊: '青羊区', 武侯: '武侯区', 成华: '成华区', 金牛: '金牛区', 高新: '高新区', 双流: '双流区', 温江: '温江区', 龙泉驿: '龙泉驿区', 高新西: '高新区西区' };
const normD = d => DIST_NAME[d] || d;

const features = [];
const names = [];
for (const dist of region.options || []) {
  if (dist.name === '不限' || !dist.border) continue;
  const displayName = normD(dist.name);
  const coords = dist.border.split(';').map(p => {
    const [lon, lat] = p.split(',').map(Number);
    if (!isFinite(lon) || !isFinite(lat)) return null;
    return bd09ToWgs84(lon, lat);
  }).filter(Boolean);
  if (coords.length < 3) continue;
  coords.push(coords[0]);
  features.push({ type: 'Feature', properties: { name: displayName }, geometry: { type: 'LineString', coordinates: coords } });
  names.push(displayName);
}
fs.writeFileSync('data/districts.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
console.log('贝壳区边界解析完成，共', features.length, '个区');
console.log(names.join('、'));
