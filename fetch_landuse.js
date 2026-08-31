const { execFileSync } = require('child_process');
const fs = require('fs');

// 成都主城区 bbox（绕城高速内）
const BBOX = { s: 30.50, w: 103.95, n: 30.78, e: 104.18 };
const STEP = 0.05;

function overpass(query) {
  const out = execFileSync('curl', ['-sS', '--max-time', '240', 'https://overpass-api.de/api/interpreter', '--data-urlencode', `data=${query}`], { maxBuffer: 100 * 1024 * 1024 });
  return JSON.parse(out.toString('utf8'));
}

function fetchCell(s, w, n, e) {
  const query = `[out:json][timeout:200];(way["landuse"="residential"](${s},${w},${n},${e});>;);out body;`;
  return overpass(query).elements;
}

(async () => {
  const all = [];
  let cellNo = 0;
  for (let lat = BBOX.s; lat < BBOX.n; lat += STEP) {
    for (let lon = BBOX.w; lon < BBOX.e; lon += STEP) {
      cellNo++;
      const s = lat, w = lon, n = Math.min(lat + STEP, BBOX.n), e = Math.min(lon + STEP, BBOX.e);
      try {
        const els = fetchCell(s, w, n, e);
        all.push(...els);
        console.log(`格子 ${cellNo}: 抓到 ${els.length} 个 way，累计 ${all.length}`);
      } catch (err) {
        console.log(`格子 ${cellNo}: 失败 ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1500)); // Overpass 限速
    }
  }

  // 去重（相邻格子会重复抓边界上的 way）
  const seen = new Set();
  const unique = all.filter(e => {
    const key = e.type + '/' + e.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  fs.writeFileSync('data/landuse_residential.json', JSON.stringify({ elements: unique }));
  const nWays = unique.filter(e => e.type === 'way').length;
  const nNodes = unique.filter(e => e.type === 'node').length;
  console.log(`\n完成：共 ${nWays} 个住宅地块 way，${nNodes} 个节点`);
  console.log(`文件大小: ${Math.round(fs.statSync('data/landuse_residential.json').size / 1024)} KB`);
})();
