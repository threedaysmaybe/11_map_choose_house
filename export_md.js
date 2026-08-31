const fs = require('fs');
const path = require('path');

const DIR = 'data/ke_xiaoqu';
const OUT = path.join(DIR, '报告');

function md(files) {
  fs.mkdirSync(OUT, { recursive: true });
  let exported = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const name = data.name || path.basename(f, '.json');
    const info = data.info || {};
    const lines = [];
    lines.push(`# ${name}`);
    lines.push('');
    lines.push(`> 抓取时间：${(data.updatedAt || '').slice(0, 10)}　|　均价：**${data.price || '?'} 元/㎡**`);
    lines.push('');
    lines.push('## 小区信息');
    lines.push('');
    lines.push('| 字段 | 值 |');
    lines.push('|---|---|');
    const rows = [
      ['建筑类型', info['建筑类型']],
      ['楼栋总数', info['楼栋总数']],
      ['房屋总数', info['房屋总数']],
      ['容积率', info['容积率']],
      ['绿化率', info['绿化率']],
      ['建成年代', info['建成年代']],
      ['交易权属', info['交易权属']],
      ['物业费', info['物业费']],
      ['开发商', info['开发商']],
    ];
    rows.forEach(([k, v]) => { if (v) lines.push(`| ${k} | ${v} |`); });
    lines.push('');

    // 地铁
    if (data.metro && data.metro.length) {
      lines.push('## 附近地铁');
      lines.push('');
      const sorted = data.metro.slice().sort((a, b) => parseInt(a.distance) - parseInt(b.distance));
      lines.push(`最近：**${sorted[0].name} ${sorted[0].distance}**（${sorted[0].lines}）`);
      lines.push('');
      lines.push('| 地铁站 | 距离 | 线路 |');
      lines.push('|---|---|---|');
      sorted.forEach(m => lines.push(`| ${m.name} | ${m.distance} | ${m.lines} |`));
      lines.push('');
    }

    // 成交记录
    if (data.deals && data.deals.length) {
      lines.push('## 最近成交');
      lines.push('');
      lines.push('| 面积 | 签约日期 | 成交价 | 成交单价 |');
      lines.push('|---|---|---|---|');
      data.deals.forEach(d => lines.push(`| ${d.面积} | ${d.签约日期} | ${d.成交价} | ${d.成交单价} |`));
      lines.push('');
    }

    // 房源
    if (data.houses && data.houses.length) {
      lines.push('## 在售房源');
      lines.push('');
      lines.push('| 户型 | 面积 | 总价 | 单价 | 朝向 | 楼层 |');
      lines.push('|---|---|---|---|---|---|');
      data.houses.forEach(h => lines.push(`| ${h.room || '?'} | ${h.area || '?'}㎡ | ${h.totalPrice || '?'}万 | ${h.unitPrice || '?'}元/平 | ${h.orientation || '?'} | ${h.floor || '?'}楼层 |`));
      lines.push('');
    }

    // 图片
    const imgs = data.localImages || [];
    if (imgs.length) {
      lines.push('## 图片');
      lines.push('');
      imgs.forEach(img => lines.push(`![${img}](images/${name}/${img})`));
      lines.push('');
    }

    const file = path.join(OUT, name + '.md');
    fs.writeFileSync(file, lines.join('\n'));
    exported.push(name);
  }
  return exported;
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => path.join(DIR, f));
const exported = md(files);
console.log(`已导出 ${exported.length} 份报告：${exported.join('、')} → ${OUT}`);
