const fs = require('fs');
const { execFileSync } = require('child_process');

// 成都绕城高速内 bbox
const SOUTH = 30.50, WEST = 103.95, NORTH = 30.78, EAST = 104.18;
const STEP = 0.025;

function postOverpass(query) {
  const out = execFileSync('curl', [
    '-sS', '--max-time', '90',
    '-X', 'POST', 'https://overpass-api.de/api/interpreter',
    '--data-urlencode', 'data=' + query,
  ], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  return out;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cellQuery(s, w, n, e) {
  return `[out:json][timeout:60];(way["building"](${s},${w},${n},${e});way["building:part"](${s},${w},${n},${e}););out body geom;`;
}

async function main() {
  const TEST_LIMIT = parseInt(process.argv[2] || '0', 10);
  const all = [];
  const seen = new Set();
  let cellIdx = 0;

  const cells = [];
  for (let lat = SOUTH; lat < NORTH; lat += STEP) {
    for (let lon = WEST; lon < EAST; lon += STEP) {
      cells.push({ s: lat, w: lon, n: Math.min(lat + STEP, NORTH), e: Math.min(lon + STEP, EAST) });
    }
  }
  console.log(`总网格数: ${cells.length}（STEP=${STEP}）`);

  for (const c of cells) {
    cellIdx++;
    if (TEST_LIMIT > 0 && cellIdx > TEST_LIMIT) break;
    const q = cellQuery(c.s, c.w, c.n, c.e);
    try {
      const body = await postOverpass(q);
      const j = JSON.parse(body);
      const els = j.elements || [];
      let added = 0;
      for (const el of els) {
        const key = el.type + '/' + el.id;
        if (!seen.has(key)) { seen.add(key); all.push(el); added++; }
      }
      console.log(`网格 ${cellIdx}/${cells.length} [${c.s.toFixed(3)},${c.w.toFixed(3)}] -> ${els.length} 个要素, 新增 ${added}, 累计 ${all.length}`);
    } catch (e) {
      console.log(`网格 ${cellIdx} 失败: ${e.message}`);
    }
    // 每 5 个网格保存一次进度（断点续传）
    if (cellIdx % 5 === 0) {
      fs.writeFileSync('data/chengdu_raw.json', JSON.stringify({ elements: all }), 'utf-8');
    }
    await sleep(2500); // 控制 overpass rate limit
  }

  fs.writeFileSync('data/chengdu_raw.json', JSON.stringify({ elements: all }), 'utf-8');
  console.log(`\n完成，累计 ${all.length} 个要素，已保存 data/chengdu_raw.json`);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
