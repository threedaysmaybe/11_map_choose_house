const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// 智能抓取贝壳：自动识别页面类型，有啥抓啥，增量合并
const DIR = 'data/ke_xiaoqu';
const IMG_DIR = path.join(DIR, 'images');

function classifyPage(url) {
  if (/map\.ke\.com/.test(url)) return 'map';
  if (/xiaoqu\/\d+/.test(url)) return 'xiaoqu_detail';
  if (/xiaoqu\/rs/.test(url)) return 'xiaoqu_search';
  if (/ershoufang\/\d+\.html/.test(url)) return 'house_detail';
  if (/ershoufang\//.test(url)) return 'ershoufang_list';
  return 'other';
}

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// 提取小区详情页信息
async function grabXiaoquDetail(page, boardNames) {
  return await page.evaluate((boardNames) => {
    const txt = document.body.innerText.replace(/\s+/g, ' ');
    const grab = re => { const m = txt.match(re); return m ? m[1].trim() : null; };
    // 小区名（从标题/页头）
    const name = grab(/小区大全.*?([\u4e00-\u9fa5]{2,8}小区)/) || grab(/([\u4e00-\u9fa5]{2,8}小区)(?:房价|二手房|详情|大全)/) || grab(/([\u4e00-\u9fa5A-Za-z0-9·]{2,14}?)(?:房价|二手房|租房)/) || (document.querySelector('.detailTitle, .xiaoquTitle, h1')?.textContent || '').replace(/[·\s·]/g, '');
    // 均价
    const price = grab(/([\d,]+)元\/㎡/);
    // label-value 字段
    const info = {};
    const LABELS = ['建筑类型', '房屋总数', '楼栋总数', '绿化率', '容积率', '交易权属', '建成年代', '供暖类型', '用水类型', '用电类型', '物业费', '开发商'];
    for (let i = 0; i < LABELS.length; i++) {
      const label = LABELS[i], next = LABELS[i + 1];
      const re = next ? new RegExp(label + '\\s*(.*?)(?=' + next + '|地铁|公交|小区|成交|$)', 's') : new RegExp(label + '\\s*(.*?)$', 's');
      const m = txt.match(re);
      info[label] = m ? m[1].trim().slice(0, 40) : '';
    }
    // 地铁（站名 + 距离 + 线路）
    const metro = [];
    const metroRe = /([\u4e00-\u9fa5]{2,8}站?)\s*(\d+)米\s*(地铁[\d号、;]+)/g;
    let mm;
    while ((mm = metroRe.exec(txt))) metro.push({ name: mm[1], distance: mm[2] + '米', lines: mm[3] });
    // 成交记录
    const deals = [];
    const dealRe = /(\d{4}年|暂无信息)\s*([\d.]+平米)\s*(\d{4}-\d{2}-\d{2})\s*([\d.]+万)\s*([\d,]+元\/平)/g;
    let dm;
    while ((dm = dealRe.exec(txt))) deals.push({ 建成年份: dm[1], 面积: dm[2], 签约日期: dm[3], 成交价: dm[4], 成交单价: dm[5] });
    // 清理字段噪音
    if (info['物业费']) info['物业费'] = (info['物业费'].match(/[\d.]+(?:至[\d.]+)?元\/平米\/月/) || [])[0] || info['物业费'];
    if (info['开发商']) info['开发商'] = (info['开发商'].match(/[\u4e00-\u9fa5（）()]+(?:公司|集团|置业|开发|房地产)[\u4e00-\u9fa5（）()]*/) || [])[0] || info['开发商'];
    // 小区图片（抓全部，缩略图统一成大图，按图片ID去重）
    const rawImgs = [...document.querySelectorAll('img')].map(i => i.src || i.getAttribute('data-src')).filter(s => /hdic-resblock/.test(s));
    const seen = new Set();
    const images = [];
    for (const u of rawImgs) {
      const id = (u.match(/([a-f0-9-]{32,})/) || [])[1] || u;
      if (seen.has(id)) continue;
      seen.add(id);
      images.push(u.replace(/\.(710x400|118x80|236x160)\.jpg/, '.710x400.jpg'));
    }
    // 板块：优先抓面包屑"… > XX小区 > 小区名"，XX 即板块（最可靠，不受地铁站名干扰）
    let board = '';
    if (name && name.length >= 2) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = txt.match(new RegExp('([\\u4e00-\\u9fa5]{2,8}小区)\\s*>\\s*' + esc));
      if (m) board = m[1].replace(/小区$/, '');
    }
    // fallback：小区名附近找已知板块名
    if (!board && name && name.length >= 2) {
      const nameIdx = txt.lastIndexOf(name);
      if (nameIdx >= 0) {
        const start = Math.max(0, nameIdx - 40);
        const near = txt.slice(start, nameIdx + name.length + 40);
        board = (boardNames || []).find(n => near.includes(n)) || '';
      }
    }
    if (!board) board = (boardNames || []).find(n => txt.includes(n)) || '';
    return { name, price, board, info, metro, deals, images };
  }, boardNames);
}

