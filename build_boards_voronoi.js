const fs = require('fs');
const { Delaunay } = require('d3-delaunay');

// 板块中心点 → Voronoi 无缝边界
const boards = JSON.parse(fs.readFileSync('data/boards.json', 'utf8')).filter(b => b.location && b.count >= 5);
const points = boards.map(b => {
  const [lon, lat] = b.location.split(',').map(Number);
  return [lon, lat];
});

// 成都主城区（绕城高速内，稍放宽）
const BBOX = [103.95, 30.50, 104.18, 30.78];

const delaunay = Delaunay.from(points);
const voronoi = delaunay.voronoi(BBOX);

const features = [];
let ok = 0;
boards.forEach((b, i) => {
  const poly = voronoi.cellPolygon(i);
  if (!poly || poly.length < 3) return;
  features.push({
    type: 'Feature',
    properties: { name: b.name, district: b.district || '', center: b.location },
    geometry: { type: 'Polygon', coordinates: [poly] },
  });
  ok++;
});

fs.writeFileSync('data/boards_voronoi.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
console.log('Voronoi 板块边界:', ok, '个（共', boards.length, '个板块）');
