const fs = require('fs');

// 规范化小区名：去空格、去括号内容（"杜鹃园(和兴街)" → "杜鹃园"）
function normalize(s) {
  return (s || '').replace(/[·\s·]/g, '').replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '');
}

function loadHouses(files) {
  const all = [];
  for (const f of files) { try { all.push(...JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (e) {} }
  return all;
}

const houses = loadHouses(['data/xingfuli_houses.json', 'data/beike_houses.json', 'data/beike_jinjiang.json']);

// 收集每个小区的总层数（去重）
const floorsByComm = new Map();
for (const h of houses) {
  const comm = normalize(h.community);
  const m = (h.floor || '').match(/共(\d+)层/);
  if (!comm || !m) continue;
  const n = parseInt(m[1]);
  if (!floorsByComm.has(comm)) floorsByComm.set(comm, []);
  if (!floorsByComm.get(comm).includes(n)) floorsByComm.get(comm).push(n);
}

// 每个小区的层数档（排序）
const levelTiers = new Map();
for (const [comm, floors] of floorsByComm) {
  const sorted = floors.sort((a, b) => a - b);
  // 差距 < 3 层的合并为一档（用中位数）
  if (sorted.length > 1 && sorted[sorted.length - 1] - sorted[0] < 3) {
    const mid = sorted[Math.floor(sorted.length / 2)];
    levelTiers.set(comm, [mid]);
  } else {
    levelTiers.set(comm, sorted);
  }
}

// 读取楼栋，按小区分组
const b = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
const byComm = new Map();
for (const f of b.features) {
  const comm = normalize(f.properties.name);
  if (!comm) continue;
  if (!byComm.has(comm)) byComm.set(comm, []);
  byComm.get(comm).push(f);
}

let singleCount = 0, multiCount = 0, updated = 0;
for (const [comm, tiers] of levelTiers) {
  const buildings = byComm.get(comm);
  if (!buildings || !buildings.length) continue;
  if (tiers.length === 1) {
    // 单一层数：整小区用这个层数
    const h = Math.round(tiers[0] * 3);
    for (const f of buildings) { f.properties.height = h; f.properties.heightSource = 'floors'; }
    singleCount++; updated += buildings.length;
  } else {
    // 多种层数：楼栋按面积排序，均分到层数档（面积小 → 层数低）
    const sorted = buildings.slice().sort((a, b) => (a.properties.area || 0) - (b.properties.area || 0));
    const n = tiers.length;
    for (let i = 0; i < sorted.length; i++) {
      const tierIdx = Math.min(n - 1, Math.floor(i * n / sorted.length));
      const f = sorted[i];
      f.properties.height = Math.round(tiers[tierIdx] * 3);
      f.properties.heightSource = 'floors';
    }
    multiCount++; updated += sorted.length;
  }
}

fs.writeFileSync('data/buildings.geojson', JSON.stringify(b));
console.log('分层完成：单一层数小区', singleCount, '个，多种层数小区', multiCount, '个，共更新', updated, '栋楼');