// 提取房源详情页信息
async function grabHouseDetail(page) {
  return await page.evaluate(async () => {
    const txt = document.body.innerText.replace(/\s+/g, ' ');
    const grab = re => { const m = txt.match(re); return m ? m[1].trim() : null; };
    // 总价/单价：从价格元素提取
    const priceEl = document.querySelector('.total, .price, [class*=total], [class*=price]');
    const priceText = priceEl ? priceEl.innerText.replace(/\s+/g, ' ') : txt;
    const totalPrice = (priceText.match(/([\d.]+)\s*万/) || [])[1] || grab(/([\d.]+)\s*万/);
    const unitPrice = (priceText.match(/([\d,]+)\s*元\/平米/) || [])[1] || grab(/([\d,]+)元\/平/);
    const title = document.title || '';
    // 小区名：优先从固定 DOM 位置读取（.communityName 元素，或小区详情链接）
    let community = '';
    const commEl = document.querySelector('.communityName');
    if (commEl) {
      const m = commEl.textContent.replace(/\s+/g, ' ').match(/小区名称\s*([\u4e00-\u9fa5A-Za-z0-9·]+)/);
      if (m) community = m[1];
    }
    if (!community) {
      const link = [...document.querySelectorAll('a[href*="xiaoqu"]')].find(a => /xiaoqu\/\d+/.test(a.href) && a.textContent.trim().length >= 2 && a.textContent.trim().length <= 12);
      if (link) community = link.textContent.trim();
    }
    // fallback：标题正则（小区名后缀特征）
    if (!community) {
      const RESI = '(?:花园|花苑|苑|城|郡|庭|院|湾|府|居|宅|邸|堡|岸|庄|湖|山|园|公馆|名宅|公寓|阁|[一二三四五六七八九十]?期)';
      community = (title.match(new RegExp('_([\\u4e00-\\u9fa5]{2,10}' + RESI + ')')) || [])[1]
        || grab(new RegExp('([\\u4e00-\\u9fa5]{2,8}' + RESI + ')')) || '';
    }
    // 所在区域（.areaName 元素："所在区域 武侯 华西"，区 + 板块）
    let district = '', board = '';
    const areaEl = document.querySelector('.areaName');
    if (areaEl) {
      const m = areaEl.textContent.replace(/\s+/g, ' ').match(/所在区域\s*([\u4e00-\u9fa5]+)\s*([\u4e00-\u9fa5]+)/);
      if (m) { district = m[1]; board = m[2]; }
    }
    // 从房源描述提取关键特征（单位房/回迁/满五/停车费/电梯等）
    const features = [];
    if (/单位房|单位集资|单位分房|单位宿舍|单位大院/.test(txt)) features.push('单位房');
    if (/房改房/.test(txt)) features.push('房改房');
    if (/回迁房|回迁/.test(txt)) features.push('回迁房');
    if (/经济适用房|经适房|两限房/.test(txt)) features.push('经适房');
    if (/满五|满五年/.test(txt)) features.push('满五');
    if (/户型方正/.test(txt)) features.push('户型方正');
    if (/南北通透/.test(txt)) features.push('南北通透');
    if (/精装修|精装/.test(txt)) features.push('精装');
    const pk = txt.match(/停车费\s*[:：]?\s*(\d+)/);
    if (pk) features.push('停车费' + pk[1] + '元/月');
    if (/电梯/.test(txt)) features.push('电梯');
    // 梯户比（X梯X户，如"两梯六户"）
    const cnNum = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const toNum = s => { s = s.trim(); if (/^\d+$/.test(s)) return parseInt(s); if (cnNum[s]) return cnNum[s]; return 0; };
    let tihu = '';
    const tihuM = txt.match(/([一二三四五六七八九十两\d]+)梯([一二三四五六七八九十两\d]+)户/);
    if (tihuM) {
      const ti = toNum(tihuM[1]), hu = toNum(tihuM[2]);
      if (ti && hu) tihu = ti + '梯' + hu + '户';
    }
    // 建筑结构（框架结构/砖混结构/钢结构/混合结构等）
    const structure = grab(/建筑结构\s*([\u4e00-\u9fa5]{1,6}结构)/) || '';
    // 补充字段：抵押/产权/建筑类型/户型结构/用途/装修/挂牌/上次交易/核心卖点/房本
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
    // 抓高清大图：点击缩略图打开大图查看器，读 data-pic(1000x750)/src(710x400)
    let imageUrls = [];
    try {
      const thumb = document.querySelector('.thumbnail img, .smallpic img');
      if (thumb) {
        thumb.click();
        await new Promise(r => setTimeout(r, 1800));
        const bigImgs = [...document.querySelectorAll('.bigImg img')];
        if (bigImgs.length) {
          const seen = new Set();
          for (const img of bigImgs) {
            const u = img.getAttribute('data-pic') || img.src || '';
            if (!u || seen.has(u)) continue;
            seen.add(u);
            imageUrls.push(u.replace(/\?.*$/, ''));
          }
          document.querySelector('.bigImg .mask')?.click();
        }
      }
    } catch (e) {}
    // 兜底：缩略图（120x80）
    if (!imageUrls.length) {
      const raw = [...document.querySelectorAll('img')].map(i => i.src || i.getAttribute('data-src')).filter(s => /hdic-frame|inspection/.test(s));
      const seen = new Set();
      for (const u of raw) {
        const id = (u.match(/([a-f0-9-]{32,})/) || [])[1] || u.match(/([0-9]+_[A-Za-z0-9]+)/)?.[1] || u;
        if (seen.has(id)) continue;
        seen.add(id);
        imageUrls.push(u.replace(/\?.*$/, ''));
        if (imageUrls.length >= 8) break;
      }
    }
    return {
      title: title.replace(/[-_].*$/, '').trim(),
      room: grab(/(\d+室\d+厅)/),
      area: grab(/([\d.]+)平米/),
      taoneiArea: grab(/套内面积\s*([\d.]+)/),
      totalPrice,
      unitPrice,
      floor: grab(/(低|中|高)楼层/),
      totalFloors: grab(/共(\d+)层/),
      orientation: grab(/(东南|西南|东北|西北|南北|东西|南|北|东|西)(?=\s|$)/),
      community,
      district,
      board,
      features,
      tihu,
      structure,
      diya,
      chanquan,
      buildingType,
      huxingStructure,
      usage,
      decoration,
      listTime,
      lastTrade,
      sellingPoint,
      fangben,
      images: imageUrls,
    };
  });
}

