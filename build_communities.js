const fs = require('fs');

// 1. 读 landuse（way + node），组装地块 polygon
const landuse = JSON.parse(fs.readFileSync('data/landuse_residential.json', 'utf8'));
const nodeMap = new Map();
const ways = [];
for (const e of landuse.elements) {
  if (e.type === 'node') nodeMap.set(e.id, [e.lon, e.lat]);
  else if (e.type === 'way') ways.push(e);
}

function wayToPolygon(w) {
  const pts = [];
  for (const nid of w.nodes) {
    const c = nodeMap.get(nid);
    if (c) pts.push(c);
  }
  return pts;
}

// 2. 读 buildings
const buildings = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
const feats = buildings.features;

function centroid(f) {
  const r = f.geometry.coordinates[0];
  let lon = 0, lat = 0;
  for (const [l, a] of r) { lon += l; lat += a; }
  return [lon / r.length, lat / r.length];
}

function pointInPolygon(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 凸包（Andrew's monotone chain）
function convexHull(points) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// 非住宅关键词
const NON_RES = /小学|中学|学校|大学|学院|幼儿园|医院|卫生|诊所|公司|集团|商场|广场|大厦|酒店|宾馆|饭店|餐厅|银行|政府|局$|厅$|馆$|工厂|产业园|物流|市场|超市|商店|车站|机场|加油站|办公|写字楼|研究院|研究所|设计院|规划院|宿舍|校区|院区/;

// 楼栋空间索引（grid，~1km 格子）
const CELL = 0.01;
const grid = new Map();
feats.forEach((f, i) => {
  const c = centroid(f);
  const key = Math.floor(c[0] / CELL) + ',' + Math.floor(c[1] / CELL);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(i);
});

// 3. 地块匹配 + 名字校正
const communities = [];
const covered = new Set(); // 被地块覆盖的楼栋 index
let nameCorrected = 0;

for (const w of ways) {
  const poly = wayToPolygon(w);
  if (poly.length < 4) continue;

  let minLon = 1e9, minLat = 1e9, maxLon = -1e9, maxLat = -1e9;
  for (const [lon, lat] of poly) {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }

  const kx0 = Math.floor(minLon / CELL), kx1 = Math.floor(maxLon / CELL);
  const ky0 = Math.floor(minLat / CELL), ky1 = Math.floor(maxLat / CELL);
  const insideIdx = [];
  for (let kx = kx0; kx <= kx1; kx++) {
    for (let ky = ky0; ky <= ky1; ky++) {
      for (const i of grid.get(kx + ',' + ky) || []) {
        const c = centroid(feats[i]);
        if (pointInPolygon(c[0], c[1], poly)) insideIdx.push(i);
      }
    }
  }

  if (insideIdx.length === 0) continue;
  insideIdx.forEach(i => covered.add(i));

  const nameCount = {};
  for (const i of insideIdx) {
    const n = feats[i].properties.name;
    if (n) nameCount[n] = (nameCount[n] || 0) + 1;
  }

  let resName = null, resCount = 0;
  for (const [n, cnt] of Object.entries(nameCount)) {
    if (NON_RES.test(n)) continue;
    if (cnt > resCount) { resName = n; resCount = cnt; }
  }

  if (resName) {
    for (const i of insideIdx) {
      const n = feats[i].properties.name;
      if (n && NON_RES.test(n)) {
        feats[i].properties.name = resName;
        nameCorrected++;
      }
    }
  }

  const center = centroid({ geometry: { coordinates: [poly] } });
  communities.push({
    type: 'Feature',
    properties: { name: resName || '', count: insideIdx.length, centerLon: center[0], centerLat: center[1] },
    geometry: { type: 'LineString', coordinates: poly.concat([poly[0]]) },
  });
}

// 4. fallback：没被地块覆盖的楼栋，按名字分组用凸包补边框
const uncovered = new Map();
for (let i = 0; i < feats.length; i++) {
  if (covered.has(i)) continue;
  const n = feats[i].properties.name;
  if (!n || NON_RES.test(n)) continue;
  if (!uncovered.has(n)) uncovered.set(n, []);
  uncovered.get(n).push(i);
}

// 通用名过滤（非小区名：X楼/食堂/号楼/X栋/座/字母/家居等）
const GENERIC = /楼$|食堂|号楼|栋$|座$|^[A-Za-z0-9]{1,2}$|家居|公寓楼|宿舍楼/;

// 空间聚类（同名但分散的楼栋拆开，避免几十km超大凸包）
function distM(a, b) {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((b[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 111320;
  return Math.sqrt(dx * dx + dy * dy);
}
function clusterByDistance(items, thresholdM) {
  const clusters = [];
  for (const it of items) {
    let placed = false;
    for (const cl of clusters) {
      if (distM(it.c, cl.center) < thresholdM) { cl.items.push(it); placed = true; break; }
    }
    if (!placed) clusters.push({ items: [it], center: it.c });
  }
  return clusters.map(cl => cl.items);
}

let fallbackCount = 0;
for (const [name, idxs] of uncovered) {
  if (idxs.length < 2) continue;
  if (GENERIC.test(name)) continue; // 过滤通用名
  const items = idxs.map(i => ({ i, c: centroid(feats[i]) }));
  const clusters = clusterByDistance(items, 800); // 800m 内归一组
  for (const cl of clusters) {
    if (cl.length < 2) continue;
    const pts = [];
    for (const it of cl) {
      for (const [lon, lat] of feats[it.i].geometry.coordinates[0]) pts.push([lon, lat]);
    }
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    hull.push(hull[0]);
    let lon = 0, lat = 0;
    for (const [l, a] of hull) { lon += l; lat += a; }
    lon /= hull.length; lat /= hull.length;
    communities.push({
      type: 'Feature',
      properties: { name, count: cl.length, centerLon: lon, centerLat: lat },
      geometry: { type: 'LineString', coordinates: hull },
    });
    fallbackCount++;
  }
}

// 保存校正后的 buildings
fs.writeFileSync('data/buildings.geojson', JSON.stringify(buildings));

// 保存地块边界
const named = communities.filter(c => c.properties.name);
fs.writeFileSync('data/communities.geojson', JSON.stringify({ type: 'FeatureCollection', features: named }));
console.log('地块边框:', communities.length, '| 有名字:', named.length, '| 其中凸包 fallback:', fallbackCount);
console.log('校正边缘楼栋名:', nameCorrected, '栋');
console.log('文件大小:', Math.round(fs.statSync('data/communities.geojson').size / 1024) + ' KB');
