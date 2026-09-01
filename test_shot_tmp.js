const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const page = await browser.newPage();
  await page.goto('https://cd.ke.com/ershoufang/106128551688.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  const thumbs = await page.$$('.thumbnail img, .smallpic img');
  console.log('缩略图数:', thumbs.length);
  let saved = 0;
  const seen = new Set();
  for (let i = 0; i < Math.min(3, thumbs.length); i++) {
    try {
      await thumbs[i].click();
      await new Promise(r => setTimeout(r, 1600));
      const idx = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('.bigImg img')];
        return imgs.findIndex(img => { const r = img.getBoundingClientRect(); return r.width > 80 && r.height > 50; });
      });
      console.log(`  缩略图${i} → 可见大图 index:`, idx);
      const bigImgs = await page.$$('.bigImg img');
      if (idx >= 0 && bigImgs[idx]) {
        const buf = await bigImgs[idx].screenshot({ type: 'jpeg', quality: 92 });
        console.log(`    截图成功 ${buf.length} 字节`);
        saved++;
      }
    } catch(e) { console.log(`  缩略图${i} 异常:`, e.message); }
    try { const m = await page.$('.bigImg .mask'); if (m) await m.click(); } catch(e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('成功截图:', saved);
  await page.close();
  browser.disconnect();
})();
