const fs = require('fs');

const KEY = '9cb8fd71a6e7324e80f1fcd82ef8ee73';

async function regeo(lon, lat) {
  const url = `https://restapi.amap.com/v3/geocode/regeo?location=${lon},${lat}&key=${KEY}&extensions=all`;
  const r = await fetch(url);
  return r.json();
}

function centroid(f) {
  const ring = f.geometry.coordinates[0];
  let lon = 0, lat = 0;
  for (const [l, a] of ring) { lon += l; lat += a; }
  return [lon / ring.length, lat / ring.length];
}

(async () => {
  const buildings = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
  // 采样：每 40 栋取 1 个坐标（约 1200 个点，覆盖主城区）
  const sample = buildings.features.filter((f, i) => i % 40 === 0);
  console.log('采样坐标:', sample.length, '个');

  const boards = new Map(); // name -> { name, location, count }
  let done = 0;
  for (const f of sample) {
    const [lon, lat] = centroid(f);
    try {
      const d = await regeo(lon, lat);
      const bas = d.regeocode && d.regeocode.addressComponent && d.regeocode.addressComponent.businessAreas || [];
      for (const ba of bas) {
        if (!ba.name) continue;
        if (!boards.has(ba.name)) boards.set(ba.name, { name: ba.name, location: ba.location, count: 0 });
        boards.get(ba.name).count++;
      }
    } catch (e) {}
    done++;
    if (done % 50 === 0) console.log(`进度 ${done}/${sample.length}`);
    await new Promise(r => setTimeout(r, 300));
  }

  const list = [...boards.values()].sort((a, b) => b.count - a.count);
  fs.writeFileSync('data/boards.json', JSON.stringify(list, null, 2));
  console.log('\n板块总数:', list.length);
  list.forEach(b => console.log(`  ${b.name} | ${b.location} | 出现 ${b.count} 次`));
})();
