const { execSync } = require('child_process');

function isFetchRunning() {
  try {
    const out = execSync(
      'powershell -Command "Get-CimInstance Win32_Process -Filter \\"name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*fetch_names*\' }"',
      { encoding: 'utf8', timeout: 15000 }
    );
    return out.includes('fetch_names');
  } catch (e) {
    return false;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('[自动流程] 等待抓名字进程结束...');
  let waited = 0;
  while (isFetchRunning()) {
    await sleep(60000); // 每分钟检测一次
    waited += 60;
    if (waited % 600 === 0) console.log(`[自动流程] 已等待 ${Math.round(waited / 60)} 分钟...`);
  }
  console.log('[自动流程] 抓名字完成，开始合并名字...');
  execSync('node merge_names.js', { stdio: 'inherit' });

  console.log('[自动流程] 合并完成，重新生成瓦片（含新名字）...');
  execSync('node generate_tiles.js', { stdio: 'inherit' });

  console.log('[自动流程] 全部完成，60 秒后关机（如需取消请运行 shutdown /a）');
  execSync('shutdown /s /t 60');
})().catch(e => { console.error('[自动流程] 失败:', e.message); process.exit(1); });
