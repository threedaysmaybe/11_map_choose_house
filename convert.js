const fs = require('fs');

const FLOOR_HEIGHT = 3;

function areaM2(geom) {
  let s = 0;
  for (let i = 0; i < geom.length - 1; i++) {
    s += geom[i].lon * geom[i + 1].lat - geom[i + 1].lon * geom[i].lat;
  }
  s = Math.abs(s) / 2;
  const midLat = geom.reduce((a, p) => a + p.lat, 0) / geom.length;
  return s * 111320 * (111320 * Math.cos((midLat * Math.PI) / 180));
}

const TYPE_HEIGHT = {
  // 无层数信息的保守默认高度（宁可低估，避免把老小区/低层误判成高层）
  commercial: 15, office: 45, apartments: 18, residential: 18,
  hotel: 30, school: 12, kindergarten: 9, retail: 12, service: 9,
  fire_station: 12, construction: 12, roof: 3, train_station: 20,
  bungalow: 3, house: 6, industrial: 12, warehouse: 12, garage: 6,
};

function inferByArea(area) {
  if (area < 200) return 6;
  if (area < 500) return 9;
  if (area < 1500) return 15;
  if (area < 4000) return 21;
  return 27;
}

function computeHeight(tags, area) {
  const h = tags.height;
  const lv = tags['building:levels'];
  const lvNum = lv ? parseFloat(lv) : NaN;
  if (h) { const hv = parseFloat(h); if (!isNaN(hv) && hv > 0) return { height: hv, source: 'height', levels: lvNum || null }; }
  if (!isNaN(lvNum) && lvNum > 0) return { height: lvNum * FLOOR_HEIGHT, source: 'levels', levels: lvNum };
  const btype = tags.building || 'yes';
  const inferred = TYPE_HEIGHT[btype] !== undefined ? TYPE_HEIGHT[btype] : inferByArea(area);
  return { height: inferred, source: 'estimated', levels: Math.round(inferred / FLOOR_HEIGHT) };
}

// Douglas-Peucker 简化（容差单位：度，约 0.00001°≈1.1m）
function perpendicularDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function douglasPeucker(pts, tol) {
  if (pts.length <= 2) return pts;
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol) {
    const left = douglasPeucker(pts.slice(0, idx + 1), tol);
    const right = douglasPeucker(pts.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function toPolygonCoords(geom) {
  // 降低精度到 5 位小数（约 1m），再 DP 简化
  const coords = geom.map(p => [Math.round(p.lon * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]);
  const open = coords.slice(0, -1);
  let simplified = douglasPeucker(open, 0.00001);
  if (simplified.length < 4) simplified = open;
  simplified.push(simplified[0]); // 闭合
  return simplified;
}

const d = JSON.parse(fs.readFileSync('data/chengdu_raw.json', 'utf-8'));
const ways = (d.elements || []).filter(e => e.type === 'way' && e.geometry && e.geometry.length >= 3);

const features = [];
const seen = new Set();
const sourceCount = { height: 0, levels: 0, estimated: 0 };
let partCount = 0, buildingCount = 0;

for (const w of ways) {
  const key = w.type + '/' + w.id;
  if (seen.has(key)) continue;
  seen.add(key);
  const tags = w.tags || {};
  const area = areaM2(w.geometry);

  let height, source, levels, building;
  if (tags['building:part']) {
    // building:part：只用真实 height/levels，不推断
    const h = tags.height, lv = tags['building:levels'];
    const lvNum = lv ? parseFloat(lv) : NaN;
    if (h) { const hv = parseFloat(h); if (!isNaN(hv) && hv > 0) { height = hv; source = 'height'; levels = lvNum || null; } }
    else if (!isNaN(lvNum) && lvNum > 0) { height = lvNum * FLOOR_HEIGHT; source = 'levels'; levels = lvNum; }
    if (height === undefined) continue; // 无高度，跳过 part
    building = 'part';
    partCount++;
  } else {
    const r = computeHeight(tags, area);
    height = r.height; source = r.source; levels = r.levels;
    building = tags.building || 'yes';
    buildingCount++;
  }

  const finalHeight = Math.min(Math.round(height * 10) / 10, 300); // clamp 异常高度
  if (finalHeight < 3) continue; // 只过滤 <3m 附属建筑（车库/车棚/门卫室），保留所有 1 层以上建筑

  sourceCount[source]++;
  features.push({
    type: 'Feature',
    id: w.id,
    properties: {
      height: finalHeight,
      levels,
      name: tags.name || null,
      building,
      heightSource: source,
      area: Math.round(area),
    },
    geometry: { type: 'Polygon', coordinates: [toPolygonCoords(w.geometry)] },
  });
}

const fc = { type: 'FeatureCollection', features };
fs.writeFileSync('data/buildings.geojson', JSON.stringify(fc), 'utf-8');

const kb = (fs.statSync('data/buildings.geojson').size / 1024).toFixed(0);
console.log(`建筑 ${buildingCount} 栋 + building:part ${partCount} 个 = ${features.length}`);
console.log(`高度来源: 精确height=${sourceCount.height}, 按层数=${sourceCount.levels}, 推断估算=${sourceCount.estimated}`);
console.log(`GeoJSON 大小: ${kb} KB`);

const hs = features.map(f => f.properties.height).sort((a, b) => a - b);
console.log(`高度(米): 中位=${hs[Math.floor(hs.length / 2)]}, 最高=${hs[hs.length - 1]}, >=40m=${hs.filter(h => h >= 40).length}栋`);

const named = features.filter(f => f.properties.name).length;
console.log(`有名称: ${named} 栋 (${(named / features.length * 100).toFixed(1)}%)`);
