// 更新房源图片：遍历今天(updatedAt=今天)抓的带 url 房源，逐个打开房源页，用截图方式抓高清大图，覆盖 localImages
// 用法：node update_images.js [--all]   默认只抓今天；--all 抓全部
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIR = path.join(ROOT, 'data', 'ke_xiaoqu');
const IMG_DIR = path.join(DIR, 'images');
const ALL = process.argv.includes('--all');
const TODAY = new Date().toISOString().slice(0, 10);

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// 逐个点击缩略图打开大图查看器，element.screenshot 截图浏览器已渲染的高清图
// 打开大图查看器，读 .bigImg .slide 里的高清大图 URL（710x400），用页面内 fetch（带登录 Cookie）下载高清原图
async function downloadHouseImages(page, subdir) {
  const dir = path.join(IMG_DIR, subdir);
  ensureDir(dir);
  const saved = [];
  try {
    const thumb = await page.$('.thumbnail img, .smallpic img');
    if (!thumb) return saved;
    await thumb.click();
    await new Promise(r => setTimeout(r, 1800)); // 等大图查看器打开、高清图 URL 就绪
    const urls = await page.evaluate(() => {
      // 优先 li 的 data-pic（1000x750，4:3 完整图，不裁上下）；fallback data-src（710x400）
      const lis = [...document.querySelectorAll('.bigImg .slide ul li')];
      let list = lis.map(li => li.getAttribute('data-pic') || li.getAttribute('data-src') || '').filter(Boolean);
      if (!list.length) {
        const imgs = [...document.querySelectorAll('.bigImg .slide img')];
        list = imgs.map(img => img.getAttribute('data-pic') || img.src || '').filter(Boolean);
      }
      return list;
    });
    try { const mask = await page.$('.bigImg .mask'); if (mask) await mask.click(); } catch (e) {}
    if (!urls.length) return saved;
    const seen = new Set();
    for (let i = 0; i < urls.length; i++) {
      try {
        const base64 = await page.evaluate(async (u) => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000);
            const resp = await fetch(u, { headers: { Referer: 'https://cd.ke.com/' }, signal: ctrl.signal });
            clearTimeout(t);
            if (!resp.ok) return null;
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            const CHUNK = 8192;
            for (let j = 0; j < bytes.length; j += CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(j, j + CHUNK));
            return btoa(binary);
          } catch (e) { return null; }
        }, urls[i]);
        if (!base64 || seen.has(urls[i])) continue;
        seen.add(urls[i]);
        const ext = (urls[i].match(/\.(jpg|jpeg|png|webp)/i) || [])[1] || 'jpg';
        const file = path.join(dir, `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
        fs.writeFileSync(file, Buffer.from(base64, 'base64'));
        saved.push(file);
      } catch (e) {}
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
    if (!ALL && (d.updatedAt || '').slice(0, 10) !== TODAY) continue; // 默认只抓今天
    const comm = f.replace(/\.json$/, '');
    for (const h of (d.houses || [])) {
      if (h.url) tasks.push({ comm, url: h.url, houseCode: h.houseCode, room: h.room || '?' });
    }
  }
  console.log(`范围: ${ALL ? '全部' : '今天(' + TODAY + ')'}，待更新房源 ${tasks.length} 套\n`);

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null, timeout: 15000 });
  const page = await browser.newPage();

  let done = 0, ok = 0;
  const fails = [];
  for (const t of tasks) {
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      const saved = await downloadHouseImages(page, t.comm);
      if (saved.length) {
        const f = path.join(DIR, t.comm + '.json');
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        const h = (d.houses || []).find(x => x.houseCode === t.houseCode || x.url === t.url);
        if (h) {
          h.localImages = saved.map(x => path.basename(x));
          fs.writeFileSync(f, JSON.stringify(d, null, 2));
          ok++;
        } else {
          fails.push({ comm: t.comm, room: t.room, reason: '档案里找不到该房源(houseCode/url不匹配)' });
        }
      } else {
        fails.push({ comm: t.comm, room: t.room, reason: '截图0张(可能页面无缩略图或大图查看器未打开)' });
      }
      done++;
      console.log(`[${done}/${tasks.length}] ${t.comm} ${t.room} → ${saved.length} 张`);
    } catch (e) {
      done++;
      fails.push({ comm: t.comm, room: t.room, reason: e.message });
      console.log(`[${done}/${tasks.length}] ${t.comm} ${t.room} ❌ ${e.message}`);
    }
  }

  await page.close();
  browser.disconnect();

  console.log('\n===== 总结 =====');
  console.log(`成功更新: ${ok}/${tasks.length}`);
  if (fails.length) {
    console.log(`失败 ${fails.length} 套:`);
    fails.forEach(f => console.log(`  ❌ ${f.comm} ${f.room} — ${f.reason}`));
  } else {
    console.log('无失败');
  }
})().catch(e => { console.error('脚本异常:', e.message); process.exit(1); });
