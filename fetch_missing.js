// 补抓缺失字段的房源（只抓缺 diya 的，加延迟避免反爬）
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const DIR = path.join(__dirname, 'data', 'ke_xiaoqu');
const FIELDS = ['diya', 'chanquan', 'buildingType', 'huxingStructure', 'usage', 'decoration', 'listTime', 'lastTrade', 'sellingPoint', 'fangben'];

async function grabNewFields(page) {
  return await page.evaluate(() => {
    const txt = document.body.innerText.replace(/\s+/g, ' ');
    const grab = re => { const m = txt.match(re); return m ? m[1].trim() : null; };
    const diya = grab(/抵押信息\s*(无抵押|有抵押)/) || '';
    const chanquan = grab(/产权所属\s*(非共有|共有|按份共有|共同共有)/) || '';
    const buildingType = grab(/建筑类型\s*(板楼|塔楼|板塔结合|平房)/) || '';
    const huxingStructure = grab(/户型结构\s*(平层|复式|跃层|错层)/) || '';
    const usage = grab(/房屋用途\s*(普通住宅|别墅|公寓|商业办公|车位)/) || '';
    const decoration = grab(/装修情况\s*(毛坯|简装|精装|豪华装修)/) || '';
    const listTime = grab(/挂牌时间\s*(\d{4}年\d{1,2}月\d{1,2}日)/) || '';
    const lastTrade = grab(/上次交易\s*(\d{4}年\d{1,2}月\d{1,2}日)/) || '';
    const spM = txt.match(/核心卖点\s*([\u4e00-\u9fa5，。、：；0-9a-zA-Z\s]{5,120})/);
    const sellingPoint = spM ? spM[1].trim() : '';
    const fangben = grab(/房本备件\s*([^\s]+)/) || '';
    return { diya, chanquan, buildingType, huxingStructure, usage, decoration, listTime, lastTrade, sellingPoint, fangben };
  });
}

(async () => {
  // 找缺失的房源（缺 diya 的）
  const targets = [];
  for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json') && x !== 'xiaoqu_list.json')) {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const h of (d.houses || [])) {
      if (h.url && !h.diya) targets.push({ file: f, url: h.url, houseCode: h.houseCode || '' });
    }
  }
  console.log(`缺失房源: ${targets.length} 个`);

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const page = await browser.newPage();
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      const data = await grabNewFields(page);
      const file = path.join(DIR, t.file);
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const h = (d.houses || []).find(x => String(x.houseCode) === String(t.houseCode) || (x.url && x.url === t.url));
      if (h && data.diya) {
        for (const k of FIELDS) { if (data[k] && !h[k]) h[k] = data[k]; }
        fs.writeFileSync(file, JSON.stringify(d, null, 2));
        console.log(`[${i + 1}/${targets.length}] ✓ ${t.file} ${h.room} ${h.area}㎡ → 抵押:${data.diya} 产权:${data.chanquan || '-'} 用途:${data.usage || '-'} 装修:${data.decoration || '-'}`);
      } else {
        console.log(`[${i + 1}/${targets.length}] ✗ ${t.file} ${h ? h.room + ' ' + h.area + '㎡' : ''} → ${data.diya ? '' : '验证码拦截/无数据'}`);
      }
    } catch (e) {
      console.log(`[${i + 1}/${targets.length}] ✗ ${t.file} 失败: ${e.message}`);
    } finally {
      await page.close();
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  browser.disconnect();
  console.log('完成');
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
