// 重新抓取已有房源，补充新字段（套内面积/梯户比/区域/总楼层）
// 只填充空值，不覆盖用户手动填的数据（套内面积）和备注
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const DIR = path.join(__dirname, 'data', 'ke_xiaoqu');

async function grabNewFields(page) {
  return await page.evaluate(() => {
    const txt = document.body.innerText.replace(/\s+/g, ' ');
    const grab = re => { const m = txt.match(re); return m ? m[1].trim() : null; };
    // 套内面积（贝壳常为"暂无"，抓不到则为 null）
    const taoneiArea = grab(/套内面积\s*([\d.]+)/);
    // 梯户比（X梯X户）
    const cnNum = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const toNum = s => { s = s.trim(); if (/^\d+$/.test(s)) return parseInt(s); if (cnNum[s]) return cnNum[s]; return 0; };
    let tihu = '';
    const tihuM = txt.match(/([一二三四五六七八九十两\d]+)梯([一二三四五六七八九十两\d]+)户/);
    if (tihuM) { const ti = toNum(tihuM[1]), hu = toNum(tihuM[2]); if (ti && hu) tihu = ti + '梯' + hu + '户'; }
    // 区域（图片右边"所在区域 武侯 华西"）
    let district = '', board = '';
    const areaEl = document.querySelector('.areaName');
    if (areaEl) {
      const m = areaEl.textContent.replace(/\s+/g, ' ').match(/所在区域\s*([\u4e00-\u9fa5]+)\s*([\u4e00-\u9fa5]+)/);
      if (m) { district = m[1]; board = m[2]; }
    }
    // 总楼层
    const totalFloors = grab(/共(\d+)层/);
    return { taoneiArea, tihu, district, board, totalFloors };
  });
}

(async () => {
  // 收集所有房源 url
  const targets = [];
  for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json') && x !== 'xiaoqu_list.json')) {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const h of (d.houses || [])) {
      if (h.url) targets.push({ file: f, url: h.url, houseCode: h.houseCode || '' });
    }
  }
  console.log(`待抓取房源: ${targets.length} 个`);

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const page = await browser.newPage();
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1500));
      const data = await grabNewFields(page);
      const file = path.join(DIR, t.file);
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const h = (d.houses || []).find(x => String(x.houseCode) === String(t.houseCode) || (x.url && x.url === t.url));
      if (h) {
        if (data.taoneiArea && !h.taoneiArea) h.taoneiArea = data.taoneiArea;   // 只填空值，保留手动填的
        if (data.tihu && !h.tihu) h.tihu = data.tihu;
        if (data.totalFloors && !h.totalFloors) h.totalFloors = data.totalFloors;
      }
      if (data.district || data.board) {
        if (!d.board && data.board) d.board = data.board;
        if (!d.district && data.district) d.district = data.district;
      }
      fs.writeFileSync(file, JSON.stringify(d, null, 2));
      console.log(`[${i + 1}/${targets.length}] ${t.file} ${h ? h.room + ' ' + h.area + '㎡' : ''} → 套内:${data.taoneiArea || '-'} 梯户:${data.tihu || '-'} 区域:${data.district || '-'}/${data.board || '-'}`);
    } catch (e) {
      console.log(`[${i + 1}/${targets.length}] ${t.file} 失败: ${e.message}`);
    } finally {
      await page.close();
    }
  }

  browser.disconnect();
  console.log('全部完成');
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
