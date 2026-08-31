const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CITY_ID = 1083; // 成都
const COUNT = 50; // 每页条数

function parseItem(item) {
  const core = item.core_info || [];
  const base = item.base_info || [];
  const get = (arr, attr) => { const f = arr.find(x => x.attr === attr); return f ? f.value : ''; };
  const community = get(core, '小区名');
  if (!community) return null;
  return {
    community,
    price: get(core, '售价'),
    area: get(core, '建筑面积'),
    room: get(core, '房型'),
    orientation: get(base, '朝向'),
    floor: get(base, '楼层'),
  };
}

async function fetchPage(offset) {
  const url = `https://fangchan.toutiao.com/f100/api/search?city_id=${CITY_ID}&offset=${offset}&house_type=2&count=${COUNT}&page_type=old_list`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return r.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const all = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore && offset < 20000) {
    let j;
    try {
      j = await fetchPage(offset);
    } catch (e) {
      console.log('请求失败，重试…', e.message);
      await sleep(2000);
      continue;
    }
    const items = (j.data && j.data.items) || [];
    for (const item of items) {
      const h = parseItem(item);
      if (h) all.push(h);
    }
    hasMore = !!(j.data && j.data.has_more);
    offset += COUNT;
    if (offset % 500 === 0) console.log(`已抓 ${all.length} 套 (offset ${offset})`);
    await sleep(400);
  }

  // 去重（同小区+面积+总价）
  const seen = new Set();
  const dedup = all.filter(h => {
    const k = h.community + '|' + h.area + '|' + h.price;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  fs.writeFileSync('data/xingfuli_houses.json', JSON.stringify(dedup, null, 2));
  console.log(`\n✅ 幸福里抓取完成，共 ${dedup.length} 套（原始 ${all.length} 套）`);
  dedup.slice(0, 8).forEach(h => console.log('  ·', h.community, '|', h.price, '|', h.area, '|', h.orientation, '|', h.room));
})();
