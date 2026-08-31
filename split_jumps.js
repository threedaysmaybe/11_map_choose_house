const fs = require('fs');

function distanceKm(a, b) {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 111320;
  return Math.sqrt(dx * dx + dy * dy) / 1000;
}

const d = JSON.parse(fs.readFileSync('data/districts.geojson', 'utf8'));
const THRESHOLD = 3; // 3 公里，超过才视为飞地之间的跳跃（避免误拆简化后的大间距点）

const outFeatures = [];
for (const f of d.features) {
  const coords = f.geometry.coordinates;
  const subRings = [];
  let current = [coords[0]];
  let splitCount = 0;
  for (let i = 1; i < coords.length; i++) {
    if (distanceKm(coords[i - 1], coords[i]) > THRESHOLD) {
      if (current.length >= 2) subRings.push(current);
      current = [coords[i]];
      splitCount++;
    } else {
      current.push(coords[i]);
    }
  }
  if (current.length >= 2) subRings.push(current);

  for (const ring of subRings) {
    // 只有首尾相邻（本来就是闭合环）才闭合，否则保持开口（飞地缺口）
    const closed = distanceKm(ring[0], ring[ring.length - 1]) < THRESHOLD;
    if (closed && ring.length >= 3) ring.push(ring[0]);
    if (ring.length >= 3) {
      outFeatures.push({ type: 'Feature', properties: { name: f.properties.name }, geometry: { type: 'LineString', coordinates: ring } });
    }
  }
  if (splitCount > 0) console.log(f.properties.name, '拆出', splitCount + 1, '段');
}

fs.writeFileSync('data/districts.geojson', JSON.stringify({ type: 'FeatureCollection', features: outFeatures }));
console.log('总计边界段:', outFeatures.length);
