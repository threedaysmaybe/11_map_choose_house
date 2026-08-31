const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const t0 = Date.now();
  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const tDOM = Date.now();
  console.log(`DOMContentLoaded: ${(tDOM - t0) / 1000}s`);

  // 等 loading 元素消失
  try {
    await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 120000 });
    const tDone = Date.now();
    console.log(`数据加载完成(loading消失): ${(tDone - t0) / 1000}s`);
    console.log(`其中 fetch+解析+渲染: ${(tDone - tDOM) / 1000}s`);
  } catch (e) {
    console.log('120秒内 loading 未消失，可能卡住了');
  }

  await browser.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