// 下载图片（带 Referer 防盗链，fetch 转 base64 存文件）
async function downloadImages(page, urls, subdir) {
  if (!urls.length) return [];
  const dir = path.join(IMG_DIR, subdir);
  ensureDir(dir);
  const saved = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const u = urls[i];
      const ext = (u.match(/\.(jpg|jpeg|png|webp)/i) || [])[1] || 'jpg';
      const base64 = await page.evaluate(async (url) => {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          const resp = await fetch(url, { headers: { 'Referer': 'https://cd.ke.com/' }, signal: ctrl.signal });
          clearTimeout(timer);
          if (!resp.ok) return null;
          const buf = await resp.arrayBuffer();
          const bytes = new Uint8Array(buf);
          // 分块转 base64（避免逐字节拼接的 O(n²) 性能问题）
          let binary = '';
          const CHUNK = 8192;
          for (let j = 0; j < bytes.length; j += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(j, j + CHUNK));
          }
          return btoa(binary);
        } catch (e) { return null; }
      }, u);
      if (!base64) continue;
      const file = path.join(dir, `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
      fs.writeFileSync(file, Buffer.from(base64, 'base64'));
      saved.push(file);
    } catch (e) {}
  }
  return saved;
}

(async () => {
  ensureDir(DIR); ensureDir(IMG_DIR);
  // 读取板块名列表（用于识别小区所属板块）
  let boardNames = [];
  try { boardNames = JSON.parse(fs.readFileSync('data/boards.json', 'utf8')).map(b => b.name).filter(Boolean); } catch (e) {}
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await browser.pages();
  const result = { 小区: [], 房源: [], 列表: [], 其他: [] };

  for (const page of pages) {
    const url = page.url();
    const type = classifyPage(url);
    if (type === 'map' || type === 'other' || type === 'xiaoqu_search') { result.其他.push(url.slice(0, 60)); continue; }

    if (type === 'xiaoqu_detail') {
      const data = await grabXiaoquDetail(page, boardNames);
      const name = data.name || url.match(/xiaoqu\/(\d+)/)?.[1] || '未知小区';
      // 增量合并到 JSON
      const file = path.join(DIR, name + '.json');
      let existing = {};
      if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };
      if (data.images && data.images.length) {
        const saved = await downloadImages(page, data.images, name);
        merged.localImages = [...new Set([...(merged.localImages || []), ...saved.map(f => path.basename(f))])];
      }
      fs.writeFileSync(file, JSON.stringify(merged, null, 2));
      result.小区.push(`${name}（均价${data.price || '?'}，成交${data.deals.length}条，地铁${data.metro.map(m => m.name + m.distance).join('/')}，图${(data.images || []).length}张）`);
    } else if (type === 'house_detail') {
      const data = await grabHouseDetail(page);
      // 存房源详情，按小区归属
      const comm = data.community || '未归属';
      const file = path.join(DIR, comm + '.json');
      let existing = {};
      if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!existing.houses) existing.houses = [];
      // 附上贝壳房源链接 + 用房源 code（URL 里的数字）去重
      data.url = page.url();
      const houseCode = (page.url().match(/\/(\d{8,})\.html/) || [])[1] || '';
      data.houseCode = houseCode;
      if (data.images && data.images.length) {
        const saved = await downloadImages(page, data.images, comm);
        data.localImages = saved.map(f => path.basename(f));
      }
      // 归并区域信息（区 + 板块）到小区档案（房源页图片右边的"所在区域"）
      if (!existing.board && data.board) existing.board = data.board;
      if (!existing.district && data.district) existing.district = data.district;
      if (!existing.name && data.community) existing.name = data.community;
      // 归并房源关键特征到小区信息（单位房/停车费等）
      if (data.features && data.features.length) {
        existing.info = existing.info || {};
        const propTypes = ['单位房', '房改房', '回迁房', '经适房'];
        const prop = data.features.find(f => propTypes.includes(f));
        if (prop && !existing.info['房屋性质']) existing.info['房屋性质'] = prop;
        const pk = data.features.find(f => f.startsWith('停车费'));
        if (pk && !existing.info['停车费']) existing.info['停车费'] = pk.replace('停车费', '');
        existing.features = [...new Set([...(existing.features || []), ...data.features])];
      }
      // 找已存在的同一房源：优先 houseCode，其次 title（旧房源没有 houseCode）
      let dupIdx = -1;
      if (houseCode) dupIdx = existing.houses.findIndex(h => h.houseCode === houseCode);
      if (dupIdx < 0) dupIdx = existing.houses.findIndex(h => h.title && h.title === data.title);
      if (dupIdx >= 0) {
        // 已存在：更新（补充总层高/链接等新字段，保留旧图片）
        const old = existing.houses[dupIdx];
        existing.houses[dupIdx] = {
          ...old,
          ...data,
          // 套内面积：新抓的为空时保留旧值（用户可能手动填过，别覆盖）
          taoneiArea: data.taoneiArea || old.taoneiArea || '',
          localImages: (data.localImages && data.localImages.length) ? data.localImages : (old.localImages || [])
        };
        result.房源.push(`[已更新] ${data.title || '房源'}（补充楼层/链接）`);
      } else {
        existing.houses.push(data);
        result.房源.push(`${data.title || '房源'}（${data.room} ${data.area} ${data.totalPrice}）→ ${comm}`);
      }
      fs.writeFileSync(file, JSON.stringify(existing, null, 2));
    } else if (type === 'ershoufang_list') {
      result.列表.push('二手房列表页（用「抓取当前页房源」按钮抓）');
    }
  }

  console.log('=== 抓取结果 ===');
  for (const k of Object.keys(result)) {
    if (result[k].length) console.log(`\n【${k}】${result[k].length} 个:`);
    result[k].forEach(x => console.log('  -', x));
  }
  console.log('\n存储目录:', DIR);

  // 自动重新生成列表 + 坐标，并自检 APP 地图定位
  try {
    const { execFile } = require('child_process');
    const runScript = (script) => new Promise((resolve, reject) => {
      execFile(process.execPath, [script], { cwd: __dirname }, (err) => err ? reject(err) : resolve());
    });
    await runScript('gen_xiaoqu_list.js');
    await runScript('gen_xiaoqu_coords.js');
    const list = JSON.parse(require('fs').readFileSync(path.join(DIR, 'xiaoqu_list.json'), 'utf8'));
    const noLoc = list.files.filter(x => !x.lon || !x.lat);
    if (noLoc.length) {
      console.log('\n⚠️ 自检：仍有 ' + noLoc.length + ' 个小区无法定位: ' + noLoc.map(x => x.name).join('、'));
    } else {
      console.log('\n✅ 自检：所有小区均可在 APP 地图定位');
    }
  } catch (e) {
    console.log('\n⚠️ 自检失败:', e.message);
  }

  // 写抓取结果到文件，供 serve 返回给前端（stdio inherit 后前端拿不到 stdout）
  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'fetch_result.json'), JSON.stringify(result, null, 2));
  } catch (e) {}

  browser.disconnect();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
