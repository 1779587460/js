/*!
 * fnOS Live2D 壁纸 —— 普通引入版 v1.26.0
 *
 * 用法：不用油猴，直接在网页里引这个文件（放在 <head> 或 <body> 末尾都行）：
 *     <script src="/static/fnos-live2d.js"></script>
 * 想只对某个地址生效，把上面那行用 if 包一下，或在服务端按域名输出。
 *
 * 与 fnos-live2d.user.js 的差别：只少了油猴元数据块 + 多一个重复引入的幂等守卫，
 * 功能完全一致（素材取自 l2d.su，纯浏览器端注入，不改 NAS 上任何文件）。
 *
 * 注意：脚本会联网取 l2d.su / static.l2d.su / jsdelivr 上的依赖与模型；
 *       如果页面开了 CSP，需要放行这些域（飞牛 fnOS 默认没有 CSP）。
 */
//
// 说明：这里刻意不使用 @require 预加载依赖。
// Tampermonkey 在 @require 下载失败时会直接跳过整个脚本（连第一行都不执行），
// 表现就是「控制台一条日志都没有」，非常难排查。
// 改由脚本内部按 CDN 列表逐个回退注入，失败时也能给出明确提示。

/*
 * 说明
 * ------------------------------------------------------------------
 * 1) 素材来源：l2d.su（碧蓝航线 Live2D 查看器）
 *    模型文件托管在 https://static.l2d.su/azurlane/live2d/<名字>/<名字>.model3.json
 *    该站点返回 Access-Control-Allow-Origin: * ，所以可以直接跨域加载，无需任何 cookie。
 * 2) 本脚本只做「浏览器端注入」，不改动 NAS 上的任何文件，卸载脚本即完全还原。
 * 3) 想换模型：面板里粘贴 l2d.su 的皮肤链接（如 https://l2d.su/cn/skins/307074/）
 *    或直接填皮肤 ID / 模型名即可，脚本会自动解析出模型地址。
 */

