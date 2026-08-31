const { execFileSync } = require('child_process');
const fs = require('fs');

const BBOX = { s: 30.50, w: 103.95, n: 30.78, e: 104.18 };

const query = `[out:json][timeout:200];(
  way["highway"~"motorway|trunk|primary|secondary"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  way["waterway"~"river|stream|canal"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  way["natural"="water"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
);out geom;`;

console.log('抓取 OSM 道路+河流线…');
const out = execFileSync('curl', ['-sS', '--max-time', '600', 'https://overpass-api.de/api/interpreter', '--data-urlencode', `data=${query}`], { maxBuffer: 300 * 1024 * 1024 }).toString();

const j = JSON.parse(out);
const elements = j.elements || [];

const features = [];
elements.filter(e => e.type === 'way' && e.geometry).forEach(w => {
  const coords = w.geometry.map(p => [p.lon, p.lat]);
  if (coords.length < 2) return;
  const tags = w.tags || {};
  const kind = tags.highway || tags.waterway || (tags.natural === 'water' ? 'water' : '');
  features.push({
    type: 'Feature',
    properties: { name: tags.name || '', kind, highway: tags.highway || '' },
    geometry: { type: 'LineString', coordinates: coords },
  });
});

fs.writeFileSync('data/roads.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
console.log('完成，共', features.length, '条线');
const byKind = {};
features.forEach(f => { const k = f.properties.kind || 'other'; byKind[k] = (byKind[k] || 0) + 1; });
console.log('分类:', JSON.stringify(byKind));
