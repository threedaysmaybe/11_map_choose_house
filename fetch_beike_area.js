const puppeteer = require('puppeteer-core');
const fs = require('fs');

// 半自动抓贝壳二手房（按区）：检测到验证码就暂停，等用户手动过，然后自动继续
// 用法: node fetch_beike_area.js <区拼音> <最大页数>
const AREA = process.argv[2] || 'jinjiang';
const MAX_PAGES = parseInt(process.argv[3] || '100', 10);

const resultFile = `data/beike_${AREA}.json`;
const pageFile = `data/beike_${AREA}_page.txt`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitCaptcha(beike, pg) {
  console.log(`\n⚠️ 第 ${pg} 页触发验证码，请在调试 Chrome 里点一下滑块过验证码...`);
  console.log('（脚本会自动检测，你过完它自己继续）');
  for (let i = 0; i < 300; i++) { // 最多等 10 分钟
    await sleep(2000);
    try {
      const url = beike.url();
      if (!url.includes('captcha')) { console.log('✅ 验证码已过，继续抓取\n'); return true; }
    } catch (e) {}
    if (i === 150) console.log('（已等 5 分钟，仍在等待...）');
  }
  console.log('❌ 等待超时（10 分钟），本次停止');
  return false;
}

async function isCaptcha(beike) {
  try {
    const url = beike.url();
    if (url.includes('captcha')) return true;
    const t = await beike.title();
    return /CAPTCHA|验证码/i.test(t);
  } catch (e) { return false; }
}

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const beike = pages.find(p => p.url().includes('ke.com')) || pages[0];

  // 断点续传
  let results = [];
  let startPage = 1;
  if (fs.existsSync(resultFile)) results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  if (fs.existsSync(pageFile)) startPage = parseInt(fs.readFileSync(pageFile, 'utf8').trim(), 10) + 1;
  console.log(`断点续传：已有 ${results.length} 套，从第 ${startPage} 页继续`);

  for (let pg = startPage; pg <= MAX_PAGES; pg++) {
    const url = pg === 1
      ? `https://cd.ke.com/ershoufang/${AREA}/`
      : `https://cd.ke.com/ershoufang/${AREA}/pg${pg}/`;
    try {
      await beike.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);

      // 检测验证码，暂停等用户
      if (await isCaptcha(beike)) {
        const ok = await waitCaptcha(beike, pg);
        if (!ok) break;
        pg--; // 重试当前页
        continue;
      }

      const parsed = await beike.evaluate(() => {
        return [...document.querySelectorAll('.sellListContent li.clear, .sellListContent li')].map(li => {
          const title = li.querySelector('.title a, .title')?.textContent?.trim() || '';
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
          return {
            community: positionInfo || title.split(' ')[0],
            room,
            area: area ? parseFloat(area) : null,
            orientation,
            floor: floorTotal ? `${floorPos}楼层/共${floorTotal}层` : (floorPos ? `${floorPos}楼层` : ''),
            price: totalPrice,
            unit: unitPrice,
          };
        });
      });

      if (!parsed.length) { console.log(`第 ${pg} 页无数据，结束`); break; }
      results.push(...parsed);
      fs.writeFileSync(resultFile, JSON.stringify(results));
      fs.writeFileSync(pageFile, String(pg));
      console.log(`第 ${pg} 页: +${parsed.length} 套，累计 ${results.length} 套`);
      await sleep(2500);
    } catch (e) { console.log(`第 ${pg} 页失败: ${e.message}`); await sleep(2000); }
  }

  console.log(`\n完成：共抓 ${results.length} 套，存到 ${resultFile}`);
  browser.disconnect();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
