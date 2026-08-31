const fs = require('fs');

const data = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));

// 直接按原始 name 分组（不归一化，一期/二期/南区/北区分开）
const groups = new Map();
for (const f of data.features) {
  const name = f.properties.name;
  if (!name) continue;
  if (!groups.has(name)) groups.set(name, []);
  groups.get(name).push(f);
}

// 非住宅关键词黑名单
const NON_RES = /广场|中心|大厦|公司|集团|学院|大学|学校|中学|小学|幼儿园|校区|宿舍|院区|住院|医学|工厂|厂$|产业园|物流|市场|酒店|宾馆|医院|银行|政府|局$|厅$|馆$|站$|寺|庙|公园|体育|商场|写字楼|饭店|餐厅|商店|超市|城投|置业|基地|仓库|科技园|软件园|工业|汽车|维修|装饰|建材|家具|电器|商贸|农贸|批发|交易|金融|保险|证券|总部|孵化|创业|商务|会议|展览|博览|演艺|影城|剧院|图书|文化|艺术|传媒|广告|咨询|事务所|管理|服务|科技|电子|机械|设备|制造|包装|印刷|纺织|服装|食品|饮料|制药|医疗|康养|养老|车站|客运|机场|码头|加油站|充电站|变电站|水厂|电厂|燃气|通信|移动|联通|电信|商铺|餐饮|食府|酒楼|火锅|烧烤|药房|诊所|牙科|咖啡|奶茶|美容|美发|洗车|公寓式|青年|人才公寓|研究院|研究所|设计院|规划院/;

// 凸包（Andrew's monotone chain）
function convexHull(points) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// 楼栋中心
function centroid(f) {
  const ring = f.geometry.coordinates[0];
  let lon = 0, lat = 0;
  for (const [l, a] of ring) { lon += l; lat += a; }
  return [lon / ring.length, lat / ring.length];
}

// 空间聚类：同名但分散的楼栋拆成多个组团，避免凸包过大
function clusterByDistance(items, thresholdKm) {
  const clusters = [];
  for (const it of items) {
    let placed = false;
    for (const cl of clusters) {
      if (distanceKm(it.c, cl.center) < thresholdKm) { cl.items.push(it); placed = true; break; }
    }
    if (!placed) {
      const c = { items: [it], center: it.c };
      clusters.push(c);
      // 动态更新中心
    }
  }
  return clusters.map(cl => cl.items);
}

function distanceKm(a, b) {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 111320;
  return Math.sqrt(dx * dx + dy * dy) / 1000;
}

const features = [];
let single = 0;
let nonRes = 0;
for (const [name, buildings] of groups) {
  if (buildings.length < 2) { single++; continue; }
  if (NON_RES.test(name)) { nonRes++; continue; }

  // 楼栋中心 + 空间聚类
  const items = buildings.map(f => ({ f, c: centroid(f) }));
  const clusters = clusterByDistance(items, 0.8); // 800m 内归一组（减少组团数，避免拆太碎）

  for (const cl of clusters) {
    const pts = [];
    for (const it of cl) {
      for (const [lon, lat] of it.f.geometry.coordinates[0]) pts.push([lon, lat]);
    }
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    hull.push(hull[0]);

    let lon = 0, lat = 0;
    for (const [l, a] of hull) { lon += l; lat += a; }
    lon /= hull.length; lat /= hull.length;

    features.push({
      type: 'Feature',
      properties: { name, count: cl.length, centerLon: lon, centerLat: lat },
      geometry: { type: 'LineString', coordinates: hull },
    });
  }
}

const out = { type: 'FeatureCollection', features };
fs.writeFileSync('data/communities.geojson', JSON.stringify(out));
console.log('组团边框数:', features.length, '| 单栋（跳过）:', single, '| 非住宅（过滤）:', nonRes);
console.log('文件大小:', Math.round(fs.statSync('data/communities.geojson').size / 1024) + ' KB');
