const fs = require('fs');
const { execFileSync } = require('child_process');

// 失败的 12 个网格（s, w），用更小 STEP 重试
const FAILED = [
  [30.500, 104.050], [30.500, 104.075],
  [30.600, 104.050],
  [30.625, 104.075], [30.625, 104.150],
  [30.650, 104.025], [30.650, 104.125], [30.650, 104.175],
  [30.675, 104.000], [30.675, 104.025], [30.675, 104.100],
  [30.700, 104.175],
];
const STEP = 0.0125; // 更小网格避免超时

function postOverpass(query) {
  return execFileSync('curl', [
    '-sS', '--max-time', '120',
    '-X', 'POST', 'https://overpass-api.de/api/interpreter',
    '--data-urlencode', 'data=' + query,
  ], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cellQuery(s, w, n, e) {
  return `[out:json][timeout:90];(way["building"](${s},${w},${n},${e});way["building:part"](${s},${w},${n},${e}););out body geom;`;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync('data/chengdu_raw.json', 'utf-8'));
  const all = existing.elements || [];
  const seen = new Set(all.map(el => el.type + '/' + el.id));

  let subCells = 0;
  for (const [s0, w0] of FAILED) {
    for (let lat = s0; lat < s0 + 0.025; lat += STEP) {
      for (let lon = w0; lon < w0 + 0.025; lon += STEP) {
        subCells++;
        const s = lat, w = lon, n = Math.min(lat + STEP, s0 + 0.025), e = Math.min(lon + STEP, w0 + 0.025);
        try {
          const body = await postOverpass(cellQuery(s, w, n, e));
          const j = JSON.parse(body);
          let added = 0;
          for (const el of (j.elements || [])) {
            const key = el.type + '/' + el.id;
            if (!seen.has(key)) { seen.add(key); all.push(el); added++; }
          }
          console.log(`重试子网格 [${s.toFixed(4)},${w.toFixed(4)}] -> ${(j.elements || []).length} 要素, 新增 ${added}, 累计 ${all.length}`);
        } catch (e) {
          console.log(`重试子网格 [${s.toFixed(4)},${w.toFixed(4)}] 失败: ${e.message.substring(0, 60)}`);
        }
        if (subCells % 4 === 0) fs.writeFileSync('data/chengdu_raw.json', JSON.stringify({ elements: all }), 'utf-8');
        await sleep(2000);
      }
    }
  }

  fs.writeFileSync('data/chengdu_raw.json', JSON.stringify({ elements: all }), 'utf-8');
  console.log(`\n重试完成，累计 ${all.length} 个要素`);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
