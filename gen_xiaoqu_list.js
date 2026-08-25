// 生成静态小区列表 data/xiaoqu_list.json（供 GitHub Pages 等静态部署使用，不依赖 serve.js）
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'data', 'ke_xiaoqu');
// 读取板块→区映射
let boardDistrict = {};
try {
  const boards = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'boards.json'), 'utf8'));
  for (const b of boards) boardDistrict[b.name] = b.district || '';
} catch (e) {}
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'xiaoqu_list.json') : [];
const list = files.map(f => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const board = d.board || '';
    const quanshu = (d.info && d.info['交易权属']) || '';
    const anzhi = /拆迁|安置|回迁/.test(quanshu);
    return { name: d.name || f.replace(/\.json$/, ''), board, district: boardDistrict[board] || '', anzhi };
  } catch (e) {
    return { name: f.replace(/\.json$/, ''), board: '', district: '', anzhi: false };
  }
}).filter(x => x.name);

// 先按区，再按板块，再按名字
list.sort((a, b) => (a.district || '').localeCompare(b.district || '') || (a.board || '').localeCompare(b.board || '') || (a.name || '').localeCompare(b.name || ''));

const out = path.join(dir, 'xiaoqu_list.json');
fs.writeFileSync(out, JSON.stringify({ ok: true, files: list }, null, 2));
console.log('已生成', out, '（' + list.length + ' 个小区）');
