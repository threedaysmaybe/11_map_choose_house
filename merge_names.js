const fs = require('fs');

// 真噪音：商铺/餐饮/银行/医疗等服务类 POI（不是建筑/小区名）
const NOISE_RE = /药房|火锅|养身|养生|烧烤|麻辣|银行|支行|门诊|牙科|美容|咖啡|奶茶|酒楼|饭店|食府|餐厅|诊所|药店|理发|洗车|维修|中介|房产|超市|便利店|餐馆|秘制|烤鱼|串串|面馆|米线|火锅店|冒菜|汤锅|钵钵鸡/;

const d = JSON.parse(fs.readFileSync('data/buildings.geojson', 'utf8'));
const names = JSON.parse(fs.readFileSync('data/names_result.json', 'utf8'));
const nameMap = {};
let skipped = 0;
for (const r of names) {
  if (!r.name) continue;
  if (NOISE_RE.test(r.name)) { skipped++; continue; }
  nameMap[r.id] = r.name;
}

let filled = 0;
for (const f of d.features) {
  if (!f.properties.name && nameMap[f.id]) {
    f.properties.name = nameMap[f.id];
    f.properties.nameSource = 'amap';
    filled++;
  }
}

fs.writeFileSync('data/buildings.geojson', JSON.stringify(d), 'utf-8');
const named = d.features.filter(f => f.properties.name).length;
console.log(`过滤掉噪音 ${skipped} 条`);
console.log(`已补全 ${filled} 栋楼的名称`);
console.log(`现在有名称: ${named}/${d.features.length} 栋 (${(named / d.features.length * 100).toFixed(1)}%)`);
