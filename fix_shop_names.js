const fs = require('fs');
const KEY = '9cb8fd71a6e7324e80f1fcd82ef8ee73';

// 商铺/机构类名字（这些很可能是 building.name 而非小区名）
const SHOP_RE = /旅行社|门市部|服务网点|营业厅|药店|药房|诊所|口腔|公司|酒店|宾馆|饭店|餐馆|食府|酒楼|超市|便利店|咖啡|奶茶|银行|证券|保险|培训|教育|美容|美发|理发|餐饮|火锅|面馆|烧烤|麻辣烫|维修|洗车|中介|地产|物流|产业园|阀门|科技|电子|机械|化工|建材|家具|装饰|汽车|4s店|ktv|酒吧|健身|网吧|会所/;

// 小区名应过滤掉的非楼盘词
const NOISE_NB = /街道|社区|村|路|街|大道|镇|乡|开发区|新区|片区|广场|公园/;

function wgs84ToGcj02(lon, lat) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  const tLat = (x, y) => { let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x)); r += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; r += (20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3; r += (160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3; return r; };
  const tLon = (x, y) => { let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x)); r += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; r += (20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3; r += (150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3; return r; };
  const dLat = tLat(lon-105, lat-35), dLon = tLon(lon-105, lat-35);
  const radLat = lat/180*Math.PI; let m = Math.sin(radLat); m = 1-ee*m*m; const sq = Math.sqrt(m);
  const dLat2 = (dLat*180)/((a*(1-ee))/(m*sq)*Math.PI);
  const dLon2 = (dLon*180)/(a/sq*Math.cos(radLat)*Math.PI);
  return [lon+dLon2, lat+dLat2];
}

function centroid(f) {
  const r = f.geometry.coordinates[0]; let lo=0, la=0;
  for (const [l,a] of r) { lo+=l; la+=a; }
  return [lo/r.length, la/r.length];
}

async function regeoNeighborhood(glon, glat) {
  const url = `https://restapi.amap.com/v3/geocode/regeo?location=${glon.toFixed(6)},${glat.toFixed(6)}&extensions=all&radius=500&key=${KEY}`;
  const r = await fetch(url); const j = await r.json();
  const ac = j.regeocode && j.regeocode.addressComponent;
  const nb = ac && ac.neighborhood && ac.neighborhood.name;
  return (typeof nb === 'string' && nb && !NOISE_NB.test(nb)) ? nb : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const d = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
  const shops = d.features.filter(f => SHOP_RE.test(f.properties.name || ''));
  console.log('商铺/机构类楼栋:', shops.length, '栋');

  let fixed = 0;
  for (let i = 0; i < shops.length; i++) {
    const f = shops[i];
    const [lon, lat] = centroid(f);
    const [glon, glat] = wgs84ToGcj02(lon, lat);
    try {
      const nb = await regeoNeighborhood(glon, glat);
      if (nb) { f.properties.name = nb; fixed++; }
    } catch (e) {}
    if ((i + 1) % 50 === 0) console.log(`进度 ${i + 1}/${shops.length}, 已修正 ${fixed}`);
    await sleep(250);
  }

  fs.writeFileSync('data/buildings.geojson', JSON.stringify(d));
  console.log('完成，共修正', fixed, '栋');
})();
