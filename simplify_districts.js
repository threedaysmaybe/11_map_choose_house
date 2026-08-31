const fs = require('fs');

// Douglas-Peucker 简化（去掉过细的尖角）
function perpendicularDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const t2 = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t2 * dx), p[1] - (a[1] + t2 * dy));
}

function douglasPeucker(points, eps) {
  if (points.length < 3) return points;
  let maxDist = 0, maxIdx = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], a, b);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > eps) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), eps);
    const right = douglasPeucker(points.slice(maxIdx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

const d = JSON.parse(fs.readFileSync('data/districts.geojson', 'utf8'));
const EPS = 0.00025; // 约 28 米，去掉过细尖角，保留区边界轮廓

let removed = 0;
for (const f of d.features) {
  const orig = f.geometry.coordinates;
  // 去掉闭合点再简化，最后补回
  const simplified = douglasPeucker(orig, EPS);
  if (simplified.length >= 3) {
    f.geometry.coordinates = simplified;
    removed += orig.length - simplified.length;
  }
}

fs.writeFileSync('data/districts.geojson', JSON.stringify(d));
console.log('简化完成，共移除', removed, '个点');
for (const f of d.features) {
  console.log(' ', f.properties.name, ':', f.geometry.coordinates.length, '点');
}
