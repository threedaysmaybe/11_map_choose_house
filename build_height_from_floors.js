const fs = require('fs');

// 从房源数据提取楼层总高，估算楼栋高度，更新 buildings.geojson
function loadHouses(files) {
  const all = [];
  for (const f of files) {
    try { all.push(...JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (e) {}
  }
  return all;
}

const houses = loadHouses(['data/xingfuli_houses.json', 'data/beike_houses.json']);

// 提取每个小区的总层数列表
const floorsByCommunity = new Map();
for (const h of houses) {
  const comm = (h.community || '').replace(/[·\s·]/g, '');
  if (!comm || !h.floor) continue;
  // floor 形如 "中楼层/共26层" 或 "高楼层/共6层"
  const m = (h.floor || '').match(/共(\d+)层/);
  if (!m) continue;
  const totalFloors = parseInt(m[1]);
  if (!floorsByCommunity.has(comm)) floorsByCommunity.set(comm, []);
  floorsByCommunity.get(comm).push(totalFloors);
}

// 取中位数（比均值抗极端值）
const median = arr => { const s = [...arr].sort((a, b) => a - b); const mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2); };

const heightByCommunity = new Map();
for (const [comm, floors] of floorsByCommunity) {
  if (floors.length < 1) continue;
  const totalFloors = median(floors);
  heightByCommunity.set(comm, Math.round(totalFloors * 3)); // 层高 3 米
}

// 更新 buildings.geojson
const b = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
let updated = 0;
for (const f of b.features) {
  const name = (f.properties.name || '').replace(/[·\s·]/g, '');
  if (!name) continue;
  const h = heightByCommunity.get(name);
  if (h && h > 0 && h < 200) {
    f.properties.height = h;
    f.properties.heightSource = 'floors';
    updated++;
  }
}
fs.writeFileSync('data/buildings.geojson', JSON.stringify(b));
console.log('楼层→高度：覆盖', heightByCommunity.size, '个小区，更新', updated, '栋楼的高度');
console.log('样例:');
[...heightByCommunity.entries()].slice(0, 10).forEach(([c, h]) => console.log('  ', c, '→', h, '米'));
