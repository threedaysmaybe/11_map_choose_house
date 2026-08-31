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
  await page.waitForFunction(() => window.map && window.map.getSource('buildings'), { timeout: 60000 });
  await new Promise(r => setTimeout(r, 6000));

  const info = await page.evaluate(() => {
    const src = window.map.getSource('buildings');
    const b = window.map.getBounds().toArray();
    const pad = 0.01;
    const w = b[0][0] - pad, s = b[0][1] - pad, e = b[1][0] + pad, n = b[1][1] + pad;
    const raw = src._data && src._data.features ? src._data.features.length : -1;
    const q = window.map.querySourceFeatures('buildings').length;
    return { zoom: window.map.getZoom(), rawFeatures: raw, queriedFeatures: q, vp: [w, s, e, n] };
  });

  console.log('zoom:', info.zoom);
  console.log('source._data.features.length:', info.rawFeatures);
  console.log('querySourceFeatures.length:', info.queriedFeatures);
  console.log('viewport bbox:', JSON.stringify(info.vp));

  await browser.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
