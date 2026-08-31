const fs = require('fs');

const data = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
const buildings = data.features;

// 非住宅关键词（这些名字可能是误标，需检查修正）
const NON_RES = /小学|中学|学校|大学|学院|幼儿园|医院|卫生|诊所|公司|集团|商场|广场|大厦|酒店|宾馆|饭店|餐厅|银行|政府|局$|厅$|馆$|工厂|产业园|物流|市场|超市|商店|车站|机场|加油站|办公|写字楼|研究院|研究所|设计院|规划院|宿舍|校区|院区/;

function centroid(f) {
  const ring = f.geometry.coordinates[0];
  let lon = 0, lat = 0;
  for (const [l, a] of ring) { lon += l; lat += a; }
  return [lon / ring.length, lat / ring.length];
}

function distKm(a, b) {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 111320;
  return Math.sqrt(dx * dx + dy * dy);
}

// 空间分桶
const CELL = 0.001; // ~100m
const grid = new Map();
buildings.forEach((f, i) => {
  const c = centroid(f);
  const kx = Math.floor(c[0] / CELL), ky = Math.floor(c[1] / CELL);
  const key = kx + ',' + ky;
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(i);
});

const THRESHOLD_M = 90;
let corrected = 0;
for (let i = 0; i < buildings.length; i++) {
  const f = buildings[i];
  const name = f.properties.name;
  if (!name || !NON_RES.test(name)) continue;

  const c = centroid(f);
  const kx = Math.floor(c[0] / CELL), ky = Math.floor(c[1] / CELL);

  // 收集 3x3 邻域内楼栋的住宅名
  const resNames = {};
  let neighborTotal = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = (kx + dx) + ',' + (ky + dy);
      for (const j of grid.get(key) || []) {
        if (j === i) continue;
        const nb = buildings[j];
        if (distKm(c, centroid(nb)) > THRESHOLD_M) continue;
        neighborTotal++;
        const nn = nb.properties.name;
        if (nn && !NON_RES.test(nn)) resNames[nn] = (resNames[nn] || 0) + 1;
      }
    }
  }

  // 找占多数的住宅名
  let best = null, bestCount = 0;
  for (const [nn, cnt] of Object.entries(resNames)) {
    if (cnt > bestCount) { best = nn; bestCount = cnt; }
  }

  // 周围同住宅名 >= 3 栋，且占邻居多数，则修正
  if (best && bestCount >= 3) {
    f.properties.name = best;
    corrected++;
  }
}

fs.writeFileSync('data/buildings.geojson', JSON.stringify(data));
console.log('修正楼栋名:', corrected, '栋');
console.log('样例（修正后）:');
// 打印几个修正后的名字
const sample = buildings.filter(f => f.properties.name && /凯德|霍森斯/.test(f.properties.name)).map(f => f.properties.name);
console.log('  凯德/霍森斯相关:', [...new Set(sample)].join('、'));
