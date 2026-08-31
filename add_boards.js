const fs = require('fs');
const KEY = '9cb8fd71a6e7324e80f1fcd82ef8ee73';

// 成都主城区缺失的著名板块（房产语境，高德商圈里没有的）
const ADD_BOARDS = [
  '九眼桥', '合江亭', '水井坊', '望江路', '东湖', '锦官驿', '书院街',
  '红牌楼', '武侯祠', '青羊宫', '骡马市', '文殊坊', '天府广场',
  '荷花池', '茶店子', '沙湾', '八里庄', '昭觉寺', '牛市口', '双桥子',
];

async function searchPlace(kw) {
  const url = `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent(kw)}&city=成都&key=${KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  const pois = (j.pois || []).filter(p => p.adname && (p.adname.includes('区') || p.adname.includes('市')));
  // 取第一个在成都主城区的
  const p = pois.find(p => /武侯|锦江|青羊|金牛|成华|双流|郫都|龙泉驿/.test(p.adname)) || pois[0];
  return p ? { location: p.location, district: p.adname } : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const boards = JSON.parse(fs.readFileSync('data/boards.json', 'utf8'));
  const existing = new Set(boards.map(b => b.name));

  let added = 0;
  for (const kw of ADD_BOARDS) {
    if (existing.has(kw)) { console.log('已存在，跳过:', kw); continue; }
    try {
      const r = await searchPlace(kw);
      if (r && r.location) {
        boards.push({ name: kw, location: r.location, count: 5, district: r.district });
        existing.add(kw);
        added++;
        console.log('补充:', kw, '@', r.location, '|', r.district);
      } else {
        console.log('未找到:', kw);
      }
    } catch (e) { console.log('搜索失败:', kw, e.message); }
    await sleep(300);
  }

  fs.writeFileSync('data/boards.json', JSON.stringify(boards, null, 2));
  console.log(`\n完成，新增 ${added} 个板块，当前共 ${boards.length} 个`);
})();
