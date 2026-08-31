const { execFileSync } = require('child_process');
const fs = require('fs');

const BBOX = { s: 30.50, w: 103.95, n: 30.78, e: 104.18 };
const STEP = 0.05;
const COLS = Math.ceil((BBOX.e - BBOX.w) / STEP); // 5

// 失败的格子编号
const FAILED = [2, 3, 5, 6, 10, 12, 13, 16, 17, 18, 21, 22, 27, 28, 30];

function overpass(query) {
  const out = execFileSync('curl', ['-sS', '--max-time', '240', 'https://overpass-api.de/api/interpreter', '--data-urlencode', `data=${query}`], { maxBuffer: 100 * 1024 * 1024 });
  return JSON.parse(out.toString('utf8'));
}

function fetchCell(s, w, n, e) {
  const query = `[out:json][timeout:200];(way["landuse"="residential"](${s},${w},${n},${e});>;);out body;`;
  return overpass(query).elements;
}

(async () => {
  const existing = JSON.parse(fs.readFileSync('data/landuse_residential.json', 'utf8')).elements;
  const all = [...existing];
  const seen = new Set(existing.map(e => e.type + '/' + e.id));

  for (const cellNo of FAILED) {
    const latIdx = Math.floor((cellNo - 1) / COLS);
    const lonIdx = (cellNo - 1) % COLS;
    const s = BBOX.s + latIdx * STEP;
    const w = BBOX.w + lonIdx * STEP;
    const n = Math.min(s + STEP, BBOX.n);
    const e = Math.min(w + STEP, BBOX.e);

    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      try {
        const els = fetchCell(s, w, n, e);
        let added = 0;
        for (const el of els) {
          const key = el.type + '/' + el.id;
          if (!seen.has(key)) { seen.add(key); all.push(el); added++; }
        }
        console.log(`格子 ${cellNo} 重试成功: +${added} 个 way，累计 ${all.length}`);
        ok = true;
      } catch (err) {
        console.log(`格子 ${cellNo} 第${attempt}次失败: ${err.message.slice(0, 50)}`);
        await new Promise(r => setTimeout(r, 6000));
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  fs.writeFileSync('data/landuse_residential.json', JSON.stringify({ elements: all }));
  console.log(`\n完成：共 ${all.length} 个住宅地块 way`);
  console.log(`文件大小: ${Math.round(fs.statSync('data/landuse_residential.json').size / 1024)} KB`);
})();