(function () {
  'use strict';

  // 幂等守卫（普通引入版）：网页里被重复 <script> 引入时，只初始化一次。
  // 油猴版不需要它 —— 油猴自己对同一个脚本只会注入一份。
  if (window.__fnosL2DPlainLoaded) return;
  window.__fnosL2DPlainLoaded = true;

  const VERSION = '1.26.0';

  /* ------------------------------------------------------------ *
   * 0. 探针：只要控制台出现下面这一行，就证明脚本确实被注入了。
   *    如果连这一行都没有 —— 问题在「注入」，不在「渲染」，
   *    请查 @match/@include 是否覆盖当前地址、以及脚本是否已启用。
   * ------------------------------------------------------------ */
  const LOGS = [];
  function rawLog(kind, args) {
    try { LOGS.push(kind + ': ' + args.map((v) => String(v)).join(' ')); } catch (e) {}
  }
  try {
    console.log(
      '%c[Live2D]%c 脚本已注入 v' + VERSION,
      'color:#7c5cff;font-weight:bold',
      'color:inherit',
      '\n  URL        = ' + location.href +
      '\n  readyState = ' + document.readyState +
      '\n  提示：调 window.fnosLive2D.logs 可看全部记录'
    );
  } catch (e) {}

  if (window.__FNOS_LIVE2D_LOADED__) {
    rawLog('warn', ['脚本已存在，跳过重复注入']);
    try { console.warn('[Live2D] 脚本已存在，跳过重复注入（若刚更新过脚本，请刷新页面）'); } catch (e) {}
    return;
  }
  window.__FNOS_LIVE2D_LOADED__ = true;

  // 早期就挂上调试入口，即使后面加载失败也拿得到信息
  window.fnosLive2D = { version: VERSION, logs: LOGS, ready: false };
  // Engine / Store 稍后（对象定义之后）挂上来，供控制台排查：
  //   fnosLive2D.engine  → 引擎实例（.official.viewer 是官方 viewer）
  //   fnosLive2D.store   → 配置
  window.fnosLive2D.__pending = [];

  /* ============================================================ *
   * 0. 常量与默认配置
   * ============================================================ */

  const LS_KEY = 'fnos-live2d:config:v1';
  const STATIC_BASE = 'https://static.l2d.su/azurlane';
  const L2D_BASE = STATIC_BASE + '/live2d';

  // 各依赖的备用 CDN（按顺序尝试）
  const CDN = {
    pixi: [
      'https://fastly.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js',
      'https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js',
      'https://unpkg.com/pixi.js@7.4.3/dist/pixi.min.js',
      'https://cdn.bootcdn.net/ajax/libs/pixi.js/7.4.3/pixi.min.js',
    ],
    live2d: [
      // ⚠️ 必须用 mulmotion 分支：它带了 Cubism5 的 getDrawableInvertedMaskBit /
      //    mocVersion 支持（官方 0.4.0 遇到 moc3 v5（Live2D+）模型会整块丢渲染）
      'https://fastly.jsdelivr.net/npm/pixi-live2d-display-mulmotion@0.5.0-mm-6/dist/cubism4.min.js',
      'https://cdn.jsdelivr.net/npm/pixi-live2d-display-mulmotion@0.5.0-mm-6/dist/cubism4.min.js',
      'https://unpkg.com/pixi-live2d-display-mulmotion@0.5.0-mm-6/dist/cubism4.min.js',
    ],
    core: [
      'https://l2d.su/lib/live2dcubismcore.min.js?v=5.1.0',
      'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
      'https://fastly.jsdelivr.net/npm/live2dcubismcore@1.0.2/live2dcubismcore.min.js',
    ],
  };

  const DEFAULT_CFG = {
    modelUrl: L2D_BASE + '/dafeng_3/dafeng_3.model3.json',
    modelLabel: '大凤「放学后的甜蜜时光」',
    zoom: 1,
    resMul: 1.5,       // 渲染倍率（叠加在设备 DPR 之上）。官方默认就是 1.5，调大更清晰、调小更省电。
    // v1.22：内置引擎（legacy）已移除，全部走 l2d.su 官方运行时。
    //   渲染 / 命中 / 动作 / 触摸规则 / 音效回调全部官方语义。
    posX: 72,      // 模型底部中心的水平位置（容器百分比）
    posY: 100,     // 模型底部的垂直位置（容器百分比）
    opacity: 0.95,
    mirror: false,
    follow: true,      // 视线跟随鼠标（自研驱动 focusController，幅度明显）
    fastLoad: true,    // 快速加载：启动即并行预热官方运行时（省掉与依赖库串行等待的那几秒）
    entryLogin: true,  // 载入模型时播 login 动作（像 l2d.su 那样"进门就有登录演出"）；关掉则播待机
    breath: true,      // 呼吸（官方 setLive2DBreathing）
    blink: true,       // 眨眼（官方 setLive2DEyeBlinking）
    gestures: true,    // 拖动移动模型 + 滚轮缩放（合并成一个开关）
    zones: true,       // 分区互动：拖拽模型部件驱动参数（来自 l2d.su 的 live2dTouch 规则）
    zoneShow: false,   // 显示触摸区域：把模型里隐藏的触摸部件画出来
    sound: false,      // 声音总开关（台词语音 + 模型自带的动作音效）
    voiceMotion: true, // 播语音时联动播放对应动作
    bar: true,         // 悬浮操作栏
    skinId: 307074,    // l2d.su 皮肤 ID（用来定位台词库；默认模型大凤「放学后的甜蜜时光」）
    // v1.9.0：「可交互范围」「交互层」两个设置已移除。
    //   交互改成「只认触摸区」（window 捕获阶段探针），命中才拦截、否则放行，
    //   因此与桌面图标 / Dock 天然共存，也不存在「命中层挂哪儿」的问题。
    //   旧配置里残留的 interact / interactLayer 字段会被读进来但不再使用。
    loginPage: false,  // 登录页是否也接管壁纸（默认关：登录页要能正常登录）
    idle: false,       // 空闲时自动播放随机待机动作（默认关：会把触摸保持的状态顶掉，l2d.su 也没有）
    fabHidden: false,
    fabAutoFade: true,
    fabRight: 18,
    fabBottom: 18,
    panelOpen: false,
  };

  // 动作组的中文名（碧蓝航线模型的常见分组）
  const MOTION_LABEL = {
    idle: '待机', home: '主界面', login: '登录', mail: '邮件',
    mission: '任务', mission_complete: '任务完成', complete: '完成',
    main_1: '主界面 1', main_2: '主界面 2', main_3: '主界面 3',
    touch_head: '摸头', touch_body: '摸身体', touch_special: '特殊触摸',
    wedding: '誓约', start: '开始', effect: '特效',
  };

  /* ============================================================ *
   * 1. 工具函数
   * ============================================================ */

  function el(tag, cls, css) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (css) n.style.cssText = css;
    return n;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function log(...a) {
    rawLog('log', a);
    try { console.log('%c[Live2D]', 'color:#7c5cff;font-weight:bold', ...a); } catch (e) {}
  }

  function errlog(...a) {
    rawLog('error', a);
    try { console.error('[Live2D]', ...a); } catch (e) {}
  }

  /** 屏幕左下角的状态提示：不打开 DevTools 也能看到脚本活没活、卡在哪一步 */
  function bootHint(text, isError) {
    try {
      // 模型已经成功载入过（提示已收掉）→ 普通提示不再弹出来 ——
      // 否则后续任何一次 bootHint 调用都会把左下角那条重新显示（v1.23 修正）
      if (window.__fnosBootHintDone && !isError) return null;
      let n = document.getElementById('fnos-l2d-boothint');
      if (!n) {
        n = document.createElement('div');
        n.id = 'fnos-l2d-boothint';
        n.style.cssText =
          'position:fixed;left:14px;bottom:14px;z-index:2147483000;' +
          'padding:7px 13px;border-radius:9px;max-width:70vw;white-space:pre-wrap;' +
          'font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
          'background:rgba(18,20,26,.92);color:#dfe4f0;border:1px solid rgba(255,255,255,.14);' +
          'box-shadow:0 6px 22px rgba(0,0,0,.4);pointer-events:none;transition:opacity .4s;';
        (document.body || document.documentElement).appendChild(n);
      }
      n.textContent = text;
      n.style.opacity = '1';
      n.style.color = isError ? '#ffb0b0' : '#dfe4f0';
      n.style.borderColor = isError ? 'rgba(255,120,120,.55)' : 'rgba(255,255,255,.14)';
      n.__isError = !!isError;
      return n;
    } catch (e) { return null; }
  }

  /** 成功后淡出（错误提示则常驻，方便截图反馈） */
  function bootHintFade() {
    window.__fnosBootHintDone = true;   // 标记：此后普通提示不再显示
    const n = document.getElementById('fnos-l2d-boothint');
    if (!n || n.__isError) return;
    n.style.opacity = '0';
    setTimeout(() => { if (n && n.parentNode) n.parentNode.removeChild(n); }, 600);
  }

  /* ------------------------------------------------------------ *
   * 加载耗时打点（v1.26）
   * 只做记录、最后汇总成一条日志 —— 不然"为什么这么慢"永远只能靠猜。
   * 分四段：依赖库 → 官方运行时(chunk) → 渲染器 → 模型资源。
   * ------------------------------------------------------------ */
  const PERF = { t0: 0, marks: {} };
  function perfStart() { PERF.t0 = performance.now(); PERF.marks = {}; return PERF.t0; }
  function perfMark(name) { if (PERF.t0) { PERF.marks[name] = performance.now() - PERF.t0; } }
  function perfReport() {
    if (!PERF.t0) return;
    const m = PERF.marks, f = (x) => (x == null ? '—' : (x / 1000).toFixed(2) + 's');
    log('加载耗时（距脚本启动）：依赖库 ' + f(m.libs) + ' ｜ 官方运行时 ' + f(m.su) +
        ' ｜ 渲染器 ' + f(m.viewer) + ' ｜ 模型资源 ' + f(m.model) +
        ' ｜ 全部就绪 ' + f(m.ready));
  }

  /* ------------------------------------------------------------ *
   * 网络资源缓存（v1.22）
   *
   * 官方运行时是 6 个 chunk（约 2.5MB）+ 游戏数据 JSON，每次刷新页面都要重下 ——
   * 网络差时首次能等 100s 以上（实测基线版同样慢，不是脚本的锅，但体验很差）。
   * 这里用 IndexedDB 做一层文本缓存（CacheStorage 在 http 局域网上不是 secure
   * context，用不了；localStorage 只有 5MB，装不下）。缓存键带版本号，
   * 脚本升级即自动失效，不会用到旧代码。
   * ============================================================ */
  const CACHE_DB = 'fnos-l2d-cache', CACHE_STORE = 'res';
  // v1.26：连接复用。原来每次 cacheGet/cachePut 都 indexedDB.open() 再 close() ——
  // 一次加载要读 12 个文本 + 5 个模型资源，等于开关 17 次数据库连接，
  // 每次都带一次事务建立开销。现在只开一次、一直留着（浏览器会在标签页关闭时回收）。
  let idbConn = null;
  function idbOpen() {
    if (idbConn) return Promise.resolve(idbConn);
    return new Promise((resolve, reject) => {
      try {
        const r = indexedDB.open(CACHE_DB, 1);
        r.onupgradeneeded = () => { try { r.result.createObjectStore(CACHE_STORE); } catch (e) {} };
        r.onsuccess = () => { idbConn = r.result; resolve(r.result); };
        r.onerror = () => reject(r.error);
      } catch (e) { reject(e); }
    });
  }
  function idbOp(mode, fn) {
    return idbOpen().then((db) => new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(CACHE_STORE, mode);
        const st = tx.objectStore(CACHE_STORE);
        const req = fn(st);
        tx.oncomplete = () => resolve(req && req.result);      // 连接留着复用，不 close（v1.26）
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    }));
  }
  const cacheGet = (key) => idbOp('readonly', (st) => st.get(key));
  /** 清掉旧版本留下来的缓存键（v1.26 起键格式变了，不清就是一堆永不命中的垃圾） */
  async function pruneOldCache() {
    try {
      const rows = await cacheList();
      const stale = (rows || []).filter((r) => /^v[0-9.]+|/.test(String(r.key)));
      for (const r of stale) { try { await idbOp('readwrite', (st) => st.delete(r.key)); } catch (e) {} }
      if (stale.length) log('已清理旧格式缓存 ' + stale.length + ' 条');
    } catch (e) {}
  }
  const cachePut = (key, val) => idbOp('readwrite', (st) => st.put(val, key));

  /**
   * 缓存条目数上限：超过就按写入时间淘汰最旧的一批（v1.23）。
   * 模型资源单套约 4MB，几十套就是几百 MB —— 给个上限更安全。
   */
  const CACHE_MAX_ENTRIES = 80;
  let trimming = false;
  /** 列出缓存里所有条目的 key 与写入时间 */
  function cacheList() {
    return idbOpen().then((db) => new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const st = tx.objectStore(CACHE_STORE);
        const out = [];
        const req = st.openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (c) { out.push({ key: c.key, at: (c.value && c.value.at) || 0 }); c.continue(); }
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    }));
  }
  async function trimCache() {
    if (trimming) return;
    trimming = true;
    try {
      const rows = await cacheList();
      if (rows && rows.length > CACHE_MAX_ENTRIES) {
        rows.sort((a, b) => a.at - b.at);
        const drop = rows.slice(0, rows.length - CACHE_MAX_ENTRIES);
        for (const r of drop) { try { await idbOp('readwrite', (st) => st.delete(r.key)); } catch (e) {} }
        log('缓存清理：淘汰 ' + drop.length + ' 条最旧资源（上限 ' + CACHE_MAX_ENTRIES + '）');
      }
    } catch (e) { /* 清理失败不影响使用 */ }
    trimming = false;
  }

  /** 带缓存的文本拉取；缓存不可用时静默退化为直连 */
  async function fetchTextCached(url) {
    // v1.26：缓存键**不再带脚本版本号** —— chunk / 游戏数据的内容由 l2d.su 决定，
    //   跟我们的脚本版本没关系。以前带上版本号，结果每次更新脚本（哪怕只改一行注释）
    //   都会让 2.5MB 的 chunk 缓存全部失效、重新下载，用户体感就是每次更新完都特别慢。
    //   chunk 文件名本身带内容哈希（index-LGceUR3e.js），所以按 URL 缓存是安全的。
    const key = 'res|' + url;
    try {
      const hit = await cacheGet(key);
      if (typeof hit === 'string' && hit.length) { log('缓存命中：' + url.replace('https://', '')); return hit; }
    } catch (e) { /* 缓存不可用，直连 */ }
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
    const t = await r.text();
    try { await cachePut(key, t); } catch (e) { /* 忽略写入失败 */ }
    return t;
  }

  /* ------------------------------------------------------------ *
   * 模型资源缓存（v1.23）
   *
   * 上面 fetchTextCached 只覆盖了我们自己拉的 chunk / 游戏数据；
   * 真正的大头（moc3 + 3 张 webp + physics，狮这套约 4MB）是官方 viewer 通过
   * fetch 自己拉的 —— 每次刷新都要重下，网络差时要等一两分钟。
   * 这里包一层 window.fetch：命中 static.l2d.su 的模型资源就走 IndexedDB 里的
   * blob，返回一个等价 Response。官方完全无感（同源策略不受影响，因为我们在
   * 页面上下文里替换的是页面自己的 fetch）。
   *
   * 注意：带 Range 的请求（读 moc3 头部之类）一律不走缓存 —— 我们存的是全量
   * blob，回 200 而不是 206 会让调用方算错。
   * ------------------------------------------------------------ */
  const MODEL_ASSET_RE = /^https:\/\/static\.l2d\.su\/azurlane\//i;
  function installModelAssetCache() {
    if (window.__fnosAssetCache) return;
    window.__fnosAssetCache = true;
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!origFetch) return;
    window.fetch = function (input, init) {
      let url = '', hasRange = false;
      try {
        url = (typeof input === 'string') ? input : ((input && input.url) || '');
        const h = (init && init.headers) || (input && input.headers);
        if (h) {
          if (typeof h.get === 'function') hasRange = !!h.get('range');
          else if (Array.isArray(h)) hasRange = h.some((x) => String(x[0]).toLowerCase() === 'range');
          else hasRange = Object.keys(h).some((k) => k.toLowerCase() === 'range');
        }
        if (init && init.method && String(init.method).toUpperCase() !== 'GET') hasRange = true;
      } catch (e) { hasRange = true; }
      if (hasRange || !MODEL_ASSET_RE.test(url)) return origFetch(input, init);

      // 模型资源是静态 CDN 内容，**键不带脚本版本号** —— 脚本升级后模型缓存依然有效
      // （这就是「让缓存久一点」：chunk 会随版本失效，4MB 的模型不用重下）
      const key = 'model|' + url;
      return cacheGet(key).then((hit) => {
        if (hit && hit.blob) {
          log('模型缓存命中：' + url.split('/').pop());
          return new Response(hit.blob, {
            status: 200, statusText: 'OK',
            headers: { 'Content-Type': hit.type || 'application/octet-stream' },
          });
        }
        return origFetch(input, init).then((res) => {
          try {
            if (res && res.ok) {
              const cl = res.clone();
              cl.blob().then((blob) => {
                if (!blob || !blob.size || blob.size > 12 * 1024 * 1024) return;   // 太大就不缓存
                return cachePut(key, { blob: blob, type: blob.type || '', at: Date.now() })
                  .then(() => trimCache());
              }).catch(() => {});
            }
          } catch (e) {}
          return res;
        });
      }).catch(() => origFetch(input, init));
    };
    log('已开启模型资源缓存（moc3 / 纹理 / 物理，走 IndexedDB）');
  }

  /**
   * 确保 Cubism Core 已加载（v1.26）。
   * 「依赖库」与「官方运行时」两条线现在并行跑，两边都会需要 core；
   * 没有这个去重就会各注入一份 <script>，白下载一遍。
   */
  let coreInjecting = null;
  function ensureCore() {
    if (window.Live2DCubismCore) return Promise.resolve();
    if (!coreInjecting) {
      coreInjecting = injectScript(CDN.core).catch((e) => { coreInjecting = null; throw e; });
    }
    return coreInjecting;
  }

  /** 依次尝试多个 URL 注入 <script>，任一成功即 resolve */
  function injectScript(urls, timeoutMs) {
    const LIMIT = timeoutMs || 12000;
    return new Promise((resolve, reject) => {
      let i = 0;
      const next = () => {
        if (i >= urls.length) return reject(new Error('所有 CDN 均不可用（共尝试 ' + urls.length + ' 个）'));
        const url = urls[i++];
        const s = document.createElement('script');
        let done = false;
        // 关键：某些网络环境会「静默挂起」请求，既不 load 也不 error。
        // 没有超时的话 Promise 永远不 settle，表现就是控制台再无下文。
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          try { s.remove(); } catch (e) {}
          log('超时（' + LIMIT + 'ms），换下一个源：', url);
          next();
        }, LIMIT);
        s.src = url;
        s.async = false;
        s.onload = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(url);
        };
        s.onerror = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { s.remove(); } catch (e) {}
          log('加载失败，换下一个源：', url);
          next();
        };
        (document.head || document.documentElement).appendChild(s);
      };
      next();
    });
  }

  /**
   * 确保 Cubism Core / PIXI / pixi-live2d-display 都就绪。
   * 注意：pixi-live2d-display 会在「首次载入模型」时才检查 window.Live2DCubismCore，
   * 所以 Core 只要在 Live2DModel.from() 之前到位即可。
   */
  async function ensureLibs() {
    if (!window.Live2DCubismCore) {
      log('① 加载 Live2D Cubism Core…');
      await ensureCore();
    }
    if (!window.Live2DCubismCore) throw new Error('Live2D Cubism Core 加载失败——可能是网络无法访问 CDN');
    log('① Cubism Core 就绪');

    if (!window.PIXI) {
      log('② 加载 PIXI…');
      await injectScript(CDN.pixi);
    }
    if (!window.PIXI) throw new Error('PIXI 加载失败——可能是网络无法访问 CDN');
    log('② PIXI 就绪 v' + (window.PIXI.VERSION || '?'));

    if (!window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
      log('③ 加载 Live2D 渲染库（mulmotion / Cubism5）…');
      await injectScript(CDN.live2d);
    }
    if (!window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
      throw new Error('Live2D 渲染库加载失败——可能是网络无法访问 CDN');
    }
    log('③ pixi-live2d-display 就绪');
  }

  /* ============================================================ *
   * 2. 配置存储
   * ============================================================ */

  const Store = {
    cfg: Object.assign({}, DEFAULT_CFG),
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) Object.assign(this.cfg, JSON.parse(raw));
        // 旧配置迁移：drag / wheelZoom 现在合并成 gestures；voice 合并进 sound
        if (this.cfg.gestures === undefined) {
          this.cfg.gestures = !(this.cfg.drag === false && this.cfg.wheelZoom === false);
        }
        if (this.cfg.voice === true) this.cfg.sound = true;
        if (this.cfg.zoneShow === undefined) this.cfg.zoneShow = false;
        // v1.14：单次动作改为「定格末帧」后，随机的空闲待机会把保持住的状态（如拿出手机）
        // 顶掉 —— 和 l2d.su 一样默认关掉，做一次性迁移
        if (this.cfg.cfgV !== 2) { this.cfg.idle = false; this.cfg.cfgV = 2; }
        // 坐标语义迁移（v1.20 起只有官方运行时）：官方坐标系是
        // 「canvas 居中 + 模型自身变换」，与旧的「底部锚点 + 容器百分比」不同。
        // 首次迁移时归位到「居中 1×」，避免沿用旧坐标把模型顶出屏幕。
        if (this.cfg.engineV !== 2) {
          this.cfg.posX = 50; this.cfg.posY = 50; this.cfg.zoom = 1;
          this.cfg.engineV = 2;
        }
        // v1.22：engine 字段已废弃（不再有引擎切换），从旧配置里清掉
        if (this.cfg.engine !== undefined) delete this.cfg.engine;
        // v1.24：模型投影已移除；呼吸 / 眨眼改为可开关（默认开，与官方一致）
        if (this.cfg.shadow !== undefined) delete this.cfg.shadow;
        if (this.cfg.breath === undefined) this.cfg.breath = true;
        if (this.cfg.entryLogin === undefined) this.cfg.entryLogin = true;
        if (this.cfg.fastLoad === undefined) this.cfg.fastLoad = true;
        // v1.24：「渲染」滑杆以前没接线，值多为默认 1；现在它真的控制渲染分辨率了，
        // 把这类默认值迁到官方基线 1.5，免得升级后画面反而变糊（用户手动调过的值不动）。
        if (this.cfg.cfgV !== 3) {
          if (this.cfg.resMul === 1 || this.cfg.resMul === undefined) this.cfg.resMul = 1.5;
          this.cfg.cfgV = 3;
        }
        if (this.cfg.blink === undefined) this.cfg.blink = true;
      } catch (e) { /* ignore */ }
      return this.cfg;
    },
    save() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.cfg)); } catch (e) { /* ignore */ }
    },
    reset() {
      Object.assign(this.cfg, DEFAULT_CFG);
      this.save();
    },
  };

  /* ============================================================ *
   * 3. 模型地址解析器
   *    l2d.su 皮肤页会服务端渲染一段 SEO HTML，其中包含
   *    static.l2d.su//azurlane/squareicon/<名字>.webp
   *    而模型文件名与这个 <名字> 完全一致 —— 这就是映射规则。
   * ============================================================ */

  const Resolver = {
    async fromSkinId(id) {
      const res = await fetch('https://l2d.su/cn/skins/' + id + '/', { credentials: 'omit' });
      if (!res.ok) throw new Error('皮肤页请求失败 HTTP ' + res.status);
      const html = await res.text();

      const iconMatch = html.match(/squareicon\/([A-Za-z0-9_\-\.]+)\.webp/i);
      if (!iconMatch) throw new Error('皮肤 ' + id + ' 没有 Live2D 模型（可能是静态立绘）');

      const name = iconMatch[1];
      const title = (html.match(/<h1[^>]*>([^<]{1,40})<\/h1>/) || [])[1] || '';
      const ship = (html.match(/<h2[^>]*>([^<]{1,30})<\/h2>/) || [])[1] || '';
      const label = (ship ? ship + ' ' : '') + (title ? '「' + title + '」' : name);

      return { url: L2D_BASE + '/' + name + '/' + name + '.model3.json', label: label.trim(), name: name };
    },

    async resolve(input) {
      const s = String(input || '').trim();
      if (!s) throw new Error('请输入 l2d.su 皮肤链接、皮肤 ID 或模型名');

      // a) 直接的 model3.json 地址
      if (/^https?:\/\/.+\.model3\.json(\?.*)?$/i.test(s)) {
        const m = s.match(/([^\/]+)\.model3\.json/i);
        return { url: s, label: m ? m[1] : s };
      }
      // b) l2d.su 皮肤页链接
      const link = s.match(/l2d\.su\/(?:[a-z]{2}\/)?skins\/(\d+)/i);
      if (link) return Resolver.fromSkinId(link[1]);
      // c) 纯数字皮肤 ID
      if (/^\d{4,}$/.test(s)) return Resolver.fromSkinId(s);
      // d) 裸模型名
      if (/^[A-Za-z0-9_\-.]+$/.test(s)) {
        return { url: L2D_BASE + '/' + s + '/' + s + '.model3.json', label: s, name: s };
      }
      throw new Error('无法识别的输入：' + s);
    },
  };

  /* ============================================================ *
   * 4. Live2D 引擎
   * ============================================================ */

  /* ============================================================ *
   * 官方运行时加载器（v1.19）
   *   直接把 l2d.su 自己的 chunk 搬过来用：PIXI + 模型加载器 + WikiModelViewer（完整交互层）。
   *   · chunk 带 CORS *，可跨域 fetch；
   *   · index 里含 React 启动（import 会渲染整站 UI）→ 去掉；
   *   · 静态 import 按拓扑序改写为 blob URL；动态 import 走 window.__FNOS_MODS 查表；
   *   · 两个补丁：import.meta.resolve（Vite 预加载辅助）换恒等函数；
   *     预加载把 /assets/… 挂到当前站点会 404 硬报错 → 指回官方域名。
   * ============================================================ */
  const SU_CHUNKS = [
    'index-LGceUR3e.js', 'lib-BYypsEmk.js', 'resourceProgress-CyQ66jqg.js',
    'live2dRuntime-CzMa3YhQ.js', 'spineRuntime-CwB63JJC.js', 'modelRuntime-BDk3g7Pb.js',
  ];
  const SuStack = {
    ready: false, promise: null, mods: null,
    async load() {
      if (this.ready) return this.mods;
      if (this.promise) return this.promise;
      const self = this;
      this.promise = (async () => {
        window.__FNOS_MODS = window.__FNOS_MODS || {};
        // ── 三个资源域，别再混为一谈（v1.21 修正）──────────────────────────
        //  · chunk / css  →  https://l2d.su/assets/…        （index-CP7FX-Bo.css 也在这）
        //  · 模型 JSON/纹理 →  https://static.l2d.su/azurlane/live2d/…
        //  官方 index.js 里两处关键定义（已反混淆核对）：
        //    Ht = window.__STATIC_ASSET_ORIGIN__.replace(/\/+$/,'')   // 缺了就直接 throw
        //    Ut = Ht;  Wt = Ut + '/azurlane'                         // Wt 只给模型用
        //    Kt = function(x){ return '/' + x }                        // 只加前导斜杠！
        //    _0x4dbd3b(x) = import.meta.resolve ? resolve(x)
        //                                       : new URL(x, import.meta.url).href
        //  Vite 预加载链路：dep('assets/x.css') → Kt → '/assets/x.css' → _0x4dbd3b
        //  站点上 import.meta.url = https://l2d.su/assets/index-*.js，于是解析正确。
        //  我们把 chunk 换成 blob: URL 后 import.meta.url 变成 blob:http://本机/…，
        //  必须由 __SU_RESOLVE 把 /assets/… 兜回官方域，否则 CSS 404 →
        //  "Unable to preload CSS" → 整个模型载入 reject（v1.20 的坑）。
        //  ⚠️ 曾经的错误做法：patch Kt 去拼 __SU_ASSET_BASE，结果拼出
        //     /azurlane/assets/x.css 必 404。
        window.__SU_ASSET_BASE = window.__SU_ASSET_BASE || 'https://l2d.su/';
        if (!window.__SU_RESOLVE) {
          window.__SU_RESOLVE = function (x) {
            try {
              const s = String(x);
              if (s.indexOf('/assets/') === 0) return 'https://l2d.su' + s;
              if (s.indexOf('assets/') === 0) return 'https://l2d.su/' + s;
              return s;
            } catch (e) { return x; }
          };
        }
        // 官方 index 强依赖这个全局（站点从 <meta name="static-asset-origin"> 读），
        // 它专供 Wt（模型域），不要拿去拼 chunk。
        window.__STATIC_ASSET_ORIGIN__ = window.__STATIC_ASSET_ORIGIN__ || 'https://static.l2d.su';
        // ── 样式表隔离（v1.21）────────────────────────────────────────────
        // 官方 index-CP7FX-Bo.css 有 78KB，含 `*` / `body` / `:root` / `h1~h6` 等
        // 全局选择器，原样 append 到 fnOS 桌面会污染整个系统 UI。
        // 而 viewer 自建 DOM 只有一个 canvas（class `pixi-source-canvas` /
        // `model-native-save-canvas`），渲染全靠 WebGL，**不依赖这份 CSS**。
        // 所以：拦掉 link，不注入任何官方样式；只留一段自己的最小兜底。
        if (!window.__fnosLinkShim) {
          window.__fnosLinkShim = true;
          const origAppend = Node.prototype.appendChild;
          Node.prototype.appendChild = function (node) {
            try {
              if (node && node.tagName === 'LINK') {
                const rel = (node.rel || '').toLowerCase();
                if (rel === 'stylesheet' || rel === 'preload') {
                  const href = node.href || '';
                  if (/l2d\.su\/assets\/|^\/assets\//.test(href) || /index-[A-Za-z0-9_-]+\.css/.test(href)) {
                    if (window.__FNOS_LOG_CSS) log('已拦截官方样式表，避免污染桌面：' + href);
                    // ⚠️ vite 会 await 这个 link 的 load/error。元素不进 DOM 就永远
                    // 不会触发，Promise 悬挂 → 模型载入卡死。这里手动派发 load。
                    setTimeout(function () {
                      try {
                        const ev = new Event('load');
                        node.dispatchEvent(ev);
                        if (typeof node.onload === 'function') node.onload(ev);
                      } catch (e) {}
                    }, 0);
                    return node;
                  }
                }
              }
            } catch (e) {}
            return origAppend.call(this, node);
          };
        }
        // ── 官方 CSS 的最小必要样式（v1.21.1）──────────────────────────────
        // 我们拦截官方 79KB 样式表避免污染桌面，但官方 CSS 里有两条**功能性**规则
        // 必须保留，否则会出现真机实测的问题：
        //   .model-native-save-canvas{opacity:0} —— 官方的导出/立绘辅助画布，
        //     平时必须透明。缺了它，这个 canvas 会以可见状态盖在模型区域上
        //     （真机 HTML 实测 left:179px width:635px cursor:pointer），互动切
        //     场景后官方重算它的布局，与实际命中区错位 → 「互动区缺失/错乱」。
        //   .pixi-source-canvas{display:block;width:100%;height:100%} —— 渲染画布
        //     的基础布局。
        // 只注入这两条选择器，其余全局规则（* / body / :root…）依然拦截。
        if (!document.getElementById('fnos-l2d-official-css')) {
          const st = document.createElement('style');
          st.id = 'fnos-l2d-official-css';
          st.textContent =
            '.model-native-save-canvas{touch-action:none;opacity:0;display:block;position:absolute}' +
            '.pixi-source-canvas{display:block;width:100%;height:100%;pointer-events:none}';
          document.head.appendChild(st);
        }
        await ensureCore();
        const BASE = 'https://l2d.su/assets/';
        const texts = {};
        await Promise.all(SU_CHUNKS.map(async (f) => {
          try {
            texts[f] = await fetchTextCached(BASE + f);
          } catch (e) {
            throw new Error('拉取官方运行时失败：' + f + '（' + (e && e.message) + '）');
          }
        }));
        let idx = texts['index-LGceUR3e.js'];
        const ai = idx.indexOf("(0x0,v['createRoot'])(document['getElementById']('root'))");
        if (ai > 0) idx = idx.slice(0, ai) + 'void 0;' + idx.slice(idx.indexOf('export{', ai));
        // ⚠️ 千万不要 patch Kt。它的原意就是 `'/' + x`（把 'assets/x.css' 变成
        // '/assets/x.css'），供 Vite 预加载解析绝对路径用。曾经 patch 成拼资源域，
        // 直接导致 CSS 404 → 模型载入整体失败。
        texts['index-LGceUR3e.js'] = idx;
        const STATIC = /from\s*(['"])([^'"]*?)([A-Za-z0-9_.-]+\.js)\1/g;
        const DYN = /import\(\s*(['"\x60])([^'"\x60]*?)([A-Za-z0-9_.-]+\.js)\1\s*\)/g;
        const deps = {};
        for (const f of SU_CHUNKS) {
          deps[f] = [];
          const re = new RegExp(STATIC.source, 'g'); let m;
          while ((m = re.exec(texts[f])) !== null) {
            const nm = m[3];
            if (SU_CHUNKS.indexOf(nm) >= 0 && deps[f].indexOf(nm) < 0) deps[f].push(nm);
          }
        }
        perfMark('su');
        const mk = (code) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        const done = {};
        for (let pass = 0; pass <= SU_CHUNKS.length; pass++) {
          for (const f of SU_CHUNKS) {
            if (done[f] || !deps[f].every((d) => done[d])) continue;
            let t = texts[f];
            t = t.split('import.meta.resolve').join('window.__SU_RESOLVE');
            t = t.replace(/(['"\x60])\/assets\//g, '$1https://l2d.su/assets/');
            t = t.replace(STATIC, function (mm, q, pre, name) {
              return window.__FNOS_MODS[name] ? ('from' + q + window.__FNOS_MODS[name] + q) : mm;
            });
            t = t.replace(DYN, function (mm, q, pre, name) { return "import(window.__FNOS_MODS['" + name + "'])"; });
            window.__FNOS_MODS[f] = mk(t);
            done[f] = true;
          }
        }
        const undone = SU_CHUNKS.filter((f) => !done[f]);
        if (undone.length) throw new Error('官方运行时依赖无法解析：' + undone.join(','));
        const PIXI = await import(window.__FNOS_MODS['lib-BYypsEmk.js']);
        await import(window.__FNOS_MODS['live2dRuntime-CzMa3YhQ.js']);
        const mr = await import(window.__FNOS_MODS['modelRuntime-BDk3g7Pb.js']);
        self.mods = { PIXI: PIXI.t, WikiModelViewer: mr.WikiModelViewer };
        self.ready = true;
        log('官方引擎就绪：PIXI v' + ((PIXI.t && PIXI.t.VERSION) || '?') + '，WikiModelViewer 已加载');
        return self.mods;
      })();
      return this.promise;
    },
  };

  /** 官方加载器要的 spec：优先用游戏数据（含触摸规则），拿不到就用最小可用的合成 spec */
  async function buildOfficialSpec(url, skinId) {
    const abs = new URL(url, location.href).href;
    let spec = {
      type: 'live2d', key: url, charId: 'fnos', charKey: 'fnos',
      costumeId: '1', costumeName: 'fnOS', path: abs, live2dTouch: null,
    };
    try {
      const gid = shipGroupIdOf(skinId);
      const prefab = prefabOfUrl(url);
      if (gid && prefab) {
        const j = JSON.parse(await fetchTextCached(L2D_DATA_BASE + gid + '.json'));
        const skin = ((j.ship && j.ship.skins) || []).find((x) => x.prefab === prefab);
        if (skin && skin.model) {
          spec = Object.assign({}, skin.model, { path: abs });
          log('官方引擎：使用游戏数据 spec（' + (skin.name || prefab) + '，含触摸规则）');
        }
      }
    } catch (e) { /* 用合成 spec */ }
    return spec;
  }

  const Engine = {
    app: null,
    model: null,
    canvas: null,
    container: null,
    target: null,       // { el, kind, src } —— 当前接管的壁纸节点
    size: { w: 1, h: 1 },
    nat: { w: 1, h: 1 },
    motionGroups: {},
    loading: false,
    lastUserMotionAt: 0,
    _pointerActive: false,   // 手势进行中
    _bridgeMode: null,       // 事件桥当前模式：'touch'（转发官方）/ 'drag'（我们平移模型）
    _bridgeCapture: false,   // 官方是否已 setPointerCapture
    _drag: null,             // 拖动中的起点快照
    _pendingDrag: null,      // 按下命中区后的「待定拖动」：位移超阈值再决定 touch 还是 drag
    _offBase: null,          // 官方 fit 出来的基准变换（scale/position），用户变换在此之上叠加
    _idleMotionIndex: 0,     // 当前待机序号（面板/还原时要用）
    idleTimer: null,         // 空闲自动动作定时器（官方模式）
    _selfMotion: false,      // 我们自己主动播动作的窗口期（用于区分「互动触发」，见 onOfficialAction）
    voices: [],              // 台词库（来自 l2d.su 游戏数据）
    voiceIndex: -1,
    _audio: null,            // 正在播放的台词
    _l2dTouch: null,         // 触摸区规则（live2dTouch）

    /* ---------- 初始化渲染器 ---------- */
    // v1.22：只剩官方运行时（内置引擎已移除，旧版备份在 fnos-live2d.legacy-backup.js）。
    initRenderer(container, target) {
      const E = this;
      E._officialBoot = E.initOfficial(container, target).catch((e) => {
        errlog('官方运行时初始化失败：' + (e && e.message));
        UI.showError('Live2D 运行时初始化失败：' + (e && e.message) +
          '\n请检查能否访问 l2d.su / cubism.live2d.com');
      });
    },

    /* ---------- 官方运行时（l2d.su） ---------- */

    async initOfficial(container, target) {
      // 飞牛 React 会重建壁纸容器 DOM → tryMount 会拿着**新 container** 再次进来。
      // 旧的官方 viewer 必须先销毁，否则：模型资源被请求两遍（第一遍 ERR_ABORTED）、
      // 旧 canvas 残留、viewer 内部状态错乱（setupLive2DHitAreas 抛异常、命中区为 0）。
      if (this.official && this.official.viewer) {
        try { this.removeOfficialBridge(); } catch (e) {}
        try { this.official.viewer.destroy(); } catch (e) {}
        try { if (this.official.canvas && this.official.canvas.parentNode) this.official.canvas.parentNode.removeChild(this.official.canvas); } catch (e) {}
        this.official = null;
        this.model = null;
        this.app = null;
        log('检测到重新挂载：已销毁旧官方 viewer');
      }
      this.container = container;
      this.target = target || null;
      this.originalImg = (target && target.kind === 'img') ? target.el : null;
      this.hideOriginal();
      const mods = await SuStack.load();
      const viewer = new mods.WikiModelViewer(container, function () {}, function (p, st) {
        if (st) UI.setStatus('载入 ' + Math.round(p) + '%');
      });
      this.official = { ready: false, viewer: viewer, canvas: null };
      // ⚠️ 必须同步设置 this.app（v1.21）：tryMount() 用 `if (Engine.app) return true`
      // 做幂等守卫。官方模式若不设 app，飞牛 React SPA 每次重建 DOM 都会再次
      // initRenderer + load → 模型资源被请求两遍、第一遍 ERR_ABORTED、
      // 官方 viewer 内部状态错乱（setupLive2DHitAreas 抛异常、命中区为 0）。
      this.app = viewer.app;
      this.official.canvas = viewer.app.view || viewer.app.canvas;
      this.canvas = this.official.canvas;
      if (this.canvas) {
        this.canvas.classList.add('fnos-l2d-canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.left = '0';
        this.canvas.style.top = '0';
        this.canvas.style.zIndex = '1';
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.style.touchAction = 'none';
      }
      // ★ 互动播语音的入口（v1.22）：官方 viewer 在「触摸区被触发」时会回调
      //   setLive2DActionHandler(action, info)，action 就是动作组名（实测 touch_body / main_1…）。
      //   官方自己**不播语音**（语音挂在 l2d.su 的游戏数据上，播的责任在宿主）——
      //   官方站也是这么接的，这就是「点模型互动没声音、点面板台词却有声音」的根因。
      try {
        if (typeof viewer.setLive2DActionHandler === 'function') {
          const E = this;
          viewer.setLive2DActionHandler(function (action, info) {
            try { E.onOfficialAction(action, info); } catch (err) { log('动作回调异常：' + (err && err.message)); }
          });
          log('已接上官方动作回调（互动会播对应语音）');
        }
      } catch (e) { log('注册动作回调失败：' + (e && e.message)); }
      perfMark('viewer');
      this.installOfficialBridge();
      applyCanvasEffects();
      this.official.ready = true;
      return viewer;
    },

    /**
     * 官方动作回调：在 l2d.su 的游戏数据里按动作名找对应台词并播放。
     *   · 触摸区被点（touch_head / touch_body / touch_special …）→ 播那条台词；
     *   · 我们自己主动播的动作（面板动作按钮 / 台词联动）不重复播，避免叠音；
     *   · 声音总开关关着就不响（与「台词」列表的行为一致）。
     */
    onOfficialAction(action, info) {
      if (!action) return;
      if (this._selfMotion) return;
      if (Store.cfg.sound !== true) return;
      const list = this.voices || [];
      if (!list.length) return;
      // 动作名与台词库里的 l2dAction 可能有大小写/下划线差异（touch_idle1 vs touchidle1）
      const norm = (x) => String(x == null ? '' : x).toLowerCase().replace(/[\s_]/g, '');
      const want = norm(action);
      const word = list.filter((w) => norm(w.l2dAction) === want)[0];
      if (!word) return;
      log('互动触发语音：' + action + (word.voiceName ? '（' + word.voiceName + '）' : ''));
      this.playVoice(word, { motion: false });   // 动作官方已经播了，不要重复
    },

    /** 宿主优先：鼠标下面有图标/窗口时让 canvas 不吃指针（事件交给宿主） */
    installHostGate() {
      if (this._hostGate) return;
      const E = this;
      this._hostGate = function (e) {
        const cv = E.official && E.official.canvas;
        if (!cv) return;
        let above = false;
        try { above = E.hostAboveWallpaper(e.clientX, e.clientY); } catch (err) {}
        cv.style.pointerEvents = above ? 'none' : 'auto';
      };
      window.addEventListener('pointermove', this._hostGate, { passive: true });
    },

    /**
     * 官方模式的事件桥：把「落在官方命中区上」的指针事件转发给官方 canvas。
     *
     * 为什么必须这么做：官方把 pointerdown 绑在 canvas 上（捕获阶段），按下后用
     * container.setPointerCapture 接管后续 move/up。但 fnOS 桌面里 canvas 压在
     * 桌面图标层（icon-grid）**下面**，pointerdown 永远到不了 canvas —— 于是官方
     * 整套交互一个都不触发（按在模型上也只是点到桌面），这就是「必须先开关分区互动
     * 才能互动 / 很多地方不能互动」的根因（开关触发重挂载，偶然赶上一次能收到事件）。
     *
     * 做法：在 window 捕获阶段（最早）先做一次官方命中判定：
     *   - 命中 → stopPropagation + preventDefault，并用**合成 PointerEvent** 重派发给
     *     canvas（保留 pointerId / clientX / clientY，官方内部据此 setPointerCapture）；
     *   - 没命中 → 完全放行，桌面图标 / 窗口 / Dock 一切照旧。
     * 官方 capture 成功后，后续 move/up 由浏览器直接送到 container，我们不再重复转发。
     */
    installOfficialBridge() {
      if (this._offBridge) return;
      const E = this;
      let activeId = null;                 // 正在替模型接管的 pointerId
      const viewerOf = () => (E.official && E.official.viewer) || null;
      const hitAt = (e) => {
        const v = viewerOf();
        if (!v || !v.currentLive2d) return null;
        try {
          // 用官方自己的坐标换算，保证与我们转发的事件在同一个坐标空间
          const p = (typeof v.domPoint === 'function') ? v.domPoint(e) : null;
          const x = p && typeof p.x === 'number' ? p.x : e.clientX;
          const y = p && typeof p.y === 'number' ? p.y : e.clientY;
          return v.hitAreaAt(v.currentLive2d, x, y) || null;
        } catch (err) { return null; }
      };
      /**
       * 指针是否落在**壁纸区域**内 —— 拖动/滚轮用（v1.24 放宽）。
       *
       * 原来这里判的是「是否压在模型包围盒上」（带 12/24px 容差），结果模型上方、
       * 下方的空白区（也就是桌面上下大片区域）拖不动、滚轮也没反应 ——
       * 用户明确要求「模型外边的上下区域也要能拖动缩放」。
       * 现在改成整个壁纸容器范围；宿主图标 / 窗口 / Dock 仍由调用方的
       * hostAboveWallpaper() 让路，互不冲突。
       */
      const inWallpaper = (e) => {
        const v = viewerOf();
        if (!v || !v.container) return false;
        try {
          const r = v.container.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return false;
          return e.clientX >= r.left && e.clientX <= r.right &&
                 e.clientY >= r.top && e.clientY <= r.bottom;
        } catch (err) { return false; }
      };
      const forward = (e, type) => {
        const cv = E.official && E.official.canvas;
        if (!cv) return;
        let ev;
        try {
          ev = new PointerEvent(type, {
            bubbles: true, cancelable: true, composed: true,
            clientX: e.clientX, clientY: e.clientY,
            screenX: e.screenX, screenY: e.screenY,
            pointerId: e.pointerId, pointerType: e.pointerType,
            isPrimary: e.isPrimary, button: e.button, buttons: e.buttons,
            pressure: e.pressure, width: e.width, height: e.height,
            tiltX: e.tiltX, tiltY: e.tiltY,
          });
        } catch (err) {
          ev = new Event(type, { bubbles: true, cancelable: true });
        }
        try { Object.defineProperty(ev, '__fnosForwarded', { value: true, configurable: true }); } catch (err) {
          try { ev.__fnosForwarded = true; } catch (e2) {}
        }
        E._forwarding = true;
        try { cv.dispatchEvent(ev); } catch (err) {} finally { E._forwarding = false; }
      };
      const onDown = (e) => {
        if (e.__fnosForwarded || activeId !== null) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;   // 只接鼠标主键
        // 我们自己的悬浮按钮 / 面板：直接放行，绝不接管。
        // 否则按钮压在模型命中区上时，这里的 stopPropagation 会让按钮收不到 pointerdown。
        if (E.onOwnUI && E.onOwnUI(E.eventTarget(e))) return;
        if (E.hostAboveWallpaper(e.clientX, e.clientY)) return;   // 宿主 UI 优先
        // 「分区互动」开关：关掉后完全不接管命中区 —— 模型只做视线跟随，
        // 点哪儿都不拦截，宿主图标/窗口永远优先（拖动与缩放由 gestures 单独管）。
        const hit = (Store.cfg.zones !== false) ? hitAt(e) : null;
        if (hit) {
          // ① 压在官方命中区上 → 转发给官方，让官方那套触摸规则跑起来
          activeId = e.pointerId;
          E._bridgeMode = 'touch';
          e.stopPropagation();
          e.preventDefault();
          forward(e, 'pointerdown');
          // 官方在按下时会 container.setPointerCapture(pointerId)：
          // 成功则后续 move/up 由浏览器直接送到 container，我们不必再转发（否则会重复处理）
          let cap = false;
          try {
            const ct = E.official.container;
            cap = !!(ct && typeof ct.hasPointerCapture === 'function' && ct.hasPointerCapture(e.pointerId));
          } catch (err) {}
          E._bridgeCapture = cap;
          // ★ 待定拖动：按下时先不动，等 move 超过阈值再决定——
          //   这个命中区若有 slide/drag 规则（touch_drag*），说明用户在做互动拖拽，保持 touch；
          //   否则说明用户是想「挪模型」，就地切成 drag。（v1.21）
          E._pendingDrag = null;
          if (Store.cfg.gestures !== false) {
            let slidable = false;
            try {
              const a = (E.official.viewer.live2dHitAreas || []).filter((x) => x.id === hit.id)[0];
              const rule = a && a.rule;
              if (rule && typeof E.official.viewer.ruleHasLive2DSlide === 'function') {
                slidable = !!E.official.viewer.ruleHasLive2DSlide(rule);
              }
            } catch (err) {}
            if (!slidable && inWallpaper(e)) {
              E._pendingDrag = { sx: e.clientX, sy: e.clientY, ox: Number(Store.cfg.posX) || 50,
                                 oy: Number(Store.cfg.posY) || 50, hitId: hit.id };
            }
          }
          E.lastUserMotionAt = Date.now();
          return;
        }
        // ② 没命中命中区、但压在模型身上 → 「拖动与缩放」：自己接管，改模型变换
        if (Store.cfg.gestures !== false && inWallpaper(e)) {
          activeId = e.pointerId;
          E._bridgeMode = 'drag';
          E._bridgeCapture = false;
          E._pendingDrag = null;
          e.stopPropagation();
          e.preventDefault();
          E._drag = { sx: e.clientX, sy: e.clientY, ox: Number(Store.cfg.posX) || 50,
                      oy: Number(Store.cfg.posY) || 50, moved: false, id: e.pointerId };
          E.lastUserMotionAt = Date.now();
          try { document.body.style.cursor = 'grabbing'; E._cursorByUs = true; } catch (err) {}
          return;
        }
        // ③ 其余：完全放行给宿主
      };
      /** 把一次 pointerdown 的「待定拖动」正式升级为 drag 模式 */
      const promoteToDrag = (e) => {
        const p = E._pendingDrag;
        if (!p) return;
        E._pendingDrag = null;
        E._bridgeMode = 'drag';
        E._bridgeCapture = false;
        E._drag = { sx: p.sx, sy: p.sy, ox: p.ox, oy: p.oy, moved: true, id: e.pointerId };
        try { document.body.style.cursor = 'grabbing'; E._cursorByUs = true; } catch (err) {}
        // 通知官方这次触摸取消（否则它悬着一个 pressed 状态）
        try { forward(e, 'pointercancel'); } catch (err) {}
        const w = Math.max(1, E.containerSize().w), h = Math.max(1, E.containerSize().h);
        Store.cfg.posX = clamp(p.ox + ((e.clientX - p.sx) / w) * 100, -500, 500);
        Store.cfg.posY = clamp(p.oy + ((e.clientY - p.sy) / h) * 100, -500, 500);
        E.layoutOfficial();
        try { UI.syncSliders(); } catch (err) {}
      };
      const onMove = (e) => {
        // ⚠️ 必须挡住"我们自己转发出去的合成事件"（v1.25 修栈溢出）：
        //    cv.dispatchEvent() 是**同步**的，合成事件会立刻从 window 捕获阶段再走一遍
        //    我们自己的监听；onDown 有这层检查、onMove/onUp/onCancel 以前没有 ——
        //    于是 pointermove 被无限转发，直到 RangeError: Maximum call stack size exceeded
        //    （官方的 setPointerCapture 失败、_bridgeCapture 为 false 时必现）。
        if (e.__fnosForwarded || E._forwarding) return;
        if (activeId === null || e.pointerId !== activeId) return;
        // 待定拖动：位移超过阈值才升级
        if (E._pendingDrag) {
          const p = E._pendingDrag;
          if (Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 6) {
            e.stopPropagation();
            e.preventDefault();
            promoteToDrag(e);
          }
          return;
        }
        if (E._bridgeMode === 'drag') {
          const d = E._drag;
          if (!d) return;
          e.stopPropagation();
          e.preventDefault();
          const w = Math.max(1, E.containerSize().w), h = Math.max(1, E.containerSize().h);
          if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
          if (!d.moved) return;
          Store.cfg.posX = clamp(d.ox + ((e.clientX - d.sx) / w) * 100, -500, 500);
          Store.cfg.posY = clamp(d.oy + ((e.clientY - d.sy) / h) * 100, -500, 500);
          E.layoutOfficial();
          try { UI.syncSliders(); } catch (err) {}
          return;
        }
        if (E._bridgeCapture) return;       // 已被官方 capture，浏览器会自己送
        forward(e, 'pointermove');
      };
      const onUp = (e) => {
        if (e.__fnosForwarded || E._forwarding) return;
        if (activeId === null || e.pointerId !== activeId) return;
        activeId = null;
        E._pendingDrag = null;
        if (E._bridgeMode === 'drag') {
          e.stopPropagation();
          e.preventDefault();
          E._bridgeMode = null;
          if (E._drag && E._drag.moved) Store.save();
          E._drag = null;
          try { document.body.style.cursor = ''; E._cursorByUs = false; } catch (err) {}
          return;
        }
        E._bridgeMode = null;
        e.stopPropagation();
        e.preventDefault();
        if (!E._bridgeCapture) forward(e, 'pointerup');
        E._bridgeCapture = false;
      };
      const onCancel = (e) => {
        if (e.__fnosForwarded || E._forwarding) return;
        if (activeId === null || e.pointerId !== activeId) return;
        activeId = null;
        E._bridgeMode = null;
        E._drag = null;
        E._pendingDrag = null;
        try { document.body.style.cursor = ''; E._cursorByUs = false; } catch (err) {}
        if (!E._bridgeCapture) forward(e, 'pointercancel');
        E._bridgeCapture = false;
      };
      /** 官方模式的滚轮缩放：改 Store.zoom 后走 layoutOfficial（模型变换），
       *  不用官方 queueWheelZoomDelta —— 那条链路依赖 canvas 接得到 wheel 事件，
       *  而 canvas 在桌面上被图标层盖着，收不到。 */
      const onWheel = (e) => {
        if (Store.cfg.gestures === false) return;
        if (!E.official || !E.official.ready || !E.model) return;
        if (E.onOwnUI && E.onOwnUI(E.eventTarget(e))) return;
        if (E.hostAboveWallpaper(e.clientX, e.clientY)) return;
        if (!inWallpaper(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const next = (Number(Store.cfg.zoom) || 1) * (e.deltaY < 0 ? 1.08 : 0.92);
        Store.cfg.zoom = clamp(+next.toFixed(3), 0.05, 20);
        E.layoutOfficial();
        try { UI.syncSliders(); } catch (err) {}
        Store.save();
      };
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
      window.addEventListener('wheel', onWheel, { capture: true, passive: false });
      this._offBridge = { onDown, onMove, onUp, onCancel, onWheel };
    },

    removeOfficialBridge() {
      if (!this._offBridge) return;
      const b = this._offBridge;
      window.removeEventListener('pointerdown', b.onDown, true);
      window.removeEventListener('pointermove', b.onMove, true);
      window.removeEventListener('pointerup', b.onUp, true);
      window.removeEventListener('pointercancel', b.onCancel, true);
      if (b.onWheel) window.removeEventListener('wheel', b.onWheel, true);
      this._offBridge = null;
      this._drag = null;
      this._pendingDrag = null;
      this._bridgeMode = null;
    },

    applyOfficialSettings() {
      const v = this.official && this.official.viewer;
      if (!v) return;
      const c = Store.cfg;
      try {
        if (v.setShowHitAreas) v.setShowHitAreas(c.zoneShow === true && c.zones !== false);
      } catch (e) {}
      // ⚠️ 官方自带的 setLookAtCursor(true) 实测幅度极小（鼠标横跨全屏，头部角度只动 ~2 度），
      //   而且它内部每帧驱动 focusController，会把我们写进去的值覆盖掉。
      //   所以这里恒传 false（只借用它把 autoFocus 关掉），跟随改由下面的
      //   startFollowDrive() 自己驱动 focusController —— 幅度明显、开关也真的能开关。
      try { if (v.setLookAtCursor) v.setLookAtCursor(false); } catch (e) {}
      // ⚠️ 不要让官方接管拖拽（v1.21）：
      //   setDraggingEnabled(true) 会让 updateLive2DInteractionState 把 cursor 设成 grab，
      //   且官方拖拽只走 touch_drag* 规则、**不会移动模型位置** → 用户感觉「拖不动」。
      //   位置平移改由我们的事件桥把位移写进 Store.cfg.posX/posY + layoutOfficial()。
      //   这里恒为 false，官方专心做触摸规则。
      try { if (v.setDraggingEnabled) v.setDraggingEnabled(false); } catch (e) {}
      try { if (v.setLive2DBreathing) v.setLive2DBreathing(c.breath !== false); } catch (e) {}
      try { if (v.setLive2DEyeBlinking) v.setLive2DEyeBlinking(c.blink !== false); } catch (e) {}
      this.applyRenderScale();
      this.startFollowDrive();
      // 关掉跟随时把视线回正（否则会僵在最后一次鼠标位置）
      if (c.follow === false) {
        this._followTarget = null;      // 不再注入视线值
        try {
          const mm = v.currentLive2d;
          const fc = mm && mm.internalModel && mm.internalModel.focusController;
          if (fc && typeof fc.focus === 'function') fc.focus(0, 0, true);
        } catch (e) {}
      }
    },

    /**
     * 渲染倍率（v1.24 接通）。
     * 官方运行时把渲染分辨率写死成 canvas 的 CSS 尺寸 × renderScaleMultiplier（官方字段）
     * （实测默认 1.5：1440 宽的容器 → 2160 的画布）。之前面板上的「渲染」滑杆
     * 只改了内置引擎的 renderer.resolution，官方模式下完全没接线，所以「没起效」。
     */
    applyRenderScale() {
      const v = this.official && this.official.viewer;
      if (!v) return;
      const mul = clamp(Number(Store.cfg.resMul) || 1, 0.5, 3);
      try { v.renderScaleMultiplier = mul; } catch (e) {}
      // 官方只在「容器尺寸变化」时按倍率重算画布，改字段本身不会立即生效，
      // 所以这里主动让渲染器按新倍率重算一次（真机实测不改的话画布一直停在旧分辨率）。
      try {
        const app = v.app;
        const el = v.container;
        if (app && app.renderer && el) {
          const r = el.getBoundingClientRect();
          if (r.width > 1 && r.height > 1) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            app.renderer.resolution = mul * dpr;
            app.renderer.resize(Math.round(r.width), Math.round(r.height));
          }
        }
      } catch (e) {}
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    },

    /**
     * 视线跟随（v1.24 增强）——为什么最后是「拦截官方写参数」这条路：
     *
     *   1. 官方自带的 setLookAtCursor(true)：鼠标横跨全屏，ParamAngleX 只动 ~2 度，
     *      用户根本看不出来（就是「跟随无效」的来源）；
     *   2. 改自己驱动 focusController（库的标准做法，理论上 ParamAngleX = 30 * x）：
     *      实测也只动 1.2 度 —— 因为**官方规则系统每帧都在写参数**
     *      （setLive2DParameterFrameValue），把我们写进去的值覆盖掉了。
     *
     *   所以唯一可靠的做法：**在官方写参数的那一刻改掉它** ——
     *   包装 viewer.setLive2DParameterFrameValue，遇到角度/眼球参数就换成
     *   我们按鼠标位置算出来的值。这样既不会被覆盖，幅度也完全可控。
     */
    startFollowDrive() {
      const v = this.official && this.official.viewer;
      if (!v) return;
      const E = this;

      // ① 鼠标位置 → 归一化目标（-1..1）
      if (!this._followDrive) {
        this._followDrive = function (e) {
          if (Store.cfg.follow === false) return;
          const vv = E.official && E.official.viewer;
          const c = vv && vv.container;
          if (!c) return;
          try {
            const r = c.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
            const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
            // 水平给满、垂直收一点（头部左右摆得比上下多，观感更自然）
            E._followTarget = { x: nx * 0.9, y: ny * 0.6 };
            E._followHits = (E._followHits || 0) + 1;
            // 双保险：官方若某个模型不写角度参数，focusController 这条也能兜底
            const m = vv.currentLive2d;
            const fc = m && m.internalModel && m.internalModel.focusController;
            if (fc && typeof fc.focus === 'function') fc.focus(E._followTarget.x, E._followTarget.y);
          } catch (err) {}
        };
        window.addEventListener('mousemove', this._followDrive, { passive: true });
      }

      // ② 每帧在 coreModel.update() 之前写入视线值 ★关键
      //
      //   为什么是这里：Cubism 每帧的顺序是 动作动画 -> 物理 -> coreModel.update()(写入顶点)。
      //   动画 (motion3.json) 每帧都会写 ParamAngleX/Y/Z —— 实测直接调 focusController
      //   或 viewer 的 setLive2DParameterFrameValue 都会被它盖掉（角度只动 1~2 度）。
      //   在 coreModel.update() **之前**写，正好落在动画之后、顶点计算之前：
      //   既不会被覆盖，也不影响其它参数。
      const m0 = v.currentLive2d;
      const core = m0 && m0.internalModel && m0.internalModel.coreModel;
      if (core && typeof core.update === 'function' && !core.__fnosFollowPatched) {
        core.__fnosFollowPatched = true;
        const rawUpdate = core.update.bind(core);
        core.update = function () {
          try {
            const t = E._followTarget;
            if (t && Store.cfg.follow !== false && typeof core.setParameterValueById === 'function') {
              core.setParameterValueById('ParamAngleX', 30 * t.x);
              core.setParameterValueById('ParamAngleY', 30 * t.y);
              core.setParameterValueById('ParamAngleZ', 30 * t.x * t.y);
              core.setParameterValueById('ParamBodyAngleX', 10 * t.x);
              core.setParameterValueById('ParamEyeBallX', t.x);
              core.setParameterValueById('ParamEyeBallY', t.y);
            }
          } catch (e) {}
          return rawUpdate();
        };
        log('视线跟随：已接管模型角度参数（在 coreModel.update 前注入）');
      }

      // ③ 同时在 motionManager.update() **之后**再写一次（双保险）
      //    不同版本的 pixi-live2d-display 里，动作写在 coreModel.update 之前还是之后并不一致；
      //    两个时机都写，保证我们的值一定晚于动画。
      const mm = m0 && m0.internalModel && m0.internalModel.motionManager;
      if (mm && typeof mm.update === 'function' && !mm.__fnosFollowPatched) {
        mm.__fnosFollowPatched = true;
        const rawMm = mm.update.bind(mm);
        mm.update = function (a, b) {
          const r = rawMm(a, b);
          try {
            const t = E._followTarget;
            if (t && Store.cfg.follow !== false && typeof core.setParameterValueById === 'function') {
              core.setParameterValueById('ParamAngleX', 30 * t.x);
              core.setParameterValueById('ParamAngleY', 30 * t.y);
              core.setParameterValueById('ParamAngleZ', 30 * t.x * t.y);
              core.setParameterValueById('ParamBodyAngleX', 10 * t.x);
              core.setParameterValueById('ParamEyeBallX', t.x);
              core.setParameterValueById('ParamEyeBallY', t.y);
              E._followWrites = (E._followWrites || 0) + 1;
              E._followDbg = { t: { x: +t.x.toFixed(2), y: +t.y.toFixed(2) }, wrote: 30 * t.x };
            }
          } catch (e) {}
          return r;
        };
        log('视线跟随：已在 motionManager.update 后再注入一次');
      }
    },


    async loadOfficial(url, label) {
      await this._officialBoot;
      const viewer = this.official && this.official.viewer;
      if (!viewer) throw new Error('官方 viewer 未就绪');
      const spec = await buildOfficialSpec(url, Store.cfg.skinId);
      log('官方引擎：载入模型 ' + (label || url));
      await viewer.load(spec);
      perfMark('model');
      this.model = viewer.currentLive2d || null;
      // 官方加载后必须走的初始化序列（对齐他们 app 的 loadModel）：
      //   捕获默认状态 → 建命中区 → 绑定指针 → 播待机；少一步命中区会全部 visible=false（点不动）
      try { if (viewer.captureDefaults) viewer.captureDefaults(this.model); } catch (e) { log('captureDefaults 失败：' + e.message); }
      try { if (viewer.setupLive2DHitAreas) viewer.setupLive2DHitAreas(this.model); } catch (e) { log('setupLive2DHitAreas 失败：' + e.message); }
      try { if (viewer.bindLive2DHitAreas) viewer.bindLive2DHitAreas(this.model); } catch (e) { log('bindLive2DHitAreas 失败：' + e.message); }
      // 载入时播什么（v1.26）：默认播 login（对齐 l2d.su —— 进门先说登录台词那套动作），
      // 面板「进入加载登录动画」关掉则播待机 idle0。
      // 之所以给开关：有些模型的 login 动作会把服饰/道具状态一起带走，不是所有人都喜欢。
      try {
        const groups = this.motionGroups || {};
        if (Store.cfg.entryLogin !== false && groups.login && groups.login.length) {
          this.playMotion('login');
        } else if (viewer.playLive2DIdleMotion) {
          viewer.playLive2DIdleMotion(0);
        }
      } catch (e) {}
      // 官方已完成 fitDisplayObject（默认取景）→ 此刻的 scale/position 就是基准。
      // 之后用户的缩放/位移都在这套基准上叠加，且打 __userTransform 防止官方再覆盖。
      this._offBase = null;
      this.captureOfficialBase();
      try {
        const r = await fetch(url, { credentials: 'omit' });
        const j = await r.json();
        this.motionGroups = (j && j.FileReferences && j.FileReferences.Motions) || {};
      } catch (e) { this.motionGroups = {}; }
      // ⚠️ 必须先把当前模型写回配置（v1.25 修）：
      //    台词库与触摸规则都靠 prefabOfUrl(Store.cfg.modelUrl) 去游戏数据里找皮肤，
      //    面板顶部显示的也是 Store.cfg.modelLabel。v1.22 重写 load() 时漏掉了这两行，
      //    结果「只有第一个模型是对的」：之后每次换模型，prefab 仍然取旧地址 →
      //    游戏数据里找不到那个皮肤 → 台词 0 条、触摸区规则 0 条，面板还一直显示旧模型名。
      Store.cfg.modelUrl = url;
      if (label) Store.cfg.modelLabel = label;
      Store.save();

      this.applyOfficialSettings();
      // ⚠️ 必须 await（v1.23）：台词库来自游戏数据 JSON，如果不等它，
      //   「模型已就绪」之后的一小段时间里 this.voices 还是空的 ——
      //   这期间用户点模型互动，onOfficialAction 会因为拿不到台词而静默跳过
      //   （表现就是「互动有时有声音、有时没有」）。走缓存时这一步只要几十毫秒。
      try { await this.loadGameData(); } catch (e) { log('台词库加载失败：' + (e && e.message)); }
      this.layout();
      UI.setModelName(Store.cfg.modelLabel || url);
      UI.renderMotions(Object.keys(this.motionGroups || {}));
      UI.setStatus('');
      UI.hideError();
      perfMark('ready');
      log('官方引擎：模型已就绪（命中区 ' + ((viewer.live2dHitAreas && viewer.live2dHitAreas.length) || 0) + ' 个）');
      perfReport();
      this.startIdleLoop();   // 空闲自动动作（官方模式）
      // 载入瞬间容器可能还没量到真实尺寸（见 layoutOfficial 注释）——
      // 等宿主布局稳定后补一次，确保取景/命中区与屏幕一致。
      const self = this;
      setTimeout(function () {
        try { self.layout(); } catch (e) {}
      }, 400);
      return true;
    },

    /**
     * 官方模式：把用户的缩放/位移/镜像施加到**模型自身变换**上，而不是 canvas 的 CSS 变换。
     *
     * 为什么不能动 canvas 的 CSS（v1.21 修「显示区域和实际可点击区域不一致」）：
     *   官方命中判定 hitAreaAt / hitAreasAt 内部是
     *     `model.worldTransform.applyInverse(容器局部坐标)` → 反查命中区。
     *   worldTransform 只反映**模型自己的** scale/position/angle，**完全不知道**
     *   canvas 上挂了什么 CSS transform。所以一旦用 CSS 缩放/平移 canvas：
     *     视觉上模型被 CSS 放大平移了，数学上命中判定还停在原处 —— 两者彻底错位。
     *   实测（1.61× / 水平 80%）：模型可见中心 (1152,450)，命中质心却顽固停在
     *   (704,369)，偏差 448px，正是「看得见却点不着 / 点到的不是看到的地方」。
     *
     * 正确做法（与 l2d.su 同源）：用官方自己的 setScale() 改模型 scale，
     * 直接写 model.position，并打上 `__userTransform` 标记（官方据此跳过
     * 自动 fitDisplayObject，不再覆盖用户的取景）。这样 worldTransform 里
     * 就含了用户的变换，命中判定天然一致。
     */
    layoutOfficial() {
      const cv = this.official && this.official.canvas;
      if (!cv || !this.container) return;
      const rect = this.container.getBoundingClientRect();
      const cw = Math.round(rect.width);
      const ch = Math.round(rect.height);
      // ⚠️ 尺寸异常时**不要**覆盖 this.size（v1.23 修正）：
      //   viewer.load() 刚结束时容器可能瞬时是 0×0（挂载中间态/被宿主重建），
      //   老代码 Math.max(1, 0) 会把 size 记成 1×1 —— 之后拖动/滚轮的坐标换算
      //   按「1px 容器」算，位移 100px 就变成 10000%，模型瞬间被甩到 ±500 边界、
      //   滚轮也判不中模型。这里只在尺寸合理时才更新，异常值直接沿用旧值。
      if (cw > 1 && ch > 1) this.size = { w: cw, h: ch };

      // canvas 只负责铺满容器，绝不施加用户变换
      cv.style.transform = 'none';
      cv.style.transformOrigin = '';
      cv.style.opacity = Store.cfg.opacity;

      const m = this.model;
      if (!m) { applyCanvasEffects(); return; }

      // nat = 模型声明的画布尺寸（官方 internalModel.originalWidth/Height）。
      // modelRect()（宿主让路判定）和「填满高度」预设都按它算，必须每次布局都刷新。
      try {
        const im = m.internalModel;
        this.nat = {
          w: (im && im.originalWidth) || m.width || 1,
          h: (im && im.originalHeight) || m.height || 1,
        };
      } catch (e) {}

      // 基准：官方自己 fit 出来的 scale 与居中位置。首次 layout 时捕获。
      // 注意 `__userTransform` 会让官方不再自动 fit，所以基准要在打标记**之前**取。
      const b = this._offBase;
      const baseSc = (b && b.sc) || Math.abs(m.scale.x) || 1;
      const baseX = b ? b.x : m.position.x;
      const baseY = b ? b.y : m.position.y;

      const c = Store.cfg;
      const z = Math.max(0.05, Number(c.zoom) || 1);
      const dx = ((Number(c.posX) - 50) / 100) * cw;
      const dy = ((Number(c.posY) - 50) / 100) * ch;
      const s = Math.max(0.001, baseSc * z);
      const sx = c.mirror ? -s : s;

      try {
        // 官方 setScale 会置 __userTransform（挡住它的自动 fit），但**第二参语义不明确**：
        // 实测打开镜像后 scale.x 变负、再关掉它不会把负号改回来（用户报的「关不掉」）。
        // 所以：先请官方设一次基准，再无条件自己写一遍含镜像方向的 scale。
        if (typeof this.official.viewer.setScale === 'function') {
          try { this.official.viewer.setScale(s, false); } catch (e1) {}
        }
        m.scale.set(c.mirror ? -s : s, s);
      } catch (e) { try { m.scale.set(sx, s); } catch (e2) {} }

      try { m.position.set(baseX + dx, baseY + dy); } catch (e) {}
      try { m.__userTransform = true; } catch (e) {}

      // 命中区可视化（showHitAreas）要跟着新变换重画
      try { if (this.official.viewer.redrawLive2DHitAreas) this.official.viewer.redrawLive2DHitAreas(); } catch (e) {}
      applyCanvasEffects();
    },

    /**
     * 播一个动作 **并连它的台词一起播**（v1.26）。
     *
     * l2d.su 上点动作按钮是"动作 + 台词"一起出的，对应关系就写在游戏数据里
     * （台词的 l2dAction 字段）。我们这边以前只播动作 —— 原因是 playMotion 会给
     * _selfMotion 打标（防止官方动作回调再叠一层语音），于是官方回调那条路被自己挡掉了。
     * 所以想响，就得在这里主动播一次。
     */
    playAction(group) {
      if (!group) return false;
      const ok = this.playMotion(group);
      try {
        if (Store.cfg.sound === true && this.voices && this.voices.length) {
          const norm = (x) => String(x == null ? '' : x).toLowerCase().replace(/[\s_]/g, '');
          const w = this.voices.filter((x) => norm(x.l2dAction) === norm(group))[0];
          if (w) {
            if (Store.cfg.voiceMotion !== false) { /* 动作已经自己播了，这里只出声音 */ }
            this.playVoice(w, { motion: false });
          }
        }
      } catch (e) {}
      return ok;
    },

    /**
     * 空闲自动动作（v1.24 官方模式接通）。
     *
     * 之前删内置引擎时把 idle 循环一并删了，而官方运行时自己**不会**随机切待机，
     * 于是面板上的「空闲自动动作」开关变成空转 —— 用户反馈「无效」就是这个。
     * 这里按官方语义重做：每 12 秒检查一次，满足「开关打开 + 8 秒内无操作」就
     * 随机切一个 idleN（走 playLive2DIdleMotion，带官方那套平滑与规则复位）。
     */
    startIdleLoop() {
      if (this.idleTimer) clearInterval(this.idleTimer);
      const E = this;
      this.idleTimer = setInterval(function () {
        if (Store.cfg.idle === false) return;
        if (!E.model || document.hidden) return;
        if (Date.now() - (E.lastUserMotionAt || 0) < 8000) return;   // 刚互动过，先歇会
        const groups = Object.keys(E.motionGroups || {}).filter(function (g) { return /^idle\d*$/i.test(g); });
        if (groups.length < 2) return;
        E.playMotion(groups[Math.floor(Math.random() * groups.length)]);
      }, 12000);
    },

    /**
     * 实时量容器尺寸（v1.23）。
     * 拖动/滚轮的百分比换算必须用「此刻真实的容器像素」——缓存值可能在
     * 挂载中间态被写成异常值（见 layoutOfficial 里的注释），双保险。
     */
    containerSize() {
      try {
        const el = this.container || (this.canvas && this.canvas.parentElement);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r && r.width > 1 && r.height > 1) return { w: Math.round(r.width), h: Math.round(r.height) };
        }
      } catch (e) {}
      return { w: Math.max(1, this.size.w || 1), h: Math.max(1, this.size.h || 1) };
    },

    /** 记录官方 fit 出的基准变换（缩放/位移以此为 0 点） */
    captureOfficialBase() {
      const m = this.model;
      if (!m) return;
      try {
        this._offBase = { sc: Math.abs(m.scale.x) || 1, x: m.position.x, y: m.position.y };
        log('官方基准变换：scale=' + this._offBase.sc.toFixed(4) +
            ' pos=(' + this._offBase.x.toFixed(1) + ',' + this._offBase.y.toFixed(1) + ')');
      } catch (e) { this._offBase = null; }
    },

    /* ---------- 载入 / 切换模型（只有官方运行时一条路） ---------- */
    async load(url, label) {
      if (this.loading) return;
      this.loading = true;
      UI.setStatus('正在载入模型…');
      try {
        await this._officialBoot;          // 等运行时 boot（viewer 可能还在创建）
        if (!this.official) throw new Error('运行时未就绪');
        await this.loadOfficial(url, label);
        bootHintFade();                    // v1.22：成功即收掉左下角提示（旧版只有内置引擎会收）
      } catch (e) {
        errlog('模型载入失败：' + (e && e.message ? e.message : e));
        UI.showError('模型载入失败：' + (e && e.message ? e.message : e) +
          '\n请检查网络能否访问 static.l2d.su');
        UI.setStatus('');
        this.restoreOriginal();            // 失败时还原原壁纸，避免白屏
        bootHint('Live2D：模型载入失败 —— ' + (e && e.message ? e.message : e), true);
      } finally {
        this.loading = false;
      }
    },

    /* ---------- 布局：把模型摆到容器里 ---------- */
    layout() {
      // v1.22：只剩官方运行时一条渲染路径（取景/缩放/位移全在 layoutOfficial 里）
      this.layoutOfficial();
    },

    /* ---------------- 原壁纸的隐藏与还原 ---------------- */

    hideOriginal() {
      const t = this.target;
      if (!t) return;
      if (t.kind === 'img') {
        const list = (t.covers && t.covers.length) ? t.covers : (t.el ? [t.el] : []);
        if (!t.savedVis) t.savedVis = [];
        for (const el of list) {
          if (!el) continue;
          if (el.__fnosVisSaved === undefined) {
            el.__fnosVisSaved = el.style.visibility || '';
            t.savedVis.push(el);
          }
          el.style.visibility = 'hidden';
        }
      } else if (t.kind === 'bg') {
        const el = t.el;
        if (!el) return;
        // 记住原值再清空，卸载脚本/换模型时能完整还原
        if (!el.dataset.fnosL2dBgSaved) {
          el.dataset.fnosL2dBgSaved = '1';
          el.dataset.fnosL2dBg = el.style.backgroundImage || '';
        }
        el.style.backgroundImage = 'none';
      }
      // kind === 'solid'：纯色层本身就是壁纸，保留（清掉就变透明了）
    },

    restoreOriginal() {
      const t = this.target;
      if (!t) return;
      if (t.kind === 'img') {
        for (const el of (t.savedVis || [])) {
          if (el && el.__fnosVisSaved !== undefined) {
            el.style.visibility = el.__fnosVisSaved;
            delete el.__fnosVisSaved;
          }
        }
        t.savedVis = [];
      } else if (t.kind === 'bg' && t.el && t.el.dataset.fnosL2dBgSaved) {
        t.el.style.backgroundImage = t.el.dataset.fnosL2dBg || '';
        delete t.el.dataset.fnosL2dBgSaved;
      }
    },

    /** React 重建后可能把原壁纸又显出来，这里再压回去 */
    reassertHidden() {
      const t = this.target;
      if (!t || !t.el || !t.el.isConnected) return false;
      let changed = false;
      if (t.kind === 'img') {
        for (const el of ((t.covers && t.covers.length) ? t.covers : [t.el])) {
          if (el && el.isConnected && el.style.visibility !== 'hidden') {
            el.style.visibility = 'hidden';
            changed = true;
          }
        }
      } else if (t.kind === 'bg') {
        const cur = t.el.style.backgroundImage;
        if (cur && cur !== 'none') {
          t.el.dataset.fnosL2dBg = cur;
          t.el.dataset.fnosL2dBgSaved = '1';
          t.el.style.backgroundImage = 'none';
          changed = true;
        }
      }
      return changed;
    },

    /* ---------------- 命中层：定位 + 层级 ---------------- */

    /**
     * 只做定位。
     * 命中层可能挂在两个地方，坐标系不一样，必须分开算：
     *   container 模式（position:absolute，挂在壁纸容器里）-> 容器/画布坐标
     *   overlay   模式（position:fixed，挂在 document.body 上）-> 视口坐标
     */
    /**
     * 决定命中层挂哪儿。
     * 桌面（登录之后）的壁纸层是 z-index:0 的容器，桌面图标/任务栏都在它上面，
     * 命中层如果老实地待在容器里，点下去根本到不了 —— 这就是「互动没反应」的
     * 主要成因。所以先探一下有没有被挡住，被挡住就整体浮到 body 上。
     */
    /**
     * 命中层的采样点是否都被别的元素盖住了。
     *
     * 关键：探查前必须先让命中层自己对 elementFromPoint「隐身」。
     * 否则不管它挂在哪，探到的都是它自己 —— 结论永远是「没被挡」，于是 auto 模式
     * 会在 container / overlay 之间来回跳；而每次切换都要 appendChild，DOM 移动会
     * 释放 pointer capture，表现就是「拖动拖一下就断、滚轮没反应」。
     *
     * 隐身之后探到的才是「假设没有命中层，这一次点击会被谁接住」，结论与当前挂在
     * 哪儿无关，因此是稳定的。
     */
    /**
     * 找出这一点上「真正会接住点击」的最上层元素。要跳过两种"透明"的东西：
     *   - pointer-events:none 的（点击直接穿过去）
     *   - **本脚本自己的全屏宿主**（面板外壳，只有它内部的按钮才吃肉）
     *
     * 第二类是踩过的坑：采样点偶尔会落在宿主上，被 ownsElement 判成「这点通着」，
     * 于是结论变成「没被挡」，命中层就留在壁纸容器里被桌面图标层吃掉点击 ——
     * 表现就是「明明看得见模型，却怎么点都没反应」。
     */
    ownsElement(elm) {
      let n = elm;
      while (n) {
        if (n === this.canvas || n === this.container) return true;
        if (UI.root && n === UI.root) return true;
        n = (n.parentNode && n.parentNode.host) ? n.parentNode.host : n.parentElement;
      }
      return false;
    },

    /** 事件目标是否落在我们自己的 UI 上（面板 / 悬浮栏 / 小按钮都在 shadow DOM 里） */
    eventTarget(e) {
      try { const p = e.composedPath && e.composedPath(); if (p && p.length) return p[0]; } catch (err) {}
      return e.target;
    },
    onOwnUI(target) {
      let n = target;
      while (n) {
        if (UI.root && (n === UI.root || n === UI.root.host)) return true;
        n = (n.parentNode && n.parentNode.host) ? n.parentNode.host : n.parentElement;
      }
      return false;
    },


    /** 单个元素是不是宿主的「可操作元素」（图标 / 按钮 / 输入框 / 窗口…） */
    _isHostInteractive(n) {
      if (!n || !n.tagName) return false;
      if (n === document.body || n === document.documentElement) return false;
      if (n.hasAttribute && n.hasAttribute('data-desktop-item-id')) return true;
      const t = n.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON' ||
          t === 'A' || t === 'LABEL' || t === 'OPTION') return true;
      if (n.isContentEditable) return true;
      const role = n.getAttribute && n.getAttribute('role');
      if (role === 'button' || role === 'link' || role === 'tab' ||
          role === 'menuitem' || role === 'dialog') return true;
      // 窗口类容器：点在窗口正文上（正文本身没有任何可交互特征）时，
      // 靠类名认出「这是窗口」，否则触摸区会和窗口抢点击
      const cn = typeof n.className === 'string' ? n.className : (n.className && n.className.baseVal) || '';
      if (/\b(?:window|dialog|modal|popup|menu|dock|taskbar|titlebar)\b/i.test(cn)) return true;
      // cursor: pointer 是「这东西能点」的强信号 —— 很多宿主不给图标加 role，
      // 但一定会给可点的东西设手型光标。
      // ⚠️ 我们自己的悬停反馈也把 body 的 cursor 设成 pointer（整条栈都会继承它），
      // 这时必须跳过这条启发式，否则判定自己毒化自己：悬停过触摸区后所有点击都会误让路
      if (!this._cursorByUs) {
        try { if (getComputedStyle(n).cursor === 'pointer') return true; } catch (e) {}
      }
      return false;
    },

    /** 这一点下面是不是宿主的「可操作元素」（图标 / 按钮 / 输入框…）。是的话我们让路。 */
    hostInteractiveAt(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      if (this.onOwnUI(el)) return false;
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (this._isHostInteractive(n)) return true;
      }
      return false;
    },

    /** 这一点上、壁纸之上有没有宿主的东西（图标 / 窗口 / Dock…）。
     *  模型只是壁纸 —— 宿主 UI 永远优先：重叠时整个让路，一个指针事件都不拦。
     *  判法：沿 elementsFromPoint 的层叠栈从上往下走，抵达壁纸层 / 自己的层之前，
     *  任何一层是宿主的可操作元素就算「宿主在上」。 */
    hostAboveWallpaper(x, y) {
      const els = document.elementsFromPoint(x, y);
      if (!els.length) return false;
      if (this.onOwnUI(els[0])) return false;
      const t = this.target;
      const wallEls = t ? [t.el, ...(t.covers || [])].filter(Boolean) : [];
      for (const n of els) {
        if (n === this.canvas || n === this.container) return false;   // 已经是我们自己的层
        if (wallEls.includes(n)) return false;                          // 已经落到壁纸层
        if (this._isHostInteractive(n)) return true;
      }
      // 壁纸被我们隐藏后不会出现在命中栈里 —— 栈走完没发现宿主元素就当作「裸壁纸」
      return false;
    },

    /** 模型在屏幕上的矩形（判断「悬停在模型上」用） */
    modelRect() {
      if (this.official && this.official.ready && this.official.canvas) {
        const r = this.official.canvas.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }
      if (!this.model || !this.canvas) return null;
      const sc = Math.abs(this.model.scale.y);
      const w = this.nat.w * sc, h = this.nat.h * sc;
      const cr = this.canvas.getBoundingClientRect();
      const cx = this.model.position.x + w / 2;
      const bottom = this.model.position.y + h;
      return { left: cr.left + cx - w / 2, top: cr.top + bottom - h, width: w, height: h };
    },







    /* ---------- 台词库 ---------- */
    /** 拉取当前模型对应的游戏数据：台词（words）与触摸区规则（live2dTouch） */
    async loadGameData() {
      this.voices = [];
      this.voiceIndex = -1;
      this._l2dTouch = null;
      const gid = shipGroupIdOf(Store.cfg.skinId);
      const prefab = prefabOfUrl(Store.cfg.modelUrl);
      if (!gid || !prefab) {
        UI.renderVoices();
        if (!gid) log('没有皮肤 ID，跳过台词库（用 l2d.su 链接或皮肤 ID 指定模型就能用）');
        else log('没从地址里认出模型名，跳过台词库：' + Store.cfg.modelUrl);
        return;
      }
      try {
        const j = JSON.parse(await fetchTextCached(L2D_DATA_BASE + gid + '.json'));
        const skins = (j.ship && j.ship.skins) || [];
        // 三级匹配（v1.25）：先精确，再宽松（忽略大小写/符号），最后按 model.path 的目录名。
        // 实测 prefab 一般是准的，但不同皮肤的命名风格（大小写、下划线、后缀）并不统一，
        // 多兜两层能避免"明明数据里有、就是匹配不上"。
        let skin = skins.find((x) => x.prefab === prefab);
        if (!skin) skin = skins.find((x) => normPrefab(x.prefab) === normPrefab(prefab));
        if (!skin) {
          skin = skins.find((x) => {
            const p = (x.model && x.model.path) || '';
            const m = p.match(/live2d\/([^/]+)\//i);
            return m && normPrefab(m[1]) === normPrefab(prefab);
          });
        }
        this.voices = (skin && skin.words) || [];
        this._l2dTouch = (skin && skin.model && skin.model.live2dTouch) || null;
        const zr = (this._l2dTouch && this._l2dTouch.rules) || [];
        if (skin) {
          log('游戏数据：台词 ' + this.voices.length + ' 条，触摸区规则 ' + zr.length + ' 条（' + skin.name + '）');
        } else {
          // 没匹配上时把线索都打出来，方便一眼看出是"ID 不对"还是"模型名对不上"
          log('游戏数据：没匹配到本模型 —— 船只 ' + (j.ship && j.ship.id) + '，' +
              '要找的模型名「' + prefab + '」，该船下的皮肤：' +
              skins.map((x) => x.prefab).join(' / '));
        }
      } catch (e) {
        log('游戏数据加载失败：' + (e && e.message ? e.message : e));
      }
      UI.renderVoices();
    },

    /** 播一条台词；开了 voiceMotion 就顺带播它绑定的动作 */
    playVoice(word, opts) {
      if (!word) return false;
      const url = voiceUrlOf(word);
      if (!url) return false;
      this.stopVoice();
      try {
        const a = new Audio(url);
        a.crossOrigin = 'anonymous';
        this._audio = a;
        a.addEventListener('ended', () => { if (this._audio === a) this._audio = null; });
        a.addEventListener('error', () => { if (this._audio === a) this._audio = null; });
        const p = a.play();
        if (p && p.catch) p.catch((e) => log('台词播放被拦（先在页面上点一下即可）：' + (e && e.name)));
      } catch (e) { log('台词播放失败：' + (e && e.message)); }

      if (!opts || opts.motion !== false) {
        if (Store.cfg.voiceMotion && word.l2dAction && this.motionGroups[String(word.l2dAction)]) {
          this.playMotion(String(word.l2dAction));
        }
      }
      UI.highlightVoice(word.key);
      return true;
    },

    stopVoice() {
      if (this._audio) { try { this._audio.pause(); } catch (e) {} this._audio = null; }
    },

    playVoiceByKey(key) {
      return this.playVoice((this.voices || []).find((x) => x.key === key));
    },

    /** 悬浮栏的「语音」按钮：逐条往下念 */
    playNextVoice() {
      const list = this.voices || [];
      if (!list.length) { UI.setStatus('这个模型没有台词库'); return; }
      this.voiceIndex = (this.voiceIndex + 1) % list.length;
      this.playVoice(list[this.voiceIndex]);
    },

    /**
     * 客户端坐标 -> 「本地像素」空间（= 库的 getDrawableVertices 那个空间）。
     * 直接用库自己的 toModelPosition()：它内部做 worldTransform 逆变换 + localTransform
     * 逆变换。**不要自己拼 pixelsPerUnit** —— 一旦模型带旋转/斜切/自定义 layout 就会错。
     */


    /**
     * 取某个 drawable 的顶点，换算到**模型容器的局部坐标**（PIXI 坐标系）。
     *   模型单位 --(×pixelsPerUnit + 画布/2)--> 本地像素 --(localTransform)--> 容器局部
     * 这两步就是库渲染时走的那条链，所以画出来必定和模型严丝合缝。
     * 返回 { pts: [x0,y0,x1,y1,...], ind } —— pts 可以直接喂给 PIXI 的 drawPolygon。
     */






    /**
     * 找出指针落在哪个「触摸部件」上。
     * 碧蓝航线的原版分区互动就是在模型里埋了几个**隐形 ArtMesh**：
     *   TouchHead / TouchBody / TouchSpecial —— 点击用
     *   TouchDrag1 / TouchDrag2             —— 拖拽用（对应 live2dTouch 规则）
     * 这些部件不在 model3.json 的 HitAreas 里，所以 hitTest() 一直是空的。
     */


    /**
     * 返回命中的 Touch* 部件名。
     *
     * 实测（高雄 767 部件 / 79 个触摸件）：TouchIdle* 有几十个，而且**包围盒大量完全重合**
     * （同一位置的多状态变体）。所以不能"取第一个命中"，要：
     *   ① 优先明确的三个分区 TouchHead / TouchBody / TouchSpecial
     *   ② 其余情况取**包围盒最小**的那个（最具体）
     */


    /**
     * 点是否落在某个部件的多边形内（逐三角形同号判定，坐标是**模型容器局部坐标**）。
     * `tol` 是额外的容差（局部像素）：触摸部件很小而且**会跟着动作移动**
     * （实测大凤的 TouchDrag1 只有 37×67 屏幕像素），严格多边形命中经常抓空。
     */



    /** 把所有触摸区参数还原到规则里的起始值 */
    resetZoneValues() {
      if (this.official && this.official.ready) {
        // 官方模式（v1.21.1 接通）：走官方的状态清理链。
        //   resetLive2DOfficialTouchState() 清触摸互动状态与规则参数（推回起点）；
        //   之后再重播当前待机，让官方把本 IDLE 该就位的触摸区重新驱动到位 ——
        //   只 reset 不重播的话，参数停在起点、本该移入画面的区会停在原地。
        const v = this.official.viewer;
        let n = 0;
        try { if (v.cancelLive2DTouchInteraction) { v.cancelLive2DTouchInteraction(); n++; } } catch (e) {}
        try { if (v.clearLive2DTouchRevertTimers) { v.clearLive2DTouchRevertTimers(); n++; } } catch (e) {}
        try { if (v.resetLive2DOfficialTouchState) { v.resetLive2DOfficialTouchState(); n++; } } catch (e) {}
        try {
          if (v.playLive2DIdleMotion) v.playLive2DIdleMotion(v.live2dOfficialIdleIndex || 0);
        } catch (e) {}
        UI.setStatus(n ? '触摸区已还原（官方状态链 ' + n + ' 步 + 重播待机）' : '官方引擎未就绪，无法还原');
        setTimeout(() => UI.setStatus(''), 1600);
        return;
      }
    },



    /**
     * 每帧重建几何 —— 钩在 internalModel.update 上。
     * 库是在 _render() 里先跑 internalModel.update()（动作/物理算完，顶点才有新位置），
     * 再渲染子节点。所以在这个钩子里重画，拿到的就是**本帧**的姿势；
     * 之前用独立 2D 画布 + 自己算坐标，一旦模型变换变了就会对不上号。
     */






    /**
     * 点击模型。**只认触摸区** —— 点在触摸区之外不做任何事。
     *
     * 这里曾经有两级兜底（按 Y 轴切三段、再不行播随机待机），结果就是
     * 「点空白处也会触发互动」。现在删掉了：
     *   ① 优先用游戏数据里的规则（l2d.su 的做法）：命中规则的网格 → 设参数目标 + 播它的动作
     *   ② 规则没覆盖到的模型，才退回模型里那三个通用触摸部件（TouchHead/Body/Special）
     *   ③ 都没命中 → 什么都不做
     */




    playMotion(group, priority) {
      if (!group) return false;
      if (this.official && this.official.ready) {
        this.lastUserMotionAt = Date.now();
        // 标记「这是我们主动播的」：官方动作回调里据此跳过语音，避免面板点动作时叠一层台词。
        // 官方回调是异步来的，所以用一个短窗口而不是立即复位。
        this._selfMotion = true;
        clearTimeout(this._selfMotionTimer);
        this._selfMotionTimer = setTimeout(() => { this._selfMotion = false; }, 800);
        const v = this.official.viewer;
        // ⚠️ 这里**不要**清理触摸互动状态（v1.23 修正 v1.21.1 的错误）：
        //   官方反混淆后的实现是：
        //     cancelLive2DTouchInteraction() = this.live2DTouchInteraction = null;   // 只清引用，
        //        跳过了 finishLive2DPressedRules() 的收尾 → 按下的规则状态残留
        //     clearLive2DTouchRevertTimers() = 清掉所有 revert 定时器 —— 而那正是
        //        「延迟 + 平滑回弹」的执行者（scheduleLive2DTouchRevert 用
        //        rule.revertSmooth ?? rule.smooth 做缓动）。
        //   清掉它的后果 = 参数停在中途不回位、触摸区「没有线性移动到正确位置」，
        //   严重时相关触摸部件不可见（用户看到的「触摸区全消失」）。
        //   切场景时官方自己会 resetLive2DRulesForIdle（带平滑）把参数带回起点，
        //   我们什么都不做才是最贴近 l2d.su 的行为。
        // 待机组必须走官方的「切 IDLE」序列，不能直接 playMotionGroup：
        //   playLive2DIdleMotion(n) = live2DIdleMotionName(n) → playMotionGroup('idleN')
        //   并且官方在切 IDLE 时会 resetLive2DRulesForIdle()：把不属于新 IDLE 的
        //   触摸区参数推回起点（=「互动区域先移到画面外」），新 IDLE 该露出来的
        //   再移回画面内。实测 sig 皮肤 idx=0 时 TouchIdle2/3/4/5/8/17/19/26/32
        //   全部由可见变 invisible，TouchIdle34/38 大幅横移 —— 正是 l2d.su 的行为。
        const idle = /^idle([0-9]*)$/i.exec(group);
        if (idle && typeof v.playLive2DIdleMotion === 'function') {
          const idx = group.toLowerCase() === 'idle' ? 0 : parseInt(idle[1], 10);
          try { v.playLive2DIdleMotion(idx); return true; } catch (e) { /* 落到通用分支 */ }
        }
        try { v.playMotionGroup(group); return true; } catch (e) { return false; }
      }
      return false;
    },







    /**
     * 按「默认参数状态」捕获触摸区几何与可见性（等价官方 modelRuntime 的 captureDefaults）。
     * 之后命中测试与覆盖层都用这份静态几何 —— 任何待机/动作状态下都能点到同样的位置。
     */




    applyConfig() {
      applyCanvasEffects();
      applySoundSetting();
      this.applyOfficialSettings();
      this.layout();
    },

    destroy() {
      if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; }
      if (this._followDrive) { try { window.removeEventListener('mousemove', this._followDrive); } catch (e) {} this._followDrive = null; }
      this.restoreOriginal();
      // 官方引擎的东西挂在 viewer 上（不是 this.app）。切引擎时如果只销毁 PIXI app，
      // viewer 自己的 resizeObserver / 动作回调还活着，会继续访问已销毁的 model，
      // 抛出一连串 "Cannot read properties of null/undefined" 的异步异常。
      if (this.official && this.official.viewer) {
        const v = this.official.viewer;
        try { if (typeof v.releaseCurrentLive2dResources === 'function') v.releaseCurrentLive2dResources(); } catch (e) {}
        try { if (v.resizeObserver && typeof v.resizeObserver.disconnect === 'function') v.resizeObserver.disconnect(); } catch (e) {}
        try { if (typeof v.destroy === 'function') v.destroy(); } catch (e) {}
        try { if (v.app && typeof v.app.destroy === 'function') v.app.destroy(false, { children: true }); } catch (e) {}
      }
      if (this.model) { try { this.model.destroy({ children: true }); } catch (e) {} }
      if (this.app) { try { this.app.destroy(false, { children: true }); } catch (e) {} }
      this.removeOfficialBridge();
      // canvas 也要摘：只销毁 app 的话元素还在，销毁后的 WebGL 画布可能留着最后一帧
      // 叠在还原出来的壁纸上面（登出回到登录页就是这个表现）
      if (this.canvas && this.canvas.parentNode) { try { this.canvas.parentNode.removeChild(this.canvas); } catch (e) {} }
      if (this._onMouseMove) { window.removeEventListener('mousemove', this._onMouseMove); this._onMouseMove = null; }
      this.model = null;
      this.app = null;
      this.canvas = null;
      this.container = null;
      this.target = null;
      this.originalImg = null;
      // 必须清掉：残留的 official 会让「运行时是否就绪」的判定永远为真，
      // 重新挂载时会跳过初始化（v1.22 只有官方运行时，没有引擎切换了）
      this.official = null;
      this._officialBoot = null;
      this.motionGroups = {};
      this.stopVoice();
      this.voices = [];
      this.voiceIndex = -1;
      this._l2dTouch = null;
      this._idleMotionIndex = 0;
    },
  };

  // 把排查入口挂到 window.fnosLive2D 上（控制台里可直接查看引擎/配置/官方 viewer）
  try {
    window.fnosLive2D.store = Store;
    window.fnosLive2D.engine = Engine;
    window.fnosLive2D.dump = function () {
      const v = Engine.official && Engine.official.viewer;
      return {
        运行时: 'l2d.su 官方（v1.22 起唯一）',
        模型: Store.cfg.modelLabel || Store.cfg.modelUrl,
        缩放: Store.cfg.zoom, 水平: Store.cfg.posX, 垂直: Store.cfg.posY,
        配置: JSON.parse(JSON.stringify(Store.cfg)),
        官方基准: Engine._offBase,
        命中区数: v && v.live2dHitAreas ? v.live2dHitAreas.length : 0,
        待机索引: v && v.live2dOfficialIdleIndex,
      };
    };
  } catch (e) {}

  /**
   * 画布外观（v1.24：模型投影已移除）。
   *
   * 原来这里给 canvas 加 drop-shadow 做「模型投影」，实际观感很差：
   * 投影是加在**整块画布**上的（等于给整屏蒙一层阴影），而不是贴着模型轮廓，
   * 用户反馈「没什么用」，所以直接去掉，并把残留的 filter 清干净。
   */
  function applyCanvasEffects() {
    if (!Engine.canvas) return;
    try { Engine.canvas.style.filter = 'none'; } catch (e) {}
  }

  /**
   * 动作音效开关。
   *
   * pixi-live2d-display 的音频开关是**全局**的 `PIXI.live2d.config.sound`，
   * 而且它源码里的默认值就是 `true` —— 所以要「默认关」必须显式设成 false，
   * 否则一旦模型带音频，播放动作时会自己响。
   *
   * 注意：只有模型自带音频才会出声（model3.json 的 `Motions[].Sound` 或 `Sounds` 目录）。
   * 从游戏里抽出来的模型（碧蓝航线这类）绝大多数是**没有**的 —— 开关打开也没声音，
   * 这不是脚本坏了。
   */
  function applySoundSetting() {
    try {
      const l2d = window.PIXI && window.PIXI.live2d;
      if (l2d && l2d.config) l2d.config.sound = Store.cfg.sound === true;
    } catch (e) { /* ignore */ }
  }

  /* ============================================================ *
   * 台词库 & 分区互动
   *
   * ⚠️ 两者都来自 l2d.su 的「游戏数据」，**不在 model3.json 里** —— 这点很容易搞错：
   *    · model3.json 的 `Motions[].Sound` 才叫「动作音效」，碧蓝这批模型**全都是空的**；
   *    · 真正会响的是**台词语音**，它挂在游戏数据上（大凤有 27 条）。
   *
   * 台词
   *   https://l2d.su/data/ships/<CN|EN|JP|KR|TW>/<shipGroupId>.json
   *     -> ship.skins[] 里挑 prefab === 模型名 的那一项 -> .words[]
   *     -> 每条 { key, voiceName, resourceKey, voicePath, l2dAction, faceId, text }
   *   -> 音频 https://static.l2d.su/azurlane/<voicePath>.ogg     （CORS: *）
   *   皮肤 ID 与船 ID 的关系：307074 -> 30707，即 shipGroupId = floor(skinId / 10)
   *
   * 分区互动
   *   model.live2dTouch.rules[] -> { drawAbleName, parameter, dragDirect, offsetX, offsetY, smooth, range }
   *   即「在某个 ArtMesh 上拖拽 -> 驱动某个 Cubism 参数」。碧蓝航线原版的触摸区就是这个机制，
   *   **不是**「点不同区域播不同动作」。
   * ============================================================ */
  const L2D_DATA_BASE = 'https://l2d.su/data/ships/CN/';
  const L2D_VOICE_BASE = 'https://static.l2d.su/azurlane/';

  /** 从模型地址取模型名（= l2d.su 的 prefab）：…/live2d/dafeng_3/dafeng_3.model3.json -> dafeng_3 */
  function prefabOfUrl(url) {
    const s = String(url || '');
    const m = s.match(/\/([^/]+)\/\1\.model3\.json/i) || s.match(/\/([^/]+)\.model3\.json/i);
    return m ? m[1] : '';
  }

  const normPrefab = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]/g, '');

  /** 皮肤 ID -> 船 ID：307074 -> 30707 */
  function shipGroupIdOf(skinId) {
    const n = parseInt(skinId, 10);
    return Number.isFinite(n) && n > 0 ? Math.floor(n / 10) : 0;
  }

  /** 从用户输入里抠出皮肤 ID：`307074` / `https://l2d.su/cn/skins/307074/` */
  function skinIdOfInput(input) {
    const m = String(input || '').match(/skins\/(\d{5,8})|^(\d{5,8})$/);
    if (!m) return 0;
    return parseInt(m[1] || m[2], 10) || 0;
  }

  /** 台词音频地址 */
  function voiceUrlOf(word) {
    if (!word || !word.voicePath) return '';
    return L2D_VOICE_BASE + String(word.voicePath).replace(/^\/+/, '') + '.ogg';
  }

  /* ============================================================ *
   * 5. 壁纸容器的定位与接管
   * ============================================================ */

  /* ------------------------------------------------------------ *
   * 找到「壁纸层」并接管它
   *
   * 飞牛的登录页和桌面（登录之后）用的**不是同一套节点**，这点从它的前端源码
   * 里确认过（/assets/index-*.js 的壁纸渲染组件）：
   *
   *   登录页 ：<div class="semi-image"><img src="/static/bg/wallpaper-1.webp"></div>
   *   桌面   ：<div class="absolute inset-0 z-0 object-contain"> 里面再套图片组件
   *
   * 而且桌面的壁纸有三种来源（desktopConfig.userPreference.wallpaperType）：
   *   100 单张图片  -> 一个 <img>
   *   500 动态壁纸  -> 两张 <img> 按明暗主题交叉淡入
   *   300 纯色      -> **根本没有 <img>**，只有一个背景色 div
   * 用户还能自己上传壁纸，那时 src 未必以 /static/bg/ 开头。
   *
   * 所以这里**不能只按 URL 关键字找**，改成按「谁真的铺满了屏幕」来判定。
   * 注意飞牛桌面上的图标也是 <img>（deskdata/img/i.png，20×20），
   * 只按关键字匹配会把图标当成壁纸 —— 这是之前桌面上找不到/找错目标的原因。
   * ------------------------------------------------------------ */

  /** 元素的可视区域是否达到视口的某个比例 */
  function coversViewport(elm, ratio) {
    if (!elm || !elm.getBoundingClientRect) return false;
    const r = elm.getBoundingClientRect();
    const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
    return r.width >= vw * ratio && r.height >= vh * ratio;
  }

  /** 取元素 computed style 里的背景图 URL（排除渐变和 data URI） */
  function bgUrlOf(elm) {
    try {
      const bi = getComputedStyle(elm).backgroundImage || '';
      if (!bi || bi === 'none' || /gradient/i.test(bi)) return '';
      const m = bi.match(/url\((['"]?)([^'")]+)\1\)/i);
      if (!m) return '';
      const u = m[2];
      if (u.startsWith('data:')) return '';
      return u;
    } catch (e) { return ''; }
  }

  /** 从某节点往上找「最内层的整屏祖先」，作为 canvas 的宿主 */
  function pickContainer(from) {
    let node = from;
    while (node && node !== document.body && node !== document.documentElement) {
      if (coversViewport(node, 0.95)) return node;
      node = node.parentElement;
    }
    return from || null;
  }

  /* ------------------------------------------------------------------ *
   * 飞牛桌面壁纸的权威来源：localStorage 里的 `DesktopConfig-<uid>`
   *
   * 前端源码（/assets/index-*.js）里就是这么写的：
   *   R9 = () => `DesktopConfig-${uid}`
   *   userPreference: { wallpaperType, singlePhotoWpId, singleColorWpId,
   *                     dynamicWpId, fillModeType, bgFillColorCode }
   *   wallpaperType: 100=单张图片 / 300=纯色 / 500=动态壁纸（两张，明暗主题切换）
   *   fillModeType:  0=Cover(object-cover) / 1=Fill / 2=Contain
   *
   * 注意壁纸地址会带 CDN 前缀，不能按 `/static/bg/` 这种子串去猜：
   *   L9 = 走 CDN ? 'https://static2.<domain>/os-web/v1' : ''
   *   最终 src = L9 + '/static/bg/wallpaper-1.webp'
   * 所以这里一律按「路径尾部」比较。
   * ------------------------------------------------------------------ */
  /**
   * 当前是不是飞牛的「登录页」。
   *
   * 必须单独判 —— 登录页和桌面**共用同一套壁纸节点**（都是 div.semi-image > img），
   * 而且 DesktopConfig-<uid> 挂在同一个 origin 的 localStorage 上，登录页照样读得到。
   * 所以原来的识别逻辑两边都会命中。挂上之后，命中层在「整个壁纸」模式下是铺满视口的，
   * 被登录卡片挡住时又会自动置顶到 body —— 整块盖住登录表单，人就登不进去了。
   */
  function isLoginPage() {
    try {
      // ① 有可见的密码框（最可靠的信号）
      const pws = document.querySelectorAll('input[type="password"]');
      for (let i = 0; i < pws.length; i++) {
        const r = pws[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
      // ② 路径里带 login
      if (/\/login\b/i.test(location.pathname)) return true;
      // ③ 兜底：没有任何「桌面证据」，却出现了表单类元素
      //    （桌面有 [data-desktop-item-id] / .desktop；两者都没有时才敢这么判，
      //      这样桌面初始渲染慢也不会被误伤）
      if (!document.querySelector('[data-desktop-item-id], .desktop, .desktop-root')) {
        if (document.querySelector('form, input:not([type="hidden"]), textarea')) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /** 当前是否该「完全不接管壁纸」（登录页 + 用户没开启） */
  function loginBlocked() {
    return !Store.cfg.loginPage && isLoginPage();
  }

  function desktopWallpaperUrls() {
    const urls = [];
    const pick = (list, id) => (list || []).find((x) => x && x.id === id);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('DesktopConfig-') !== 0) continue;
        let cfg;
        try { cfg = JSON.parse(localStorage.getItem(k) || ''); } catch (e) { continue; }
        const p = cfg && cfg.userPreference;
        if (!p) continue;
        if (p.wallpaperType === 100) {
          const w = pick(cfg.singlePhotoWallpapers, p.singlePhotoWpId);
          if (w) urls.push(w.url, w.thumbnailUrl);
        } else if (p.wallpaperType === 500) {
          const w = pick(cfg.dynamicWallpapers, p.dynamicWpId);
          if (w) urls.push(w.dynamicUrl1, w.dynamicUrl2, w.thumbnailDynamicUrl1, w.thumbnailDynamicUrl2);
        }
      }
    } catch (e) { /* localStorage 被禁用等，忽略 */ }
    return urls.filter(Boolean);
  }

  /** 归一化成「根路径」，兼容 CDN 前缀 / 协议与主机名 / ./ 前缀 / 查询串 */
  function pathTail(u) {
    const s = String(u).split('?')[0].split('#')[0]
      .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '')   // 去「协议://主机」
      .replace(/^\.\//, '')                            // 去「./」
      .replace(/^\/+/, '');
    return '/' + s;
  }
  function matchesAnyUrl(src, urls) {
    if (!src) return false;
    const s = pathTail(src);
    if (!s) return false;
    for (const u of urls) {
      const t = pathTail(u);
      if (t && (s === t || s.endsWith(t) || t.endsWith(s))) return true;
    }
    return false;
  }

  function findWallpaperTarget() {
    // ---- ⓿ 权威来源：桌面配置里写死了壁纸地址，直接精确命中 ----
    const cfgUrls = desktopWallpaperUrls();
    if (cfgUrls.length) {
      const hits = [];
      for (const img of document.querySelectorAll('img')) {
        if (img.closest && img.closest('.fnos-l2d-host')) continue;
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (!matchesAnyUrl(src, cfgUrls)) continue;
        const r = img.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const area = r.width * r.height;
        hits.push({ el: img, src: src, area: area, big: area >= innerWidth * innerHeight * 0.15 });
      }
      if (hits.length) {
        hits.sort((a, b) => b.area - a.area);
        const best = hits[0];
        const container = pickContainer(best.el.parentElement) || best.el.parentElement;
        // 只接管「大图」（懒加载占位图 / 动态壁纸的第二张）。
        // 小图不碰 —— 桌面图标有可能恰好用了同一张图，藏掉就出事了。
        const covers = hits.filter((h) => h.big).map((h) => h.el);
        if (covers.indexOf(best.el) < 0) covers.push(best.el);
        if (container) {
          for (const img of container.querySelectorAll('img')) {
            if (covers.indexOf(img) >= 0) continue;
            if (coversViewport(img, 0.55)) covers.push(img);
          }
        }
        log('壁纸层 = 命中桌面配置 <img>（' + hits.length + ' 张），主图 src=' + best.src);
        return { el: best.el, container: container, kind: 'img', src: best.src, covers: covers };
      }
      log('桌面配置里有 ' + cfgUrls.length + ' 个壁纸地址，但页面暂无匹配的 <img>（可能是纯色壁纸，或还没渲染完）');
    }

    // ---- ① 整屏的 <img>：登录页 + 桌面的「图片壁纸」都是这种 ----
    const imgCands = [];
    for (const img of document.querySelectorAll('img')) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!src || src.startsWith('data:')) continue;
      if (img.closest && img.closest('.fnos-l2d-host')) continue;   // 别把自己的东西算进来
      if (!coversViewport(img, 0.6)) continue;                      // 这一条把 20×20 的桌面图标滤掉
      const hint = (/\/static\/bg\//i.test(src) || /wallpaper/i.test(src)) ? 2 : 1;
      const r = img.getBoundingClientRect();
      imgCands.push({ el: img, kind: 'img', src: src, hint: hint, area: r.width * r.height });
    }
    if (imgCands.length) {
      imgCands.sort((a, b) => (b.hint - a.hint) || (b.area - a.area));
      const best = imgCands[0];
      const container = pickContainer(best.el.parentElement) || best.el.parentElement;

      // 同一容器里可能还有别的整屏图：动态壁纸有两张，懒加载组件还会留一张占位图。
      // 只藏一张会露出另一张，所以一并接管。
      const covers = [best.el];
      if (container) {
        for (const img of container.querySelectorAll('img')) {
          if (img === best.el) continue;
          if (coversViewport(img, 0.9)) covers.push(img);
        }
      }
      log('壁纸层 = <img>（整屏候选 ' + imgCands.length + ' 个），选中 src=' + best.src +
        (covers.length > 1 ? '；同容器另有 ' + (covers.length - 1) + ' 张整屏图一并接管' : ''));
      return { el: best.el, container: container, kind: 'img', src: best.src, covers: covers };
    }

    // ---- ② 整屏元素的 CSS background-image（兜底） ----
    let bg = null;
    for (const elm of document.querySelectorAll('body *')) {
      if (elm.closest && elm.closest('.fnos-l2d-host')) continue;
      if (!coversViewport(elm, 0.98)) continue;
      const u = bgUrlOf(elm);
      if (u) bg = { el: elm, container: elm, kind: 'bg', src: u, covers: [elm] }; // 取最内层那个
    }
    if (bg) { log('壁纸层 = CSS 背景图 ' + bg.src); return bg; }

    // ---- ③ 整屏纯色层：飞牛的「纯色壁纸」就是这种，压根没有 <img> ----
    let solid = null;
    for (const elm of document.querySelectorAll('body *')) {
      if (elm.closest && elm.closest('.fnos-l2d-host')) continue;
      if (!coversViewport(elm, 0.98)) continue;
      const bc = elm.style && elm.style.backgroundColor;
      if (bc && bc !== 'transparent' && bc !== 'rgba(0, 0, 0, 0)') {
        solid = { el: elm, container: elm, kind: 'solid', src: bc, covers: [] };
      }
    }
    if (solid) { log('壁纸层 = 纯色 ' + solid.src); return solid; }

    return null;
  }

  // 兼容旧调用名（diag 里在用）
  function findWallpaperImg() {
    const t = findWallpaperTarget();
    return t ? t.el : null;
  }

  function tryMount() {
    // 幂等守卫：app 已建好 → 已挂载；官方 boot 进行中（SuStack.load 要好几秒，
    // 期间 this.app 还是 null）→ 也视为已挂载。否则飞牛 React 重建容器时
    // 会并发跑两个 initOfficial → 模型资源请求两遍、第一遍 ERR_ABORTED。
    if (Engine.app || Engine._officialBoot) return true;
    if (loginBlocked()) return false;   // 登录页不接管（详见 isLoginPage 的注释）
    const target = findWallpaperTarget();
    if (!target) return false;
    const container = target.container;
    if (!container || container.__fnosL2DMounted) return false;

    container.__fnosL2DMounted = true;
    log('找到壁纸层，开始挂载 Live2D', container);
    Engine.initRenderer(container, target);
    Engine.load(Store.cfg.modelUrl, Store.cfg.modelLabel);

    // ── 挂载图层后再移除飞牛原生壁纸层：先让 Live2D 就位，再撤掉旧壁纸，
    //    避免挂载瞬间出现「无壁纸」空档，体验更顺 ──
    //  ⚠️ 安全保护：如果这两个 id 恰好就是「我们挂载 canvas 的容器」或其祖先，
    //     直接 removeChild 会把刚挂上去的 canvas 一起删掉 → Live2D 直接消失。
    //     这种情况一律跳过（原生 <img> 已由 hideOriginal 隐藏，不会露馅）。
    ['fndesk-bg-layer', 'fndesk_wallpaper'].forEach((id) => {
      const node = document.getElementById(id);
      if (!node || !node.parentNode) return;
      if (node === container || (container && node.contains(container))) {
        log('跳过移除 #' + id + '（它是挂载容器或其祖先，移除会带走 canvas）');
        return;
      }
      node.parentNode.removeChild(node);
      log('挂载后已移除原生壁纸元素 #' + id);
    });
    return true;
  }

  /** 飞牛是 React SPA，登录页/桌面会反复重建 DOM，这里做节流 + 自愈 */
  function watchWallpaper() {
    let scheduled = false;
    let missTicks = 0;
    let reported = false;

    const run = () => {
      // 登录页：完全不接管，也把已经挂上的拆掉（退出登录回到登录页就是这条路径）。
      // 放在最前面，顺带避免一直刷「未找到壁纸」的提示。
      if (loginBlocked()) {
        if (Engine.app) {
          log('当前是登录页，撤下 Live2D 并还原原壁纸');
          if (Engine.container) Engine.container.__fnosL2DMounted = false;
          Engine.destroy();
        }
        missTicks = 0;
        reported = false;
        return;
      }

      // 尚未挂载 -> 继续等待壁纸出现
      if (!Engine.app) {
        if (tryMount()) return;
        // 连续找不到目标节点时，明确报出来，避免「脚本好像死了」的错觉
        if (++missTicks === 12 && !reported) {
          reported = true;
          const imgs = Array.from(document.querySelectorAll('img'))
            .map((i) => (i.getAttribute('src') || i.getAttribute('data-src') || '').split('/').slice(-2).join('/'))
            .filter(Boolean).slice(0, 12);
          log('还没有找到壁纸 <img>（已等待约 4 秒）。当前页面上的图片：',
            imgs.length ? imgs.join(' | ') : '（一个都没有）');
          log('如果壁纸是 CSS background-image 而不是 <img>，本脚本无法接管，请把节点结构发我适配。');
          bootHint('Live2D：未找到壁纸节点\n' +
            '页面上没有 img[src*="/static/bg/"]，可能是 CSS 背景图。\n' +
            '按 Alt+L 可打开面板，或看控制台的 [Live2D] 日志。');
        }
        return;
      }

      // 已挂载：确保原壁纸始终被隐藏
      Engine.reassertHidden();


      // 容器被 React 重建导致 canvas 掉出文档 -> 重新挂载
      if (Engine.canvas && !Engine.canvas.isConnected) {
        if ((Engine.remountCount = (Engine.remountCount || 0) + 1) > 6) return;
        log('壁纸容器被重建，重新挂载（第 ' + Engine.remountCount + ' 次）');
        if (Engine.container) Engine.container.__fnosL2DMounted = false;
        Engine.destroy();
        tryMount();
      }
    };
    const tick = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; run(); }, 350);
    };

    tick();
    const mo = new MutationObserver(tick);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    Engine.observer = mo;
  }

  /* ============================================================ *
   * 6. 控制面板（Shadow DOM 隔离，避免被飞牛全局样式污染）
   * ============================================================ */

  const UI = {
    root: null,
    shadow: null,
    fab: null,
    panel: null,
    statusEl: null,

    mount() {
      const host = el('div', 'fnos-l2d-host');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;pointer-events:none;';
      document.body.appendChild(host);
      this.root = host;
      this.shadow = host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = TEMPLATE;
      this.fab = this.shadow.querySelector('.fab');
      this.panel = this.shadow.querySelector('.panel');
      this.bar = this.shadow.querySelector('.bar');
      this.statusEl = this.shadow.querySelector('.status');

      this.buildBar();
      this.applyFabPosition();
      this.bindUI();
      this.syncSliders();
      this.syncSwitches();
      this.setModelName(Store.cfg.modelLabel || '');
      this.setOpen(!!Store.cfg.panelOpen);
      this.syncControls();
    },

    applyFabPosition() {
      const c = Store.cfg;
      this.fab.style.right = c.fabRight + 'px';
      this.fab.style.bottom = c.fabBottom + 'px';
      this.panel.style.right = c.fabRight + 'px';
      this.panel.style.bottom = (c.fabBottom + 54) + 'px';
      if (this.bar) {
        // v1.22：开启简易控制栏时悬浮球会隐藏，控制栏直接占它的位置（省一块空间）
        this.bar.style.right = c.fabRight + 'px';
        this.bar.style.bottom = c.fabBottom + 'px';
      }
    },

    bindUI() {
      const q = (s) => this.shadow.querySelector(s);
      const qa = (s) => Array.from(this.shadow.querySelectorAll(s));

      // 折叠小按钮：点击展开面板 / 按住可拖动位置
      // ⚠️ 拖动必须绑到 window（捕获阶段），不能只绑在按钮上：
      //   · 指针一旦离开按钮，按钮自身就收不到 pointermove —— 表现就是「拖出按钮就不跟随」；
      //   · 飞牛桌面上按钮常悬在 Live2D 图层/图标区上方，事件容易被引擎探针或画面层拿走的；
      //   · setPointerCapture 在多层 + shadow DOM + 全局捕获探针的环境里并不可靠，只作尽力而为，
      //     真正保证「跟随」的是下面挂在 window 上的监听。
      let dragging = false, moved = false, sx = 0, sy = 0, or = 0, ob = 0, pid = null;
      const onMove = (e) => {
        if (!dragging || (pid !== null && e.pointerId !== pid)) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        Store.cfg.fabRight = clamp(or - dx, 0, window.innerWidth - 48);
        Store.cfg.fabBottom = clamp(ob - dy, 0, window.innerHeight - 48);
        this.applyFabPosition();
        if (e.cancelable) e.preventDefault();
      };
      const endDrag = (e) => {
        if (!dragging || (pid !== null && e.pointerId !== pid)) return;
        dragging = false; pid = null;
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', endDrag, true);
        window.removeEventListener('pointercancel', endDrag, true);
        try { this.fab.releasePointerCapture(e.pointerId); } catch (err) {}
        if (moved) { Store.save(); return; }
        // 没移动 = 当成点击：展开 / 收起面板
        this.setOpen(!Store.cfg.panelOpen);
      };
      this.fab.addEventListener('pointerdown', (e) => {
        if (dragging) return;
        dragging = true; moved = false; pid = e.pointerId;
        sx = e.clientX; sy = e.clientY;
        or = Store.cfg.fabRight; ob = Store.cfg.fabBottom;
        try { this.fab.setPointerCapture(e.pointerId); } catch (err) {}
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', endDrag, true);
        window.addEventListener('pointercancel', endDrag, true);
        // 别让宿主 / 引擎探针把这次按下顺手拿走
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      });

      q('.collapse').addEventListener('click', () => this.setOpen(false));

      // 载入模型
      const doLoad = async () => {
        const input = q('.model-input');
        const btn = q('.btn-load');
        const val = input.value.trim();
        if (!val) return;
        btn.disabled = true;
        this.setStatus('正在解析…');
        this.hideError();
        try {
          const r = await Resolver.resolve(val);
          // 记下皮肤 ID —— 台词库要靠它定位（307074 -> 船 30707）
          const sid = skinIdOfInput(val) || skinIdOfInput(r.url);
          if (sid) Store.cfg.skinId = sid;
          this.setStatus('正在载入…');
          await Engine.load(r.url, r.label);
          input.value = '';
        } catch (err) {
          this.showError(err.message || String(err));
          this.setStatus('');
        } finally {
          btn.disabled = false;
        }
      };
      q('.btn-load').addEventListener('click', doLoad);
      q('.model-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLoad(); });

      // 滑杆
      const bindRange = (sel, key, fmt) => {
        const input = q(sel);
        const out = input.parentElement.querySelector('b');
        input.addEventListener('input', () => {
          Store.cfg[key] = parseFloat(input.value);
          out.textContent = fmt(Store.cfg[key]);
          Engine.layout();
        });
        input.addEventListener('change', () => Store.save());
      };
      bindRange('.r-zoom', 'zoom', (v) => v.toFixed(2) + '×');
      bindRange('.r-posx', 'posX', (v) => Math.round(v) + '%');
      bindRange('.r-posy', 'posY', (v) => Math.round(v) + '%');
      bindRange('.r-opacity', 'opacity', (v) => Math.round(v * 100) + '%');
      // 渲染倍率：官方模式下写 viewer.renderScaleMultiplier 才会重算画布分辨率
      const resRange = q('.r-res');
      if (resRange) {
        const resOut = resRange.parentElement.querySelector('b');
        resRange.addEventListener('input', () => {
          Store.cfg.resMul = parseFloat(resRange.value);
          resOut.textContent = (+Store.cfg.resMul).toFixed(2) + '×';
          Engine.applyRenderScale();
        });
        resRange.addEventListener('change', () => Store.save());
      }

      // 开关
      const bindSwitch = (sel, key, after) => {
        const input = q(sel);
        input.addEventListener('change', () => {
          Store.cfg[key] = input.checked;
          Store.save();
          if (after) after();
        });
      };
      bindSwitch('.s-mirror', 'mirror', () => Engine.layout());
      bindSwitch('.s-bar', 'bar', () => this.syncControls());
      bindSwitch('.s-loginpage', 'loginPage', () => {
        if (Store.cfg.loginPage) watchWallpaper();          // 打开：立刻尝试挂载
        else if (Engine.app && loginBlocked()) {            // 关掉：若正挂在登录页，撤下
          if (Engine.container) Engine.container.__fnosL2DMounted = false;
          Engine.destroy();
        }
      });
      bindSwitch('.s-follow', 'follow', () => Engine.applyOfficialSettings());
      bindSwitch('.s-fastload', 'fastLoad');
      bindSwitch('.s-entrylogin', 'entryLogin');
      bindSwitch('.s-breath', 'breath', () => Engine.applyOfficialSettings());
      bindSwitch('.s-blink', 'blink', () => Engine.applyOfficialSettings());
      bindSwitch('.s-idle', 'idle');
      bindSwitch('.s-gestures', 'gestures', () => Engine.applyOfficialSettings());
      // 「分区互动」在官方模式下 = 事件桥是否接管命中区（关掉则模型只做视线跟随，
      // 点哪儿都不拦截，桌面图标完全优先）；「显示触摸区域」= 官方命中区可视化
      bindSwitch('.s-zones', 'zones', () => Engine.applyOfficialSettings());
      bindSwitch('.s-zoneshow', 'zoneShow', () => Engine.applyOfficialSettings());
      bindSwitch('.s-sound', 'sound', () => { applySoundSetting(); if (!Store.cfg.sound) Engine.stopVoice(); });
      bindSwitch('.s-voicemotion', 'voiceMotion');

      // 快捷动画（对齐官方 UI 的 Quick animations）
      qa('[data-quick]').forEach((b) => {
        b.addEventListener('click', () => {
          const k = b.getAttribute('data-quick');
          const all = Object.keys(Engine.motionGroups || {});
          if (!all.length) { this.setStatus('这个模型没有动作数据'); return; }
          if (k === 'random') {
            // 排掉 idle 系（那属于「空闲自动动作」），剩下的里随便挑一个
            const pool = all.filter((g) => !/^idle\d*$/i.test(g));
            const list = pool.length ? pool : all;
            Engine.playAction(list[Math.floor(Math.random() * list.length)]);
            return;
          }
          if (all.indexOf(k) < 0) { this.setStatus('这个模型没有「' + k + '」动作'); return; }
          Engine.playAction(k);
        });
      });

      // 预设位置
      qa('[data-preset]').forEach((b) => {
        b.addEventListener('click', () => {
          const p = b.getAttribute('data-preset');
          if (p === 'center') { Store.cfg.posX = 50; Store.cfg.posY = 100; Store.cfg.zoom = 1; }
          if (p === 'right') { Store.cfg.posX = 78; Store.cfg.posY = 100; Store.cfg.zoom = 1; }
          if (p === 'left') { Store.cfg.posX = 22; Store.cfg.posY = 100; Store.cfg.zoom = 1; }
          if (p === 'fill') {
            const nw = Engine.nat.w, nh = Engine.nat.h;
            Store.cfg.zoom = clamp((Engine.size.h / nh) / Math.min(Engine.size.w / nw, Engine.size.h / nh), 0.05, 20);
            Store.cfg.posY = 100;
          }
          Store.save();
          Engine.layout();
          this.syncSliders();
        });
      });

      // 底部操作
      q('.btn-reset').addEventListener('click', () => {
        Store.reset();
        this.syncSliders();
        this.syncSwitches();
        Engine.applyConfig();
        Engine.load(Store.cfg.modelUrl, Store.cfg.modelLabel);
      });
      q('.btn-toggle-show').addEventListener('click', () => this.toggleModel());
      const remount = () => {
        if (Engine.canvas) {
          try { Engine.canvas.parentNode.removeChild(Engine.canvas); } catch (e) {}
          if (Engine.container) Engine.container.__fnosL2DMounted = false;
          Engine.destroy();   // destroy 里会把原壁纸还原、事件桥与命中层一并摘掉
        }
        this.setStatus('正在重新挂载…');
        setTimeout(() => {
          if (tryMount()) { this.setStatus(''); return; }
          if (loginBlocked()) {
            this.showError('当前是登录页 —— 按设置不接管壁纸。\n想在这里也显示的话，到「显示」区打开「登录页也显示」。');
            return;
          }
          this.showError('没有找到壁纸元素（可能当前不在桌面）');
        }, 100);
      };
      q('.btn-remount').addEventListener('click', remount);
      q('.btn-hide-fab').addEventListener('click', () => {
        // 控制栏模式下这个按钮叫「隐藏按钮」，语义就是「把右下角这坨收掉」——
        // 所以顺手关掉控制栏，否则悬浮球虽然藏了、控制栏还杵在那里。
        if (Store.cfg.bar !== false) Store.cfg.bar = false;
        Store.cfg.fabHidden = true; Store.save();
        this.setOpen(false);
        this.syncControls();
        this.syncSwitches();
      });

      // 快捷键 Alt+L 展开/收起，Alt+H 显示/隐藏模型
      window.addEventListener('keydown', (e) => {
        if (!e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === 'l') {
          Store.cfg.fabHidden = false; Store.save();
          this.syncControls();
          this.setOpen(!Store.cfg.panelOpen);
        } else if (k === 'h') {
          this.toggleModel();
        }
      });
    },

    toggleModel() {
      if (!Engine.canvas) return;
      // 切换后是否应当处于「隐藏」状态
      const willHide = Engine.canvas.style.display !== 'none';
      Engine.canvas.style.display = willHide ? 'none' : 'block';
      const b = this.shadow.querySelector('.btn-toggle-show');
      if (b) b.textContent = willHide ? '显示模型' : '隐藏模型';
      if (!willHide) Engine.layout();
    },

    setOpen(open) {
      Store.cfg.panelOpen = !!open;
      Store.save();
      this.panel.classList.toggle('open', !!open);
    },

    setStatus(txt) {
      if (!this.statusEl) return;
      this.statusEl.textContent = txt || '';
      this.statusEl.classList.toggle('show', !!txt);
    },

    showError(txt) {
      if (!this.statusEl) return;
      this.statusEl.textContent = txt;
      this.statusEl.classList.add('show', 'error');
    },
    hideError() {
      if (!this.statusEl) return;
      this.statusEl.classList.remove('error');
    },

    setModelName(name) {
      const n = this.shadow.querySelector('.model-name');
      if (n) n.textContent = name || '未知';
    },

    /* ---------- 台词列表 ---------- */
    renderVoices() {
      const box = this.shadow.querySelector('.voices');
      const cnt = this.shadow.querySelector('.voice-count');
      if (!box) return;
      const list = Engine.voices || [];
      if (cnt) cnt.textContent = list.length ? list.length + ' 条' : '';
      if (!list.length) {
        box.innerHTML = '<div class="empty">这个模型没有台词库。<br>用 <b>l2d.su 链接</b>或<b>皮肤 ID</b>（如 307074）指定模型即可。</div>';
        return;
      }
      box.innerHTML = '';
      list.forEach((w) => {
        const d = document.createElement('div');
        d.className = 'voice-line';
        d.setAttribute('data-voice-key', w.key || '');
        d.title = (w.voiceName || '') + (w.l2dAction ? '　动作：' + w.l2dAction : '') + (w.text ? '\n' + w.text : '');
        const n = document.createElement('span'); n.className = 'vn'; n.textContent = w.voiceName || w.key || '';
        const t = document.createElement('span'); t.className = 'vt'; t.textContent = w.text || '';
        d.appendChild(n); d.appendChild(t);
        d.addEventListener('click', () => {
          if (Store.cfg.sound === false) {
            Store.cfg.sound = true; Store.save();
            this.syncSwitches();
          }
          Engine.playVoice(w);
        });
        box.appendChild(d);
      });
    },

    highlightVoice(key) {
      const box = this.shadow.querySelector('.voices');
      if (!box) return;
      box.querySelectorAll('.voice-line').forEach((elm) => {
        elm.classList.toggle('playing', elm.getAttribute('data-voice-key') === key);
      });
    },

    /* ---------- 悬浮操作栏（对齐 l2d.su 的 model-floating-actions） ---------- */
    buildBar() {
      const bar = this.shadow.querySelector('.bar');
      if (!bar) return;
      const ICONS = {
        zones: '<path d="M12 2a7 7 0 0 1 7 7c0 3.9-7 13-7 13S5 12.9 5 9a7 7 0 0 1 7-7zm0 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>',
        voice: '<path d="M4 9v6h3l5 4V5L7 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM19 12a7 7 0 0 1-3 5.7v2.1A9 9 0 0 0 21 12a9 9 0 0 0-5-8.1v2.1A7 7 0 0 1 19 12z"/>',
        text: '<path d="M4 4h16v2H4V4zm0 5h16v2H4V9zm0 5h10v2H4v-2zm0 5h7v2H4v-2z"/>',
        drag: '<path d="M11 2h2v6h3l-4 4-4-4h3V2zM2 11h6v3l4-4 4 4h-3v2h-2v6h-2v-6H6l4-4-4-4h3V2H2v9zm20 0v2h-6v3l-4-4 4-4v3h6z"/>',
        wheel: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 0 1 7 7h-2.2A4.8 4.8 0 0 0 12 7.2V5zm0 14a7 7 0 0 1-7-7h2.2A4.8 4.8 0 0 0 12 16.8V19zm0-4.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>',
        target: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>',
        restore: '<path d="M12 3a9 9 0 1 0 8.5 12h-2.2A6.8 6.8 0 1 1 12 5.2c1.9 0 3.6.8 4.8 2H14v2h6V3h-2v2.3A9 9 0 0 0 12 3z"/>',
        eye: '<path d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 2c-3.6 0-6.7 3-7.7 5C5.3 14 8.4 17 12 17s6.7-3 7.7-5C18.7 10 15.6 7 12 7zm0 1.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"/>',
        reset: '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
        settings: '<path d="M12 3c3.9 0 7 2.8 7 6.3 0 1.1-.3 2.1-.8 3 .6.5 1.1 1 1.4 1.7.5 1 .3 1.9-.5 2.5-.6.4-1.3.4-2 .1-.6-.2-1.2-.7-1.7-1.3-.4-.4-1-.5-1.5-.3-1.1.6-2.3 1-3.6 1s-2.5-.4-3.6-1c-.5-.3-1.1-.1-1.5.3-.5.6-1.1 1.1-1.7 1.3-.7.3-1.4.3-2-.1-.8-.6-1-1.5-.5-2.5.3-.7.8-1.2 1.4-1.7-.5-.9-.8-1.9-.8-3C5 5.8 8.1 3 12 3zm-2.6 5.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm5.2 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"/>',
      };
      const BTNS = [
        { k: 'zones', t: '分区互动：开 / 关', icon: 'zones' },
        { k: 'zoneshow', t: '显示触摸区域（把看不见的触摸部件画出来）', icon: 'target' },
        { k: 'zoneReset', t: '还原触摸区参数', icon: 'restore' },
        { k: 'sep' },
        { k: 'sound', t: '声音：开 / 关', icon: 'voice' },
        { k: 'next', t: '念下一句台词', icon: 'text' },
        { k: 'sep' },
        { k: 'gestures', t: '拖动与缩放：开 / 关', icon: 'drag' },
        { k: 'hide', t: '显示 / 隐藏模型', icon: 'eye' },
        { k: 'reset', t: '还原位置与缩放', icon: 'reset' },
        { k: 'settings', t: 'Live2D 壁纸设置 (Alt+L)', icon: 'settings' },
      ];
      bar.innerHTML = '';
      BTNS.forEach((b) => {
        if (b.k === 'sep') {
          const sp = document.createElement('div'); sp.className = 'sep'; bar.appendChild(sp); return;
        }
        const btn = document.createElement('button');
        btn.setAttribute('data-bar', b.k);
        btn.title = b.t;
        btn.innerHTML = '<svg viewBox="0 0 24 24">' + ICONS[b.icon] + '</svg>';
        btn.addEventListener('click', () => this.onBarClick(b.k));
        bar.appendChild(btn);
      });
      this.syncBar();
    },

    onBarClick(k) {
      const flip = (key) => {
        Store.cfg[key] = Store.cfg[key] === false;
        Store.save();
        Engine.applyOfficialSettings();
        this.syncSwitches();
      };
      if (k === 'zones') flip('zones');
      else if (k === 'zoneshow') flip('zoneShow');
      else if (k === 'zoneReset') Engine.resetZoneValues();
      else if (k === 'gestures') flip('gestures');
      else if (k === 'sound') {
        flip('sound');
        applySoundSetting();
        if (!Store.cfg.sound) Engine.stopVoice();
      } else if (k === 'next') {
        if (Store.cfg.sound === false) {
          Store.cfg.sound = true; Store.save(); applySoundSetting(); this.syncSwitches();
        }
        Engine.playNextVoice();
      } else if (k === 'hide') { const b = this.shadow.querySelector('.btn-toggle-show'); if (b) b.click(); }
      else if (k === 'reset') { const b = this.shadow.querySelector('.btn-reset'); if (b) b.click(); }
      // v1.22：控制栏代替了悬浮球，所以这一格从「隐藏操作栏」改成「打开设置面板」
      else if (k === 'settings') this.setOpen(!Store.cfg.panelOpen);
    },

    syncBar() {
      const bar = this.shadow.querySelector('.bar');
      if (!bar) return;
      const c = Store.cfg;
      const on = (k, v) => { const b = bar.querySelector('[data-bar="' + k + '"]'); if (b) b.classList.toggle('on', !!v); };
      on('zones', c.zones !== false);
      on('zoneshow', c.zoneShow === true);
      on('gestures', c.gestures !== false);
      on('sound', c.sound === true);
    },

    /**
     * 统一管控「悬浮球 / 控制栏」的显隐（v1.22）。
     * 规则：开了简易控制栏 → 控制栏常显、悬浮球让位；否则悬浮球显示（除非用户点过「隐藏按钮」）。
     */
    syncControls() {
      const c = Store.cfg;
      const barOn = c.bar !== false;
      if (this.bar) this.bar.classList.toggle('show', barOn);
      if (this.fab) this.fab.classList.toggle('hidden', barOn || c.fabHidden === true);
      this.applyFabPosition();
      this.syncBar();
    },

    renderMotions(groups) {
      const box = this.shadow.querySelector('.motions');
      if (!box) return;
      box.innerHTML = '';
      if (!groups || !groups.length) {
        box.innerHTML = '<span class="empty">该模型没有动作数据</span>';
        return;
      }
      const order = ['idle', 'home', 'login', 'main_1', 'main_2', 'main_3',
        'touch_head', 'touch_body', 'touch_special', 'mail', 'mission',
        'mission_complete', 'wedding', 'complete'];
      groups.sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });

      groups.forEach((g) => {
        const b = el('button', 'chip');
        b.textContent = MOTION_LABEL[g] || g;
        b.title = g;
        b.addEventListener('click', () => Engine.playAction(g));   // 动作 + 对应台词
        box.appendChild(b);
      });
    },

    syncSliders() {
      const c = Store.cfg;
      const set = (sel, val, fmt, out) => {
        const i = this.shadow.querySelector(sel);
        if (!i) return;
        i.value = val;
        const b = i.parentElement.querySelector('b');
        if (b) b.textContent = fmt(val);
      };
      set('.r-zoom', c.zoom, (v) => v.toFixed(2) + '×');
      set('.r-posx', c.posX, (v) => Math.round(v) + '%');
      set('.r-posy', c.posY, (v) => Math.round(v) + '%');
      set('.r-opacity', c.opacity, (v) => Math.round(v * 100) + '%');
      set('.r-res', c.resMul == null ? 1 : c.resMul, (v) => (+v).toFixed(2) + '×');
    },

    syncSwitches() {
      const c = Store.cfg;
      const set = (sel, v) => { const i = this.shadow.querySelector(sel); if (i) i.checked = !!v; };
      set('.s-mirror', c.mirror);
      set('.s-fastload', c.fastLoad !== false);
      set('.s-entrylogin', c.entryLogin !== false);
      set('.s-breath', c.breath !== false);
      set('.s-blink', c.blink !== false);
      set('.s-loginpage', c.loginPage === true);
      set('.s-bar', c.bar !== false);
      set('.s-follow', c.follow);
      set('.s-idle', c.idle);
      set('.s-gestures', c.gestures !== false);
      set('.s-zones', c.zones !== false);
      set('.s-zoneshow', c.zoneShow === true);
      set('.s-sound', c.sound === true);
      set('.s-voicemotion', c.voiceMotion !== false);
      this.syncControls();
    },
  };

  /* ---------- 面板模板 ---------- */
  const TEMPLATE = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
      "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }

  /* ---- 折叠小按钮 ---- */
  .fab {
    position: fixed; width: 42px; height: 42px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: rgba(24,26,34,.82); backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,.16);
    box-shadow: 0 6px 20px rgba(0,0,0,.35);
    cursor: grab; pointer-events: auto; user-select: none;
    /* 触摸/触控笔下必须禁掉默认手势，否则浏览器会把「拖动」当成滚动，
       中途派发 pointercancel → 拖动中断（拖出按钮就不跟随的元凶之一） */
    touch-action: none;
    transition: opacity .35s, transform .2s, background .2s;
    opacity: .55;
  }
  .fab:hover { opacity: 1; background: rgba(34,38,50,.94); transform: scale(1.06); }
  .fab:active { cursor: grabbing; }
  .fab.hidden { display: none; }
  .fab svg { width: 22px; height: 22px; display: block; }

  /* ---- 面板 ---- */
  .panel {
    position: fixed; width: 286px; max-height: min(72vh, 620px);
    display: none; flex-direction: column;
    background: rgba(22,24,31,.92); backdrop-filter: blur(18px);
    border: 1px solid rgba(255,255,255,.13);
    border-radius: 14px; box-shadow: 0 18px 48px rgba(0,0,0,.5);
    color: #e9ecf3; font-size: 12px;
    pointer-events: auto; overflow: hidden;
  }
  .panel.open { display: flex; }

  header {
    display: flex; align-items: center; gap: 8px;
    padding: 11px 12px; border-bottom: 1px solid rgba(255,255,255,.09);
    background: linear-gradient(180deg, rgba(255,255,255,.05), transparent);
  }
  header .dot { width: 8px; height: 8px; border-radius: 50%; background: #6c8cff;
    box-shadow: 0 0 8px #6c8cff; flex: none; }
  header .t { font-weight: 600; font-size: 13px; letter-spacing: .3px; flex: 1; }
  .collapse {
    width: 22px; height: 22px; border: none; border-radius: 6px; cursor: pointer;
    background: rgba(255,255,255,.08); color: #cfd5e2; font-size: 14px; line-height: 1;
  }
  .collapse:hover { background: rgba(255,255,255,.16); color: #fff; }

  .body { overflow-y: auto; padding: 10px 12px 4px; flex: 1; }
  .body::-webkit-scrollbar { width: 6px; }
  .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 3px; }

  .sec { margin-bottom: 13px; }
  .sec-t {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em;
    color: #8b93a7; margin-bottom: 6px; font-weight: 600;
  }

  .model-name {
    padding: 7px 9px; border-radius: 8px; margin-bottom: 6px;
    background: rgba(108,140,255,.14); color: #b9c8ff;
    border: 1px solid rgba(108,140,255,.25);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .row { display: flex; gap: 6px; }
  input[type="text"] {
    flex: 1; min-width: 0; padding: 6px 8px; border-radius: 8px;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.14);
    color: #e9ecf3; font-size: 11.5px; outline: none;
  }
  input[type="text"]:focus { border-color: #6c8cff; background: rgba(108,140,255,.1); }
  input[type="text"]::placeholder { color: #6b7284; }

  button {
    font-family: inherit; font-size: 11.5px; cursor: pointer;
    border-radius: 8px; border: 1px solid rgba(255,255,255,.14);
    background: rgba(255,255,255,.08); color: #dfe4ee;
    padding: 6px 10px; transition: background .15s, border-color .15s;
  }
  button:hover { background: rgba(255,255,255,.16); }
  button:disabled { opacity: .45; cursor: default; }
  .btn-load { background: rgba(108,140,255,.28); border-color: rgba(108,140,255,.5); color: #dfe6ff; }
  .btn-load:hover { background: rgba(108,140,255,.45); }

  .hint { color: #6b7284; font-size: 10.5px; margin-top: 5px; line-height: 1.5; }

  .motions { display: flex; flex-wrap: wrap; gap: 5px; max-height: 118px; overflow-y: auto; }
  .motions::-webkit-scrollbar { width: 5px; }
  .motions::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 3px; }
  .chip { padding: 4px 9px; border-radius: 20px; font-size: 11px; }
  .chip:hover { background: rgba(108,140,255,.3); border-color: rgba(108,140,255,.55); }
  .empty { color: #6b7284; font-size: 11px; }

  .slider { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
  .slider span { width: 42px; color: #99a1b3; flex: none; }
  .slider b { width: 44px; text-align: right; color: #b9c8ff; font-weight: 500; flex: none;
    font-variant-numeric: tabular-nums; }
  input[type="range"] {
    flex: 1; -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px;
    background: rgba(255,255,255,.16); outline: none;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 13px; height: 13px; border-radius: 50%;
    background: #6c8cff; cursor: pointer; box-shadow: 0 0 0 3px rgba(108,140,255,.2);
  }
  input[type="range"]::-moz-range-thumb {
    width: 13px; height: 13px; border: none; border-radius: 50%; background: #6c8cff; cursor: pointer;
  }

  .switch { display: flex; align-items: center; justify-content: space-between;
    padding: 5px 0; color: #c3cad8; }
  .switch input { appearance: none; -webkit-appearance: none; width: 32px; height: 18px;
    border-radius: 10px; background: rgba(255,255,255,.16); position: relative;
    cursor: pointer; transition: background .2s; flex: none; margin: 0; }
  .switch input::after { content: ''; position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .2s; }
  .switch input:checked { background: #6c8cff; }
  .switch input:checked::after { transform: translateX(14px); }

  select {
    font-family: inherit; font-size: 11.5px; padding: 5px 7px; border-radius: 8px;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14);
    color: #dfe4ee; outline: none; cursor: pointer;
  }
  select option { background: #1b1e26; color: #e9ecf3; }
  .select-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; color: #c3cad8; }

  .presets { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 2px; }
  .presets button { flex: 1; padding: 5px 4px; font-size: 11px; }

  footer {
    display: flex; gap: 6px; padding: 9px 12px;
    border-top: 1px solid rgba(255,255,255,.09);
    background: rgba(0,0,0,.16); flex-wrap: wrap;
  }
  footer button { flex: 1; white-space: nowrap; padding: 6px 6px; font-size: 11px; }

  .status {
    display: none; padding: 7px 10px; margin: 0 12px 9px;
    border-radius: 8px; font-size: 11px; line-height: 1.5;
    background: rgba(108,140,255,.14); color: #b9c8ff;
    border: 1px solid rgba(108,140,255,.28); white-space: pre-wrap;
  }
  .status.show { display: block; }
  .status.error { background: rgba(255,90,90,.14); color: #ffb3b3; border-color: rgba(255,90,90,.35); }

  /* ---- 台词列表 ---- */
  .voice-count { color: #6b7284; font-weight: 400; letter-spacing: 0; }
  .voices { max-height: 170px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
  .voices::-webkit-scrollbar { width: 5px; }
  .voices::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 3px; }
  .voice-line {
    display: flex; align-items: center; gap: 7px; cursor: pointer;
    padding: 5px 8px; border-radius: 7px; border: 1px solid transparent;
    color: #c3cad8; font-size: 11.5px; text-align: left;
    background: rgba(255,255,255,.04);
  }
  .voice-line:hover { background: rgba(108,140,255,.18); border-color: rgba(108,140,255,.35); }
  .voice-line.playing { background: rgba(108,140,255,.28); border-color: rgba(108,140,255,.6); color: #dfe6ff; }
  .voice-line .vn { flex: none; width: 62px; color: #99a1b3; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .voice-line.playing .vn { color: #b9c8ff; }
  .voice-line .vt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .voices .empty { color: #6b7284; font-size: 11px; line-height: 1.6; padding: 4px 0; }

  /* ---- 悬浮操作栏（对齐 l2d.su 的 model-floating-actions） ---- */
  .bar {
    position: fixed; display: none; flex-direction: column; gap: 4px;
    padding: 5px; border-radius: 14px;
    background: rgba(22,24,31,.86); backdrop-filter: blur(16px);
    border: 1px solid rgba(255,255,255,.13);
    box-shadow: 0 12px 32px rgba(0,0,0,.42);
    pointer-events: auto; transition: opacity .35s;
  }
  .bar.show { display: flex; }
  .bar.faded { opacity: .35; }
  .bar.faded:hover { opacity: 1; }
  .bar button {
    width: 34px; height: 34px; padding: 0; border-radius: 9px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
    color: #cfd5e2;
  }
  .bar button:hover { background: rgba(108,140,255,.28); border-color: rgba(108,140,255,.5); color: #fff; }
  .bar button.on { background: rgba(108,140,255,.34); border-color: rgba(108,140,255,.62); color: #fff; }
  .bar button svg { width: 17px; height: 17px; display: block; fill: currentColor; }
  .bar .sep { height: 1px; margin: 2px 4px; background: rgba(255,255,255,.1); }
  /* ---- 设置面板底部的免责声明（v1.24：从控制栏挪到面板里）---- */
  .note {
    padding: 8px 12px 2px; border-top: 1px solid rgba(255,255,255,.06);
    font-size: 10px; line-height: 1.55; color: #6b7284;
    user-select: none; cursor: help;
  }
  .note b { color: #8b93a7; font-weight: 600; }

  /* ---- 快捷动画（对齐官方 UI 的 Quick animations）---- */
  .quick { display: flex; gap: 5px; flex-wrap: wrap; }
  .quick button { flex: 1; min-width: 62px; padding: 6px 4px; font-size: 11px; }
</style>

<div class="bar"></div>

<div class="fab" title="Live2D 壁纸设置 (Alt+L)">
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3.2c3.6 0 6.4 2.5 6.4 5.9 0 1-.2 1.9-.6 2.7-.1.3 0 .5.2.7.7.5 1.3 1 1.7 1.7.5.9.4 1.6-.2 2.1-.4.3-.9.4-1.5.2-.5-.2-1-.6-1.5-1.2-.3-.4-.9-.5-1.3-.2-1 .6-2.1.9-3.2.9s-2.2-.3-3.2-.9c-.4-.3-1-.2-1.3.2-.5.6-1 1-1.5 1.2-.6.2-1.1.1-1.5-.2-.6-.5-.7-1.2-.2-2.1.4-.7 1-1.2 1.7-1.7.2-.2.3-.4.2-.7-.4-.8-.6-1.7-.6-2.7C5.6 5.7 8.4 3.2 12 3.2Z"
      stroke="#a9bcff" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="9.4" cy="9.4" r="1.25" fill="#a9bcff"/>
    <circle cx="14.6" cy="9.4" r="1.25" fill="#a9bcff"/>
  </svg>
</div>

<div class="panel">
  <header>
    <span class="dot"></span>
    <span class="t">Live2D 壁纸</span>
    <button class="collapse" title="收起">–</button>
  </header>

  <div class="status"></div>

  <div class="body">
    <div class="sec">
      <div class="sec-t">当前模型</div>
      <div class="model-name">—</div>
      <div class="row">
        <input type="text" class="model-input" placeholder="l2d.su 链接 / 皮肤ID / 模型名">
        <button class="btn-load">载入</button>
      </div>
      <div class="hint">可填 <code>307074</code> 或 <code>https://l2d.su/cn/skins/307074/</code></div>
    </div>

    <div class="sec">
      <div class="sec-t">快捷动画</div>
      <div class="quick">
        <button data-quick="idle">待机</button>
        <button data-quick="home">主界面</button>
        <button data-quick="touch_head">摸头</button>
        <button data-quick="touch_body">摸身体</button>
        <button data-quick="random">随机一个</button>
      </div>
      <div class="hint">对齐 l2d.su 的「快捷动画」：一键就播，不用去下面的完整动作表里翻。
        「随机一个」会从该模型的非待机动作里挑一个（待机循环交给「空闲自动动作」）。</div>
    </div>

    <div class="sec">
      <div class="sec-t">动作</div>
      <div class="motions"></div>
    </div>

    <div class="sec">
      <div class="sec-t">显示</div>
      <label class="slider"><span>缩放</span><input type="range" class="r-zoom" min="0.1" max="20" step="0.01" value="1"><b>1.00×</b></label>
      <label class="slider"><span>水平</span><input type="range" class="r-posx" min="-500" max="500" step="1" value="72"><b>72%</b></label>
      <label class="slider"><span>垂直</span><input type="range" class="r-posy" min="-500" max="500" step="1" value="100"><b>100%</b></label>
      <label class="slider"><span>渲染</span><input type="range" class="r-res" min="0.5" max="3" step="0.25" value="1"><b>1.00×</b></label>
      <label class="slider"><span>不透明</span><input type="range" class="r-opacity" min="0.1" max="1" step="0.01" value="0.95"><b>95%</b></label>
      <div class="presets">
        <button data-preset="left">左侧</button>
        <button data-preset="center">居中</button>
        <button data-preset="right">右侧</button>
        <button data-preset="fill">填满高度</button>
      </div>
      <label class="switch">水平镜像<input type="checkbox" class="s-mirror"></label>
      <label class="switch">快速加载<input type="checkbox" class="s-fastload" checked></label>
      <label class="switch">进入加载登录动画<input type="checkbox" class="s-entrylogin" checked></label>
      <label class="switch">呼吸<input type="checkbox" class="s-breath" checked></label>
      <label class="switch">眨眼<input type="checkbox" class="s-blink" checked></label>
      <label class="switch">登录页也显示<input type="checkbox" class="s-loginpage"></label>
      <label class="switch">简易控制栏<input type="checkbox" class="s-bar" checked></label>
      <div class="hint"><b>快速加载</b>：启动时立刻并行预取官方运行时（约 2.5MB）与依赖库，
        省掉两段串行的等待；配合内置资源缓存，二次刷新基本几秒就能就绪。
        关掉则改成"用到才拉"（少占一点带宽，但会慢几秒）。<br>
        <b>进入加载登录动画</b>：载入/切换模型时先播该模型的 <code>login</code> 动作（和 l2d.su 一样）。
        有些模型的 login 会顺手改变服饰/道具状态，不喜欢就关掉 —— 关掉后载入时只播待机。</div>
      <div class="hint"><b>简易控制栏</b>：勾上后右下角的悬浮球会直接变成一条控制栏
        （分区互动 / 声音 / 台词 / 拖动缩放 / 隐藏模型 / 还原 / 设置），点最下面的
        「设置」按钮展开这个面板。取消勾选则恢复成悬浮球。</div>
      <div class="hint">登录页和桌面共用同一套壁纸节点，所以脚本两边都会命中。
        但登录页会被整屏的交互层盖住、导致登不进去，所以<b>默认不接管登录页</b>；
        想看的话打开这个开关，并顺手关掉「分区互动」，登录界面完全不受影响。</div>
    </div>

    <div class="sec">
      <div class="sec-t">互动</div>
      <label class="switch">视线跟随鼠标<input type="checkbox" class="s-follow" checked></label>
      <label class="switch">空闲自动动作<input type="checkbox" class="s-idle" checked></label>
      <label class="switch">拖动与缩放<input type="checkbox" class="s-gestures" checked></label>
      <label class="switch">分区互动<input type="checkbox" class="s-zones" checked></label>
      <label class="switch">显示触摸区域<input type="checkbox" class="s-zoneshow"></label>
      <div class="hint">交互<b>只认触摸区</b>：命中触摸区才拦截点击，其余位置（桌面图标、Dock、
        登录卡片…）照常点到 —— 两者不互斥。<br>
        <b>拖动与缩放</b>：悬停在模型上滚轮缩放；按住模型拖动可挪动模型
        （点在可拖拽的触摸区上时优先执行互动，拖开一段即转为挪动模型）。<br>
        <b>分区互动</b>：接管触摸区 —— 点/拖模型上那些看不见的部件来驱动参数，并联动语音。
        关掉后模型只做视线跟随，桌面图标永远优先。<br>
        <b>显示触摸区域</b>：把那些看不见的触摸部件画出来（红=头 绿=身体 蓝=特殊 琥珀=可拖拽 紫=待机区）。</div>
    </div>

    <div class="sec">
      <div class="sec-t">声音</div>
      <label class="switch">声音<input type="checkbox" class="s-sound"></label>
      <label class="switch">语音联动动作<input type="checkbox" class="s-voicemotion" checked></label>
      <div class="hint">一个开关管<b>台词语音</b>（l2d.su 游戏数据）：<br>
        · 点下面的台词列表 → 播那句（并联动它的动作）；<br>
        · <b>直接互动模型</b>（点/摸触摸区）→ 官方触发动作后自动播对应台词（headtouch→摸头台词、
        touch2→特殊触摸台词…）。<br>
        默认关；点台词或开这个开关都能启用。动作音效（model3.json 自带 Sounds）对游戏抽取模型基本为空，
        所以会响的只有台词语音。</div>
    </div>

    <div class="sec">
      <div class="sec-t">台词 <span class="voice-count"></span></div>
      <div class="voices"><div class="empty">用 l2d.su 链接或皮肤 ID 指定模型后，这里会列出全部台词</div></div>
    </div>
  </div>

  <div class="note" title="本脚本是非官方个人扩展，与飞牛 / 碧蓝航线官方无关。">
    <b>免责声明</b>：本脚本为个人自用的非官方扩展，与飞牛 fnOS、碧蓝航线及其运营方均无关联；
    模型与语音素材版权归原厂及原作者所有，仅供本机预览，请勿用于商业用途。
  </div>

  <footer>
    <button class="btn-reset">重置</button>
    <button class="btn-toggle-show">隐藏模型</button>
    <button class="btn-remount">重新挂载</button>
    <button class="btn-hide-fab">隐藏按钮</button>
  </footer>
</div>
`;

  /* ============================================================ *
   * 7. 启动
   * ============================================================ */

  /**
   * 提前和几个必备域名建好连接（v1.26）。
   * DNS + TLS 握手在首次访问时是实打实的几百毫秒，提前做掉就等于省下来。
   */
  function installPreconnect() {
    try {
      ['https://l2d.su', 'https://static.l2d.su', 'https://cdn.jsdelivr.net', 'https://fastly.jsdelivr.net',
       'https://cubism.live2d.com'].forEach(function (h) {
        const l = document.createElement('link');
        l.rel = 'preconnect';
        l.href = h;
        l.crossOrigin = 'anonymous';
        (document.head || document.documentElement).appendChild(l);
      });
    } catch (e) {}
  }

  async function boot() {
    perfStart();
    installPreconnect();
    log('开始初始化…');
    bootHint('Live2D：正在加载依赖…');
    Store.load();
    installModelAssetCache();   // 越早越好：官方 viewer 的所有资源请求都要经过它
    setTimeout(function () { pruneOldCache(); }, 3000);   // 后台清掉旧格式缓存键，不阻塞启动
    // ★ 快速加载（v1.26）：把「官方运行时（2.5MB chunk）」的下载提前和依赖库并行跑 ——
    //   原来这两段是串行的（等 PIXI/Cubism 就绪才开始拉 chunk），
    //   实测依赖库那段要 4~5 秒，并行后这段时间直接被省掉。
    //   SuStack.load() 自带 promise 去重，重复调用安全。
    if (Store.cfg.fastLoad !== false) {
      try { SuStack.load().catch(function () {}); } catch (e) {}
    }
    try {
      await ensureLibs();
    } catch (err) {
      errlog('依赖加载失败：', err);
      bootHint('Live2D 依赖加载失败：' + (err && err.message ? err.message : err) +
        '\n请确认这台设备能访问 jsdelivr / cubism.live2d.com\n' +
        '（脚本文件本身已执行，问题在 CDN 网络）', true);
      return;
    }
    if (!window.PIXI || !window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
      errlog('pixi-live2d-display 未就绪，放弃注入');
      bootHint('Live2D 库未就绪，已放弃注入（详见控制台）', true);
      return;
    }
    perfMark('libs');
    bootHint('Live2D：依赖就绪，正在查找壁纸节点…');
    UI.mount();
    watchWallpaper();
    log('已就绪，等待壁纸元素出现…');
  }

  // 供调试使用：控制台执行 fnosLive2D.diag() 可打印一份自检报告
  Object.assign(window.fnosLive2D, {
    Engine, Store, UI, Resolver, tryMount, findWallpaperImg, findWallpaperTarget,
    diag() {
      const info = {
        version: VERSION,
        地址: location.href,
        PIXI: !!window.PIXI,
        CubismCore: !!window.Live2DCubismCore,
        Live2DModel: !!(window.PIXI && window.PIXI.live2d && window.PIXI.live2d.Live2DModel),
        画布在文档中: !!(Engine.canvas && Engine.canvas.isConnected),
        找到的壁纸节点: (function () {
          const i = findWallpaperImg();
          if (!i) return '未找到';
          return i.tagName + '.' + (i.className || '') + '  src=' + (i.getAttribute('src') || i.getAttribute('data-src'));
        })(),
        当前模型: Store.cfg.modelUrl,
        日志条数: LOGS.length,
      };
      try { console.table(info); } catch (e) { console.log(info); }
      return info;
    },

    /**
     * 现场自检：在飞牛页面的控制台执行 fnosLive2D.probe() ，
     * 把打印出来的 JSON 整段发我，就能定位「壁纸没接管 / 互动没反应」。
     */
    probe() {
      const t = findWallpaperTarget();
      let hit = null;
      const mr = Engine.modelRect();
      if (mr) {
        const cx = mr.left + mr.width / 2, cy = mr.top + mr.height / 2;
        const at = document.elementFromPoint(cx, cy);
        const z = (function () {
          const v = Engine.official && Engine.official.viewer;
          if (!v || !v.currentLive2d) return null;
          try { return v.hitAreaAt(v.currentLive2d, cx, cy) || null; } catch (e) { return null; }
        })();
        hit = {
          模型矩形: [Math.round(mr.left), Math.round(mr.top), Math.round(mr.width), Math.round(mr.height)],
          中心点最顶层元素: at ? (at.tagName + (at.id ? '#' + at.id : '') + (at.className ? '.' + String(at.className).split(/\s+/).slice(0, 2).join('.') : '')) : 'null',
          中心点是否宿主可操作元素: Engine.hostInteractiveAt(cx, cy),
          上方有宿主元素: Engine.hostAboveWallpaper(cx, cy),
          中心点命中的触摸区: z ? (z.id || null) : null,
        };
      }
      const full = [];
      for (const elm of document.querySelectorAll('body *')) {
        if (!coversViewport(elm, 0.9)) continue;
        const cs = getComputedStyle(elm);
        full.push({
          节点: elm.tagName + (elm.id ? '#' + elm.id : '') +
            (elm.className ? '.' + String(elm.className).split(/\s+/).slice(0, 3).join('.') : ''),
          z: cs.zIndex, position: cs.position, 背景图: bgUrlOf(elm) || '',
        });
      }
      const imgs = Array.from(document.querySelectorAll('img')).map((i) => {
        const r = i.getBoundingClientRect();
        return {
          src: (i.getAttribute('src') || i.getAttribute('data-src') || '').slice(-70),
          尺寸: Math.round(r.width) + 'x' + Math.round(r.height),
          visibility: i.style.visibility || getComputedStyle(i).visibility,
        };
      });
      const out = {
        地址: location.href,
        窗口: window.innerWidth + 'x' + window.innerHeight,
        脚本版本: VERSION,
        依赖: { PIXI: !!(window.PIXI && window.PIXI.VERSION), Core: !!window.Live2DCubismCore },
        选中的壁纸层: t ? {
          类型: t.kind, src: t.src,
          容器: t.container ? (t.container.tagName + (t.container.className ? '.' + String(t.container.className).split(/\s+/).slice(0, 3).join('.') : '')) : null,
          一并接管数: (t.covers || []).length,
        } : '未找到',
        已挂载: !!(Engine.canvas && Engine.canvas.isConnected),
        命中层: hit,
        整屏元素: full,
        页面上的图片: imgs,
      };
      try { console.log(JSON.stringify(out, null, 1)); } catch (e) { console.log(out); }
      return out;
    },
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
