const fs = require('fs');
const path = require('path');
const geojsonvt = require('geojson-vt').default;
const vtpbf = require('vt-pbf');

const data = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
console.log('建筑总数:', data.features.length);

// 建立瓦片索引
const index = geojsonvt(data, {
  maxZoom: 17,
  indexMaxZoom: 17,
  indexMaxPoints: 0,
  tolerance: 2,      // 简化容差（像素）
  extent: 4096,
  buffer: 64,
  // 不加 generateId：geojson-vt 默认用 geojson.id（顶层 id），setFeatureState 才能按 id 命中
});

const BBOX = { west: 103.95, south: 30.50, east: 104.18, north: 30.78 };

function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
function lat2y(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}

const outDir = 'data/tiles';
let total = 0;

for (let z = 0; z <= 17; z++) {
  const x0 = lon2x(BBOX.west, z), x1 = lon2x(BBOX.east, z);
  const y0 = lat2y(BBOX.north, z), y1 = lat2y(BBOX.south, z);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const tile = index.getTile(z, x, y);
      if (!tile || !tile.features || tile.features.length === 0) continue;
      const pbf = Buffer.from(vtpbf.fromGeojsonVt({ buildings: tile }));
      const dir = path.join(outDir, String(z), String(x));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, y + '.pbf'), pbf);
      total++;
    }
  }
}

console.log('生成瓦片数:', total);
console.log('输出目录:', path.resolve(outDir));
