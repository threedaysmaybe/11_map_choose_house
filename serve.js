const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

// 注意：.geojson 不压缩，以便前端能读取真实的 content-length 计算下载进度
const GZIP_EXT = ['.json', '.html', '.js', '.css'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pbf': 'application/x-protobuf',
};

const server = http.createServer((req, res) => {
  // 保存区边界（手动重画后）
  if (req.method === 'POST' && req.url === '/save-district') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, coordinates } = JSON.parse(body);
        if (!name || !Array.isArray(coordinates) || coordinates.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '参数错误' }));
          return;
        }
        const file = path.join(ROOT, 'data', 'districts.geojson');
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        d.features = d.features.filter(f => f.properties.name !== name);
        d.features.push({ type: 'Feature', properties: { name }, geometry: { type: 'LineString', coordinates } });
        fs.writeFileSync(file, JSON.stringify(d));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 更新板块数据（从贝壳抓取真实板块边界）
  if (req.method === 'POST' && req.url === '/update-boards') {
    const { execFile } = require('child_process');
    execFile(process.execPath, ['update_boards.js'], { cwd: ROOT, timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (err) res.end(JSON.stringify({ ok: false, msg: (stdout || '').trim() || err.message }));
      else res.end(JSON.stringify({ ok: true, msg: (stdout || '').trim() }));
    });
    return;
  }

  // 一键启动调试 Chrome（用于登录贝壳）
  if (req.method === 'POST' && req.url === '/open-debug-chrome') {
    try {
      const { execFileSync } = require('child_process');
      const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      execFileSync('cmd', ['/c', 'start', '', chrome, '--remote-debugging-port=9222', '--user-data-dir=C:\\beike_profile', 'https://map.ke.com/map/510100/ESF/']);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: e.message }));
    }
    return;
  }

  // 抓取调试 Chrome 当前页的贝壳房源
  if (req.method === 'POST' && req.url === '/fetch-current-page') {
    // 异步执行，避免阻塞 serve
    const { execFile } = require('child_process');
    execFile(process.execPath, ['fetch_current_page.js'], { cwd: ROOT, timeout: 30000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (err) res.end(JSON.stringify({ ok: false, msg: (stdout || '').trim() || err.message }));
      else res.end(JSON.stringify({ ok: true, msg: (stdout || '').trim() }));
    });
    return;
  }

  // 手动设置楼栋层数（用户告知高度，记录并重新渲染）
  if (req.method === 'POST' && req.url === '/set-building-height') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, floors } = JSON.parse(body);
        const fl = parseFloat(floors);
        if (!id || !isFinite(fl) || fl <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, msg: '参数错误' }));
          return;
        }
        const fsx = fs.promises;
        // 记录到 manual_heights.json
        const mf = path.join(ROOT, 'data', 'manual_heights.json');
        let manual = {};
        if (fs.existsSync(mf)) manual = JSON.parse(await fsx.readFile(mf, 'utf8'));
        manual[id] = fl;
        await fsx.writeFile(mf, JSON.stringify(manual));
        // 更新 buildings.geojson（24MB，异步读写避免阻塞 serve 事件循环）
        const bf = path.join(ROOT, 'data', 'buildings.geojson');
        const b = JSON.parse(await fsx.readFile(bf, 'utf8'));
        const f = b.features.find(x => String(x.id) === String(id));
        if (!f) { res.end(JSON.stringify({ ok: false, msg: '未找到该楼栋' })); return; }
        f.properties.height = Math.round(fl * 3);
        f.properties.levels = fl;
        f.properties.heightSource = 'manual';
        await fsx.writeFile(bf, JSON.stringify(b));
        // 先响应，瓦片后台生成（不阻塞前端等待）
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: '已设为 ' + fl + ' 层，正在后台渲染…' }));
        const { execFile } = require('child_process');
        execFile(process.execPath, ['generate_tiles.js'], { cwd: ROOT, timeout: 120000 }, () => {});
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 修正楼栋（名字/层数），记录到 manual_fixes.json 持久保留
  if (req.method === 'POST' && req.url === '/fix-building') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, name, floors } = JSON.parse(body);
        if (!id) { res.end(JSON.stringify({ ok: false, msg: '缺少 id' })); return; }
        const fsx = fs.promises;
        const ff = path.join(ROOT, 'data', 'manual_fixes.json');
        let fixes = {};
        if (fs.existsSync(ff)) fixes = JSON.parse(await fsx.readFile(ff, 'utf8'));
        const entry = fixes[id] || {};
        const bf = path.join(ROOT, 'data', 'buildings.geojson');
        const b = JSON.parse(await fsx.readFile(bf, 'utf8'));
        const f = b.features.find(x => String(x.id) === String(id));
        if (!f) { res.end(JSON.stringify({ ok: false, msg: '未找到该楼栋' })); return; }
        const done = [];
        if (name && typeof name === 'string' && name.trim()) {
          f.properties.name = name.trim();
          entry.name = name.trim();
          done.push(`名字→「${name.trim()}」`);
        }
        const fl = parseFloat(floors);
        if (isFinite(fl) && fl > 0) {
          f.properties.height = Math.round(fl * 3);
          f.properties.levels = fl;
          f.properties.heightSource = 'manual';
          entry.floors = fl;
          done.push(`${fl}层(${Math.round(fl * 3)}米)`);
        }
        if (!done.length) { res.end(JSON.stringify({ ok: false, msg: '未提供 name 或 floors' })); return; }
        fixes[id] = entry;
        await fsx.writeFile(ff, JSON.stringify(fixes));
        await fsx.writeFile(bf, JSON.stringify(b));
        // 先响应，瓦片后台生成（不阻塞前端等待）
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: '已修正 ' + done.join('，') + '，正在后台渲染…' }));
        const { execFile } = require('child_process');
        execFile(process.execPath, ['generate_tiles.js'], { cwd: ROOT, timeout: 120000 }, () => {});
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 智能抓取贝壳（自动识别所有打开的页面，有啥抓啥）
  if (req.method === 'POST' && req.url === '/fetch-ke-smart') {
    // 异步执行，避免阻塞 serve（否则抓取期间其它请求会 fail to fetch）
    // stdio:'inherit'：子进程继承 serve 的 stdio，规避 Windows 下 pipe stdio 触发 libuv process_title 断言崩溃
    const { execFile } = require('child_process');
    execFile(process.execPath, ['fetch_ke_smart.js'], { cwd: ROOT, timeout: 180000, stdio: 'inherit' }, (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (err) { res.end(JSON.stringify({ ok: false, msg: err.message })); return; }
      // 读抓取结果文件，返回详细结果给前端
      try {
        const result = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fetch_result.json'), 'utf8'));
        const parts = [];
        for (const k of ['小区', '房源', '列表', '其他']) {
          if (result[k] && result[k].length) parts.push(`【${k}】${result[k].length}个\n` + result[k].map(x => '· ' + x).join('\n'));
        }
        res.end(JSON.stringify({ ok: true, msg: parts.join('\n') || '抓取完成' }));
      } catch (e) { res.end(JSON.stringify({ ok: true, msg: '抓取完成' })); }
    });
    return;
  }

  // 导出 Markdown 报告
  if (req.method === 'POST' && req.url === '/export-md') {
    const { execFile } = require('child_process');
    execFile(process.execPath, ['export_md.js'], { cwd: ROOT, timeout: 60000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (err) res.end(JSON.stringify({ ok: false, msg: (stdout || '').trim() || err.message }));
      else res.end(JSON.stringify({ ok: true, msg: (stdout || '').trim() }));
    });
    return;
  }

  // 列出已抓取的小区档案
  if (req.url === '/list-xiaoqu') {
    try {
      const dir = path.join(ROOT, 'data', 'ke_xiaoqu');
      // 板块→区映射
      let boardDistrict = {};
      try {
        const boards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'boards.json'), 'utf8'));
        for (const b of boards) boardDistrict[b.name] = b.district || '';
      } catch (e) {}
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'xiaoqu_list.json') : [];
      // 读取每个小区的 name + board + district + 是否安置房
      const list = files.map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          const board = d.board || '';
          const quanshu = (d.info && d.info['交易权属']) || '';
          const anzhi = /拆迁|安置|回迁/.test(quanshu);
          const tagSet = new Set();
          for (const h of (d.houses || [])) for (const t of (h.tags || [])) tagSet.add(t);
          return { name: d.name || f.replace(/\.json$/, ''), board, district: boardDistrict[board] || '', anzhi, tags: [...tagSet] };
        } catch (e) { return { name: f.replace(/\.json$/, ''), board: '', district: '', anzhi: false }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, files: list }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, files: [] }));
    }
    return;
  }

  // 删除小区档案
  if (req.method === 'POST' && req.url === '/delete-xiaoqu') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!name) { res.end(JSON.stringify({ ok: false, msg: '缺少 name' })); return; }
        const dir = path.join(ROOT, 'data', 'ke_xiaoqu');
        const file = path.join(dir, name + '.json');
        if (fs.existsSync(file)) fs.unlinkSync(file);
        // 先响应，图片目录放到响应后用系统命令异步删除（在子进程执行，不会崩 serve 进程）
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: `已删除「${name}」档案` }));
        const imgDir = path.join(dir, 'images', name);
        if (fs.existsSync(imgDir)) {
          try {
            const { execFile } = require('child_process');
            execFile('cmd', ['/c', 'rmdir', '/s', '/q', imgDir], { timeout: 15000 }, () => {});
          } catch (e) { /* 忽略 */ }
        }
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 给小区档案加备注
  if (req.method === 'POST' && req.url === '/add-xiaoqu-note') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, note } = JSON.parse(body);
        if (!name) { res.end(JSON.stringify({ ok: false, msg: '缺少 name' })); return; }
        const file = path.join(ROOT, 'data', 'ke_xiaoqu', name + '.json');
        if (!fs.existsSync(file)) { res.end(JSON.stringify({ ok: false, msg: '未找到该小区档案' })); return; }
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        d.note = note || '';
        fs.writeFileSync(file, JSON.stringify(d, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: note ? '备注已保存' : '备注已清空' }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 删除小区档案里的某一条房源
  if (req.method === 'POST' && req.url === '/delete-house') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, houseCode } = JSON.parse(body);
        if (!name) { res.end(JSON.stringify({ ok: false, msg: '缺少小区名' })); return; }
        const file = path.join(ROOT, 'data', 'ke_xiaoqu', name + '.json');
        if (!fs.existsSync(file)) { res.end(JSON.stringify({ ok: false, msg: '未找到该小区档案' })); return; }
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        const before = (d.houses || []).length;
        d.houses = (d.houses || []).filter(h => String(h.houseCode) !== String(houseCode));
        fs.writeFileSync(file, JSON.stringify(d, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: `已删除房源（${before} → ${d.houses.length}）` }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 调整房源顺序（上移/下移）
  if (req.method === 'POST' && req.url === '/reorder-houses') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, hi, dir } = JSON.parse(body);
        if (!name) { res.end(JSON.stringify({ ok: false, msg: '缺少小区名' })); return; }
        const file = path.join(ROOT, 'data', 'ke_xiaoqu', name + '.json');
        if (!fs.existsSync(file)) { res.end(JSON.stringify({ ok: false, msg: '未找到该小区档案' })); return; }
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        const houses = d.houses || [];
        const i = parseInt(hi, 10);
        const j = dir === 'up' ? i - 1 : i + 1;
        if (i >= 0 && j >= 0 && i < houses.length && j < houses.length) {
          const tmp = houses[i];
          houses[i] = houses[j];
          houses[j] = tmp;
          fs.writeFileSync(file, JSON.stringify(d, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, msg: '已调整顺序' }));
        } else {
          res.end(JSON.stringify({ ok: false, msg: '已到边界，无法移动' }));
        }
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 写小区房源顺序/删除到本地文件（电脑端报告页操作时同步本地，刷新后不丢）
  if (req.method === 'POST' && req.url === '/write-xiaoqu') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, houses } = JSON.parse(body);
        if (!name || !Array.isArray(houses)) { res.end(JSON.stringify({ ok: false, msg: '参数错误' })); return; }
        const file = path.join(ROOT, 'data', 'ke_xiaoqu', name + '.json');
        if (!fs.existsSync(file)) { res.end(JSON.stringify({ ok: false, msg: '未找到该小区档案' })); return; }
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        d.houses = houses;
        fs.writeFileSync(file, JSON.stringify(d, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 设置房源套内面积（用户手动输入，算得房率）
  if (req.method === 'POST' && req.url === '/set-taonei-area') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, houseCode, taoneiArea } = JSON.parse(body);
        if (!name || !houseCode) { res.end(JSON.stringify({ ok: false, msg: '缺少参数' })); return; }
        const file = path.join(ROOT, 'data', 'ke_xiaoqu', name + '.json');
        if (!fs.existsSync(file)) { res.end(JSON.stringify({ ok: false, msg: '未找到小区档案' })); return; }
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        const h = (d.houses || []).find(x => String(x.houseCode) === String(houseCode));
        if (!h) { res.end(JSON.stringify({ ok: false, msg: '未找到房源' })); return; }
        h.taoneiArea = taoneiArea || '';
        fs.writeFileSync(file, JSON.stringify(d, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: '套内面积已保存' }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 给房源加标签
  if (req.method === 'POST' && req.url === '/add-house-tag') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, houseCode, tag } = JSON.parse(body);
        if (!name || !houseCode || !tag) { res.end(JSON.stringify({ ok: false, msg: '缺少参数' })); return; }
        const file = path.join(ROOT, 'data', 'ke_xiaoqu', name + '.json');
        if (!fs.existsSync(file)) { res.end(JSON.stringify({ ok: false, msg: '未找到小区档案' })); return; }
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        const h = (d.houses || []).find(x => String(x.houseCode) === String(houseCode));
        if (!h) { res.end(JSON.stringify({ ok: false, msg: '未找到房源' })); return; }
        h.tags = h.tags || [];
        if (!h.tags.includes(tag)) h.tags.push(tag);
        fs.writeFileSync(file, JSON.stringify(d, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: '已添加标签「' + tag + '」', tags: h.tags }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 移除房源标签
  if (req.method === 'POST' && req.url === '/remove-house-tag') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { name, houseCode, tag } = JSON.parse(body);
        if (!name || !houseCode || !tag) { res.end(JSON.stringify({ ok: false, msg: '缺少参数' })); return; }
        const file = path.join(ROOT, 'data', 'ke_xiaoqu', name + '.json');
        if (!fs.existsSync(file)) { res.end(JSON.stringify({ ok: false, msg: '未找到小区档案' })); return; }
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        const h = (d.houses || []).find(x => String(x.houseCode) === String(houseCode));
        if (!h) { res.end(JSON.stringify({ ok: false, msg: '未找到房源' })); return; }
        h.tags = (h.tags || []).filter(t => t !== tag);
        fs.writeFileSync(file, JSON.stringify(d, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: '已移除标签「' + tag + '」', tags: h.tags }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      }
    });
    return;
  }

  // 列出所有房源标签（去重）
  if (req.url === '/list-tags') {
    try {
      const dir = path.join(ROOT, 'data', 'ke_xiaoqu');
      const tagSet = new Set();
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'xiaoqu_list.json') : [];
      for (const f of files) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          for (const h of (d.houses || [])) {
            for (const t of (h.tags || [])) tagSet.add(t);
          }
        } catch (e) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tags: [...tagSet].sort() }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, tags: [] }));
    }
    return;
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // 内部中间数据（原始抓取数据/转换产物），不对浏览器服务，避免大文件压缩阻塞 serve
  const INTERNAL_DATA = /(_raw\.json$|_extra\.json$|_full\.json$|_count\.json$|names_result\.json$|landuse_residential\.json$|ke_initdata\.json$|\.geojson\.bak$|_page\.txt$)/;
  if (INTERNAL_DATA.test(urlPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // 对文本类资源 gzip 压缩（大幅加快 16MB GeoJSON 加载）
    // 只对 <5MB 的文本资源 gzip；大文件（如 34MB 原始数据）直接返回，避免 gzipSync 同步压缩阻塞事件循环导致 serve 卡死
    if (GZIP_EXT.includes(ext) && data.length > 1024 && data.length < 5 * 1024 * 1024 && (req.headers['accept-encoding'] || '').includes('gzip')) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      res.end(zlib.gzipSync(data));
    } else {
      res.writeHead(200, headers);
      res.end(data);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('成都选房地图已启动');
  console.log('本机访问: http://localhost:' + PORT);
  try {
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log('手机(同一WiFi)访问: http://' + net.address + ':' + PORT);
        }
      }
    }
  } catch (e) {}
});
