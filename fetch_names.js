const fs = require('fs');
const https = require('https');
const KEY = '9cb8fd71a6e7324e80f1fcd82ef8ee73';

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function centroid(f) {
  const ring = f.geometry.coordinates[0];
  let lon = 0, lat = 0;
  for (const [l, a] of ring) { lon += l; lat += a; }
  return [lon / ring.length, lat / ring.length];
}

// 批量坐标转换 WGS84 -> GCJ02（一次最多40个）
async function batchConvert(coords) {
  const result = new Array(coords.length);
  for (let i = 0; i < coords.length; i += 40) {
    const batch = coords.slice(i, i + 40);
    const locStr = batch.map(c => c[0] + ',' + c[1]).join('|');
    const url = `https://restapi.amap.com/v3/assistant/coordinate/convert?locations=${locStr}&coordsys=gps&key=${KEY}`;
    const data = await get(url);
    try {
      const j = JSON.parse(data);
      if (j.status === '1' && j.locations) {
        const locs = j.locations.split(';');
        locs.forEach((loc, k) => {
          const [lon, lat] = loc.split(',').map(Number);
          result[i + k] = [lon, lat];
        });
      }
    } catch (e) { console.log('坐标转换解析失败:', data.substring(0, 100)); }
    await sleep(200);
  }
  return result;
}

// regeo 查名字（AOI 面名优先）
const FILTER_RE = /开发区|高新区|新区|街道|公园|大道|绕城|环路|高速公路|立交|收费站|客运站|机场|药房|餐馆|火锅|养身|烧烤|麻辣|超市|便利店|美容|门诊|牙科|咖啡|奶茶|酒楼|饭店|食府|餐厅|诊所|药店|理发|洗车|维修|中介|房产/;
async function regeoName(lon, lat) {
  const url = `https://restapi.amap.com/v3/geocode/regeo?location=${lon},${lat}&extensions=all&radius=500&key=${KEY}`;
  const data = await get(url);
  try {
    const j = JSON.parse(data);
    if (j.status !== '1') return null;
    const ac = j.regeocode?.addressComponent;
    if (ac?.building?.name && typeof ac.building.name === 'string') return ac.building.name;
    if (ac?.neighborhood?.name && typeof ac.neighborhood.name === 'string') return ac.neighborhood.name;
    const aois = (j.regeocode?.aois || []).filter(a => {
      if (!a.name || typeof a.name !== 'string') return false;
      if (a.name.length > 20) return false;
      if (/[()（）]/.test(a.name)) return false; // 带括号 = POI 带地址（如"药房(XX路)"）
      if (FILTER_RE.test(a.name)) return false;
      const area = parseFloat(a.area);
      if (area > 0 && area < 3000) return false; // 面积过小 = 商铺/小店
      return true;
    });
    if (aois.length) {
      aois.sort((a, b) => parseFloat(a.area) - parseFloat(b.area));
      return aois[0].name;
    }
  } catch (e) {}
  return null;
}

(async () => {
  const LIMIT = parseInt(process.argv[2] || '0', 10); // 0 = 全部
  const d = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
  const noName = d.features.filter(f => !f.properties.name);
  const targets = LIMIT > 0 ? noName.slice(0, LIMIT) : noName;
  console.log(`无名称楼栋: ${noName.length} 栋，本次处理: ${targets.length} 栋`);

  // 断点续传：读取上次已保存结果，跳过已处理的
  const done = new Map();
  if (fs.existsSync('data/names_result.json')) {
    const prev = JSON.parse(fs.readFileSync('data/names_result.json', 'utf8'));
    for (const r of prev) done.set(r.id, r);
    console.log(`已读取上次进度: ${prev.length} 栋`);
  }
  const pending = targets.filter(t => !done.has(t.id));
  console.log(`本次待处理: ${pending.length} 栋（跳过已完成的 ${targets.length - pending.length} 栋）`);

  // 1. 坐标转换（只转换待处理的）
  const centers = pending.map(centroid);
  console.log('坐标转换中...');
  const gcj = await batchConvert(centers);

  // 2. 逐栋 regeo
  const results = [...done.values()];
  let hit = results.filter(r => r.name).length;
  const saveProgress = () => {
    fs.writeFileSync('data/names_result.json', JSON.stringify(results, null, 0));
  };
  for (let i = 0; i < pending.length; i++) {
    const c = gcj[i];
    if (!c) { results.push({ id: pending[i].id, name: null }); continue; }
    const name = await regeoName(c[0], c[1]);
    if (name) hit++;
    results.push({ id: pending[i].id, name });
    if ((i + 1) % 50 === 0) {
      console.log(`进度 ${i + 1}/${pending.length}, 累计命中 ${hit}`);
      saveProgress(); // 每 50 栋存档一次，可断点续传
    }
    await sleep(350);
  }
  saveProgress();

  console.log(`\n完成: 累计 ${results.length} 栋, 命中名字 ${hit} 栋 (${(hit / results.length * 100).toFixed(1)}%)`);
  console.log('结果已保存 data/names_result.json');
  // 打印样例
  const named = results.filter(r => r.name).slice(0, 30);
  console.log('\n样例:');
  named.forEach(r => console.log('  ' + r.name));
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
