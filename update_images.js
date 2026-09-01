// 更新房源图片：遍历所有带 url 的房源，逐个打开房源页，用截图方式抓高清大图，覆盖 localImages
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIR = path.join(ROOT, 'data', 'ke_xiaoqu');
const IMG_DIR = path.join(DIR, 'images');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// 逐个点击缩略图打开大图查看器，element.screenshot 截图浏览器已渲染的高清图
async function screenshotHouseImages(page, subdir) {
  const dir = path.join(IMG_DIR, subdir);
  ensureDir(dir);
  const saved = [];
  try {
    const thumbs = await page.$$('.thumbnail img, .smallpic img');
    if (!thumbs.length) return saved;
    for (let i = 0; i < thumbs.length; i++) {
      try {
        await thumbs[i].click();
        await new Promise(r => setTimeout(r, 1600)); // 等大图加载渲染
        const bigImg = await page.$('.bigImg img');
        if (bigImg) {
          const buf = await bigImg.screenshot({ type: 'jpeg', quality: 92 });
          const file = path.join(dir, `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.jpg`);
          fs.writeFileSync(file, buf);
          saved.push(file);
        }
      } catch (e) {}
      try { const mask = await page.$('.bigImg .mask'); if (mask) await mask.click(); } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (e) {}
  return saved;
}

(async () => {
  ensureDir(DIR);
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'xiaoqu_list.json');
  const tasks = [];
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const comm = f.replace(/\.json$/, '');
    for (const h of (d.houses || [])) {
      if (h.url) tasks.push({ comm, url: h.url, houseCode: h.houseCode, room: h.room || '?' });
    }
  }
  console.log(`待更新房源 ${tasks.length} 套`);

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null, timeout: 15000 });
  const page = await browser.newPage();

  let done = 0, ok = 0;
  for (const t of tasks) {
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      const saved = await screenshotHouseImages(page, t.comm);
      if (saved.length) {
        const f = path.join(DIR, t.comm + '.json');
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        const h = (d.houses || []).find(x => x.houseCode === t.houseCode || x.url === t.url);
        if (h) {
          h.localImages = saved.map(x => path.basename(x));
          fs.writeFileSync(f, JSON.stringify(d, null, 2));
          ok++;
        }
      }
      done++;
      console.log(`[${done}/${tasks.length}] ${t.comm} ${t.room} → ${saved.length} 张`);
    } catch (e) {
      done++;
      console.log(`[${done}/${tasks.length}] ${t.comm} ${t.room} ❌ ${e.message}`);
    }
  }

  await page.close();
  browser.disconnect();
  console.log(`完成：更新 ${ok}/${tasks.length} 套`);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
