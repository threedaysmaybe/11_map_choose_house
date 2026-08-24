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
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync(process.execPath, ['update_boards.js'], { cwd: ROOT, timeout: 60000, encoding: 'utf8' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, msg: out.trim() }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: (e.stdout || '').toString().trim() || e.message }));
    }
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
    req.on('end', () => {
      try {
        const { id, floors } = JSON.parse(body);
        const fl = parseFloat(floors);
        if (!id || !isFinite(fl) || fl <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, msg: '参数错误' }));
          return;
        }
        // 记录到 manual_heights.json
        const mf = path.join(ROOT, 'data', 'manual_heights.json');
        let manual = {};
        if (fs.existsSync(mf)) manual = JSON.parse(fs.readFileSync(mf, 'utf8'));
        manual[id] = fl;
        fs.writeFileSync(mf, JSON.stringify(manual));
        // 更新 buildings.geojson
        const bf = path.join(ROOT, 'data', 'buildings.geojson');
        const b = JSON.parse(fs.readFileSync(bf, 'utf8'));
        const f = b.features.find(x => String(x.id) === String(id));
        if (!f) { res.end(JSON.stringify({ ok: false, msg: '未找到该楼栋' })); return; }
        f.properties.height = Math.round(fl * 3);
        f.properties.levels = fl;
        f.properties.heightSource = 'manual';
        fs.writeFileSync(bf, JSON.stringify(b));
        // 重新生成瓦片
        const { execFileSync } = require('child_process');
        execFileSync(process.execPath, ['generate_tiles.js'], { cwd: ROOT, timeout: 60000 });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: `已设为 ${fl} 层（${Math.round(fl * 3)} 米）并重新渲染` }));
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
    req.on('end', () => {
      try {
        const { id, name, floors } = JSON.parse(body);
        if (!id) { res.end(JSON.stringify({ ok: false, msg: '缺少 id' })); return; }
        const ff = path.join(ROOT, 'data', 'manual_fixes.json');
        let fixes = {};
        if (fs.existsSync(ff)) fixes = JSON.parse(fs.readFileSync(ff, 'utf8'));
        const entry = fixes[id] || {};
        const bf = path.join(ROOT, 'data', 'buildings.geojson');
        const b = JSON.parse(fs.readFileSync(bf, 'utf8'));
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
        fs.writeFileSync(ff, JSON.stringify(fixes));
        fs.writeFileSync(bf, JSON.stringify(b));
        const { execFileSync } = require('child_process');
        execFileSync(process.execPath, ['generate_tiles.js'], { cwd: ROOT, timeout: 60000 });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg: '已修正 ' + done.join('，') + ' 并重新渲染' }));
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
    const { execFile } = require('child_process');
    execFile(process.execPath, ['fetch_ke_smart.js'], { cwd: ROOT, timeout: 90000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (err) res.end(JSON.stringify({ ok: false, msg: (stdout || '').trim() || err.message }));
      else res.end(JSON.stringify({ ok: true, msg: (stdout || '').trim() }));
    });
    return;
  }

  // 导出 Markdown 报告
  if (req.method === 'POST' && req.url === '/export-md') {
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync(process.execPath, ['export_md.js'], { cwd: ROOT, timeout: 30000, encoding: 'utf8' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, msg: out.trim() }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: (e.stdout || '').toString().trim() || e.message }));
    }
    return;
  }

  // 列出已抓取的小区档案
  if (req.url === '/list-xiaoqu') {
    try {
      const dir = path.join(ROOT, 'data', 'ke_xiaoqu');
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'xiaoqu_list.json') : [];
      // 读取每个小区的 name + board
      const list = files.map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { name: d.name || f.replace(/\.json$/, ''), board: d.board || '' };
        } catch (e) { return { name: f.replace(/\.json$/, ''), board: '' }; }
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

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

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
    if (GZIP_EXT.includes(ext) && data.length > 1024 && (req.headers['accept-encoding'] || '').includes('gzip')) {
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
