const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function main() {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  } catch (e) {
    console.error('❌ 无法连接调试 Chrome。请先启动：');
    console.error('   chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\\beike_profile');
    console.error('   然后用这个 Chrome 打开贝壳二手房列表页并过验证码。');
    return;
  }

  const pages = await browser.pages();
  const beikePage = pages.find(p => p.url().includes('ke.com/ershoufang'));
  if (!beikePage) {
    console.log('❌ 未找到贝壳二手房列表页（url 含 ke.com/ershoufang）。');
    console.log('   当前打开的页面:');
    pages.forEach(p => console.log('   -', p.url()));
    return;
  }

  console.log('✅ 已找到贝壳页面:', beikePage.url());

  // 提取房源卡片（小区名 + 价格 + 面积 + 朝向）
  const houses = await beikePage.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll(
      'li.clear, .sellListContent li, .content__list li, .resblock-list li, div.info.clear, li[data-el]'
    );
    cards.forEach(card => {
      // 纯小区名在 .positionInfo a
      const commEl = card.querySelector('.positionInfo a, .flood .positionInfo a');
      const community = commEl ? commEl.textContent.trim() : '';
      const priceEl = card.querySelector('.totalPrice span, .totalPrice, .priceInfo .totalPrice, .total-price');
      const price = priceEl ? priceEl.textContent.trim().replace(/\s+/g, '') : '';
      const unitEl = card.querySelector('.unitPrice span, .unitPrice, .unit-price');
      const unit = unitEl ? unitEl.textContent.trim().replace(/\s+/g, '') : '';
      const infoEl = card.querySelector('.houseInfo');
      const info = infoEl ? infoEl.textContent.trim().replace(/\s+/g, ' ') : '';
      // 从 info 提取面积和朝向（info 形如"中楼层(共11层) 3室2厅 | 137.8平米 | 南 北"）
      const areaM = info.match(/([\d.]+)\s*平米/);
      const area = areaM ? areaM[1] + '平米' : '';
      const seg = info.split('|').map(s => s.trim());
      const orientation = seg.length >= 3 ? seg[seg.length - 1] : '';
      if (community) results.push({ community, area, orientation, price, unit });
    });
    return results;
  });

  console.log('提取到房源:', houses.length, '条');
  if (houses.length === 0) {
    console.log('⚠️ 没提取到房源卡片，可能是贝壳页面结构变了，或当前页还没加载出列表。');
  }
  houses.slice(0, 8).forEach(h => console.log('  ·', h.community, '|', h.price, '|', h.area, '|', h.orientation));

  fs.writeFileSync('data/beike_houses.json', JSON.stringify(houses, null, 2));
  console.log('\n✅ 已保存 data/beike_houses.json');
  browser.disconnect();
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
