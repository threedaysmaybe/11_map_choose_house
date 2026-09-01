// 重试抓取图片：针对指定的失败小区，遍历其房源，逐个打开房源页下载高清图，带失败重试
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIR = path.join(ROOT, 'data', 'ke_xiaoqu');
const IMG_DIR = path.join(DIR, 'images');
const TARGETS = (process.argv[2] || '').split(',');
const ONLY_FAILED = process.argv.includes('--failed');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// 打开大图查看器，读 li 的 data-pic（1000x750 4:3 完整图），页面内 fetch 下载高清原图
async function downloadHouseImages(page, subdir) {
  const dir = path.join(IMG_DIR, subdir);
  ensureDir(dir);
  const saved = [];
  try {
    const thumb = await page.$('.thumbnail img, .smallpic img');
    if (!thumb) return saved;
    await thumb.click();
    await new Promise(r => setTimeout(r, 1800));
    const urls = await page.evaluate(() => {
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
    const comm = f.replace(/\.json$/, '');
    if (TARGETS.length && !TARGETS.includes(comm)) continue;
    for (const h of (d.houses || [])) {
      if (!h.url) continue;
      if (ONLY_FAILED && (h.localImages || []).length > 0) continue;
      tasks.push({ comm, url: h.url, houseCode: h.houseCode, room: h.room || '?' });
    }
  }
  console.log(`待重试房源 ${tasks.length} 套`);

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null, timeout: 15000 });
  const page = await browser.newPage();

  let done = 0, ok = 0;
  const fails = [];
  for (const t of tasks) {
    let saved = [];
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2500));
      saved = await downloadHouseImages(page, t.comm);
      if (!saved.length) {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3500));
        saved = await downloadHouseImages(page, t.comm);
      }
    } catch (e) {
      fails.push({ comm: t.comm, room: t.room, reason: e.message });
      done++;
      console.log(`[${done}/${tasks.length}] ${t.comm} ${t.room} ❌ ${e.message}`);
      continue;
    }
    if (saved.length) {
      const f = path.join(DIR, t.comm + '.json');
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      const h = (d.houses || []).find(x => x.houseCode === t.houseCode || x.url === t.url);
      if (h) { h.localImages = saved.map(x => path.basename(x)); fs.writeFileSync(f, JSON.stringify(d, null, 2)); ok++; }
      else fails.push({ comm: t.comm, room: t.room, reason: '档案里找不到该房源' });
    } else {
      fails.push({ comm: t.comm, room: t.room, reason: '重试后仍0张' });
    }
    done++;
    console.log(`[${done}/${tasks.length}] ${t.comm} ${t.room} → ${saved.length} 张`);
  }

  await page.close();
  browser.disconnect();
  console.log(`\n成功: ${ok}/${tasks.length}`);
  if (fails.length) { console.log('失败:'); fails.forEach(f => console.log(`  ❌ ${f.comm} ${f.room} — ${f.reason}`)); }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
