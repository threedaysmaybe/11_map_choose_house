// 生成静态小区列表 data/xiaoqu_list.json（供 GitHub Pages 等静态部署使用，不依赖 serve.js）
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'data', 'ke_xiaoqu');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'xiaoqu_list.json') : [];
const list = files.map(f => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { name: d.name || f.replace(/\.json$/, ''), board: d.board || '' };
  } catch (e) {
    return { name: f.replace(/\.json$/, ''), board: '' };
  }
}).filter(x => x.name);

list.sort((a, b) => (a.board || '').localeCompare(b.board || '') || (a.name || '').localeCompare(b.name || ''));

const out = path.join(dir, 'xiaoqu_list.json');
fs.writeFileSync(out, JSON.stringify({ ok: true, files: list }, null, 2));
console.log('已生成', out, '（' + list.length + ' 个小区）');
