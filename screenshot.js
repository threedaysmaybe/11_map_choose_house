const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function shot(page, name) {
  await page.screenshot({ path: `screenshots/${name}.png` });
  console.log(`✅ 已截图: screenshots/${name}.png`);
}

(async () => {
  if (!fs.existsSync('screenshots')) fs.mkdirSync('screenshots');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--window-size=1600,1000',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 });

  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('Error') || t.includes('error') || t.includes('加载失败')) {
      console.log('[浏览器console]', t);
    }
  });
  page.on('pageerror', err => console.log('[页面错误]', err.message));

  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 12000));

  // 图1：默认 3D 视角（楼块 + 阴影）
  await shot(page, '1_default_3d');

  // 图2：俯视看楼栋分布
  await page.evaluate(() => { window.map.setPitch(20); window.map.setBearing(0); });
  await new Promise(r => setTimeout(r, 3000));
  await shot(page, '2_top_view');

  // 图3：标记一栋楼 + 南侧遮挡 + 视野环
  await page.evaluate(() => {
    const features = window.map.querySourceFeatures('buildings', { sourceLayer: 'buildings' });
    const candidates = features.filter(f => {
      const h = f.properties.height;
      return h >= 24 && h <= 70 && f.geometry && f.geometry.type === 'Polygon';
    });
    if (candidates.length) {
      const target = candidates[Math.floor(candidates.length / 2)];
      window.markTarget(target);
      const ring = target.geometry.coordinates[0];
      let lon = 0, lat = 0;
      for (const [l, a] of ring) { lon += l; lat += a; }
      window.map.flyTo({ center: [lon / ring.length, lat / ring.length], zoom: 16.5, pitch: 60, bearing: -20 });
    }
  });
  await new Promise(r => setTimeout(r, 5000));
  await shot(page, '3_marked_viewshed');

  await browser.close();
  console.log('全部截图完成');
})().catch(e => { console.error('截图失败:', e.message); process.exit(1); });
