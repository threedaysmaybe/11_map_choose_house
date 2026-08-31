const puppeteer = require('puppeteer-core');
const fs = require('fs');

// 抓取调试 Chrome 当前页的贝壳二手房房源，追加到结果文件（按房源ID去重）
const AREA = process.argv[2] || 'jinjiang';
const resultFile = `data/beike_${AREA}.json`;

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const beike = pages.find(p => p.url().includes('ershoufang')) || pages.find(p => p.url().includes('ke.com'));

  if (!beike) { console.error('❌ 未找到贝壳二手房列表页，请先在调试 Chrome 打开并翻到目标页'); process.exit(1); }

  const url = beike.url();
  const isCaptcha = /captcha|验证码/.test(url) || /CAPTCHA/i.test(await beike.title().catch(() => ''));
  if (isCaptcha) { console.error('❌ 当前是验证码页，请先过验证码并翻到房源列表页'); process.exit(1); }

  const parsed = await beike.evaluate(() => {
    return [...document.querySelectorAll('.sellListContent li.clear, .sellListContent li')].map(li => {
      const titleA = li.querySelector('.title a');
      const title = (titleA?.textContent || li.querySelector('.title')?.textContent || '').trim();
      const houseCode = ((titleA?.href || titleA?.getAttribute('href') || '')).match(/\/(\d{8,})\.html/)?.[1] || '';
      const positionInfo = li.querySelector('.positionInfo a, .positionInfo')?.textContent?.trim() || '';
      const houseInfo = (li.querySelector('.houseInfo')?.textContent || '').replace(/\s+/g, '');
      const totalPrice = (li.querySelector('.totalPrice')?.textContent || '').replace(/\s+/g, '');
      const unitPrice = (li.querySelector('.unitPrice')?.textContent || '').replace(/\s+/g, '');
      const fullText = li.innerText || '';
      const room = (title.match(/(\d+室\d+厅)/) || [])[1] || '';
      const floorTotal = (houseInfo.match(/共(\d+)层/) || [])[1] || '';
      const floorPos = (houseInfo.match(/(低|中|高)楼层/) || [])[1] || '';
      const area = (fullText.match(/([\d.]+)平米/) || [])[1] || '';
      const orientation = (title.match(/(东南|西南|东北|西北|南|北|东|西)/) || [])[1] || '';
      const year = (fullText.match(/(\d{4})年/) || [])[1] || '';
      const tags = [...li.querySelectorAll('.tag, .hashtag, [class*=tag]')].map(t => t.textContent.trim()).filter(Boolean);
      return {
        houseCode,
        community: positionInfo || title.split(' ')[0],
        room,
        area: area ? parseFloat(area) : null,
        orientation,
        floor: floorTotal ? `${floorPos}楼层/共${floorTotal}层` : (floorPos ? `${floorPos}楼层` : ''),
        price: totalPrice,
        unit: unitPrice,
        year,
        tags,
      };
    });
  });

  if (!parsed.length) { console.error('❌ 当前页没解析到房源卡片'); process.exit(1); }

  // 去重合并
  let results = [];
  if (fs.existsSync(resultFile)) results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const existing = new Set(results.map(r => r.houseCode).filter(Boolean));
  let added = 0;
  for (const p of parsed) {
    if (p.houseCode && existing.has(p.houseCode)) continue;
    if (p.houseCode) existing.add(p.houseCode);
    results.push(p);
    added++;
  }
  fs.writeFileSync(resultFile, JSON.stringify(results));

  console.log(`✅ 本页 ${parsed.length} 套，新增 ${added} 套，累计 ${results.length} 套`);
  console.log(`当前页 URL: ${url.replace(/https:\/\/cd.ke.com\/ershoufang\//, '').slice(0, 30)}`);
  browser.disconnect();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
