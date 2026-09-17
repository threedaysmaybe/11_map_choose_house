// 计算每个小区到 4 个目的地的驾车距离 + 公交最短时间（高德 API）
const fs = require('fs');
const https = require('https');

const KEY = '9cb8fd71a6e7324e80f1fcd82ef8ee73';
const PI = Math.PI;
const a = 6378245.0;
const ee = 0.00669342162296594323;

// 目的地（GCJ02 坐标，高德返回）
const DESTS = [
  { name: '春熙路', lon: 104.078643, lat: 30.657952 },
  { name: '大悦城', lon: 104.011166, lat: 30.626041 },
  { name: '万象城', lon: 104.115390, lat: 30.648490 },
  { name: '联发科技', lon: 104.064713, lat: 30.538108 },
];

function outOfChina(lon, lat) { return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}
function wgs2gcj(lon, lat) {
  if (outOfChina(lon, lat)) return [lon, lat];
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLon = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return [lon + dLon, lat + dLat];
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, r => {
      let s = '';
      r.on('data', d => s += d);
      r.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(new Error(s.slice(0, 120))); } });
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function driving(org, dest) {
  const j = await get(`https://restapi.amap.com/v3/direction/driving?origin=${org}&destination=${dest}&key=${KEY}`);
  if (j.status !== '1' || !j.route || !j.route.paths || !j.route.paths[0]) return null;
  return { distance: j.route.paths[0].distance, duration: j.route.paths[0].duration };
}
async function transit(org, dest) {
  // 指定「最快」策略 + 明天早上 8 点出发，避开深夜公交地铁停运导致的绕远/长时间方案
  const tmr = new Date(Date.now() + 86400000);
  const date = tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0');
  const j = await get(`https://restapi.amap.com/v3/direction/transit/integrated?origin=${org}&destination=${dest}&city=成都&key=${KEY}&strategy=1&date=${date}&time=08:00`);
  if (j.status !== '1' || !j.route || !j.route.transits || !j.route.transits.length) return null;
  // 取耗时最短的一条
  const t = j.route.transits.reduce((min, x) => (x.duration < min.duration ? x : min), j.route.transits[0]);
  return { duration: t.duration, distance: t.distance };
}

(async () => {
  const list = (JSON.parse(fs.readFileSync('data/ke_xiaoqu/xiaoqu_list.json', 'utf8')).files || []);
  // 断点续传：读已计算的结果
  let result = {};
  try { result = JSON.parse(fs.readFileSync('data/commute.json', 'utf8')); } catch (e) {}

  const pending = list.filter(x => x.lon && x.lat && !result[x.name]);
  console.log('待计算小区:', pending.length, '/ 总计:', list.length);
  let i = 0;
  for (const xq of pending) {
    const [glon, glat] = wgs2gcj(xq.lon, xq.lat);
    const org = glon.toFixed(6) + ',' + glat.toFixed(6);
    const r = {};
    for (const d of DESTS) {
      const dest = d.lon + ',' + d.lat;
      try {
        const dr = await driving(org, dest);
        const tr = await transit(org, dest);
        r[d.name] = dr && tr ? { driveDist: dr.distance, driveTime: dr.duration, transitTime: tr.duration } : null;
      } catch (e) { r[d.name] = null; }
      await sleep(250);
    }
    result[xq.name] = r;
    i++;
    if (i % 5 === 0) {
      fs.writeFileSync('data/commute.json', JSON.stringify(result, null, 0));
      console.log('进度', i + '/' + pending.length, xq.name);
    }
  }
  fs.writeFileSync('data/commute.json', JSON.stringify(result, null, 0));
  console.log('完成，共', i, '个小区，已写入 data/commute.json');
})();
