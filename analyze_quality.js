const fs = require('fs');

const d = JSON.parse(fs.readFileSync('data/jinrongcheng_raw.json', 'utf-8'));
const ways = d.elements.filter(e => e.type === 'way' && e.geometry && e.geometry.length >= 3);

// 鞋带公式求多边形面积（度²），再转平方米
function areaM2(coords) {
  let s = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    s += coords[i].lon * coords[i + 1].lat - coords[i + 1].lon * coords[i].lat;
  }
  s = Math.abs(s) / 2; // 度²
  const midLat = coords.reduce((a, p) => a + p.lat, 0) / coords.length;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);
  return s * mPerDegLat * mPerDegLon;
}

const missing = ways.filter(w => !(w.tags || {}).height && !(w.tags || {})['building:levels']);
const byType = {};
const missingAreas = [];

for (const w of missing) {
  const t = w.tags || {};
  const btype = t.building || 'yes';
  byType[btype] = (byType[btype] || 0) + 1;
  const a = areaM2(w.geometry);
  missingAreas.push({ type: btype, area: a, id: w.id, name: t.name || null });
}

console.log(`缺高度楼栋总数: ${missing.length}`);
console.log(`\n缺高度楼栋 · 类型分布:`);
Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

console.log(`\n缺高度楼栋 · footprint 面积分布:`);
const buckets = [
  ['<200㎡(小附属)', 0, 200],
  ['200-500㎡(别墅/联排)', 200, 500],
  ['500-1500㎡(多层/高层)', 500, 1500],
  ['>1500㎡(大体量楼/商场)', 1500, 1e12],
];
for (const [label, lo, hi] of buckets) {
  const n = missingAreas.filter(x => x.area >= lo && x.area < hi).length;
  console.log(`  ${label}: ${n}`);
}

// 大面积但缺高度的（最可能是高层漏标，需要补）
const big = missingAreas.filter(x => x.area >= 500).sort((a, b) => b.area - a.area);
console.log(`\n>=500㎡ 但缺高度的楼: ${big.length} 栋（这些最可能是漏标的高层）`);
big.slice(0, 25).forEach(x => console.log(`  id=${x.id} type=${x.type} area=${Math.round(x.area)}㎡ ${x.name || ''}`));
