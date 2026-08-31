const fs = require('fs');

// 通用修正：把「底商名(小区名+方位/后缀)」还原成小区名
// 例：互惠超市(朝阳名宅北) → 朝阳名宅
const SHOP = /超市|商店|商铺|便利店|百货|烟酒|餐饮|饭店|酒楼|餐厅|火锅|烧烤|麻辣|面馆|小吃|药房|药店|诊所|门诊|牙科|理发|美容|中介|房产|旅|网吧|茶馆|咖啡|奶茶|酒|五金|汽修|洗车|宠物|快递|移动|联通|电信|银行/;
const RESI = /苑|园|城|郡|庭|院|湾|府|居|宅|邸|堡|岸|庄|湖|山|峰|岭|名|公寓|花园|小区|新城/;
const ROAD = /路|街|巷|道|桥|支|分|店|段|环|线|口|大厦|中心|储蓄|门市|营业|分理|驿/;

function extractCommunity(name) {
  const m = name.match(/^(.+?)[(（](.+?)[)）]$/);
  if (!m) return null;
  if (!SHOP.test(m[1])) return null;
  // 去方位词（组合优先）和后缀
  let inner = m[2].replace(/(东南|西南|东北|西北|东|南|西|北|中|侧|门)$/, '');
  inner = inner.replace(/(储蓄所|门市部|分理处|支行|营业厅|店|部|所)$/, '');
  inner = inner.replace(/[·\s·]/g, '');
  if (!inner || inner.length < 2 || inner.length > 8) return null;
  if (ROAD.test(inner)) return null;
  if (!RESI.test(inner)) return null;
  return inner;
}

const names = JSON.parse(fs.readFileSync('data/names_result.json', 'utf8'));
const fixMap = new Map();
for (const r of names) {
  if (!r.name) continue;
  const comm = extractCommunity(r.name);
  if (comm) fixMap.set(r.id, comm);
}

const b = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
let fixed = 0;
for (const f of b.features) {
  const comm = fixMap.get(f.id);
  if (comm) {
    f.properties.name = comm;
    fixed++;
  }
}
fs.writeFileSync('data/buildings.geojson', JSON.stringify(b));
console.log(`修正 ${fixed} 栋楼的名字（底商→小区名）`);
console.log('样例:');
[...fixMap.values()].slice(0, 20).forEach(c => console.log('  ', c));
