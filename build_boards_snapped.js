const fs = require('fs');

const roads = JSON.parse(fs.readFileSync('data/roads.geojson', 'utf8')).features;
const boards = JSON.parse(fs.readFileSync('data/boards_voronoi.geojson', 'utf8')).features;

// 只用主干道 + 河流（去掉 link 分支，减少干扰）
const MAIN_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'river', 'canal', 'water', 'stream']);
const mainRoads = roads.filter(f => MAIN_KINDS.has(f.properties.kind));

// 网格空间索引
const GRID = 0.005; // ~500 米
const grid = new Map();
function gk(lon, lat) { return Math.floor(lon / GRID) + ',' + Math.floor(lat / GRID); }
mainRoads.forEach(line => {
  const keys = new Set();
  for (const [lon, lat] of line.geometry.coordinates) keys.add(gk(lon, lat));
  for (const k of keys) { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(line); }
});

function projectToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return a;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const t2 = Math.max(0, Math.min(1, t));
  return [a[0] + t2 * dx, a[1] + t2 * dy];
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

function snap(pt, threshold) {
  const gx = Math.floor(pt[0] / GRID), gy = Math.floor(pt[1] / GRID);
  const candidates = new Set();
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    (grid.get((gx + di) + ',' + (gy + dj)) || []).forEach(l => candidates.add(l));
  }
  let minD = threshold, best = pt;
  for (const line of candidates) {
    const coords = line.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const proj = projectToSegment(pt, coords[i], coords[i + 1]);
      const d = dist(pt, proj);
      if (d < minD) { minD = d; best = proj; }
    }
  }
  return best;
}

// 先把边细分成小段（每 ~80 米一段），再逐段吸附到路/河
const THRESHOLD = 0.004; // ~440 米
const STEP = 0.0007; // ~80 米
function subdivide(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push(a);
    const d = dist(a, b);
    const n = Math.floor(d / STEP);
    for (let j = 1; j < n; j++) {
      out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
    }
  }
  return out;
}
let snappedCount = 0;
for (const f of boards) {
  const ring = f.geometry.coordinates[0];
  const dense = subdivide(ring);
  const snapped = dense.map(p => snap(p, THRESHOLD));
  const cleaned = [snapped[0]];
  for (let i = 1; i < snapped.length; i++) {
    if (dist(snapped[i], cleaned[cleaned.length - 1]) > 0.00015) cleaned.push(snapped[i]);
  }
  if (cleaned.length >= 3) {
    if (dist(cleaned[0], cleaned[cleaned.length - 1]) > 0.00015) cleaned.push(cleaned[0]);
    f.geometry = { type: 'Polygon', coordinates: [cleaned] };
    snappedCount++;
  }
}

fs.writeFileSync('data/boards_voronoi.geojson', JSON.stringify({ type: 'FeatureCollection', features: boards }));
console.log('吸附完成，处理', snappedCount, '个板块，共', mainRoads.length, '条路/河线');
