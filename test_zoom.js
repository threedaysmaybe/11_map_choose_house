const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  const info = await page.evaluate(() => {
    const src = window.map.getSource('buildings');
    const loadedTiles = src && src._tiles ? Object.keys(src._tiles).length : -1;
    const q = window.map.querySourceFeatures('buildings').length;
    const b = window.map.getBounds().toArray();
    return { loadedTiles, queriedFeatures: q, bounds: b, zoom: window.map.getZoom() };
  });
  console.log('初始: zoom', info.zoom, '| 已加载瓦片数:', info.loadedTiles, '| 视野内feature:', info.queriedFeatures);
  console.log('初始 bounds:', JSON.stringify(info.bounds));

  // 飞到南边三环外
  await page.evaluate(() => {
    window.map.flyTo({ center: [104.04, 30.55], zoom: 15, pitch: 50, bearing: -20, duration: 0 });
  });
  await new Promise(r => setTimeout(r, 4000));

  const info2 = await page.evaluate(() => {
    const src = window.map.getSource('buildings');
    const loadedTiles = src && src._tiles ? Object.keys(src._tiles).length : -1;
    const q = window.map.querySourceFeatures('buildings').length;
    const b = window.map.getBounds().toArray();
    return { loadedTiles, queriedFeatures: q, bounds: b, zoom: window.map.getZoom() };
  });
  console.log('南边三环外: zoom', info2.zoom, '| 已加载瓦片数:', info2.loadedTiles, '| 视野内feature:', info2.queriedFeatures);
  console.log('南边 bounds:', JSON.stringify(info2.bounds));

  await page.screenshot({ path: 'screenshots/test_south.png' });
  console.log('已截图 screenshots/test_south.png');

  await browser.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
