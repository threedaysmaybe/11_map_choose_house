const fs = require('fs');
const KEY = '9cb8fd71a6e7324e80f1fcd82ef8ee73';

async function regeo(lon, lat) {
  const url = `https://restapi.amap.com/v3/geocode/regeo?location=${lon},${lat}&key=${KEY}&extensions=all`;
  const r = await fetch(url);
  return r.json();
}

(async () => {
  const boards = JSON.parse(fs.readFileSync('data/boards.json', 'utf8'));
  for (const b of boards) {
    const [lon, lat] = (b.location || '').split(',').map(Number);
    if (!lon || !lat) continue;
    try {
      const d = await regeo(lon, lat);
      b.district = (d.regeocode && d.regeocode.addressComponent && d.regeocode.addressComponent.district) || '';
    } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  fs.writeFileSync('data/boards.json', JSON.stringify(boards, null, 2));

  const byDistrict = {};
  boards.forEach(b => { const k = b.district || '未知'; byDistrict[k] = (byDistrict[k] || 0) + 1; });
  console.log('按区分组（区 → 板块数）:');
  Object.entries(byDistrict).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v} 个板块`));
})();
