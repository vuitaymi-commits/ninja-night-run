/* ============================================================
 * 月夜疾行 · 屋顶狂奔  (Ninja Night Run)
 * 纯 Canvas 2D + 原生 JS，零依赖，低内存，60fps
 * ============================================================ */
(() => {
'use strict';

/* ---------------- 工具 ---------------- */
const TAU = Math.PI * 2;
const rand  = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const mod   = (a, n) => ((a % n) + n) % n;

function roundRect(c, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ---------------- 画布 ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

let W = 0, H = 0, S = 1, DPR = 1;
let baseGround = 0, skyGrad = null, vigGrad = null, moonGlow = null;

/* ---------------- 全局状态 ---------------- */
let state = 'menu';          // menu | play | over
let paused = false;
let t = 0;                   // 全局时间(秒)
let scroll = 0;              // 世界滚动距离
let speed = 0, maxSpeed = 0;
let distM = 0, coins = 0;
let shake = 0, overT = 0, deadFlag = false;

let best = 0;
try { best = parseInt(localStorage.getItem('nnr_best') || '0', 10) || 0; } catch (e) {}

/* 实体 */
let ninja = null;
let segments = [];   // 屋顶段 {x,w,y,windows[],lantern,coins[],obs[]}
let genX = 0;
let crows = [];      // {x,y,ph}
let crowTimer = 4;
let parts = [];      // 粒子

/* 背景缓存 */
let stars = [], clouds = [], farItems = [], midItems = [], farFW = 0, midFW = 0, flies = [];

/* 展品（文物）系统 */
let relics = [];           /* 路上文物 {x,y,relic,ph,got,spawnT} */
let pendingRelic = null;   /* 下一件待刷文物 {atX, item} */
let ownedRelics = new Set();
let popups = [];           /* 拾取飘字 {x,y,life,max,text,color} */
/* 锦衣卫追击状态：retreat 甩开离场计时；lunge 砍中忍者时前扑计时 */
let chaser = { on: false, retreat: 0, lunge: 0, runPh: 0 };

/* ---------------- 常量（随 S 缩放） ---------------- */
const CFG = {
  gravity: 2400, jumpV: 920, djV: 830,
  sp0: 235, spMax: 700, spAcc: 3.2,
};

/* ---------------- 移动端（触屏）支持 ----------------
   触屏设备用 canvas 内虚拟按键代替键盘；桌面端不显示，逻辑不受影响 */
const IS_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
let uiBtns = [];   /* 每帧重建：{x,y,w,h,cb}，pointerdown 时优先命中 */

/* 画一个虚拟按键并注册命中区（uiBtns 在 render 开头清空） */
function uiBtn(x, y, w, h, label, cb, opts = {}) {
  const r = Math.min(w, h) * 0.3;
  ctx.globalAlpha = opts.dim != null ? opts.dim : 1;
  ctx.fillStyle = opts.bg || 'rgba(18,22,48,0.72)';
  roundRect(ctx, x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = opts.border || 'rgba(240,212,138,0.75)';
  ctx.lineWidth = 1.6 * S;
  roundRect(ctx, x, y, w, h, r); ctx.stroke();
  ctx.fillStyle = opts.color || '#f0d48a';
  ctx.font = `bold ${Math.round((opts.fs || 15) * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1 * S);
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 1;
  if (!opts.disabled) uiBtns.push({ x, y, w, h, cb });
}

/* ============================================================
 * 尺寸与背景生成
 * ============================================================ */
function resize() {
  if (window.innerWidth <= 0 || window.innerHeight <= 0) return; /* 视口不可用时跳过 */
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  S = clamp(H / 540, 0.62, 2.2);
  baseGround = Math.round(H * 0.76);

  skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#0a0e24');
  skyGrad.addColorStop(0.55, '#1b2145');
  skyGrad.addColorStop(1, '#2b2350');

  vigGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
  vigGrad.addColorStop(0, 'rgba(4,6,18,0)');
  vigGrad.addColorStop(1, 'rgba(4,6,18,0.5)');

  const mx = W * 0.76, my = H * 0.19, mr = 34 * S;
  moonGlow = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 3.4);
  moonGlow.addColorStop(0, 'rgba(247,243,224,0.30)');
  moonGlow.addColorStop(1, 'rgba(247,243,224,0)');

  buildAmbient();
}

function buildAmbient() {
  /* 星星 */
  stars = [];
  const nStars = Math.round(W * H / 14000);
  for (let i = 0; i < nStars; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.55,
      r: rand(0.6, 1.8) * S,
      ph: rand(0, TAU),
      c: Math.random() < 0.7 ? '#cdd6ff' : (Math.random() < 0.5 ? '#ffffff' : '#ffe9c9'),
    });
  }

  /* 云 */
  clouds = [];
  for (let i = 0; i < 5; i++) {
    clouds.push({
      x: Math.random() * W, y: rand(0.05, 0.3) * H,
      s: rand(0.7, 1.6) * S, v: rand(4, 10),
    });
  }

  /* 远景：古城剪影（塔、城楼、民居） */
  farFW = Math.max(W * 2, 1600);
  farItems = [];
  let fx = rand(0, 120);
  while (fx < farFW) {
    const kind = Math.random() < 0.16 ? 'pagoda' : (Math.random() < 0.24 ? 'gate' : 'block');
    const it = { x: fx, kind, a: rand(0.55, 1) };
    if (kind === 'pagoda')      { it.w = rand(70, 100) * S;  it.h = rand(150, 230) * S; fx += it.w + rand(30, 130) * S; }
    else if (kind === 'gate')   { it.w = rand(120, 170) * S; it.h = rand(95, 140) * S;  fx += it.w + rand(30, 120) * S; }
    else                        { it.w = rand(60, 150) * S;  it.h = rand(40, 110) * S;  fx += it.w + rand(14, 70) * S; }
    farItems.push(it);
  }

  /* 中景：街市风格（铺面 / 钟楼 / 民居），与主殿庑殿顶区分 */
  midFW = Math.max(W * 2, 1800);
  midItems = [];
  let mx = rand(0, 100);
  while (mx < midFW) {
    const r = Math.random();
    const kind = r < 0.4 ? 'shop' : r < 0.62 ? 'tower' : 'house';
    const w = kind === 'shop' ? rand(140, 230) * S
            : kind === 'tower' ? rand(85, 125) * S
            : rand(95, 165) * S;
    const h = kind === 'shop' ? rand(80, 115) * S
            : kind === 'tower' ? rand(170, 235) * S
            : rand(55, 95) * S;
    const wins = [];
    const rows = Math.max(1, Math.floor(h / (34 * S)));
    const cols = Math.max(1, Math.floor(w / (40 * S)));
    for (let r2 = 0; r2 < rows; r2++)
      for (let cc = 0; cc < cols; cc++)
        if (Math.random() < 0.55)
          wins.push({ x: (0.18 + cc * 0.72 / Math.max(1, cols - 1 || 1)) * w + rand(-4, 4) * S,
                      y: 18 * S + r2 * 26 * S + rand(-3, 3) * S, on: Math.random() < 0.8 });
    midItems.push({
      x: mx, w, h, wins, kind,
      lantern: Math.random() < 0.4,
      banner: kind === 'shop' && Math.random() < 0.7,   /* 铺面幌子 */
      lph: rand(0, TAU),
    });
    mx += w + rand(8, 60) * S;
  }

  /* 萤火虫 */
  flies = [];
  for (let i = 0; i < 12; i++) {
    flies.push({ x: Math.random() * W, y: rand(0.45, 0.8) * H, ph: rand(0, TAU), sp: rand(6, 16) });
  }
}

/* ============================================================
 * 屋顶（跑道）生成 —— 古风飞檐屋顶
 * ============================================================ */
function segAt(wx) {
  for (const sg of segments)
    if (wx >= sg.x && wx <= sg.x + sg.w) return sg;
  return null;
}

function spawnSeg(x, w, y) {
  const sg = { x, w, y, windows: [], lantern: null, coins: [], obs: [], beasts: [], bays: [], hook: null, upper: null };

  /* 建筑立面开间：朱柱分隔，每间为菱花窗或隔扇门（明暗随机） */
  const nBays = Math.max(3, Math.round(w / (74 * S)));
  for (let i = 0; i < nBays; i++) {
    sg.bays.push({
      door: i === Math.floor(nBays / 2) && Math.random() < 0.7, /* 明间多为隔扇门 */
      lit: Math.random() < 0.62,
      lattice: Math.random() < 0.5 ? 'cross' : 'diamond',
    });
  }

  /* 屋顶灯笼（纯装饰） */
  if (w > 380 * S && Math.random() < 0.55)
    sg.lantern = { x: rand(0.3, 0.7) * w, ph: rand(0, TAU) };

  /* 檐角走兽（龙凤狮子等，沿脊排列） */
  if (w > 300 * S) {
    const nB = randi(3, 5);
    for (let i = 0; i < nB; i++)
      sg.beasts.push({ x: (0.1 + 0.8 * (i / Math.max(1, nB - 1))) * w });
  }

  /* 铜钱：屋顶平铺一排 */
  if (Math.random() < 0.42 && w > 300 * S) {
    const n = randi(3, 4);
    const cx0 = rand(0.25, 0.55) * w;
    for (let i = 0; i < n; i++)
      sg.coins.push({ x: x + cx0 + i * 36 * S, y: y - 42 * S, ph: rand(0, TAU), got: false });
  }

  /* 钩索道具：路径上随机刷新，拾取补充（携带上限 5） */
  if (w > 260 * S && Math.random() < 0.34)
    sg.hook = { x: x + rand(0.2, 0.8) * w, y: y - 40 * S, ph: rand(0, TAU), got: false };

  /* 二层阁楼：宽段上方随机搭建平台（奖励路线：铜钱多、无障碍） */
  if (w > 430 * S && segments.length > 2 && Math.random() < 0.26) {
    const uw = w * rand(0.4, 0.58);
    sg.upper = { x: x + w * rand(0.14, 0.24), w: uw, y: y - rand(112, 130) * S, coins: [], lit: Math.random() < 0.6 };
    const nU = randi(2, 3);
    for (let i = 0; i < nU; i++)
      sg.upper.coins.push({ x: sg.upper.x + uw * (0.25 + 0.5 * i / Math.max(1, nU - 1)), y: sg.upper.y - 42 * S, ph: rand(0, TAU), got: false });
  }

  /* 障碍：陶罐 / 香炉（留出起降安全边距） */
  if (w > 340 * S && segments.length > 2 && Math.random() < 0.5) {
    const type = Math.random() < 0.5 ? 'jar' : 'censer';
    sg.obs.push({
      type,
      x: x + rand(0.3, 0.6) * w,
      y: y,
      ph: rand(0, TAU),
    });
  }
  segments.push(sg);
  return sg;
}

/* 缺口上空的铜钱弧线（世界坐标，独立数组） */
let gapCoins = [];
function spawnGapCoins2(x0, y0, x1, y1) {
  if (Math.random() > 0.42) return;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    gapCoins.push({
      x: x0 + (x1 - x0) * p,
      y: Math.min(y0, y1) - 34 * S - Math.sin(p * Math.PI) * 60 * S,
      ph: rand(0, TAU), got: false,
    });
  }
}

/* 各品质文物的最小/最大刷出间距（像素 ×S）：品质越高越稀有 */
const RELIC_GAP = { 1: [1600, 2600], 2: [2200, 3400], 3: [3000, 4500], 4: [4200, 6200], 5: [6000, 9000] };
/* 安排下一件文物：按品质权重抽取（已拥有的不再刷），间距随品质加大。
   场上同时最多一件：只有捡到或错过上一件后才会调用本函数 */
function scheduleRelic(fromX) {
  if (pendingRelic) return;   /* 已有排队中的文物，不重复安排 */
  /* 已拥有 + 押运中的都不再刷新 */
  const excl = new Set(ownedRelics);
  if (ninja && ninja.carried) for (const r of ninja.carried) excl.add(r.id);
  const item = window.ARTIFACTS.rollRelic(excl);
  if (!item) { pendingRelic = null; return; }   /* 1000 件集齐，不再刷新 */
  const [g0, g1] = RELIC_GAP[item.rv];
  pendingRelic = { atX: fromX + rand(g0, g1) * S, item };
}

function genWorld() {
  const limit = scroll + W + 700 * S;
  while (genX < limit) {
    const prev = segments[segments.length - 1];
    let gap = 0;
    const spdR = (speed - CFG.sp0 * S) / ((CFG.spMax - CFG.sp0) * S);
    if (segments.length > 2) {
      gap = rand(90, 150) * S + clamp(spdR, 0, 1) * 70 * S;
    }
    const w = rand(320, 720) * S;
    let y = prev ? prev.y + rand(-34, 34) * S : baseGround;
    y = clamp(y, baseGround - 34 * S, baseGround + 14 * S);
    if (prev) spawnGapCoins2(prev.x + prev.w, prev.y, genX + gap, y);
    const sg = spawnSeg(genX + gap, w, y);

    /* 文物落在本段上：若计划点恰好落进缺口，则平移到本段中段 */
    if (pendingRelic) {
      if (pendingRelic.atX < sg.x) pendingRelic.atX = sg.x + rand(0.25, 0.6) * w;
      if (pendingRelic.atX <= sg.x + sg.w) {
        const item = pendingRelic.item;
        relics.push({
          x: pendingRelic.atX,
          y: sg.y - (48 + item.rv * 5) * S,    /* 品质越高浮得越高，需小跳 */
          relic: item, ph: rand(0, TAU), got: false,
        });
        /* 放置后不再立即排下一件：等捡到或错过再排 */
        pendingRelic = null;
      }
    }

    genX = genX + gap + w;
  }
  /* 回收 */
  while (segments.length && segments[0].x + segments[0].w < scroll - 320 * S) segments.shift();
  gapCoins = gapCoins.filter(c => !c.got && c.x > scroll - 200 * S);
  /* 文物滚出屏幕 = 错过：场上无文物时才安排下一件 */
  const missed = relics.some(r => !r.got && r.x <= scroll - 200 * S);
  relics = relics.filter(r => !r.got && r.x > scroll - 200 * S);
  if (missed && relics.length === 0) scheduleRelic(scroll + W);
}

/* ============================================================
 * 忍者
 * ============================================================ */
function makeNinja() {
  return {
    sx: 0,              // 屏幕x（resize 时更新）
    y: baseGround,      // 脚底y
    vy: 0,
    grounded: true,
    jumps: 0,
    coyote: 0, buffer: 0,
    runPhase: 0,
    spinT: 0,           // 二段跳空翻
    squash: 0, stretch: 0,
    blinkT: rand(2, 5),
    blinking: 0,
    dead: false, deadRot: 0,
    hooks: 3,           // 钩索数量（上限 5）
    grap: null,         // 钩索摆动状态 {ax,ay,L,th,om,t,segT}
    hookCD: 0,          // 钩索冷却（秒）
    lastEaveY: 0,       // 最近踩过的檐口高度（判断是否掉到檐下）
    shield: false,      // 护盾（抵御一次撞击）
    mount: null,        // 坐骑：'wolf' | 'roc' | null
    mountHP: 0,         // 狼的耐久（2 次）
    rocM0: 0,           // 大鹏起飞时的里程（飞 100 米后离开）
    inv: 0,             // 受击无敌帧
    wanted: false,      // 锦衣卫追缉中（捡到文物触发）
    lives: 2,           // 追缉中的两条命
    wantedM0: 0,        // 本轮追缉起始里程（跑 150 米甩开）
    residual: 0,        // 每次甩开后保留的少量永久加速（有上限）
    carried: [],        // 押运中的文物（甩开锦衣卫后才真正入藏；死亡则丢失）
  };
}

function doJump(v) {
  ninja.vy = v;
  ninja.grounded = false;
  ninja.coyote = 0;
  ninja.stretch = 1;
  addDust(ninja.sx, ninja.y, 5);
}

function tryJump() {
  if (state !== 'play' || paused || ninja.dead) return;
  /* 摆动中按跳跃 → 主动松钩跳出（保留当前切向速度） */
  if (ninja.grap) {
    const g = ninja.grap;
    const yDot = -g.L * g.om * Math.sin(g.th);
    ninja.grap = null;
    ninja.grounded = false;
    ninja.vy = clamp(yDot * 0.8 - 220 * S, -620 * S, -80 * S);
    ninja.jumps = 2;
    addDust(ninja.sx, ninja.y, 3);
    return;
  }
  if (ninja.grounded || ninja.coyote > 0) {
    ninja.jumps = 1;
    doJump(-CFG.jumpV * S);
  } else if (ninja.jumps < 2) {
    ninja.jumps = 2;
    ninja.spinT = 1;
    doJump(-CFG.djV * S);
  } else {
    ninja.buffer = 0.12;
  }
}

/* 钩索：掉落时限内发射，锚定前方最近屋檐，荡秋千荡回（5s 冷却） */
function fireHook() {
  const n = ninja;
  if (state !== 'play' || paused || n.dead || n.grap || n.grounded) return;
  if (n.hooks <= 0 || n.hookCD > 0) return;
  /* 仅在忍者已落到檐口下方时可用，且未坠过救援线 */
  if (n.y <= n.lastEaveY + 10 * S) return;
  if (n.y > baseGround + 235 * S) return;
  const wx = scroll + n.sx;
  let ts = null;
  for (const sg of segments) { if (sg.x + sg.w > wx + 10 * S) { ts = sg; break; } }
  if (!ts) return;
  /* 锚点：前方段檐口上方较高处（大圆弧便于越过檐口） */
  const ax = ts.x + Math.min(ts.w * 0.38, 150 * S);
  const ay = ts.y - 80 * S;
  const dx = wx - ax, dy = n.y - ay;
  const L = clamp(Math.hypot(dx, dy), 70 * S, 520 * S);
  const th = Math.atan2(dx, dy);
  /* 初角速：由下落动能换算并给向前增益，保证荡得过缺口 */
  const om = clamp((-n.vy * Math.sin(th)) / L + 1.5, 1.4, 3.4);
  n.hooks--;
  n.hookCD = 5;
  n.grap = { ax, ay, L, th, om, t: 0, segT: ts };
  addDust(n.sx, n.y, 3);
}

/* ============================================================
 * 粒子
 * ============================================================ */
function addPart(p) { if (parts.length < 220) parts.push(p); }

function addDust(x, y, n) {
  for (let i = 0; i < n; i++)
    addPart({
      type: 'dust',
      x: x + rand(-8, 8) * S, y: y + rand(-3, 1) * S,
      vx: rand(-60, -20) * S, vy: rand(-40, 5) * S,
      life: 0, max: rand(0.3, 0.6), r: rand(1.5, 3.5) * S,
    });
}

function addSparkle(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(40, 140) * S;
    addPart({
      type: 'spark',
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40 * S,
      life: 0, max: rand(0.3, 0.55), r: rand(1.5, 3) * S,
    });
  }
}

function addBurst(x, y) {
  for (let i = 0; i < 26; i++) {
    const a = rand(0, TAU), v = rand(80, 300) * S;
    addPart({
      type: Math.random() < 0.5 ? 'dust' : 'spark',
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0, max: rand(0.4, 0.9), r: rand(2, 4.5) * S,
    });
  }
}

/* 文物入藏时的品质色光屑 */
function addRelicBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(60, 220) * S;
    addPart({
      type: 'rspark', c: color,
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30 * S,
      life: 0, max: rand(0.4, 0.8), r: rand(1.5, 3.5) * S,
    });
  }
}

function updateParts(dt) {
  for (const p of parts) {
    p.life += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.type === 'spark') p.vy += 300 * S * dt;
    if (p.type === 'dust')  { p.vx *= (1 - 2 * dt); p.vy -= 30 * S * dt; }
  }
  parts = parts.filter(p => p.life < p.max);
}

/* ============================================================
 * 生命周期
 * ============================================================ */
function reset() {
  scroll = 0; speed = CFG.sp0 * S; maxSpeed = CFG.spMax * S;
  distM = 0;
  coins = 0;   /* 金币每局重置，不带入下一局 */
  segments = []; gapCoins = []; crows = []; parts = [];
  relics = []; popups = []; pendingRelic = null;
  chaser = { on: false, retreat: 0, lunge: 0, runPh: 0 };
  crowTimer = rand(4, 7);
  deadFlag = false; paused = false; shake = 0;
  ninja = makeNinja();
  ninja.sx = Math.round(W * 0.26);
  const first = spawnSeg(-260 * S, W * 1.35, baseGround);
  ninja.y = first.y;
  ninja.lastEaveY = first.y;
  genX = first.x + first.w;
  scheduleRelic(first.x + first.w * 0.35);   /* 第一件文物稍后出现 */
  genWorld();
}

function startGame() { reset(); state = 'play'; paused = false; }

/* 金币换购技能：1 护盾(50) / 2 狼坐骑(80) / 3 大鹏(100) */
function buyPower(k) {
  const n = ninja;
  if (state !== 'play' || paused || n.dead) return;
  if (k === 1) {
    if (n.shield || coins < 50) return;
    coins -= 50; n.shield = true;
    addSparkle(n.sx, n.y - 30 * S, 12);
  } else if (k === 2) {
    if (n.mount || coins < 80) return;
    coins -= 80; n.mount = 'wolf'; n.mountHP = 2;
    addDust(n.sx, n.y, 8);
  } else if (k === 3) {
    if (n.mount || coins < 100) return;
    coins -= 100; n.mount = 'roc'; n.rocM0 = distM;
    addSparkle(n.sx, n.y - 40 * S, 10);
  }
}

function die() {
  if (deadFlag) return;
  deadFlag = true;
  state = 'over';
  overT = 0; shake = 9;
  ninja.dead = true;
  ninja.vy = -520 * S;
  addBurst(ninja.sx, ninja.y - 30 * S);
  if (distM > best) { best = distM; try { localStorage.setItem('nnr_best', String(best)); } catch (e) {} }
  /* 账号存档：最佳成绩 / 奔逃次数（金币每局重置，不存档） */
  if (window.Account && Account.isLogin()) {
    const d = Account.getData();
    Account.save({ best: Math.max(d.best || 0, best), runs: (d.runs | 0) + 1 });
  }
}

/* 拾取文物：押运中 + 品质飘字 + 锦衣卫出场 + 速度突增（甩开才入藏） */
function collectRelic(rl, sx) {
  const item = rl.relic, n = ninja, R = window.ARTIFACTS.RARITY[item.rv];
  n.carried.push(item);           /* 先押运，甩开才入账 */
  addRelicBurst(sx, rl.y, R.color, item.rv >= 4 ? 30 : 18);
  popups.push({
    x: sx, y: rl.y - 44 * S, life: 0, max: 1.8,
    text: `【${R.name}】${item.name}`, color: R.color,
  });
  /* 触发或刷新追缉：满血两条命，重新计 150 米，速度再提一档 */
  n.wanted = true;
  n.lives = 2;
  n.wantedM0 = distM;
  chaser.on = true; chaser.retreat = 0; chaser.lunge = 0;
  speed = Math.min(maxSpeed + n.residual + 70 * S, speed + 55 * S);
  /* 追缉期间不再刷新任何文物：下一件要等甩开锦衣卫后才安排 */
}

/* 甩开锦衣卫后：把押运的文物全部入库 */
function stashCarried() {
  const n = ninja;
  if (!n.carried.length) return;
  for (const item of n.carried) {
    if (window.Account && Account.isLogin()) Account.addRelic(item.id);
    ownedRelics.add(item.id);
  }
  popups.push({
    x: n.sx, y: n.y - 68 * S, life: 0, max: 1.4,
    text: `入藏 ${n.carried.length} 件文物`, color: '#f0d48a',
  });
  n.carried = [];
}

/* 大鹏降落点安全检查：脚下有屋顶段，且前后 3 米内无障碍物 */
function rocLandingSafe() {
  const wxC = scroll + ninja.sx;
  let onRoof = false;
  for (const sg of segments) {
    if (wxC >= sg.x && wxC <= sg.x + sg.w) { onRoof = true; break; }
  }
  if (!onRoof) return false;
  const range = 3 * 46 * S;   /* 3 米 */
  for (const sg of segments) {
    if (sg.x > wxC + range || sg.x + sg.w < wxC - range) continue;
    for (const ob of sg.obs) {
      if (!ob.gone && Math.abs(ob.x - wxC) < range) return false;
    }
  }
  return true;
}

/* ============================================================
 * 更新
 * ============================================================ */
function update(dt) {
  t += dt;
  shake = Math.max(0, shake - 30 * dt);

  /* 云缓慢漂移 */
  for (const cl of clouds) {
    cl.x -= cl.v * S * dt;
    if (cl.x < -240 * S) cl.x = W + 240 * S;
  }

  if (state === 'play' && !paused) {
    /* 追缉中 +70S 临时极速；每次甩开保留 15S 永久余量（上限 150S） */
    const effMax = maxSpeed + ninja.residual + (ninja.wanted ? 70 * S : 0);
    speed = Math.min(effMax, speed + CFG.spAcc * S * dt);
    scroll += speed * dt;
    distM = Math.floor(scroll / (46 * S));
    ninja.hookCD = Math.max(0, ninja.hookCD - dt);   /* 钩索冷却 */

    /* --- 锦衣卫追缉：跑满 150 米甩开 --- */
    if (ninja.wanted && distM - ninja.wantedM0 >= 150) {
      ninja.wanted = false;
      ninja.residual = Math.min(150 * S, ninja.residual + 15 * S);
      chaser.on = false; chaser.retreat = 0.7;
      addSparkle(ninja.sx - 120 * S, ninja.y - 40 * S, 14);
      popups.push({ x: ninja.sx, y: ninja.y - 96 * S, life: 0, max: 1.4, text: '甩开锦衣卫！', color: '#9fe8c8' });
      stashCarried();   /* 甩开成功：押运文物入藏 */
      scheduleRelic(scroll + W * 0.6);   /* 甩开后才允许刷新下一件文物 */
    }
    chaser.runPh += clamp(speed / (110 * S), 1.4, 2.8) * dt;
    chaser.lunge = Math.max(0, chaser.lunge - dt);
    chaser.retreat = Math.max(0, chaser.retreat - dt);

    /* --- 忍者物理 --- */
    const n = ninja;
    const wx = scroll + n.sx;
    const prevY = n.y;
    n.inv = Math.max(0, n.inv - dt);

    if (n.mount === 'roc') {
      /* ---- 大鹏飞行：高空平飞，免疫一切障碍；满 100 米后飞走 ---- */
      const ty = baseGround - 170 * S;
      n.y += (ty - n.y) * Math.min(1, 6 * dt);
      n.vy = 0; n.grounded = false;
      n.coyote = 0; n.buffer -= dt;
      if (distM - n.rocM0 >= 100) {
        /* 满 100 米后找安全点降落：脚下有屋顶、前后 3 米无障碍；否则继续飞 */
        if (rocLandingSafe() || distM - n.rocM0 >= 140) {   /* 140 米强制兜底 */
          n.mount = null; n.vy = 160 * S;   /* 大鹏飞走，忍者回落 */
          n.inv = Math.max(n.inv, 0.8);     /* 落地短暂无敌，防贴脸障碍 */
          addBurst(n.sx + 20 * S, n.y);
        }
      }
    } else if (n.grap) {
      /* ---- 钩索摆动：单摆积分（绕前方檐口锚点荡秋千） ---- */
      const g = n.grap;
      g.t += dt;
      g.om -= (CFG.gravity * S / g.L) * Math.sin(g.th) * dt;  /* 重力回复力矩（稳定摆） */
      if (g.om > 0) g.om = Math.min(g.om + 2.2 * dt, 3.4);     /* 荡秋千注能：向前摆持续加力 */
      g.om *= (1 - 0.06 * dt);                                 /* 轻微阻尼 */
      g.th += g.om * dt;
      const wxG = g.ax + g.L * Math.sin(g.th);
      n.y = g.ay + g.L * Math.cos(g.th);
      n.sx = wxG - scroll;
      const yDot = -g.L * g.om * Math.sin(g.th);               /* 竖直速度（负=上升） */
      const ts = g.segT;
      /* 荡过目标段左缘且升到檐口附近并上升中 → 脱钩，抛物线落上屋檐 */
      if ((scroll + n.sx) > ts.x + 20 * S && n.y <= ts.y + 18 * S && yDot < 0) {
        n.grap = null;
        n.grounded = false;
        n.vy = clamp(yDot * 0.75, -560 * S, -180 * S);
        n.stretch = 0.7;
        addDust(n.sx, n.y, 4);
      } else if (g.t > 3.4) { n.grap = null; }                 /* 超时安全网 */
      n.coyote = 0; n.buffer -= dt;
    } else {
      n.vy += CFG.gravity * S * dt;
      n.y += n.vy * dt;
      n.coyote -= dt; n.buffer -= dt;

      if (n.y > baseGround + 260 * S) { die(); return; }

      const seg = segAt(wx);
      /* 二层阁楼平台：忍者在其高度附近且水平范围内 → 视为上层地面 */
      let effY = seg ? seg.y : null;
      if (seg && seg.upper && wx >= seg.upper.x && wx <= seg.upper.x + seg.upper.w && n.y <= seg.upper.y + 30 * S)
        effY = seg.upper.y;
      if (n.grounded) {
        if (effY == null) { n.grounded = false; n.coyote = 0.09; }
        else if (n.y < effY - 24 * S) { n.grounded = false; }   /* 从上层走出边缘 → 掉落 */
        else {
          n.y = effY; n.vy = 0;
          n.lastEaveY = seg.y;
          /* 步频相位随速度推进（整体放慢；限频保证节奏肉眼可辨） */
          n.runPhase += clamp(speed / (110 * S), 1.4, 2.8) * dt;
          /* 脚步落地扬尘（与步频同步） */
          const st1 = Math.sin(n.runPhase * TAU), st2 = Math.sin(n.runPhase * TAU + Math.PI);
          if (n._s1 > 0 && st1 <= 0) addDust(n.sx - 4 * S, n.y, 1);
          if (n._s2 > 0 && st2 <= 0) addDust(n.sx - 4 * S, n.y, 1);
          n._s1 = st1; n._s2 = st2;
        }
      } else if (n.vy >= 0 && effY != null && prevY <= effY + 1 && n.y >= effY) {
        n.y = effY; n.vy = 0; n.grounded = true;
        n.jumps = 0; n.squash = 1; n.spinT = 0;
        addDust(n.sx, n.y, 6);
        if (n.buffer > 0) { n.buffer = 0; tryJump(); }
      }
    }

    /* 跑动扬尘 */
    if (n.grounded && Math.random() < dt * 9) addDust(n.sx - 6 * S, n.y, 1);

    n.squash  = Math.max(0, n.squash - dt / 0.14);
    n.stretch = Math.max(0, n.stretch - dt / 0.18);
    if (n.spinT > 0) n.spinT = Math.max(0, n.spinT - dt / 0.5);
    n.blinkT -= dt;
    if (n.blinkT <= 0) { n.blinking = 0.12; n.blinkT = rand(2, 5); }
    n.blinking = Math.max(0, n.blinking - dt);

    /* --- 生成/回收 --- */
    genWorld();

    /* --- 乌鸦 --- */
    crowTimer -= dt;
    if (crowTimer <= 0 && speed > 430 * S) {
      crowTimer = rand(3.5, 6.5);
      crows.push({ x: scroll + W + 120 * S, y: baseGround - 130 * S + rand(-10, 10) * S, ph: rand(0, TAU) });
    }
    for (const cr of crows) cr.x -= 130 * S * dt;
    crows = crows.filter(cr => cr.x - scroll > -140 * S);

    /* --- 碰撞（收缩命中盒，手感宽容；钩索摆动 / 大鹏飞行 / 无敌帧跳过） --- */
    if (!n.grap && n.mount !== 'roc' && n.inv <= 0) {
      const nx = n.sx, nyTop = n.y - (n.mount === 'wolf' ? 78 : 54) * S, nbw = 24 * S;
      const nL = nx - nbw / 2, nR = nx + nbw / 2, nT = nyTop, nB = n.y;
      const takeHit = (gone) => {
        gone();                                    /* 销毁障碍/乌鸦 */
        n.inv = 0.9;
        addBurst(nx, n.y - 34 * S);
        if (n.mount === 'wolf') {
          n.mountHP--;
          if (n.mountHP <= 0) { n.mount = null; addDust(nx, n.y, 10); }  /* 狼伤重退场 */
        } else if (n.shield) {
          n.shield = false;
        } else if (n.wanted) {
          /* 锦衣卫追缉中：两条命——掉一条命，闪烁 1 秒，第二条用完被拿下 */
          n.lives--;
          n.inv = 1.0;
          chaser.lunge = 0.45;
          shake = 7;
          if (n.lives <= 0) { die(); return false; }
          popups.push({ x: nx, y: n.y - 90 * S, life: 0, max: 1.2, text: `还剩 ${n.lives} 条命！`, color: '#ff7a6b' });
        } else {
          die(); return false;
        }
        return true;
      };
      for (const sg of segments) {
        if (sg.x > scroll + W + 60 || sg.x + sg.w < scroll - 60) continue;
        for (const ob of sg.obs) {
          if (ob.gone) continue;
          const ox = ob.x - scroll;
          const w2 = (ob.type === 'jar' ? 13 : 15) * S;
          const h2 = (ob.type === 'jar' ? 34 : 38) * S;
          if (nR > ox - w2 + 4 * S && nL < ox + w2 - 4 * S && nB > ob.y - h2 && nT < ob.y) {
            if (!takeHit(() => { ob.gone = true; })) return;
          }
        }
      }
      for (const cr of crows) {
        if (cr.gone) continue;
        const cx = cr.x - scroll;
        if (nR > cx - 13 * S && nL < cx + 13 * S && nB > cr.y - 8 * S && nT < cr.y + 8 * S) {
          /* 狼会吃掉鸟（不耗耐久），护盾抵一次，否则死亡 */
          if (n.mount === 'wolf') {
            cr.gone = true;
            addSparkle(cx, cr.y, 8);
            addBurst(cx, cr.y);
          } else if (!takeHit(() => { cr.gone = true; })) return;
        }
      }
    }

    /* --- 拾取铜钱 / 钩索道具 --- */
    const pcx = n.sx, pcy = n.y - 30 * S;
    const pick = (c) => {
      if (c.got) return;
      const sx2 = c.x - scroll;
      if (Math.abs(sx2 - pcx) < 30 * S && Math.abs(c.y - pcy) < 34 * S) {
        c.got = true; coins += 3; addSparkle(sx2, c.y, 6);   /* 每枚按 ×3 计入 */
      }
    };
    for (const sg of segments) for (const c of sg.coins) pick(c);
    for (const c of gapCoins) pick(c);
    /* 上层阁楼铜钱 */
    for (const sg of segments) if (sg.upper) for (const c of sg.upper.coins) pick(c);
    /* 钩索道具拾取（携带上限 5） */
    for (const sg of segments) {
      const hk = sg.hook;
      if (!hk || hk.got) continue;
      const hx = hk.x - scroll;
      if (Math.abs(hx - pcx) < 30 * S && Math.abs(hk.y - pcy) < 36 * S) {
        hk.got = true;
        if (n.hooks < 5) { n.hooks++; addSparkle(hx, hk.y, 8); }
      }
    }

    /* --- 文物展品拾取 → 入藏 / 触发锦衣卫追缉 / 提速 --- */
    for (const rl of relics) {
      if (rl.got) continue;
      const rxx = rl.x - scroll;
      if (Math.abs(rxx - pcx) < 34 * S && Math.abs(rl.y - pcy) < 52 * S) {
        rl.got = true;
        collectRelic(rl, rxx);
      }
    }
    /* 飘字上升 */
    for (const p of popups) { p.life += dt; p.y -= 34 * S * dt; }
    popups = popups.filter(p => p.life < p.max);

  } else if (state === 'menu') {
    /* 忍者原地待机（呼吸起伏） */
    ninja.y = baseGround + Math.sin(t * 2.2) * 1.5 * S;
    ninja.blinkT -= dt;
    if (ninja.blinkT <= 0) { ninja.blinking = 0.12; ninja.blinkT = rand(2, 5); }
    ninja.blinking = Math.max(0, ninja.blinking - dt);
  } else if (state === 'over') {
    overT += dt;
    if (ninja.dead) {
      ninja.vy += CFG.gravity * 0.7 * S * dt;
      ninja.y += ninja.vy * dt;
      ninja.deadRot += dt * 5;
    }
  }

  updateParts(dt);
}

/* ============================================================
 * 绘制 —— 背景
 * ============================================================ */
function drawSky() {
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  /* 星星 */
  for (const st of stars) {
    const a = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.8 + st.ph));
    ctx.globalAlpha = a;
    ctx.fillStyle = st.c;
    const sx = mod(st.x - t * 2 * S, W + 4) - 2;
    ctx.beginPath(); ctx.arc(sx, st.y, st.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* 云（画在月亮后面，避免遮月形成黑带） */
  ctx.fillStyle = 'rgba(28,34,66,0.45)';
  for (const cl of clouds) {
    const cx = cl.x, cy = cl.y, s = cl.s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 64 * s, 13 * s, 0, 0, TAU);
    ctx.ellipse(cx + 38 * s, cy - 8 * s, 40 * s, 11 * s, 0, 0, TAU);
    ctx.ellipse(cx - 40 * s, cy - 5 * s, 34 * s, 9 * s, 0, 0, TAU);
    ctx.fill();
  }

  /* 月亮 + 光晕 */
  const mx = W * 0.76, my = H * 0.19, mr = 34 * S;
  ctx.fillStyle = moonGlow;
  ctx.fillRect(mx - mr * 3.4, my - mr * 3.4, mr * 6.8, mr * 6.8);
  ctx.fillStyle = '#f5f0da';
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(210,204,180,0.6)';
  ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.16, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.11, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(mx + mr * 0.05, my - mr * 0.45, mr * 0.09, 0, TAU); ctx.fill();
}

function drawFar() {
  const off = scroll * 0.12 % farFW;
  for (const it of farItems) {
    const sx0 = mod(it.x - off, farFW);
    for (const sx of [sx0, sx0 - farFW]) {
      if (sx > W + 100 || sx + it.w < -100) continue;
      ctx.globalAlpha = it.a;
      ctx.fillStyle = '#10142e';
      const base = baseGround + 30 * S;
      /* 剪影重檐屋顶：两端飞檐翘角的庑殿顶轮廓 */
      const silRoof = (xL, xR, ry, ey, lift, oh) => {
        ctx.beginPath();
        ctx.moveTo(xL - oh, ry - lift);
        ctx.quadraticCurveTo(xL - 3 * S, ey - (ey - ry) * 0.25, xL, ey);
        ctx.lineTo(xR, ey);
        ctx.quadraticCurveTo(xR + 3 * S, ey - (ey - ry) * 0.25, xR + oh, ry - lift);
        ctx.lineTo(xR + oh - 2 * S, ry - lift + (ey - ry) * 0.5);
        ctx.quadraticCurveTo((xL + xR) / 2, ey + 3 * S, xL - oh + 2 * S, ry - lift + (ey - ry) * 0.5);
        ctx.closePath(); ctx.fill();
      };
      const h = it.h;
      const b = (k) => base - h * k;
      if (it.kind === 'pagoda') {
        /* 太和殿式大殿：三层台基 + 重檐庑殿顶 + 高柱屋身 */
        ctx.fillRect(sx - 8 * S, b(0.12), it.w + 16 * S, h * 0.04);
        ctx.fillRect(sx - 4 * S, b(0.08), it.w + 8 * S, h * 0.04);
        /* 下层屋身（柱廊） */
        ctx.fillRect(sx + 3 * S, b(0.40), it.w - 6 * S, h * 0.29);
        /* 下层檐（宽大） */
        silRoof(sx - 1 * S, sx + it.w + 1 * S, b(0.47), b(0.39), h * 0.05, 15 * S);
        /* 上层高柱屋身（收分） */
        ctx.fillRect(sx + 11 * S, b(0.74), it.w - 22 * S, h * 0.29);
        /* 上层重檐大屋顶 */
        silRoof(sx - 3 * S, sx + it.w + 3 * S, b(1.0), b(0.72), h * 0.07, 22 * S);
        /* 正脊与鸱吻剪影 */
        ctx.fillRect(sx + it.w * 0.16, b(1.0) - 2.4 * S, it.w * 0.68, 2.6 * S);
        ctx.beginPath();
        ctx.moveTo(sx + it.w * 0.13, b(1.0)); ctx.lineTo(sx + it.w * 0.16, b(1.0) - 7 * S); ctx.lineTo(sx + it.w * 0.19, b(1.0));
        ctx.moveTo(sx + it.w * 0.87, b(1.0)); ctx.lineTo(sx + it.w * 0.84, b(1.0) - 7 * S); ctx.lineTo(sx + it.w * 0.81, b(1.0));
        ctx.closePath(); ctx.fill();
        /* 宝顶 */
        ctx.fillRect(sx + it.w / 2 - 1.2 * S, b(1.0) - 12 * S, 2.4 * S, 10 * S);
        ctx.beginPath(); ctx.arc(sx + it.w / 2, b(1.0) - 13 * S, 2.8 * S, 0, TAU); ctx.fill();
      } else if (it.kind === 'gate') {
        /* 午门式城楼：高城台（三拱门）+ 重檐城楼 */
        const wallTop = base - h * 0.52;
        ctx.fillRect(sx, wallTop, it.w, h * 0.52);
        /* 三个拱门洞 */
        ctx.fillStyle = '#080c22';
        for (let i = -1; i <= 1; i++) {
          const ax = sx + it.w * (0.5 + i * 0.26), aw = it.w * 0.11;
          ctx.beginPath();
          ctx.moveTo(ax - aw, base);
          ctx.lineTo(ax - aw, wallTop + h * 0.20);
          ctx.arc(ax, wallTop + h * 0.20, aw, Math.PI, 0);
          ctx.lineTo(ax + aw, base);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#10142e';
        /* 城台顶沿 */
        ctx.fillRect(sx - 3 * S, wallTop - 3 * S, it.w + 6 * S, 3 * S);
        /* 下层檐 */
        const twL = sx + it.w * 0.08, twR = sx + it.w * 0.92;
        silRoof(twL, twR, wallTop - h * 0.13, wallTop - h * 0.05, h * 0.04, 13 * S);
        /* 城楼屋身 */
        ctx.fillRect(twL + 6 * S, wallTop - h * 0.34, twR - twL - 12 * S, h * 0.20);
        /* 上层重檐屋顶 */
        silRoof(twL - 2 * S, twR + 2 * S, wallTop - h * 0.46, wallTop - h * 0.32, h * 0.05, 16 * S);
        ctx.fillRect(sx + it.w * 0.28, wallTop - h * 0.48, it.w * 0.44, 2.2 * S);
      } else {
        /* 配殿：石台基 + 柱廊 + 单檐庑殿 */
        ctx.fillRect(sx - 5 * S, base - h * 0.08, it.w + 10 * S, h * 0.08);
        ctx.fillRect(sx + 2 * S, base - h * 0.52, it.w - 4 * S, h * 0.44);
        silRoof(sx - 1 * S, sx + it.w + 1 * S, base - h, base - h * 0.52, h * 0.06, 15 * S);
        ctx.fillRect(sx + it.w * 0.2, base - h - 2 * S, it.w * 0.6, 2 * S);
      }
      ctx.globalAlpha = 1;
    }
  }
}

function drawMid() {
  const off = scroll * 0.35 % midFW;
  for (const it of midItems) {
    const sx0 = mod(it.x - off, midFW);
    for (const sx of [sx0, sx0 - midFW]) {
      if (sx > W + 60 || sx + it.w < -60) continue;
      const bottom = baseGround + 26 * S;
      const top = bottom - it.h;
      const bw = it.w;
      const MC = {
        wall: '#5c1416', col: '#742020', colL: '#922c2c', deep: '#3a0d12',
        tile: '#8f7128', tileD: '#6d541c', ridge: '#5e1616', gold: '#a88428',
        stone: '#6b665a', stoneD: '#4a463c', stoneL: '#8a857a', ink: '#240a10'
      };
      const nBays = Math.max(2, Math.round(bw / (42 * S)));
      const isLit = (i) => it.wins.some(w => w.x > bw * (i / nBays) && w.x < bw * ((i + 1) / nBays) && w.on);
      /* 菱花格心：暗色窗棂压在暖色窗纸上 */
      const lattice = (x0, x1, y0, y1, lit) => {
        ctx.strokeStyle = lit ? 'rgba(74,28,16,0.55)' : 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 0.9 * S;
        const cw = x1 - x0;
        ctx.beginPath();
        for (let k = 1; k <= 2; k++) {
          const mx = x0 + cw * k / 3;
          ctx.moveTo(mx, y0); ctx.lineTo(mx, y1);
        }
        ctx.moveTo(x0, y0 + (y1 - y0) * 0.5); ctx.lineTo(x1, y0 + (y1 - y0) * 0.5);
        ctx.stroke();
      };

      /* 台基 */
      ctx.fillStyle = MC.stone;
      ctx.fillRect(sx - 4 * S, bottom - 7 * S, bw + 8 * S, 7 * S);
      ctx.fillStyle = 'rgba(230,226,210,0.5)';
      ctx.fillRect(sx - 4 * S, bottom - 7 * S, bw + 8 * S, 1.2 * S);

      /* ---- 中景通用构件 ---- */
      const drawBayWall = (wx0, wx1, wy0, wy1, n) => {
        /* 柱分间 + 菱花窗墙身 */
        ctx.fillStyle = MC.wall; ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
        for (let i = 0; i <= n; i++) {
          const cx = wx0 + (wx1 - wx0) * (i / n);
          ctx.fillStyle = MC.col;
          ctx.fillRect(cx - 1.6 * S, wy0, 3.2 * S, wy1 - wy0);
          ctx.fillStyle = MC.colL;
          ctx.fillRect(cx + 0.4 * S, wy0, 0.8 * S, wy1 - wy0);
        }
        for (let i = 0; i < n; i++) {
          const bx0 = wx0 + (wx1 - wx0) * (i / n) + 3 * S, bx1 = wx0 + (wx1 - wx0) * ((i + 1) / n) - 3 * S;
          const lit = isLit(i);
          ctx.fillStyle = lit ? 'rgba(232,178,92,0.42)' : MC.deep;
          ctx.fillRect(bx0, wy0 + 3 * S, bx1 - bx0, wy1 - wy0 - 6 * S);
          lattice(bx0 + 1 * S, bx1 - 1 * S, wy0 + 5 * S, wy1 - 4 * S, lit);
        }
      };
      /* 直坡瓦面（悬山/硬山：两坡向中央短脊收拢，无翘角，区别于主殿庑殿） */
      const gableRoof = (rx0, rx1, ry, ey, ridgeHalf) => {
        const cxm = sx + bw / 2;
        ctx.fillStyle = MC.tile;
        ctx.beginPath();
        ctx.moveTo(rx0, ey);
        ctx.quadraticCurveTo(rx0 + (cxm - rx0) * 0.55, ry + (ey - ry) * 0.72, cxm - ridgeHalf, ry);
        ctx.lineTo(cxm + ridgeHalf, ry);
        ctx.quadraticCurveTo(rx1 - (rx1 - cxm) * 0.45, ry + (ey - ry) * 0.72, rx1, ey);
        ctx.lineTo(rx1 - 3 * S, ey + 3.5 * S);
        ctx.quadraticCurveTo(cxm, ey + 5.5 * S, rx0 + 3 * S, ey + 3.5 * S);
        ctx.closePath(); ctx.fill();
        /* 瓦垄（自檐口向脊收） */
        ctx.strokeStyle = MC.tileD; ctx.lineWidth = 0.8 * S;
        ctx.beginPath();
        for (let tx = rx0 + 5 * S; tx < cxm - ridgeHalf; tx += 8 * S) {
          const u = 1 - (tx - rx0) / (cxm - ridgeHalf - rx0);
          ctx.moveTo(tx, ey - 1 * S); ctx.lineTo(cxm - ridgeHalf * u, ry + 1 * S);
          ctx.moveTo(rx1 - (tx - rx0), ey - 1 * S); ctx.lineTo(cxm + ridgeHalf * u, ry + 1 * S);
        }
        ctx.stroke();
        /* 短正脊 */
        ctx.fillStyle = MC.ridge;
        ctx.fillRect(cxm - ridgeHalf - 3 * S, ry - 2.4 * S, ridgeHalf * 2 + 6 * S, 2.8 * S);
      };

      if (it.kind === 'tower') {
        /* 钟楼：高台基 + 平座栏杆 + 收分塔身 + 腰檐 + 攒尖宝顶 */
        const skirtH = 13 * S;
        ctx.fillStyle = MC.stoneD;
        ctx.fillRect(sx - 6 * S, bottom - skirtH, bw + 12 * S, skirtH);
        ctx.fillStyle = MC.stone;
        ctx.fillRect(sx - 2 * S, bottom - skirtH - 4 * S, bw + 4 * S, 5 * S);
        /* 平座栏杆 */
        const balT = bottom - skirtH - 4 * S;
        ctx.fillStyle = MC.stoneL;
        ctx.fillRect(sx - 2 * S, balT - 8 * S, bw + 4 * S, 1.6 * S);
        ctx.fillRect(sx - 2 * S, balT - 2.5 * S, bw + 4 * S, 1.6 * S);
        for (let px = sx + 2 * S; px < sx + bw; px += 12 * S)
          ctx.fillRect(px - 1 * S, balT - 8 * S, 2 * S, 8 * S);
        /* 下层塔身（收分） */
        const bodyT = balT - 2.5 * S, midT = top + it.h * 0.30;
        drawBayWall(sx + 2 * S, sx + bw - 2 * S, midT, bodyT, Math.max(2, Math.round(bw / (30 * S))));
        /* 腰檐（四坡窄檐） */
        const mw = bw * 0.62;
        ctx.fillStyle = MC.tile;
        ctx.beginPath();
        ctx.moveTo(sx + (bw - mw) / 2 - 8 * S, midT);
        ctx.quadraticCurveTo(sx + bw / 2, midT - 7 * S, sx + (bw + mw) / 2 + 8 * S, midT);
        ctx.lineTo(sx + (bw + mw) / 2 + 3 * S, midT + 3.5 * S);
        ctx.quadraticCurveTo(sx + bw / 2, midT - 1 * S, sx + (bw - mw) / 2 - 3 * S, midT + 3.5 * S);
        ctx.closePath(); ctx.fill();
        /* 上层短身 */
        const uw = bw * 0.58;
        drawBayWall(sx + (bw - uw) / 2, sx + (bw + uw) / 2, top + 10 * S, midT - 1 * S, 2);
        /* 攒尖顶 + 宝顶珠 */
        ctx.fillStyle = MC.tile;
        ctx.beginPath();
        ctx.moveTo(sx + (bw - uw) / 2 - 9 * S, top + 10 * S);
        ctx.quadraticCurveTo(sx + bw * 0.32, top - 3 * S, sx + bw / 2, top);
        ctx.quadraticCurveTo(sx + bw * 0.68, top - 3 * S, sx + (bw + uw) / 2 + 9 * S, top + 10 * S);
        ctx.lineTo(sx + (bw + uw) / 2 + 3 * S, top + 13.5 * S);
        ctx.quadraticCurveTo(sx + bw / 2, top + 6 * S, sx + (bw - uw) / 2 - 3 * S, top + 13.5 * S);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = MC.gold;
        ctx.beginPath(); ctx.arc(sx + bw / 2, top - 4 * S, 3.4 * S, 0, TAU); ctx.fill();
        ctx.fillRect(sx + bw / 2 - 1 * S, top - 2 * S, 2 * S, 4 * S);
      } else if (it.kind === 'shop') {
        /* 铺面：高柱廊开间 + 腰檐雨棚 + 上层矮墙 + 悬山瓦顶 + 幌子 */
        const wallT = top + it.h * 0.30;
        drawBayWall(sx, sx + bw, wallT, bottom - 7 * S, nBays);
        /* 腰檐雨棚（出挑窄檐） */
        ctx.fillStyle = MC.tile;
        ctx.beginPath();
        ctx.moveTo(sx - 9 * S, wallT);
        ctx.quadraticCurveTo(sx + 4 * S, wallT - 6 * S, sx + bw * 0.5 - 4 * S, wallT - 7 * S);
        ctx.lineTo(sx + bw * 0.5 + 4 * S, wallT - 7 * S);
        ctx.quadraticCurveTo(sx + bw - 4 * S, wallT - 6 * S, sx + bw + 9 * S, wallT);
        ctx.lineTo(sx + bw + 6 * S, wallT + 3.5 * S);
        ctx.quadraticCurveTo(sx + bw / 2, wallT - 2 * S, sx - 6 * S, wallT + 3.5 * S);
        ctx.closePath(); ctx.fill();
        /* 上层矮墙（亮窗） */
        drawBayWall(sx + 4 * S, sx + bw - 4 * S, top + 9 * S, wallT - 7 * S, nBays);
        /* 悬山大屋顶 */
        gableRoof(sx - 8 * S, sx + bw + 8 * S, top, top + 9 * S, bw * 0.16);
        /* 幌子：檐口挑杆 + 竖布幌（轻摆） */
        if (it.banner) {
          const px = sx + bw * (0.72 + Math.sin(it.lph) * 0.1);
          const sway = Math.sin(t * 1.8 + it.lph) * 0.1;
          ctx.strokeStyle = MC.ink; ctx.lineWidth = 1.4 * S;
          ctx.beginPath(); ctx.moveTo(px, top + 10 * S); ctx.lineTo(px + 10 * S, top + 14 * S); ctx.stroke();
          ctx.save();
          ctx.translate(px + 10 * S, top + 14 * S); ctx.rotate(sway);
          ctx.fillStyle = '#8f3a2a';
          ctx.fillRect(-2.5 * S, 0, 5 * S, 16 * S);
          ctx.fillStyle = 'rgba(244,193,78,0.85)';
          ctx.fillRect(-2.5 * S, 3 * S, 5 * S, 1.6 * S);
          ctx.fillRect(-2.5 * S, 8 * S, 5 * S, 1.6 * S);
          ctx.restore();
        }
      } else {
        /* 民居：矮墙 + 硬山双坡直脊顶（朴素，无斗栱无翘角） */
        const wallT = top + it.h * 0.24;
        drawBayWall(sx, sx + bw, wallT, bottom - 7 * S, nBays);
        gableRoof(sx - 6 * S, sx + bw + 6 * S, top, wallT, bw * 0.2);
      }

      /* 檐角红灯笼 */
      if (it.lantern) {
        const sway = Math.sin(t * 1.6 + it.lph) * 0.12;
        const lx = sx - 8 * S, ly = top + 2 * S;
        ctx.strokeStyle = '#3a0808'; ctx.lineWidth = 1.5 * S;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.sin(sway) * 8 * S, ly + 12 * S); ctx.stroke();
        const bx = lx + Math.sin(sway) * 8 * S, by = ly + 12 * S;
        ctx.fillStyle = 'rgba(226,80,63,0.18)';
        ctx.beginPath(); ctx.arc(bx, by + 7 * S, 12 * S, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e2503f';
        roundRect(ctx, bx - 4.5 * S, by, 9 * S, 13 * S, 4 * S); ctx.fill();
        ctx.fillStyle = '#f4c14e';
        ctx.fillRect(bx - 4.5 * S, by + 2 * S, 9 * S, 1.6 * S);
      }
    }
  }

  /* 萤火虫 */
  for (const f of flies) {
    f.x += Math.sin(t * 0.7 + f.ph) * f.sp * S * 0.016;
    f.y += Math.cos(t * 0.9 + f.ph * 2) * f.sp * S * 0.011;
    if (f.x < -10) f.x = W + 10; if (f.x > W + 10) f.x = -10;
    const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3 + f.ph * 3));
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath(); ctx.arc(f.x, f.y, 1.8 * S, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ============================================================
 * 绘制 —— 紫禁城宫殿立面（重檐庑殿 / 斗栱 / 朱柱 / 台基）
 * ============================================================ */
const PAL = {
  wall: '#7c1d1d', wallDark: '#5e1414', wallDeep: '#43101a',
  col: '#b03333', colL: '#d44b4b', colD: '#872020', beam: '#932626',
  tile: '#d2a93c', tileL: '#eccb62', tileD: '#a88428', tileShade: '#8a6a1e',
  ridge: '#8e2323', ridgeL: '#c23a3a', ridgeD: '#5a1313', gold: '#e8c45e',
  dgTeal: '#41706a', dgTealD: '#2b4a46', dgRed: '#6e1a1a',
  winDark: '#260b12', winGlow: 'rgba(245,196,102,0.62)', winFrame: '#380d12',
  stone: '#cfcabd', stoneL: '#e4e0d4', stoneD: '#a8a290', stoneSh: '#8a8472',
  beast: '#571313', ink: '#12060a'
};

/* 朱红立柱（含柱头/柱础） */
function paintColumn(cx, y0, y1) {
  const w = 5.4 * S;
  ctx.fillStyle = PAL.colD;
  roundRect(ctx, cx - w, y0, w * 2, y1 - y0, w * 0.55); ctx.fill();
  ctx.fillStyle = PAL.col;
  roundRect(ctx, cx - w * 0.92, y0, w * 1.72, y1 - y0, w * 0.55); ctx.fill();
  ctx.fillStyle = PAL.colL;
  ctx.fillRect(cx + w * 0.28, y0 + 2 * S, 1.5 * S, y1 - y0 - 4 * S);
  ctx.fillStyle = PAL.beam;
  ctx.fillRect(cx - w * 1.55, y0 - 2 * S, w * 3.1, 3.4 * S);
  ctx.fillRect(cx - w * 1.55, y1 - 1.4 * S, w * 3.1, 3.4 * S);
}

/* 菱花格窗 / 隔扇门（开间内填充） */
function paintBay(px0, px1, y0, y1, bay, door) {
  const inset = 4.2 * S, pad = 2.6 * S;
  const ax0 = px0 + inset, ax1 = px1 - inset;
  ctx.fillStyle = PAL.wallDeep;
  ctx.fillRect(ax0, y0, ax1 - ax0, y1 - y0);
  const gx0 = ax0 + pad, gx1 = ax1 - pad;
  const gy0 = y0 + pad, gy1 = y1 - pad;
  ctx.fillStyle = bay.lit ? PAL.winGlow : PAL.winDark;
  ctx.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
  /* 隔扇门的裙板（下半实板） */
  if (door) {
    ctx.fillStyle = bay.lit ? 'rgba(120,40,30,0.55)' : 'rgba(40,12,16,0.9)';
    ctx.fillRect(gx0, gy0 + (gy1 - gy0) * 0.62, gx1 - gx0, (gy1 - gy0) * 0.38);
  }
  /* 外框 */
  ctx.strokeStyle = PAL.winFrame;
  ctx.lineWidth = 1.8 * S;
  ctx.strokeRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
  /* 菱花格纹 */
  ctx.strokeStyle = bay.lit ? 'rgba(96,32,12,0.9)' : 'rgba(150,110,60,0.4)';
  ctx.lineWidth = 1 * S;
  ctx.beginPath();
  if (bay.lattice === 'diamond') {
    const step = 8 * S;
    for (let gx = gx0; gx <= gx1 + step; gx += step) {
      ctx.moveTo(gx, gy0); ctx.lineTo(gx - (gy1 - gy0), gy1);
      ctx.moveTo(gx, gy0); ctx.lineTo(gx + (gy1 - gy0), gy1);
    }
  } else {
    for (let gx = gx0 + 7 * S; gx < gx1; gx += 7 * S) { ctx.moveTo(gx, gy0); ctx.lineTo(gx, gy1); }
    for (let gy = gy0 + 8 * S; gy < gy1; gy += 8 * S) { ctx.moveTo(gx0, gy); ctx.lineTo(gx1, gy); }
  }
  ctx.stroke();
}

/* 一整层屋身（墙身 + 朱柱分间 + 菱花窗） */
function paintStory(x0, x1, y0, y1, bays) {
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = PAL.wallDark;
  ctx.fillRect(x0, y0, 6 * S, y1 - y0);
  ctx.fillStyle = 'rgba(220,80,70,0.13)';
  ctx.fillRect(x1 - 7 * S, y0, 7 * S, y1 - y0);
  const n = bays.length;
  for (let i = 0; i <= n; i++)
    paintColumn(x0 + (x1 - x0) * (i / n), y0, y1);
  for (let i = 0; i < n; i++) {
    const bx0 = x0 + (x1 - x0) * (i / n);
    const bx1 = x0 + (x1 - x0) * ((i + 1) / n);
    paintBay(bx0, bx1, y0 + 2 * S, y1 - 2 * S, bays[i], bays[i].door);
  }
}

/* 和玺彩画额枋（青金绿相间的彩绘梁枋） */
function paintCaihua(x0, x1, y, h) {
  ctx.fillStyle = PAL.dgRed;
  ctx.fillRect(x0, y, x1 - x0, h);
  ctx.fillStyle = PAL.dgTealD;
  for (let gx = x0; gx < x1; gx += 14 * S)
    ctx.fillRect(gx + 2 * S, y + 1.5 * S, 6 * S, h - 3 * S);
  ctx.fillStyle = PAL.gold;
  ctx.fillRect(x0, y + 0.8 * S, x1 - x0, 1.2 * S);
  ctx.fillRect(x0, y + h - 2 * S, x1 - x0, 1.2 * S);
}

/* 斗栱层（檐下密集的叠涩斗栱剪影） */
function paintDougong(x0, x1, yTop, h) {
  ctx.fillStyle = 'rgba(20,6,10,0.55)';
  ctx.fillRect(x0, yTop, x1 - x0, h);
  for (let gx = x0 + 5 * S; gx < x1; gx += 12.5 * S) {
    ctx.fillStyle = PAL.dgRed;
    ctx.fillRect(gx - 2 * S, yTop + h - 3.4 * S, 4 * S, 3.4 * S);          /* 大斗 */
    ctx.fillStyle = PAL.dgTeal;
    ctx.fillRect(gx - 5.5 * S, yTop + h - 6.4 * S, 11 * S, 3 * S);          /* 横栱 */
    ctx.fillStyle = PAL.dgTealD;
    ctx.fillRect(gx - 1.6 * S, yTop + 1 * S, 3.2 * S, h - 6.6 * S);         /* 升 */
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(gx - 6 * S, yTop + 1.2 * S, 12 * S, 1.3 * S);
  }
}

/* 琉璃瓦檐板（带翘角的一整片屋檐） */
function paintEaveSlab(x0, x1, yTop, thick, lift) {
  const ext = 24 * S;
  ctx.fillStyle = PAL.tile;
  ctx.beginPath();
  ctx.moveTo(x0 - ext, yTop - lift);
  ctx.quadraticCurveTo(x0 - 8 * S, yTop + 1 * S, x0 + 3 * S, yTop);
  ctx.lineTo(x1 - 3 * S, yTop);
  ctx.quadraticCurveTo(x1 + 8 * S, yTop + 1 * S, x1 + ext, yTop - lift);
  ctx.lineTo(x1 + ext - 2 * S, yTop - lift + thick * 0.55);
  ctx.quadraticCurveTo(x1 + 7 * S, yTop + thick, x1 - 3 * S, yTop + thick);
  ctx.lineTo(x0 + 3 * S, yTop + thick);
  ctx.quadraticCurveTo(x0 - 7 * S, yTop + thick, x0 - ext + 2 * S, yTop - lift + thick * 0.55);
  ctx.closePath(); ctx.fill();
  /* 筒瓦瓦垄 */
  ctx.strokeStyle = PAL.tileD;
  ctx.lineWidth = 1.3 * S;
  ctx.beginPath();
  for (let gx = x0 + 6 * S; gx < x1 - 4 * S; gx += 11 * S) {
    ctx.moveTo(gx, yTop + 1.5 * S);
    ctx.lineTo(gx, yTop + thick - 1 * S);
  }
  ctx.stroke();
  ctx.strokeStyle = PAL.tileL;
  ctx.lineWidth = 0.7 * S;
  ctx.beginPath();
  for (let gx = x0 + 7.5 * S; gx < x1 - 4 * S; gx += 11 * S) {
    ctx.moveTo(gx, yTop + 2 * S);
    ctx.lineTo(gx, yTop + thick - 1.5 * S);
  }
  ctx.stroke();
  /* 檐口阴影 + 瓦当 + 滴水 */
  ctx.fillStyle = PAL.tileShade;
  ctx.fillRect(x0 + 2 * S, yTop + thick - 3.2 * S, x1 - x0 - 4 * S, 3.2 * S);
  for (let gx = x0 + 5 * S; gx < x1 - 3 * S; gx += 11 * S) {
    ctx.fillStyle = PAL.tileL;
    ctx.beginPath(); ctx.arc(gx, yTop + thick - 2.6 * S, 2.4 * S, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = PAL.tileShade;
    ctx.beginPath();
    ctx.moveTo(gx + 4 * S, yTop + thick - 0.6 * S);
    ctx.lineTo(gx + 6.6 * S, yTop + thick - 0.6 * S);
    ctx.lineTo(gx + 5.3 * S, yTop + thick + 2.6 * S);
    ctx.closePath(); ctx.fill();
  }
}

/* 鸱吻（正脊两端大吻：龙首吞脊，卷鼻、角、眼、鳞） */
function paintChiwen(cx, topY, dir) {
  ctx.fillStyle = PAL.ridgeD;
  ctx.beginPath();
  ctx.moveTo(cx, topY + 6 * S);
  ctx.quadraticCurveTo(cx + dir * 13 * S, topY - 2 * S, cx + dir * 11 * S, topY - 15 * S);
  ctx.quadraticCurveTo(cx + dir * 6 * S, topY - 26 * S, cx - dir * 1 * S, topY - 23 * S);
  ctx.quadraticCurveTo(cx - dir * 5 * S, topY - 14 * S, cx - dir * 1.5 * S, topY - 6 * S);
  ctx.closePath(); ctx.fill();
  /* 背脊金线（夜空中勾勒龙首轮廓） */
  ctx.strokeStyle = PAL.gold; ctx.lineWidth = 1.1 * S;
  ctx.beginPath();
  ctx.moveTo(cx - dir * 1.2 * S, topY - 6 * S);
  ctx.quadraticCurveTo(cx - dir * 5 * S, topY - 14 * S, cx + dir * 1 * S, topY - 23 * S);
  ctx.quadraticCurveTo(cx + dir * 6.5 * S, topY - 25 * S, cx + dir * 10.5 * S, topY - 15 * S);
  ctx.stroke();
  /* 张开的嘴（吞脊） */
  ctx.fillStyle = PAL.ink;
  ctx.beginPath();
  ctx.moveTo(cx + dir * 12.5 * S, topY - 1 * S);
  ctx.quadraticCurveTo(cx + dir * 5 * S, topY + 3.5 * S, cx + dir * 1.5 * S, topY + 1 * S);
  ctx.quadraticCurveTo(cx + dir * 7 * S, topY - 3.5 * S, cx + dir * 12.5 * S, topY - 1 * S);
  ctx.closePath(); ctx.fill();
  /* 眼 */
  ctx.fillStyle = PAL.gold;
  ctx.beginPath(); ctx.arc(cx + dir * 6.5 * S, topY - 16 * S, 1.5 * S, 0, TAU); ctx.fill();
  ctx.fillStyle = PAL.ink;
  ctx.beginPath(); ctx.arc(cx + dir * 6.9 * S, topY - 16 * S, 0.7 * S, 0, TAU); ctx.fill();
  /* 角 */
  ctx.strokeStyle = PAL.ridgeL;
  ctx.lineWidth = 2 * S;
  ctx.beginPath();
  ctx.moveTo(cx + dir * 4 * S, topY - 22 * S);
  ctx.quadraticCurveTo(cx + dir * 9 * S, topY - 30 * S, cx + dir * 3 * S, topY - 31 * S);
  ctx.stroke();
  /* 鳞纹 */
  ctx.strokeStyle = PAL.ridgeL;
  ctx.lineWidth = 1 * S;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const ly = topY - 8 * S - i * 4.5 * S;
    ctx.moveTo(cx - dir * 1 * S, ly);
    ctx.quadraticCurveTo(cx + dir * 4 * S, ly - 2.5 * S, cx + dir * 8 * S, ly - 1 * S);
  }
  ctx.stroke();
}

/* 汉白玉三层台基（带栏杆望柱） */
function paintStoneBase(x0, x1, baseTop) {
  const tiers = 3, th = (H - baseTop) / tiers;
  for (let i = 0; i < tiers; i++) {
    const inset = i * 7 * S;
    const ty = baseTop + i * th;
    ctx.fillStyle = i % 2 ? PAL.stoneD : PAL.stone;
    ctx.fillRect(x0 + inset, ty, x1 - x0 - inset * 2, th + 1);
    ctx.fillStyle = PAL.stoneL;
    ctx.fillRect(x0 + inset, ty, x1 - x0 - inset * 2, 1.6 * S);
    ctx.fillStyle = PAL.stoneSh;
    ctx.fillRect(x0 + inset, ty + th - 1.4 * S, x1 - x0 - inset * 2, 1.4 * S);
  }
  /* 顶层栏杆 */
  const ry = baseTop;
  ctx.fillStyle = PAL.stoneL;
  ctx.fillRect(x0 + 2 * S, ry - 5 * S, x1 - x0 - 4 * S, 2 * S);
  ctx.fillRect(x0 + 2 * S, ry - 1.5 * S, x1 - x0 - 4 * S, 1.6 * S);
  for (let px = x0 + 10 * S; px < x1 - 8 * S; px += 22 * S) {
    ctx.fillStyle = PAL.stoneL;
    ctx.fillRect(px - 1.8 * S, ry - 11 * S, 3.6 * S, 6.5 * S);
    ctx.beginPath(); ctx.arc(px, ry - 11.5 * S, 2.6 * S, 0, TAU); ctx.fill();
  }
}

function drawRoof(sg) {
  const sx = sg.x - scroll;
  if (sx > W + 90 || sx + sg.w < -90) return;
  const y = sg.y, w = sg.w;
  /* 忍者踩踏前檐口；金色大瓦顶自檐口向后上方高耸至正脊（太和殿形制） */
  const rise = 34 * S, curl = 9 * S, ext = 30 * S, slab = 10 * S, hipIn = 18 * S;
  const ridgeY = y - rise, wallTop = y + slab;
  /* 立面各层高度按檐下可用空间比例分配（适配矮屏，避免层叠溢出） */
  const room = H - wallTop;
  const baseH = clamp(room * 0.19, 16 * S, 30 * S);
  const dgH = 9 * S, lrH = 15 * S, lDgH = 7 * S;
  let uH = room * 0.30;
  let lH = room - baseH - dgH - uH - lrH - lDgH;
  if (lH < 14 * S) { uH -= (14 * S - lH); lH = 14 * S; }
  uH = Math.max(16 * S, uH);
  const baseTop = H - baseH;
  const uTop = wallTop + dgH, lrTop = uTop + uH;
  const lwTop = lrTop + lrH + lDgH;

  /* 下层台基 → 下层屋身 → 下层檐 → 上层屋身 */
  paintStoneBase(sx - 10 * S, sx + w + 10 * S, baseTop);
  paintStory(sx, sx + w, lwTop, baseTop, sg.bays);
  paintDougong(sx - 8 * S, sx + w + 8 * S, lrTop + lrH, lDgH);
  paintEaveSlab(sx, sx + w, lrTop, lrH, 12 * S);
  paintStory(sx, sx + w, uTop, lrTop, sg.bays);
  paintCaihua(sx - 6 * S, sx + w + 6 * S, wallTop, dgH);
  paintDougong(sx - 8 * S, sx + w + 8 * S, wallTop, dgH);

  /* ---- 高耸大屋顶曲面（筒瓦瓦垄 + 垂脊 + 飞檐翘角 + 月光受光） ---- */
  const rL = sx + hipIn, rR = sx + w - hipIn;
  const tipLX = sx - ext, tipRX = sx + w + ext, tipY = y - curl;
  /* 屋面主色：脊顶受光偏亮、檐口偏暗 */
  const grad = ctx.createLinearGradient(0, ridgeY, 0, y);
  grad.addColorStop(0, PAL.tileL);
  grad.addColorStop(0.55, PAL.tile);
  grad.addColorStop(1, PAL.tileD);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(tipLX, tipY);
  ctx.quadraticCurveTo(sx - 2 * S, y + 2 * S, sx, y);
  ctx.lineTo(sx + w, y);
  ctx.quadraticCurveTo(sx + w + 2 * S, y + 2 * S, tipRX, tipY);
  ctx.quadraticCurveTo(sx + w + ext * 0.15, ridgeY + 8 * S, rR, ridgeY);
  ctx.lineTo(rL, ridgeY);
  ctx.quadraticCurveTo(sx - ext * 0.15, ridgeY + 8 * S, tipLX, tipY);
  ctx.closePath(); ctx.fill();
  /* 右上月光受光加强 */
  ctx.fillStyle = 'rgba(245,220,140,0.13)';
  ctx.beginPath();
  ctx.moveTo(sx + w * 0.5, ridgeY + 2 * S);
  ctx.lineTo(rR, ridgeY);
  ctx.quadraticCurveTo(sx + w + ext * 0.15, ridgeY + 8 * S, tipRX, tipY);
  ctx.quadraticCurveTo(sx + w * 0.78, y - 1 * S, sx + w * 0.5, y - rise * 0.35);
  ctx.closePath(); ctx.fill();
  /* 筒瓦瓦垄（脊顶聚、檐口疏，顺应庑殿收山） */
  const tileLines = (sty, lw) => {
    ctx.strokeStyle = sty; ctx.lineWidth = lw; ctx.beginPath();
    for (let ex = sx + 10 * S; ex < sx + w - 10 * S; ex += 11 * S) {
      const u = (ex - sx) / w;
      const rx = sx + hipIn + u * (w - 2 * hipIn);
      ctx.moveTo(rx, ridgeY + 2 * S);
      ctx.quadraticCurveTo(ex, ridgeY + rise * 0.45, ex, y - 2 * S);
    }
    ctx.stroke();
  };
  tileLines(PAL.tileD, 1.3 * S);
  tileLines(PAL.tileL, 0.7 * S);
  /* 垂脊（自正脊两端压向飞檐翘角） */
  ctx.strokeStyle = PAL.tileShade; ctx.lineWidth = 2.2 * S;
  ctx.beginPath();
  ctx.moveTo(rL, ridgeY); ctx.quadraticCurveTo(sx - ext * 0.2, ridgeY + rise * 0.7, tipLX, tipY);
  ctx.moveTo(rR, ridgeY); ctx.quadraticCurveTo(sx + w + ext * 0.2, ridgeY + rise * 0.7, tipRX, tipY);
  ctx.stroke();
  /* 檐口连檐板 + 瓦当 + 滴水（忍者脚下） */
  ctx.fillStyle = PAL.tileShade;
  ctx.fillRect(sx + 2 * S, y - 0.5 * S, w - 4 * S, slab);
  ctx.fillStyle = PAL.tileD;
  ctx.fillRect(sx + 2 * S, y + slab - 2 * S, w - 4 * S, 2 * S);
  for (let tx = sx + 6 * S; tx < sx + w - 2 * S; tx += 11 * S) {
    ctx.fillStyle = PAL.tileL;
    ctx.beginPath(); ctx.arc(tx, y - 0.4 * S, 2.5 * S, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = PAL.tileShade;
    ctx.beginPath();
    ctx.moveTo(tx + 4 * S, y + 0.2 * S);
    ctx.lineTo(tx + 6.8 * S, y + 0.2 * S);
    ctx.lineTo(tx + 5.4 * S, y + 3.4 * S);
    ctx.closePath(); ctx.fill();
  }
  /* 垂脊走兽 + 仙人（沿斜脊排列，院落缺口处可见） */
  const paintHipBeasts = (x0, y0, x1, y1, dir) => {
    const n = sg.beasts.length;
    for (let i = 0; i < n; i++) {
      const p = 0.28 + 0.55 * (i / Math.max(1, n));
      const bx = x0 + (x1 - x0) * p;
      const by = y0 + (y1 - y0) * (p * p * 0.3 + p * 0.7) + 2 * S;
      const bs = (3.2 - p * 0.5) * S;
      ctx.fillStyle = PAL.beast;
      ctx.beginPath(); ctx.ellipse(bx, by, bs * 1.3, bs * 0.8, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + dir * bs * 1.1, by - bs * 0.5, bs * 0.55, 0, TAU); ctx.fill();
      ctx.fillRect(bx - bs * 0.2, by + bs * 0.4, bs * 0.4, bs * 0.8);
    }
    /* 仙人骑凤（檐角最前端） */
    ctx.fillStyle = PAL.gold;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x1 + dir * 5 * S, y1 - 2 * S);
    ctx.lineTo(x1 + dir * 1.5 * S, y1 - 8 * S);
    ctx.closePath(); ctx.fill();
  };
  paintHipBeasts(rL, ridgeY, tipLX, tipY, -1);
  paintHipBeasts(rR, ridgeY, tipRX, tipY, 1);

  /* ---- 正脊（多层线脚 + 金线 + 回纹） ---- */
  ctx.fillStyle = PAL.ridge;
  roundRect(ctx, rL - 2 * S, ridgeY - 5.5 * S, w - 2 * hipIn + 4 * S, 7.5 * S, 2.5 * S); ctx.fill();
  ctx.fillStyle = PAL.ridgeD;
  ctx.fillRect(rL - 2 * S, ridgeY + 1 * S, w - 2 * hipIn + 4 * S, 1.6 * S);
  ctx.fillStyle = PAL.gold;
  ctx.fillRect(rL, ridgeY - 4.2 * S, w - 2 * hipIn, 1.2 * S);
  ctx.fillRect(rL, ridgeY - 0.8 * S, w - 2 * hipIn, 1 * S);
  ctx.strokeStyle = PAL.ridgeL;
  ctx.lineWidth = 1 * S;
  ctx.beginPath();
  for (let rx = rL + 6 * S; rx < rR - 8 * S; rx += 16 * S) {
    ctx.moveTo(rx, ridgeY - 2.8 * S); ctx.lineTo(rx + 5 * S, ridgeY - 2.8 * S);
    ctx.lineTo(rx + 5 * S, ridgeY - 1.4 * S); ctx.lineTo(rx + 9 * S, ridgeY - 1.4 * S);
  }
  ctx.stroke();
  /* 鸱吻（正脊两端大吻） */
  paintChiwen(rL, ridgeY - 4.5 * S, -1);
  paintChiwen(rR, ridgeY - 4.5 * S, 1);

  /* 檐下红灯笼（悬挂于前檐板下） */
  if (sg.lantern) {
    const px = sx + sg.lantern.x;
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2.4 * S;
    ctx.beginPath(); ctx.moveTo(px, wallTop); ctx.lineTo(px, wallTop + 26 * S); ctx.stroke();
    const sway = Math.sin(t * 2 + sg.lantern.ph) * 0.16;
    const bx = px + Math.sin(sway) * 9 * S, by = wallTop + 26 * S;
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.4 * S;
    ctx.beginPath(); ctx.moveTo(px, wallTop + 26 * S); ctx.lineTo(bx, by + 5 * S); ctx.stroke();
    ctx.fillStyle = 'rgba(226,80,63,0.2)';
    ctx.beginPath(); ctx.arc(bx, by + 13 * S, 15 * S, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d6423a';
    roundRect(ctx, bx - 6 * S, by + 5 * S, 12 * S, 17 * S, 5 * S); ctx.fill();
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(bx - 6 * S, by + 8 * S, 12 * S, 1.8 * S);
    ctx.fillRect(bx - 6 * S, by + 17 * S, 12 * S, 1.8 * S);
  }

  /* ---- 二层阁楼（可选上层路线：平座栏杆 + 短柱廊 + 歇山小顶） ---- */
  if (sg.upper) {
    const u = sg.upper;
    const ux0 = u.x - scroll, ux1 = u.x + u.w - scroll, uy = u.y;
    /* 支撑腰檐（连接主殿与上层，宽出平台） */
    ctx.fillStyle = PAL.tileD;
    ctx.beginPath();
    ctx.moveTo(ux0 - 26 * S, uy + 14 * S);
    ctx.quadraticCurveTo(ux0 - 8 * S, uy + 2 * S, ux0 + 4 * S, uy + 2 * S);
    ctx.lineTo(ux1 - 4 * S, uy + 2 * S);
    ctx.quadraticCurveTo(ux1 + 8 * S, uy + 2 * S, ux1 + 26 * S, uy + 14 * S);
    ctx.lineTo(ux1 + 20 * S, uy + 20 * S);
    ctx.quadraticCurveTo((ux0 + ux1) / 2, uy + 8 * S, ux0 - 20 * S, uy + 20 * S);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.tile; ctx.lineWidth = 1 * S;
    ctx.beginPath();
    for (let tx = ux0 - 12 * S; tx < ux1 + 12 * S; tx += 9 * S) {
      ctx.moveTo(tx, uy + 18 * S); ctx.lineTo(tx + 1.5 * S, uy + 4 * S);
    }
    ctx.stroke();
    /* 平台面 + 平座栏杆（望柱 + 望柱头） */
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(ux0 - 6 * S, uy, ux1 - ux0 + 12 * S, 4 * S);
    ctx.fillStyle = PAL.stoneL;
    ctx.fillRect(ux0 - 6 * S, uy, ux1 - ux0 + 12 * S, 1.2 * S);
    ctx.strokeStyle = PAL.stoneL; ctx.lineWidth = 1.6 * S;
    ctx.beginPath();
    ctx.moveTo(ux0 - 6 * S, uy - 9 * S); ctx.lineTo(ux1 + 6 * S, uy - 9 * S);
    ctx.moveTo(ux0 - 6 * S, uy - 3.5 * S); ctx.lineTo(ux1 + 6 * S, uy - 3.5 * S);
    ctx.stroke();
    for (let px = ux0 - 6 * S; px <= ux1 + 6 * S; px += 13 * S) {
      ctx.fillStyle = PAL.stoneL;
      ctx.fillRect(px - 1.1 * S, uy - 10 * S, 2.2 * S, 10 * S);
      ctx.beginPath(); ctx.arc(px, uy - 10.5 * S, 1.6 * S, 0, TAU); ctx.fill();
    }
    /* 上层短柱廊（内缩，亮窗） */
    const inY = uy - 34 * S;
    ctx.fillStyle = PAL.wall;
    ctx.fillRect(ux0 + 6 * S, inY, ux1 - ux0 - 12 * S, uy - 10 * S - inY);
    const uBays = Math.max(2, Math.round((ux1 - ux0) / (52 * S)));
    for (let i = 0; i <= uBays; i++) {
      const cx = ux0 + 6 * S + (ux1 - ux0 - 12 * S) * (i / uBays);
      ctx.fillStyle = PAL.col;
      ctx.fillRect(cx - 1.5 * S, inY, 3 * S, uy - 10 * S - inY);
      ctx.fillStyle = PAL.colL;
      ctx.fillRect(cx + 0.4 * S, inY, 0.8 * S, uy - 10 * S - inY);
    }
    for (let i = 0; i < uBays; i++) {
      const bx0 = ux0 + 6 * S + (ux1 - ux0 - 12 * S) * (i / uBays) + 3 * S;
      const bx1 = ux0 + 6 * S + (ux1 - ux0 - 12 * S) * ((i + 1) / uBays) - 3 * S;
      const lit = u.lit;
      ctx.fillStyle = lit ? 'rgba(236,203,98,0.5)' : PAL.winDark;
      ctx.fillRect(bx0, inY + 2.5 * S, bx1 - bx0, uy - 10 * S - inY - 5 * S);
      ctx.strokeStyle = lit ? 'rgba(60,20,10,0.5)' : 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.9 * S;
      ctx.beginPath();
      const cw = bx1 - bx0;
      for (let k = 1; k <= 2; k++) { const mx = bx0 + cw * k / 3; ctx.moveTo(mx, inY + 4 * S); ctx.lineTo(mx, uy - 12 * S); }
      ctx.moveTo(bx0, inY + 4 * S + (uy - 14 * S - inY) * 0.5); ctx.lineTo(bx1, inY + 4 * S + (uy - 14 * S - inY) * 0.5);
      ctx.stroke();
    }
    /* 歇山小顶（微凹曲两坡 + 短正脊 + 吻） */
    const ry = inY - 6 * S;
    ctx.fillStyle = PAL.tileD;
    ctx.beginPath();
    ctx.moveTo(ux0 - 14 * S, inY - 2 * S);
    ctx.quadraticCurveTo(ux0 + (ux1 - ux0) * 0.2, ry + 6 * S, ux0 + (ux1 - ux0) * 0.32, ry);
    ctx.lineTo(ux1 - (ux1 - ux0) * 0.32, ry);
    ctx.quadraticCurveTo(ux1 - (ux1 - ux0) * 0.2, ry + 6 * S, ux1 + 14 * S, inY - 2 * S);
    ctx.lineTo(ux1 + 10 * S, inY + 3 * S);
    ctx.quadraticCurveTo((ux0 + ux1) / 2, inY + 7 * S, ux0 - 10 * S, inY + 3 * S);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.tile; ctx.lineWidth = 1 * S;
    ctx.beginPath();
    for (let tx = ux0 - 6 * S; tx < (ux0 + ux1) / 2 - 10 * S; tx += 9 * S) {
      ctx.moveTo(tx, inY + 2 * S); ctx.quadraticCurveTo(tx + 3 * S, ry + 4 * S, (ux0 + ux1) / 2 - 12 * S, ry + 1 * S);
      const tx2 = ux1 + ux0 - tx;
      ctx.moveTo(tx2, inY + 2 * S); ctx.quadraticCurveTo(tx2 - 3 * S, ry + 4 * S, (ux0 + ux1) / 2 + 12 * S, ry + 1 * S);
    }
    ctx.stroke();
    ctx.fillStyle = PAL.ridge;
    roundRect(ctx, ux0 + (ux1 - ux0) * 0.32 - 2 * S, ry - 3.2 * S, (ux1 - ux0) * 0.36 + 4 * S, 3.6 * S, 1.5 * S); ctx.fill();
    paintChiwen(ux0 + (ux1 - ux0) * 0.32, ry - 2 * S, -1);
    paintChiwen(ux1 - (ux1 - ux0) * 0.32, ry - 2 * S, 1);
  }
}

function drawObstacle(ob) {
  if (ob.gone) return;
  const sx = ob.x - scroll;
  if (sx < -60 || sx > W + 60) return;
  const y = ob.y;
  if (ob.type === 'jar') {
    /* 陶罐 */
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(sx, y + 2 * S, 13 * S, 3.5 * S, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a5a3c';
    ctx.beginPath();
    ctx.ellipse(sx, y - 14 * S, 12 * S, 15 * S, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#6d452c';
    roundRect(ctx, sx - 8 * S, y - 33 * S, 16 * S, 7 * S, 2.5 * S); ctx.fill();
    ctx.fillStyle = '#a5744a';
    ctx.fillRect(sx - 11 * S, y - 17 * S, 22 * S, 3.5 * S);
    ctx.fillStyle = 'rgba(255,235,200,0.28)';
    ctx.beginPath(); ctx.ellipse(sx - 4.5 * S, y - 17 * S, 3 * S, 7 * S, -0.25, 0, TAU); ctx.fill();
  } else {
    /* 青铜香炉 */
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(sx, y + 2 * S, 15 * S, 3.5 * S, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#46507a';
    roundRect(ctx, sx - 14 * S, y - 26 * S, 28 * S, 20 * S, 8 * S); ctx.fill();
    ctx.fillStyle = '#39426a';
    ctx.fillRect(sx - 14 * S, y - 14 * S, 28 * S, 3 * S);
    /* 双耳 */
    ctx.strokeStyle = '#46507a'; ctx.lineWidth = 3.2 * S;
    ctx.beginPath(); ctx.arc(sx - 12 * S, y - 27 * S, 4 * S, Math.PI, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx + 12 * S, y - 27 * S, 4 * S, Math.PI, TAU); ctx.stroke();
    /* 三足 */
    ctx.fillStyle = '#39426a';
    ctx.fillRect(sx - 11 * S, y - 7 * S, 4 * S, 7 * S);
    ctx.fillRect(sx + 7 * S, y - 7 * S, 4 * S, 7 * S);
    ctx.fillRect(sx - 2 * S, y - 7 * S, 4 * S, 7 * S);
    /* 高光 + 烟 */
    ctx.fillStyle = 'rgba(200,215,255,0.25)';
    ctx.beginPath(); ctx.ellipse(sx - 6 * S, y - 20 * S, 3 * S, 5.5 * S, -0.3, 0, TAU); ctx.fill();
    for (let i = 0; i < 3; i++) {
      const ph = t * 1.4 + ob.ph + i * 1.1;
      const sy = y - 30 * S - ((ph % 1.6) / 1.6) * 46 * S;
      const sa = (1 - ((ph % 1.6) / 1.6)) * 0.35;
      ctx.globalAlpha = sa;
      ctx.fillStyle = '#c9d4f5';
      ctx.beginPath();
      ctx.arc(sx + Math.sin(ph * 2.2) * 5 * S, sy, (2 + i) * S, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawCoin(c) {
  const sx = c.x - scroll;
  if (sx < -30 || sx > W + 30 || c.got) return;
  const y = c.y + Math.sin(t * 3 + c.ph) * 4 * S;
  const wsc = Math.abs(Math.cos(t * 3.4 + c.ph));
  ctx.save();
  ctx.translate(sx, y);
  ctx.scale(Math.max(0.18, wsc), 1);
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath(); ctx.arc(0, 0, 9 * S, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#9a6d1a'; ctx.lineWidth = 1.6 * S;
  ctx.beginPath(); ctx.arc(0, 0, 9 * S, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#7a5414';
  ctx.fillRect(-3 * S, -3 * S, 6 * S, 6 * S);
  ctx.restore();
}

/* 钩索道具：金色三爪飞钩，浮动微摆 */
function drawHookItem(hk) {
  const sx = hk.x - scroll;
  if (sx < -40 || sx > W + 40 || hk.got) return;
  const y = hk.y + Math.sin(t * 2.6 + hk.ph) * 4 * S;
  ctx.save();
  ctx.translate(sx, y);
  ctx.rotate(Math.sin(t * 1.8 + hk.ph) * 0.12);
  ctx.fillStyle = 'rgba(232,196,94,0.16)';
  ctx.beginPath(); ctx.arc(0, 0, 15 * S, 0, TAU); ctx.fill();
  /* 绳环 */
  ctx.strokeStyle = '#c8a050'; ctx.lineWidth = 2 * S;
  ctx.beginPath(); ctx.arc(0, -8 * S, 3.2 * S, 0, TAU); ctx.stroke();
  /* 钩身 + 三爪 */
  ctx.strokeStyle = '#e8c45e'; ctx.lineWidth = 2.6 * S; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -4.8 * S); ctx.lineTo(0, 3 * S);
  ctx.moveTo(0, 3 * S); ctx.quadraticCurveTo(-6 * S, 5 * S, -7.5 * S, -1 * S);
  ctx.moveTo(0, 3 * S); ctx.quadraticCurveTo(6 * S, 5 * S, 7.5 * S, -1 * S);
  ctx.moveTo(0, 3 * S); ctx.lineTo(0, 8.5 * S);
  ctx.stroke();
  ctx.restore();
}

function drawCrow(cr) {
  if (cr.gone) return;
  const sx = cr.x - scroll;
  if (sx < -60 || sx > W + 80) return;
  const flap = Math.sin(t * 14 + cr.ph);
  ctx.save();
  ctx.translate(sx, cr.y);
  ctx.fillStyle = '#171826';
  /* 身体 */
  ctx.beginPath(); ctx.ellipse(0, 0, 12 * S, 6.5 * S, 0, 0, TAU); ctx.fill();
  /* 头 + 喙 */
  ctx.beginPath(); ctx.arc(10 * S, -3 * S, 5 * S, 0, TAU); ctx.fill();
  ctx.fillStyle = '#f4c14e';
  ctx.beginPath();
  ctx.moveTo(14 * S, -3.5 * S); ctx.lineTo(20 * S, -2 * S); ctx.lineTo(14 * S, -1 * S);
  ctx.closePath(); ctx.fill();
  /* 眼 */
  ctx.fillStyle = '#ff5a4e';
  ctx.beginPath(); ctx.arc(11.5 * S, -4 * S, 1.4 * S, 0, TAU); ctx.fill();
  /* 翅膀 */
  ctx.fillStyle = '#10111c';
  ctx.beginPath();
  ctx.moveTo(-2 * S, -2 * S);
  ctx.quadraticCurveTo(-10 * S, (-16 * flap - 8) * S, -22 * S, (-10 * flap - 4) * S);
  ctx.quadraticCurveTo(-10 * S, (-4 * flap - 2) * S, -2 * S, 2 * S);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ============================================================
 * 绘制 —— Q 版古风忍者
 * ============================================================ */
/* 坐骑：黑狼（终极版：极端色阶 + 蓬松大尾 + 厚吻 + 圆耳 + 粗腿） */
function drawWolfRide() {
  const n = ninja;
  const hurt = n.mountHP <= 1;
  const u = n.runPhase;
  const pp = (u + 0.32 * (Math.cos(u * TAU) - 1) / TAU) * TAU;
  const lame = hurt ? 0.5 : 1;
  /* 极端色阶：在夜景中必须能明显看出三层 */
  const WC = {
    fur: '#5a6080', furM: '#98a0c8', furL: '#d0d8f8', furD: '#2a2e3e', furDD: '#15161e',
    rim: 'rgba(220,235,255,0.9)', eye: '#ffcc44', eyeG: '#ff5500',
    claw: '#f0e8d0', scar: '#ee3333', bruise: 'rgba(100,60,140,0.95)',
  };
  const sw1 = Math.sin(pp), sw2 = Math.sin(pp + Math.PI);
  const flex = Math.sin(pp * 2) * 1.6 * S;
  const hd = hurt ? 5 * S : 0;
  const tailS = Math.sin(pp + 1.2) * 8 * S;

  /* ---- 远侧腿（暗色） ---- */
  ctx.strokeStyle = WC.furD; ctx.lineWidth = 5 * S; ctx.lineCap = 'round';
  for (const [lx, s, back] of [[20, sw2, 0], [-18, sw1, 1]]) {
    const kx = lx + s * 7 * S * lame + (back ? -4 * S : 4 * S);
    const fx = kx + s * 5.5 * S * lame + (back ? -2 * S : 2 * S);
    ctx.beginPath();
    ctx.moveTo(lx * S, -13 * S); ctx.lineTo(kx * S, -9 * S); ctx.lineTo(fx * S, 0.5 * S);
    ctx.stroke();
    ctx.strokeStyle = WC.claw; ctx.lineWidth = 2.2 * S;
    ctx.beginPath(); ctx.moveTo(fx * S, -1 * S); ctx.lineTo((fx + 1.5) * S, 0.8 * S); ctx.stroke();
    ctx.strokeStyle = WC.furD;
  }

  /* ---- 尾：大蓬松刷状（躯干 1/2 长，三色阶 + 锯齿毛流） ---- */
  ctx.fillStyle = WC.furD;
  ctx.beginPath();
  ctx.moveTo(-26 * S, (-19 - flex * 0.4) * S);
  ctx.bezierCurveTo(-44 * S, (-27 - flex) * S + tailS, -66 * S, (-18) * S + tailS * 0.7, -68 * S, (-4) * S + tailS * 0.5);
  ctx.bezierCurveTo(-66 * S, (2) * S + tailS * 0.4, -56 * S, (-8) * S + tailS * 0.5, -46 * S, (-11) * S);
  ctx.bezierCurveTo(-34 * S, (-13) * S, -28 * S, (-13 - flex * 0.3) * S, -26 * S, (-15 - flex * 0.4) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.fur;
  ctx.beginPath();
  ctx.moveTo(-28 * S, (-19 - flex * 0.4) * S);
  ctx.bezierCurveTo(-42 * S, (-23 - flex) * S + tailS, -58 * S, (-16) * S + tailS * 0.6, -60 * S, (-7) * S + tailS * 0.4);
  ctx.bezierCurveTo(-58 * S, (-4) * S + tailS * 0.3, -50 * S, (-10) * S + tailS * 0.4, -42 * S, (-12) * S);
  ctx.bezierCurveTo(-34 * S, (-14) * S, -30 * S, (-14 - flex * 0.3) * S, -28 * S, (-16 - flex * 0.4) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.furM;
  ctx.beginPath();
  ctx.moveTo(-30 * S, (-20 - flex * 0.4) * S);
  ctx.bezierCurveTo(-44 * S, (-22 - flex) * S + tailS * 0.8, -54 * S, (-15) * S + tailS * 0.5, -55 * S, (-9) * S + tailS * 0.3);
  ctx.bezierCurveTo(-46 * S, (-13) * S, -38 * S, (-16) * S, -30 * S, (-18 - flex * 0.4) * S);
  ctx.closePath(); ctx.fill();
  /* 尾毛锯齿（下缘蓬松） */
  ctx.fillStyle = WC.fur;
  for (let i = 0; i < 7; i++) {
    const tx = (-34 - i * 4.5) * S;
    const ty = (-11 + Math.sin(t * 4 + i) * 1.8) * S + tailS * 0.1;
    ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(tx - 2.5 * S, ty + 5 * S); ctx.lineTo(tx + 3.5 * S, ty + 2 * S);
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = WC.rim; ctx.lineWidth = 1.8 * S;
  ctx.beginPath();
  ctx.moveTo(-42 * S, (-17) * S + tailS * 0.5);
  ctx.quadraticCurveTo(-54 * S, (-12) * S + tailS * 0.4, -60 * S, (-7) * S + tailS * 0.3);
  ctx.stroke();

  /* ---- 躯干：大块面 + 三色阶分面 ---- */
  ctx.fillStyle = WC.fur;
  ctx.beginPath();
  ctx.moveTo(30 * S, -17 * S);
  ctx.bezierCurveTo(31 * S, (-23 + flex * 0.5) * S, 26 * S, (-27 + flex) * S, 17 * S, (-27 + flex) * S);
  ctx.bezierCurveTo(8 * S, (-26.5 + flex * 0.4) * S, 2 * S, (-24 - flex * 0.4) * S, -6 * S, (-24.5 - flex * 0.3) * S);
  ctx.bezierCurveTo(-14 * S, (-25.5 - flex) * S, -22 * S, (-28 - flex * 0.8) * S, -28 * S, (-24 - flex * 0.6) * S);
  ctx.bezierCurveTo(-34 * S, (-19 - flex * 0.4) * S, -32 * S, (-12 - flex * 0.2) * S, -27 * S, (-10 + flex * 0.2) * S);
  ctx.bezierCurveTo(-16 * S, (-7.5 + flex * 0.5) * S, -4 * S, (-7 + flex * 0.6) * S, 6 * S, (-8 + flex * 0.4) * S);
  ctx.bezierCurveTo(16 * S, (-9 + flex * 0.3) * S, 24 * S, (-11 + flex * 0.2) * S, 30 * S, (-17) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.furM;
  ctx.beginPath();
  ctx.moveTo(28 * S, (-17) * S);
  ctx.bezierCurveTo(26 * S, (-26 + flex) * S, 17 * S, (-26.5 + flex) * S, 8 * S, (-25 + flex * 0.4) * S);
  ctx.bezierCurveTo(0, (-24 - flex * 0.4) * S, -8 * S, (-24 - flex * 0.3) * S, -16 * S, (-24.5 - flex) * S);
  ctx.bezierCurveTo(-22 * S, (-27 - flex * 0.8) * S, -26 * S, (-25 - flex * 0.6) * S, -28 * S, (-23 - flex * 0.6) * S);
  ctx.lineTo(-26 * S, (-20 - flex * 0.4) * S);
  ctx.bezierCurveTo(-16 * S, (-22 - flex * 0.3) * S, 0, (-21 - flex * 0.2) * S, 14 * S, (-22 + flex * 0.3) * S);
  ctx.bezierCurveTo(22 * S, (-22 + flex * 0.5) * S, 26 * S, (-20) * S, 28 * S, (-17) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.furL;
  ctx.beginPath();
  ctx.moveTo(22 * S, (-20) * S);
  ctx.bezierCurveTo(14 * S, (-25 + flex) * S, 0, (-23 - flex * 0.3) * S, -12 * S, (-23.5 - flex * 0.8) * S);
  ctx.bezierCurveTo(-18 * S, (-25 - flex * 0.6) * S, -22 * S, (-24) * S, -24 * S, (-22) * S);
  ctx.lineTo(-20 * S, (-21) * S);
  ctx.bezierCurveTo(-10 * S, (-21.5 - flex * 0.4) * S, 6 * S, (-21 + flex * 0.2) * S, 18 * S, (-21 + flex * 0.4) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.furD;
  ctx.beginPath();
  ctx.moveTo(-24 * S, (-11) * S);
  ctx.quadraticCurveTo(0, (-6.2 + flex * 0.5) * S, 22 * S, (-11.5) * S);
  ctx.quadraticCurveTo(0, (-9 + flex * 0.5) * S, -24 * S, (-11) * S);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = WC.rim; ctx.lineWidth = 1.8 * S;
  ctx.beginPath();
  ctx.moveTo(-24 * S, (-25 - flex * 0.8) * S);
  ctx.quadraticCurveTo(-8 * S, (-24 - flex * 0.4) * S, 16 * S, (-25.8 + flex) * S);
  ctx.stroke();

  /* ---- 颈头（厚吻圆耳前移 + 鬃毛） ---- */
  ctx.fillStyle = WC.fur;
  ctx.beginPath();
  ctx.moveTo(12 * S, (-26 + flex) * S);
  ctx.bezierCurveTo(18 * S, (-34 + hd) * S, 24 * S, (-39 + hd) * S, 31 * S, (-39 + hd) * S);
  ctx.lineTo(42 * S, (-35 + hd) * S);
  ctx.bezierCurveTo(44 * S, (-33.5 + hd) * S, 44 * S, (-31 + hd) * S, 42 * S, (-30.5 + hd) * S);
  ctx.bezierCurveTo(38 * S, (-29.5 + hd) * S, 32 * S, (-28 + hd) * S, 27 * S, (-24 + hd) * S);
  ctx.bezierCurveTo(22 * S, (-20 + hd) * S, 16 * S, (-18) * S, 12 * S, (-19) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.furM;
  ctx.beginPath();
  ctx.moveTo(18 * S, (-33 + hd) * S);
  ctx.bezierCurveTo(24 * S, (-38.5 + hd) * S, 28 * S, (-39 + hd) * S, 31 * S, (-39 + hd) * S);
  ctx.lineTo(37 * S, (-36.5 + hd) * S);
  ctx.bezierCurveTo(30 * S, (-36 + hd) * S, 24 * S, (-35 + hd) * S, 18 * S, (-33 + hd) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.furD;
  ctx.beginPath();
  ctx.moveTo(28 * S, (-24 + hd) * S);
  ctx.quadraticCurveTo(33 * S, (-27 + hd) * S, 38 * S, (-28.5 + hd) * S);
  ctx.quadraticCurveTo(33 * S, (-25 + hd) * S, 28 * S, (-24 + hd) * S);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = WC.rim; ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  ctx.moveTo(32 * S, (-38.5 + hd) * S); ctx.lineTo(41 * S, (-34 + hd) * S);
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(43 * S, (-31.5 + hd) * S, 2 * S, 0, TAU); ctx.fill();
  ctx.strokeStyle = WC.furDD; ctx.lineWidth = 1.4 * S;
  ctx.beginPath(); ctx.moveTo(42 * S, (-30 + hd) * S); ctx.quadraticCurveTo(37 * S, (-29.5 + hd) * S, 34 * S, (-28 + hd) * S);
  ctx.stroke();
  ctx.fillStyle = '#e8e0c8';
  ctx.beginPath();
  ctx.moveTo(41 * S, (-30 + hd) * S); ctx.lineTo(41.5 * S, (-28.8 + hd) * S); ctx.lineTo(40 * S, (-29.6 + hd) * S);
  ctx.closePath(); ctx.fill();
  /* 金色大狼眼 */
  ctx.fillStyle = WC.eye;
  ctx.beginPath(); ctx.ellipse(35 * S, (-33.5 + hd) * S, 2.8 * S, 2 * S, -0.15, 0, TAU); ctx.fill();
  ctx.fillStyle = WC.eyeG;
  ctx.beginPath(); ctx.arc(35.6 * S, (-33.4 + hd) * S, 1.2 * S, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1a0e04';
  ctx.beginPath(); ctx.arc(35.6 * S, (-33.4 + hd) * S, 0.7 * S, 0, TAU); ctx.fill();
  ctx.strokeStyle = WC.furL; ctx.lineWidth = 1.2 * S;
  ctx.beginPath(); ctx.moveTo(32 * S, (-34.8 + hd) * S); ctx.lineTo(38.5 * S, (-34.3 + hd) * S);
  ctx.stroke();
  /* 圆钝双耳前移 + 内耳粉红 */
  ctx.fillStyle = WC.fur;
  ctx.beginPath();
  ctx.moveTo(24 * S, (-36 + hd) * S); ctx.lineTo(26 * S, (-44 + hd) * S); ctx.lineTo(31 * S, (-37.5 + hd) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.furM;
  ctx.beginPath();
  ctx.moveTo(25.5 * S, (-38 + hd) * S); ctx.lineTo(26 * S, (-42.5 + hd) * S); ctx.lineTo(29 * S, (-38.5 + hd) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#dd6644';
  ctx.beginPath();
  ctx.moveTo(26.5 * S, (-39 + hd) * S); ctx.lineTo(27 * S, (-41 + hd) * S); ctx.lineTo(28.5 * S, (-39 + hd) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = WC.furD;
  ctx.beginPath();
  ctx.moveTo(30 * S, (-37.5 + hd) * S); ctx.lineTo(33 * S, (-42 + hd) * S); ctx.lineTo(35 * S, (-36.5 + hd) * S);
  ctx.closePath(); ctx.fill();
  /* 鬃毛锯齿隆起 */
  ctx.fillStyle = WC.furM;
  ctx.beginPath();
  ctx.moveTo(12 * S, (-26 + flex) * S);
  const mane = [[7,-33], [3,-29], [-1,-32.5], [-5,-28.5], [-9,-31], [-13,-27.5], [-17,-29]];
  for (const [mx, my] of mane) ctx.lineTo(mx * S, (my + flex * 0.4) * S);
  ctx.lineTo(-17 * S, (-21 - flex * 0.3) * S);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = WC.furL; ctx.lineWidth = 1 * S;
  ctx.beginPath();
  for (let i = 0; i < mane.length; i += 2) {
    ctx.moveTo(mane[i][0] * S, (mane[i][1] + flex * 0.4) * S);
    ctx.lineTo((mane[i][0] - 2) * S, (mane[i][1] + 4 + flex * 0.4) * S);
  }
  ctx.stroke();

  /* ---- 近侧腿（粗大腿 + 细小腿 + 爪） ---- */
  ctx.strokeStyle = WC.fur; ctx.lineCap = 'round';
  for (const [lx, s, back] of [[24, sw1, 0], [-22, sw2, 1]]) {
    const kx = lx + s * 8 * S * lame + (back ? -4 * S : 4 * S);
    const fx = kx + s * 6 * S * lame + (back ? -2.5 * S : 2.5 * S);
    ctx.lineWidth = 6.5 * S;
    ctx.beginPath(); ctx.moveTo(lx * S, -14 * S); ctx.lineTo(kx * S, -9 * S); ctx.stroke();
    ctx.lineWidth = 4.2 * S; ctx.strokeStyle = WC.furM;
    ctx.beginPath(); ctx.moveTo(kx * S, -9 * S); ctx.lineTo(fx * S, 0); ctx.stroke();
    ctx.strokeStyle = WC.claw; ctx.lineWidth = 2.6 * S;
    ctx.beginPath(); ctx.moveTo(fx * S, -1.5 * S); ctx.lineTo((fx + 1.5) * S, 0.5 * S); ctx.stroke();
    ctx.strokeStyle = WC.fur;
  }
  if (hurt) {
    ctx.strokeStyle = WC.scar; ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.moveTo(32 * S, (-37 + hd) * S); ctx.lineTo(37 * S, (-31 + hd) * S);
    ctx.moveTo(36 * S, (-38.5 + hd) * S); ctx.lineTo(41 * S, (-33.5 + hd) * S);
    ctx.stroke();
    ctx.fillStyle = WC.bruise;
    ctx.beginPath(); ctx.ellipse(-24 * S, (-18 - flex * 0.4) * S, 7 * S, 4.5 * S, 0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(16 * S, (-13) * S, 4.5 * S, 3.2 * S, -0.2, 0, TAU); ctx.fill();
  }
}

/* 坐骑：白色大鹏（终极版：巨翅 3 倍躯干 + 5 根分离羽指 + 胸肌高光 + 弯钩喙 + 五羽尾扇） */
function drawRocRide() {
  const flap = Math.sin(t * 5.5);
  const flap2 = Math.sin(t * 5.5 + 0.7);
  const fw = flap * 1.3;
  const fw2 = flap2 * 1.3;
  const lift = flap * 5 * S;
  const steer = Math.sin(t * 2.6) * 0.16;
  const RC = {
    w: '#ffffff', wM: '#c8b888', wD: '#98885c', wDD: '#5a4a30',
    beak: '#ffd040', beakD: '#c08010', beakL: '#ffffe0',
    rim: 'rgba(255,255,255,1)', shade: 'rgba(50,45,30,0.4)',
    paw: '#e8a820', eye: '#100800',
  };

  /* ---- 远侧翅（暗色大块面） ---- */
  {
    const a = -1.2 - fw2 * 1.0;
    const ex = 4 * S + Math.cos(a) * 32 * S, ey = (-21 + lift) * S + Math.sin(a) * 32 * S;
    const a2 = a - 0.5 - flap2 * 0.3;
    const wx = ex + Math.cos(a2) * 44 * S, wy = ey + Math.sin(a2) * 44 * S;
    ctx.fillStyle = RC.wD;
    ctx.beginPath();
    ctx.moveTo(6 * S, (-22 + lift) * S);
    ctx.quadraticCurveTo(ex - 8 * S, ey - 12 * S, wx, wy);
    ctx.quadraticCurveTo(ex + 12 * S, ey + 10 * S, 8 * S, (-13 + lift) * S);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = RC.wDD; ctx.lineWidth = 1.5 * S;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(ex + i * 5 * S, ey + i * 4 * S);
      ctx.lineTo(wx - i * 6 * S, wy - i * 5 * S);
      ctx.stroke();
    }
  }

  /* ---- 尾扇：五根长羽大角度展开 ---- */
  ctx.save();
  ctx.translate(-28 * S, (-13 + lift) * S);
  ctx.rotate(steer);
  for (let i = -2; i <= 2; i++) {
    const ang = i * 0.25 + Math.sin(t * 3 + i) * 0.04;
    const len = (40 - Math.abs(i) * 8) * S;
    ctx.save(); ctx.rotate(ang);
    ctx.fillStyle = i === 0 ? RC.w : RC.wM;
    ctx.beginPath();
    ctx.moveTo(0, -4 * S);
    ctx.quadraticCurveTo(len * 0.5, -6 * S, len, -2.5 * S);
    ctx.lineTo(len, 2.5 * S);
    ctx.quadraticCurveTo(len * 0.5, 6 * S, 0, 4 * S);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = RC.wDD; ctx.lineWidth = 1.2 * S;
    ctx.beginPath(); ctx.moveTo(4 * S, 0); ctx.lineTo(len * 0.92, 0); ctx.stroke();
    ctx.strokeStyle = RC.wD; ctx.lineWidth = 0.8 * S;
    for (let k = 1; k < 6; k++) {
      const px = len * 0.18 * k;
      ctx.beginPath();
      ctx.moveTo(px, 0); ctx.lineTo(px + 5 * S, -2.5 * S);
      ctx.moveTo(px, 0); ctx.lineTo(px + 5 * S, 2.5 * S);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  /* ---- 躯干：饱满卵形 + 大胸肌高光 + 腹阴影 + 背羽层 ---- */
  ctx.fillStyle = RC.w;
  ctx.beginPath();
  ctx.moveTo(30 * S, (-16 + lift) * S);
  ctx.bezierCurveTo(34 * S, (-7 + lift) * S, 26 * S, (-2.5 + lift) * S, 6 * S, (-2.5 + lift) * S);
  ctx.bezierCurveTo(-14 * S, (-2.5 + lift) * S, -26 * S, (-5.5 + lift) * S, -31 * S, (-12 + lift) * S);
  ctx.bezierCurveTo(-34 * S, (-16 + lift) * S, -30 * S, (-20 + lift) * S, -17 * S, (-21.5 + lift) * S);
  ctx.bezierCurveTo(-2 * S, (-23 + lift) * S, 18 * S, (-22.5 + lift) * S, 26 * S, (-19.5 + lift) * S);
  ctx.closePath(); ctx.fill();
  /* 胸肌大块高光 */
  ctx.fillStyle = RC.rim;
  ctx.beginPath();
  ctx.ellipse(20 * S, (-12.5 + lift) * S, 10 * S, 7 * S, 0.35, 0, TAU);
  ctx.fill();
  /* 腹部阴影 */
  ctx.fillStyle = RC.wM;
  ctx.beginPath();
  ctx.moveTo(26 * S, (-9 + lift) * S);
  ctx.bezierCurveTo(20 * S, (-5.5 + lift) * S, 0, (-4.5 + lift) * S, -20 * S, (-6.5 + lift) * S);
  ctx.bezierCurveTo(-2 * S, (-8.5 + lift) * S, 18 * S, (-10 + lift) * S, 26 * S, (-9 + lift) * S);
  ctx.closePath(); ctx.fill();
  /* 背部覆羽排 */
  ctx.strokeStyle = RC.wD; ctx.lineWidth = 2 * S;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo((-21 + i * 1.5) * S, (-18.5 + lift - i * 1.6) * S);
    ctx.quadraticCurveTo((-2 + i) * S, (-22.5 + lift - i * 1.9) * S, (20 - i * 2) * S, (-18 + lift - i * 1.2) * S);
    ctx.stroke();
  }
  /* 覆羽末端锯齿 */
  ctx.fillStyle = RC.wM;
  for (let i = 0; i < 8; i++) {
    const px = (-18 + i * 5.5) * S;
    ctx.beginPath();
    ctx.moveTo(px, (-19 + lift) * S);
    ctx.lineTo(px + 3 * S, (-22 + lift) * S);
    ctx.lineTo(px + 6 * S, (-19 + lift) * S);
    ctx.closePath(); ctx.fill();
  }

  /* ---- 近侧巨翅：大块扇面 + 5 根分离长羽指（翼展 3 倍躯干） ---- */
  {
    const a = -0.8 - fw * 1.0;
    const ex = 2 * S + Math.cos(a) * 34 * S, ey = (-21 + lift) * S + Math.sin(a) * 34 * S;
    const a2 = a - 0.5 - flap * 0.35;
    const wx = ex + Math.cos(a2) * 46 * S, wy = ey + Math.sin(a2) * 46 * S;
    const a3 = a2 - 0.2;
    const tx = wx + Math.cos(a3) * 26 * S, ty = wy + Math.sin(a3) * 26 * S;
    /* 翼面大块 */
    ctx.fillStyle = RC.w;
    ctx.beginPath();
    ctx.moveTo(4 * S, (-23 + lift) * S);
    ctx.quadraticCurveTo(ex - 10 * S, ey - 14 * S, tx, ty);
    /* 后缘 5 根分离长羽指 */
    const feather = [[-0.4, 30], [-0.72, 38], [-1.05, 40], [-1.4, 38], [-1.72, 30]];
    const fx0 = tx, fy0 = ty;
    let cx = fx0, cy = fy0;
    for (const [fa, fl] of feather) {
      const tipX = cx + Math.cos(a3 + fa + Math.PI) * -fl * S;
      const tipY = cy + Math.sin(a3 + fa + Math.PI) * -fl * S;
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(cx - 5 * S, cy - 7 * S);
      cx = cx - 6.5 * S; cy = cy - 8 * S;
    }
    ctx.quadraticCurveTo(ex + 14 * S, ey + 10 * S, 6 * S, (-12 + lift) * S);
    ctx.closePath(); ctx.fill();
    /* 翼根覆羽 */
    ctx.fillStyle = RC.wM;
    ctx.beginPath();
    ctx.moveTo(4 * S, (-23 + lift) * S);
    ctx.quadraticCurveTo(ex - 8 * S, ey - 10 * S, ex + 5 * S, ey + 5 * S);
    ctx.quadraticCurveTo(ex - 10 * S, ey - 2 * S, 2 * S, (-14 + lift) * S);
    ctx.closePath(); ctx.fill();
    /* 5 根明显羽杆线 */
    ctx.strokeStyle = RC.wDD; ctx.lineWidth = 2 * S;
    for (let i = 0; i < 5; i++) {
      const ang2 = a3 - 0.4 - i * 0.32;
      const len2 = (30 + (i < 2 ? i * 5 : (5 - i) * 5)) * S;
      ctx.beginPath();
      ctx.moveTo(tx - i * 6.5 * S, ty - i * 8 * S);
      ctx.lineTo(tx - i * 6.5 * S + Math.cos(ang2) * len2, ty - i * 8 * S + Math.sin(ang2) * len2);
      ctx.stroke();
    }
    /* 翼根阴影 */
    ctx.fillStyle = RC.shade;
    ctx.beginPath();
    ctx.moveTo(2 * S, (-21 + lift) * S);
    ctx.quadraticCurveTo(16 * S, (-15 + lift) * S, 14 * S, (-8 + lift) * S);
    ctx.quadraticCurveTo(0, (-13 + lift) * S, 2 * S, (-21 + lift) * S);
    ctx.closePath(); ctx.fill();
    /* 翼前缘月光轮廓 */
    ctx.strokeStyle = RC.rim; ctx.lineWidth = 2.5 * S;
    ctx.beginPath();
    ctx.moveTo(4 * S, (-23 + lift) * S);
    ctx.quadraticCurveTo(ex - 10 * S, ey - 14 * S, tx, ty);
    ctx.stroke();
  }

  /* ---- 颈头 + 弯钩金喙 ---- */
  ctx.fillStyle = RC.w;
  ctx.beginPath();
  ctx.moveTo(12 * S, (-21 + lift) * S);
  ctx.bezierCurveTo(20 * S, (-26 + lift) * S, 27 * S, (-30 + lift) * S, 32 * S, (-33 + lift) * S);
  ctx.bezierCurveTo(36 * S, (-35.5 + lift) * S, 40 * S, (-36.5 + lift) * S, 44 * S, (-35.5 + lift) * S);
  ctx.lineTo(45.5 * S, (-31.5 + lift) * S);
  ctx.bezierCurveTo(40 * S, (-30 + lift) * S, 32 * S, (-28 + lift) * S, 24 * S, (-24 + lift) * S);
  ctx.bezierCurveTo(20 * S, (-21.5 + lift) * S, 16 * S, (-19.5 + lift) * S, 12 * S, (-19.5 + lift) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = RC.rim;
  ctx.beginPath();
  ctx.moveTo(16 * S, (-25 + lift) * S);
  ctx.quadraticCurveTo(24 * S, (-30 + lift) * S, 30 * S, (-32.5 + lift) * S);
  ctx.quadraticCurveTo(24 * S, (-28 + lift) * S, 18 * S, (-23 + lift) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = RC.w;
  ctx.beginPath();
  ctx.moveTo(32 * S, (-34.5 + lift) * S);
  ctx.quadraticCurveTo(24 * S, (-44 + lift) * S, 13 * S, (-42 + lift) * S);
  ctx.quadraticCurveTo(24 * S, (-38 + lift) * S, 30 * S, (-33 + lift) * S);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = RC.wD; ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  ctx.moveTo(26 * S, (-27 + lift) * S); ctx.quadraticCurveTo(30 * S, (-29.5 + lift) * S, 33 * S, (-31.5 + lift) * S);
  ctx.moveTo(22 * S, (-24 + lift) * S); ctx.quadraticCurveTo(26 * S, (-26.5 + lift) * S, 29 * S, (-28 + lift) * S);
  ctx.stroke();
  /* 弯钩金喙（大钩） */
  ctx.fillStyle = RC.beak;
  ctx.beginPath();
  ctx.moveTo(44 * S, (-36 + lift) * S);
  ctx.quadraticCurveTo(58 * S, (-35 + lift) * S, 57 * S, (-27 + lift) * S);
  ctx.quadraticCurveTo(53 * S, (-25 + lift) * S, 47 * S, (-28 + lift) * S);
  ctx.lineTo(44.5 * S, (-31.5 + lift) * S);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = RC.beakL; ctx.lineWidth = 1.8 * S;
  ctx.beginPath();
  ctx.moveTo(45 * S, (-35.5 + lift) * S); ctx.quadraticCurveTo(53 * S, (-34 + lift) * S, 55 * S, (-28 + lift) * S);
  ctx.stroke();
  ctx.fillStyle = RC.beakD;
  ctx.beginPath();
  ctx.moveTo(47 * S, (-30 + lift) * S);
  ctx.quadraticCurveTo(52 * S, (-29 + lift) * S, 50 * S, (-26 + lift) * S);
  ctx.lineTo(45 * S, (-29.5 + lift) * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = RC.beakD;
  ctx.beginPath(); ctx.arc(47 * S, (-33.5 + lift) * S, 1.2 * S, 0, TAU); ctx.fill();
  /* 眼 */
  ctx.fillStyle = RC.wM;
  ctx.beginPath(); ctx.arc(41 * S, (-32.5 + lift) * S, 3 * S, 0, TAU); ctx.fill();
  ctx.fillStyle = RC.eye;
  ctx.beginPath(); ctx.arc(41.6 * S, (-32.5 + lift) * S, 1.6 * S, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(42 * S, (-33 + lift) * S, 0.7 * S, 0, TAU); ctx.fill();
  ctx.strokeStyle = RC.rim; ctx.lineWidth = 1.8 * S;
  ctx.beginPath();
  ctx.moveTo(33 * S, (-34.5 + lift) * S);
  ctx.quadraticCurveTo(39 * S, (-37 + lift) * S, 44 * S, (-35.8 + lift) * S);
  ctx.stroke();

  /* ---- 金爪 ---- */
  ctx.strokeStyle = RC.paw; ctx.lineWidth = 3 * S; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-4 * S, (-6.5 + lift) * S); ctx.lineTo(-5 * S, (-2.5 + lift) * S); ctx.lineTo(-11 * S, (-1 + lift) * S);
  ctx.moveTo(-2 * S, (-6.5 + lift) * S); ctx.lineTo(-2 * S, (-2 + lift) * S); ctx.lineTo(-7 * S, (-0.5 + lift) * S);
  ctx.stroke();
}
function drawNinja() {
  const n = ninja;
  const x = n.sx, y = n.y;

  /* 影子 */
  const seg = segAt(scroll + x);
  if (seg && !n.dead) {
    const h = clamp(1 - (seg.y - n.y) / (180 * S), 0.25, 1);
    ctx.globalAlpha = 0.3 * h;
    ctx.fillStyle = '#05060f';
    ctx.beginPath();
    ctx.ellipse(x, seg.y + 3 * S, 16 * S * h + 6 * S, 4 * S, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* 钩索绳（忍者腰后 → 檐口锚点） */
  if (n.grap) {
    const ax = n.grap.ax - scroll, ay = n.grap.ay;
    ctx.strokeStyle = '#4a3a20'; ctx.lineWidth = 1.6 * S;
    ctx.beginPath(); ctx.moveTo(x, y - 30 * S); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.fillStyle = 'rgba(232,196,94,0.9)';
    ctx.beginPath(); ctx.arc(ax, ay, 2.6 * S, 0, TAU); ctx.fill();
  }

  ctx.save();
  /* 受击无敌帧：闪烁 */
  if (n.inv > 0 && !n.dead) ctx.globalAlpha = 0.45 + 0.4 * Math.sin(t * 36);
  ctx.translate(x, y);

  /* ---- 坐骑：狼 / 大鹏（画在忍者脚下，忍者整体上移骑乘） ---- */
  if (n.mount === 'wolf' && !n.dead) {
    drawWolfRide();
    ctx.translate(0, -23 * S);
  } else if (n.mount === 'roc' && !n.dead) {
    drawRocRide();
    ctx.translate(0, -19 * S);
  }

  /* 死亡旋转 */
  if (n.dead) {
    ctx.translate(0, -26 * S);
    ctx.rotate(n.deadRot);
    ctx.translate(0, 26 * S);
  }

  /* 二段跳空翻 */
  if (n.spinT > 0) {
    const a = (1 - n.spinT) * TAU;
    ctx.translate(0, -26 * S);
    ctx.rotate(a);
    ctx.translate(0, 26 * S);
  }

  /* 挤压拉伸 */
  const sq = 1 + n.squash * -0.18 + n.stretch * 0.12;
  const swx = 1 + n.squash * 0.16 - n.stretch * 0.06;

  /* 疾跑前倾：绕身体重心前压，速度越快倾角越大 */
  const airborne = !n.grounded && !n.dead && state !== 'menu';
  const spdR = clamp((speed - CFG.sp0 * S) / ((CFG.spMax - CFG.sp0) * S), 0, 1);
  const lean = n.dead ? 0
    : n.grap ? clamp(n.grap.th * 0.7, -0.55, 0.55) + 0.18   /* 摆动：身体顺绳倾斜 */
    : n.mount === 'wolf' ? 0.30                              /* 骑狼：俯身前倾抓鬃 */
    : n.mount === 'roc' ? 0.42                               /* 骑鹏：贴伏背部 */
    : (airborne ? 0.24 : 0.15 + spdR * 0.07);
  ctx.translate(0, -20 * S);
  ctx.rotate(lean);
  ctx.scale(swx, sq);
  ctx.translate(0, 20 * S);

  /* 全黑配色：#0a0a0e 主体, #14141c 次色, #1e1e28 高光面, #060608 阴影面 */
  const C = {
    body: '#0a0a0e', bodyM: '#14141c', bodyL: '#1e1e28', bodyD: '#060608',
    blade: '#2a2a36', bladeD: '#080810', hilt: '#3a2a1a', tsuba: '#5a5a2a',
    eye: '#ffe9b0', eyeD: '#1a1a22',
    rim: 'rgba(180,195,235,0.55)',
    red: '#8a1a1a', redD: '#5a0808',
  };

  const ph = n.runPhase;
  /* 步伐节奏：起步慢、蹬地后半程快（由慢到快，周期无缝衔接） */
  const pace = (u) => u + 0.32 * (Math.cos(u * TAU) - 1) / TAU;
  const pp = pace(ph) * TAU;
  const running = n.grounded && !n.dead && state === 'play';
  const bob = running ? -Math.abs(Math.cos(pp)) * 2.4 * S : 0;
  const wave1 = Math.sin(t * 10) * 2.6 * S, wave2 = Math.sin(t * 10 + 1.3) * 4.2 * S;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* ---------- 腿：屈膝双关节跑步循环（贝塞尔有机感） ---------- */
  const hipY = -13 * S + bob;
  function legPoints(side) {
    if (n.dead)
      return side > 0 ? [2 * S, hipY, 8 * S, -5 * S] : [-2 * S, hipY, -5 * S, -7 * S];
    /* 骑狼：双腿分开跨骑（前脚踩狼肩后、后腿贴腹后收） */
    if (n.mount === 'wolf' && !n.dead)
      return side > 0 ? [5 * S, hipY, 12 * S, 2 * S] : [-3 * S, hipY, -14 * S, 2.5 * S];
    /* 骑鹏：半跪贴伏（前腿弓步踩背、后腿屈膝收拢） */
    if (n.mount === 'roc' && !n.dead)
      return side > 0 ? [4 * S, hipY, 12 * S, 0] : [-3 * S, hipY, -9 * S, 0];
    if (airborne)
      return n.vy < 0
        ? (side > 0 ? [2 * S, hipY, 13 * S, -9 * S] : [-2 * S, hipY, -7 * S, -4 * S])
        : (side > 0 ? [2 * S, hipY, 9 * S, -5 * S] : [-2 * S, hipY, -6 * S, -9 * S]);
    if (state === 'menu')
      return side > 0 ? [3 * S, hipY, 7 * S, 0] : [-3 * S, hipY, -6 * S, 0];
    const p = pp + (side > 0 ? 0 : Math.PI);
    return [side * 2.5 * S, hipY,
            -Math.cos(p) * 11.5 * S,
            -Math.max(0, Math.sin(p)) * 9 * S];
  }
  function drawLeg(side) {
    const [hx, hy, fx, fy] = legPoints(side);
    const dx = fx - hx, dy = fy - hy, len = Math.hypot(dx, dy) || 1;
    const bend = (5.5 + (fy < 0 ? -fy / (9 * S) * 3.5 : 0)) * S;
    const kx = (hx + fx) / 2 + (dy / len) * bend;   /* 膝盖前弯 */
    const ky = (hy + fy) / 2 - (dx / len) * bend;
    /* 大腿（贝塞尔，带肌肉起伏） */
    ctx.strokeStyle = C.body;
    ctx.lineWidth = 5.4 * S;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.quadraticCurveTo(kx, ky, fx, fy);
    ctx.stroke();
    /* 小腿（次色，稍细） */
    ctx.strokeStyle = C.bodyM;
    ctx.lineWidth = 4.5 * S;
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    /* 鞋（黑色足袋） */
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(Math.atan2(fy - ky, fx - kx) * 0.35);
    ctx.fillStyle = C.bodyD;
    ctx.beginPath(); ctx.ellipse(1.5 * S, 0, 4.6 * S, 2.7 * S, 0, 0, TAU); ctx.fill();
    /* 鞋面月光高光（朝月一面） */
    ctx.fillStyle = C.bodyL;
    ctx.beginPath(); ctx.ellipse(2.1 * S, -0.7 * S, 2.4 * S, 0.9 * S, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  drawLeg(-1);

  /* ---------- 背刀：斜挎在背后的武士刀（刀鞘+刀柄+刀镡） ---------- */
  /* 在身体之前绘制，身体覆盖中段，仅露出柄与鞘尾 */
  ctx.save();
  ctx.translate(-1 * S, -29 * S + bob);
  ctx.rotate(-0.55); /* 斜挎角度：从右肩到左腰 */
  /* 刀鞘（深色长条，贝塞尔略弯） */
  ctx.strokeStyle = C.blade;
  ctx.lineWidth = 4.4 * S;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-2 * S, 5 * S);
  ctx.quadraticCurveTo(-12 * S, -5 * S, -22 * S, -16 * S);
  ctx.stroke();
  /* 刀鞘暗面（下缘） */
  ctx.strokeStyle = C.bladeD;
  ctx.lineWidth = 1.6 * S;
  ctx.beginPath();
  ctx.moveTo(-1.5 * S, 6 * S);
  ctx.quadraticCurveTo(-12 * S, -4 * S, -21.5 * S, -15 * S);
  ctx.stroke();
  /* 刀鞘月光高光（上缘，朝月一面） */
  ctx.strokeStyle = C.bodyL;
  ctx.lineWidth = 0.9 * S;
  ctx.beginPath();
  ctx.moveTo(-2.5 * S, 4 * S);
  ctx.quadraticCurveTo(-12 * S, -6 * S, -22 * S, -17 * S);
  ctx.stroke();
  /* 刀鞘漆环（横箍） */
  ctx.strokeStyle = C.bodyL;
  ctx.lineWidth = 0.8 * S;
  for (let i = 1; i < 4; i++) {
    const tt = i / 4;
    const gx = -2 * S + (-22 * S - (-2 * S)) * tt;
    const gy = 5 * S + (-16 * S - 5 * S) * tt;
    ctx.beginPath();
    ctx.moveTo(gx - 2 * S, gy + 1.8 * S);
    ctx.lineTo(gx + 2 * S, gy - 1.8 * S);
    ctx.stroke();
  }
  /* 刀柄（鞘末端露出的木柄） */
  const hiltX = -22 * S, hiltY = -16 * S;
  ctx.strokeStyle = C.hilt;
  ctx.lineWidth = 4.8 * S;
  ctx.beginPath();
  ctx.moveTo(hiltX + 1 * S, hiltY + 1 * S);
  ctx.lineTo(hiltX - 5 * S, hiltY - 4 * S);
  ctx.stroke();
  /* 柄卷纹（菱形缠绳） */
  ctx.strokeStyle = C.bodyD;
  ctx.lineWidth = 0.7 * S;
  for (let i = 0; i < 4; i++) {
    const tt = i / 4;
    const gx = hiltX + 1 * S + (-5 * S - 1 * S) * tt;
    const gy = hiltY + 1 * S + (-4 * S - 1 * S) * tt;
    ctx.beginPath();
    ctx.moveTo(gx - 1.5 * S, gy + 1.2 * S);
    ctx.lineTo(gx + 1.5 * S, gy - 1.2 * S);
    ctx.moveTo(gx - 1.5 * S, gy - 1.2 * S);
    ctx.lineTo(gx + 1.5 * S, gy + 1.2 * S);
    ctx.stroke();
  }
  /* 刀镡（护手圆盘） */
  ctx.fillStyle = C.tsuba;
  ctx.beginPath();
  ctx.ellipse(hiltX + 2 * S, hiltY + 2 * S, 2 * S, 3.4 * S, 0.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = C.bodyL;
  ctx.lineWidth = 0.6 * S;
  ctx.beginPath();
  ctx.ellipse(hiltX + 2 * S, hiltY + 2 * S, 2 * S, 3.4 * S, 0.6, 0, TAU);
  ctx.stroke();
  /* 柄头绳绪（红色穗子） */
  ctx.strokeStyle = C.red;
  ctx.lineWidth = 1.3 * S;
  ctx.beginPath();
  ctx.moveTo(hiltX - 5 * S, hiltY - 4 * S);
  ctx.lineTo(hiltX - 7 * S - wave1 * 0.3, hiltY - 6 * S + wave2 * 0.2);
  ctx.stroke();
  ctx.fillStyle = C.redD;
  ctx.beginPath();
  ctx.arc(hiltX - 6.5 * S, hiltY - 5.5 * S, 1.4 * S, 0, TAU);
  ctx.fill();
  ctx.restore();

  /* ---------- 手臂：两段式摆臂（贝塞尔有机感，与腿反相） ---------- */
  function drawArm(side) {
    const shX = side * 6 * S, shY = -27.5 * S + bob;
    let hx, hy;
    if (n.dead) { hx = side * 11 * S; hy = -30 * S; }
    else if (n.mount === 'wolf' && !n.dead) {
      /* 骑狼：前手抓狼颈鬃、后手后摆平衡 */
      if (side > 0) { hx = 16 * S; hy = -27 * S + bob; } else { hx = -13 * S; hy = -23 * S + bob; }
    }
    else if (n.mount === 'roc' && !n.dead) {
      /* 骑鹏：双手抓翼根羽（贴伏姿态） */
      if (side > 0) { hx = 14 * S; hy = -29 * S; } else { hx = -11 * S; hy = -31 * S; }
    }
    else if (airborne) {
      if (n.vy < 0) { hx = side > 0 ? 14 * S : -13 * S; hy = side > 0 ? -24 * S : -35 * S; }
      else          { hx = side > 0 ? 12 * S : -11 * S; hy = side > 0 ? -20 * S : -30 * S; }
    } else if (state === 'menu') {
      hx = side * 8.5 * S; hy = -18 * S + (side > 0 ? 0 : 1.5 * S);
    } else {
      const p = ph * TAU + (side > 0 ? Math.PI : 0);
      hx = shX + Math.sin(p) * 9 * S;
      hy = -20 * S + bob + Math.cos(p) * 2 * S;
    }
    const dx = hx - shX, dy = hy - shY, len = Math.hypot(dx, dy) || 1;
    const ex = (shX + hx) / 2 - (dy / len) * 5 * S;  /* 肘部后弯 */
    const ey = (shY + hy) / 2 + (dx / len) * 5 * S;
    /* 大臂（贝塞尔） */
    ctx.strokeStyle = C.body;
    ctx.lineWidth = 5 * S;
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.quadraticCurveTo(ex, ey, hx, hy);
    ctx.stroke();
    /* 小臂（次色） */
    ctx.strokeStyle = C.bodyM;
    ctx.lineWidth = 4.3 * S;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
    /* 拳（黑色手套） */
    ctx.fillStyle = C.bodyD;
    ctx.beginPath(); ctx.arc(hx, hy, 2.9 * S, 0, TAU); ctx.fill();
    /* 拳面月光高光（前手朝月） */
    if (side > 0) {
      ctx.fillStyle = C.bodyL;
      ctx.beginPath(); ctx.arc(hx + 0.7 * S, hy - 0.7 * S, 1.2 * S, 0, TAU); ctx.fill();
    }
  }
  drawArm(-1);

  /* ---------- 围巾与腰带飘带（身后飘动） ---------- */
  ctx.strokeStyle = C.red; ctx.lineWidth = 4.8 * S;
  ctx.beginPath();
  ctx.moveTo(-2 * S, -34 * S + bob);
  ctx.quadraticCurveTo(-13 * S, -37 * S + bob + wave1, -24 * S, -32 * S + bob + wave2);
  ctx.stroke();
  ctx.strokeStyle = C.redD; ctx.lineWidth = 2.4 * S;
  ctx.beginPath();
  ctx.moveTo(-4 * S, -31.5 * S + bob);
  ctx.quadraticCurveTo(-14 * S, -28 * S + bob + wave2, -21 * S, -23 * S + bob + wave1);
  ctx.stroke();
  /* 围巾月光高光细线 */
  ctx.strokeStyle = C.bodyL; ctx.lineWidth = 1.1 * S;
  ctx.beginPath();
  ctx.moveTo(-2.5 * S, -34.5 * S + bob);
  ctx.quadraticCurveTo(-13 * S, -37.5 * S + bob + wave1, -23 * S, -32.5 * S + bob + wave2);
  ctx.stroke();
  /* 腰带飘带 */
  ctx.strokeStyle = C.red; ctx.lineWidth = 3.2 * S;
  ctx.beginPath();
  ctx.moveTo(-8 * S, -16.5 * S + bob);
  ctx.quadraticCurveTo(-16 * S, -13 * S + bob + wave1 * 0.6, -22 * S, -8 * S + bob + wave2 * 0.7);
  ctx.stroke();

  /* ---------- 躯干：贝塞尔侧面剪影（有机感，非矩形拼接） ---------- */
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(-7 * S, -33 * S + bob);    /* 颈后起 */
  ctx.bezierCurveTo(-9 * S, -28 * S + bob, -9.5 * S, -22 * S + bob, -8 * S, -16 * S + bob);  /* 后背曲线 */
  ctx.bezierCurveTo(-6.5 * S, -14 * S + bob, -2 * S, -13 * S + bob, 4 * S, -14 * S + bob);   /* 腰部前收 */
  ctx.bezierCurveTo(8 * S, -16 * S + bob, 8.5 * S, -22 * S + bob, 7 * S, -28 * S + bob);     /* 前胸 */
  ctx.bezierCurveTo(6.5 * S, -32 * S + bob, 3 * S, -33 * S + bob, -1 * S, -33.5 * S + bob);  /* 锁骨 */
  ctx.closePath();
  ctx.fill();
  /* 前胸月光高光面（朝月一侧） */
  ctx.fillStyle = C.bodyL;
  ctx.beginPath();
  ctx.moveTo(6.5 * S, -31 * S + bob);
  ctx.bezierCurveTo(7.8 * S, -25 * S + bob, 7.2 * S, -19 * S + bob, 5 * S, -16 * S + bob);
  ctx.bezierCurveTo(4 * S, -22 * S + bob, 5 * S, -28 * S + bob, 6.5 * S, -31 * S + bob);
  ctx.closePath();
  ctx.fill();
  /* 月光轮廓光（右侧边缘，面向月亮） */
  ctx.strokeStyle = C.rim; ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  ctx.moveTo(7 * S, -32 * S + bob);
  ctx.bezierCurveTo(8.2 * S, -25 * S + bob, 8 * S, -19 * S + bob, 5 * S, -15 * S + bob);
  ctx.stroke();
  /* 斜挎束带（红色，从右肩到左腰） */
  ctx.strokeStyle = C.red; ctx.lineWidth = 2.6 * S;
  ctx.beginPath();
  ctx.moveTo(-6 * S, -31 * S + bob);
  ctx.quadraticCurveTo(0 * S, -24 * S + bob, 6 * S, -17 * S + bob);
  ctx.stroke();
  /* 腰带（深色横带） */
  ctx.fillStyle = C.bodyD;
  ctx.beginPath();
  ctx.moveTo(-8 * S, -17 * S + bob);
  ctx.bezierCurveTo(-3 * S, -15.5 * S + bob, 3 * S, -15.5 * S + bob, 5 * S, -17 * S + bob);
  ctx.bezierCurveTo(4.5 * S, -14.5 * S + bob, -4.5 * S, -14.5 * S + bob, -7.5 * S, -16 * S + bob);
  ctx.closePath();
  ctx.fill();
  /* 腰带月光细线 */
  ctx.strokeStyle = C.bodyL; ctx.lineWidth = 0.8 * S;
  ctx.beginPath();
  ctx.moveTo(4.5 * S, -16.5 * S + bob);
  ctx.quadraticCurveTo(0, -15 * S + bob, -7 * S, -16.3 * S + bob);
  ctx.stroke();

  drawLeg(1);
  drawArm(1);

  /* ---------- 头部：侧面剪影，面巾遮口鼻，只露一只锐利眼神 ---------- */
  /* 头中心略偏后，面朝右（行进方向） */
  const hcx = 1 * S, hcy = -45 * S + bob, hr = 12.5 * S;
  ctx.fillStyle = C.body;
  ctx.beginPath();
  /* 侧面头型：后脑圆 + 前额倾斜 + 鼻梁凸出 + 面巾覆盖 */
  ctx.moveTo(hcx - hr * 0.5, hcy + hr * 0.4);  /* 颈后下 */
  ctx.bezierCurveTo(hcx - hr * 1.15, hcy, hcx - hr * 1.05, hcy - hr * 0.7, hcx - hr * 0.5, hcy - hr * 0.95);  /* 后脑 */
  ctx.bezierCurveTo(hcx, hcy - hr * 1.1, hcx + hr * 0.5, hcy - hr * 1.05, hcx + hr * 0.85, hcy - hr * 0.6);   /* 头顶 */
  ctx.bezierCurveTo(hcx + hr * 1.05, hcy - hr * 0.25, hcx + hr * 1.1, hcy + hr * 0.05, hcx + hr * 1.0, hcy + hr * 0.18);  /* 额头到鼻梁 */
  ctx.bezierCurveTo(hcx + hr * 1.12, hcy + hr * 0.28, hcx + hr * 1.05, hcy + hr * 0.4, hcx + hr * 0.85, hcy + hr * 0.42);  /* 鼻尖 */
  ctx.lineTo(hcx + hr * 0.7, hcy + hr * 0.42);  /* 鼻翼下沿 */
  /* 面巾：从鼻梁以下全部黑色覆盖 */
  ctx.bezierCurveTo(hcx + hr * 0.75, hcy + hr * 0.7, hcx + hr * 0.2, hcy + hr * 0.85, hcx - hr * 0.3, hcy + hr * 0.75);  /* 面巾下巴凸 */
  ctx.bezierCurveTo(hcx - hr * 0.55, hcy + hr * 0.6, hcx - hr * 0.6, hcy + hr * 0.5, hcx - hr * 0.5, hcy + hr * 0.4);     /* 下颌回颈 */
  ctx.closePath();
  ctx.fill();

  /* 面巾区域更暗（口鼻被遮，质感分层） */
  ctx.fillStyle = C.bodyD;
  ctx.beginPath();
  ctx.moveTo(hcx + hr * 0.7, hcy + hr * 0.42);
  ctx.bezierCurveTo(hcx + hr * 0.75, hcy + hr * 0.7, hcx + hr * 0.2, hcy + hr * 0.85, hcx - hr * 0.3, hcy + hr * 0.75);
  ctx.bezierCurveTo(hcx - hr * 0.1, hcy + hr * 0.55, hcx + hr * 0.4, hcy + hr * 0.45, hcx + hr * 0.7, hcy + hr * 0.42);
  ctx.closePath();
  ctx.fill();

  /* 鼻梁轮廓高光（侧面凸起的鼻线） */
  ctx.strokeStyle = C.bodyL; ctx.lineWidth = 1 * S;
  ctx.beginPath();
  ctx.moveTo(hcx + hr * 1.0, hcy + hr * 0.05);
  ctx.bezierCurveTo(hcx + hr * 1.12, hcy + hr * 0.18, hcx + hr * 1.1, hcy + hr * 0.32, hcx + hr * 0.95, hcy + hr * 0.42);
  ctx.stroke();

  /* 头顶月光轮廓光（右侧朝月一面） */
  ctx.strokeStyle = C.rim; ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  ctx.moveTo(hcx + hr * 0.55, hcy - hr * 0.95);
  ctx.bezierCurveTo(hcx + hr * 0.95, hcy - hr * 0.7, hcx + hr * 1.05, hcy - hr * 0.2, hcx + hr * 1.0, hcy + hr * 0.18);
  ctx.stroke();

  /* ---------- 眼睛：狭缝锐利眼神（侧面只露一只） ---------- */
  const ex = hcx + hr * 0.72, ey = hcy - hr * 0.05;
  const blink = n.blinking > 0 ? 0.12 : 1;
  ctx.save();
  ctx.translate(ex, ey);
  ctx.scale(1, blink);
  /* 眼白窄缝（锐利） */
  ctx.fillStyle = C.eye;
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.8 * S, 1.6 * S, 0, 0, TAU);
  ctx.fill();
  /* 瞳孔（深邃） */
  ctx.fillStyle = C.eyeD;
  ctx.beginPath();
  ctx.ellipse(1.3 * S, 0, 2 * S, 1.5 * S, 0, 0, TAU);
  ctx.fill();
  /* 眼神高光 */
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(1.9 * S, -0.5 * S, 0.7 * S, 0, TAU);
  ctx.fill();
  /* 上眼线（剑眉下压阴影） */
  ctx.strokeStyle = C.bodyD; ctx.lineWidth = 1.8 * S;
  ctx.beginPath();
  ctx.moveTo(-3.5 * S, -1.3 * S);
  ctx.quadraticCurveTo(0, -2.2 * S, 3.6 * S, -0.9 * S);
  ctx.stroke();
  ctx.restore();

  /* 剑眉（侧面，锐利上扬） */
  ctx.strokeStyle = C.bodyL; ctx.lineWidth = 1.7 * S;
  ctx.beginPath();
  ctx.moveTo(hcx + hr * 0.3, ey - 3.2 * S);
  ctx.quadraticCurveTo(hcx + hr * 0.7, ey - 4.4 * S, hcx + hr * 1.08, ey - 2.6 * S);
  ctx.stroke();
  /* 眉眼阴影衔接 */
  ctx.strokeStyle = C.bodyD; ctx.lineWidth = 0.9 * S;
  ctx.beginPath();
  ctx.moveTo(hcx + hr * 0.3, ey - 3.2 * S);
  ctx.quadraticCurveTo(hcx + hr * 0.7, ey - 4.4 * S, hcx + hr * 1.08, ey - 2.6 * S);
  ctx.stroke();

  /* ---------- 头巾后摆飘带（背后飘动） ---------- */
  ctx.strokeStyle = C.body; ctx.lineWidth = 3.2 * S;
  ctx.beginPath();
  ctx.moveTo(hcx - hr * 0.85, hcy - hr * 0.25);
  ctx.quadraticCurveTo(hcx - hr * 1.6 + wave1, hcy - hr * 0.5, hcx - hr * 2.3 + wave2, hcy + hr * 0.05);
  ctx.stroke();
  ctx.strokeStyle = C.bodyM; ctx.lineWidth = 1.6 * S;
  ctx.beginPath();
  ctx.moveTo(hcx - hr * 0.8, hcy - hr * 0.15);
  ctx.quadraticCurveTo(hcx - hr * 1.5 + wave2, hcy - hr * 0.35, hcx - hr * 2.1 + wave1, hcy + hr * 0.35);
  ctx.stroke();
  /* 头巾月光细线 */
  ctx.strokeStyle = C.bodyL; ctx.lineWidth = 0.8 * S;
  ctx.beginPath();
  ctx.moveTo(hcx - hr * 0.88, hcy - hr * 0.3);
  ctx.quadraticCurveTo(hcx - hr * 1.6 + wave1, hcy - hr * 0.55, hcx - hr * 2.3 + wave2, hcy);
  ctx.stroke();

  /* ---------- 护盾光环 ---------- */
  if (n.shield && !n.dead) {
    const rr = 42 * S;
    ctx.strokeStyle = `rgba(120,220,235,${0.45 + 0.28 * Math.sin(t * 5)})`;
    ctx.lineWidth = 2.2 * S;
    ctx.beginPath(); ctx.arc(0, -26 * S, rr, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(232,196,94,0.4)';
    ctx.lineWidth = 1.2 * S;
    ctx.beginPath(); ctx.arc(0, -26 * S, rr - 5 * S, 0, TAU); ctx.stroke();
  }

  ctx.restore();
}

/* ============================================================
 * 绘制 —— 特效与 UI
 * ============================================================ */
/* ============================================================
 * 绘制 —— 文物展品（路上道具 & 图鉴卡片共用同一套矢量图标）
 * ============================================================ */

/* #hex + 透明度 → rgba */
function relicColA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* 文物矢量图标：c=画布，(cx,cy) 中心，r 整体半径，cat 决定器型。
   全部坐标以 r 的倍数书写，可任意缩放（路上 17S，图鉴卡片 46）。 */
function drawRelicIcon(c, cx, cy, r, cat) {
  c.save();
  c.translate(cx, cy);
  c.lineJoin = 'round'; c.lineCap = 'round';
  const P = {
    cer: '#f3ede1', cerD: '#c9bda4', blue: '#3359a8',
    br: '#806f48', brD: '#4c432d', pat: '#628565',
    jade: '#a8dcbf', jadeD: '#3f8f66', cord: '#b9483c',
    gold: '#e9c563', goldD: '#a9802c',
    paper: '#e9e1cc', ink: '#322d3c', wood: '#6e4a2c',
    stone: '#9c978c', stoneD: '#6d685e', ivory: '#f0e8d4',
    red: '#c0423a',
  };
  /* 青花小折枝：中心圆 + 两点 */
  function flower(x, y, s) {
    c.fillStyle = P.blue;
    c.beginPath(); c.arc(x, y, s, 0, TAU); c.fill();
    c.beginPath(); c.arc(x - s * 1.7, y + s * 0.6, s * 0.55, 0, TAU);
    c.arc(x + s * 1.7, y + s * 0.6, s * 0.55, 0, TAU); c.fill();
    c.fillStyle = P.cer;
    c.beginPath(); c.arc(x, y, s * 0.35, 0, TAU); c.fill();
  }
  /* 瓷质瓶身通用勾边 */
  function porcelain(bodyPath, deco) {
    bodyPath();
    c.fillStyle = P.cer; c.fill();
    c.strokeStyle = P.cerD; c.lineWidth = r * 0.045; c.stroke();
    deco && deco();
  }

  switch (cat) {
    /* ---------- 瓷器 ---------- */
    case 'vase': /* 梅瓶 */
      porcelain(() => {
        c.beginPath();
        c.moveTo(-0.10 * r, -1.00 * r); c.lineTo(0.10 * r, -1.00 * r);
        c.bezierCurveTo(0.10 * r, -0.72 * r, 0.56 * r, -0.68 * r, 0.63 * r, -0.34 * r);
        c.bezierCurveTo(0.72 * r, 0.04 * r, 0.46 * r, 0.74 * r, 0.24 * r, 0.96 * r);
        c.lineTo(-0.24 * r, 0.96 * r);
        c.bezierCurveTo(-0.46 * r, 0.74 * r, -0.72 * r, 0.04 * r, -0.63 * r, -0.34 * r);
        c.bezierCurveTo(-0.56 * r, -0.68 * r, -0.10 * r, -0.72 * r, -0.10 * r, -1.00 * r);
        c.closePath();
      }, () => {
        c.fillStyle = P.blue;
        c.fillRect(-0.12 * r, -0.88 * r, 0.24 * r, 0.13 * r);
        flower(0, -0.22 * r, 0.10 * r);
        flower(-0.20 * r, 0.12 * r, 0.06 * r);
        flower(0.22 * r, 0.10 * r, 0.06 * r);
        c.fillRect(-0.20 * r, 0.74 * r, 0.40 * r, 0.10 * r);
      });
      break;
    case 'jar': /* 盖罐 */
      porcelain(() => {
        c.beginPath();
        c.moveTo(-0.62 * r, -0.30 * r);
        c.bezierCurveTo(-0.70 * r, 0.30 * r, -0.40 * r, 0.92 * r, 0, 0.94 * r);
        c.bezierCurveTo(0.40 * r, 0.92 * r, 0.70 * r, 0.30 * r, 0.62 * r, -0.30 * r);
        c.closePath();
      }, () => {
        flower(0, 0.18 * r, 0.11 * r);
        flower(-0.28 * r, 0.45 * r, 0.06 * r);
        flower(0.28 * r, 0.45 * r, 0.06 * r);
      });
      /* 盖与钮 */
      c.fillStyle = P.cer; c.strokeStyle = P.cerD; c.lineWidth = r * 0.045;
      c.beginPath(); c.ellipse(0, -0.40 * r, 0.52 * r, 0.18 * r, 0, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
      c.fillRect(-0.08 * r, -0.66 * r, 0.16 * r, 0.14 * r); c.strokeRect(-0.08 * r, -0.66 * r, 0.16 * r, 0.14 * r);
      break;
    case 'pot': /* 执壶 */
      porcelain(() => {
        c.beginPath(); c.arc(0, 0.12 * r, 0.52 * r, 0, TAU); c.closePath();
      }, () => { flower(0, 0.14 * r, 0.09 * r); });
      c.fillStyle = P.cer; c.strokeStyle = P.cerD; c.lineWidth = r * 0.05;
      c.beginPath(); c.moveTo(0.42 * r, -0.02 * r); c.quadraticCurveTo(0.72 * r, -0.22 * r, 0.78 * r, -0.52 * r);
      c.quadraticCurveTo(0.66 * r, -0.28 * r, 0.42 * r, -0.18 * r); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.arc(-0.48 * r, 0.02 * r, 0.20 * r, -Math.PI / 2, Math.PI / 2); c.stroke();
      c.beginPath(); c.ellipse(0, -0.34 * r, 0.22 * r, 0.08 * r, 0, 0, TAU); c.fill(); c.stroke();
      break;
    case 'bowl': /* 碗 */
      porcelain(() => {
        c.beginPath();
        c.moveTo(-0.72 * r, -0.22 * r);
        c.quadraticCurveTo(0, 0.62 * r, 0.72 * r, -0.22 * r);
        c.lineTo(0.30 * r, 0.82 * r); c.lineTo(-0.30 * r, 0.82 * r); c.closePath();
      }, () => {
        c.strokeStyle = P.blue; c.lineWidth = r * 0.07;
        c.beginPath(); c.arc(0, -0.20 * r, 0.60 * r, 0.20, Math.PI - 0.20); c.stroke();
      });
      c.strokeStyle = P.cerD; c.lineWidth = r * 0.045;
      c.beginPath(); c.ellipse(0, -0.22 * r, 0.72 * r, 0.15 * r, 0, 0, TAU); c.stroke();
      break;
    case 'cup': /* 压手杯 */
      c.save(); c.translate(0, 0.18 * r); c.scale(0.72, 0.72);
      porcelain(() => {
        c.beginPath();
        c.moveTo(-0.72 * r, -0.22 * r);
        c.quadraticCurveTo(0, 0.62 * r, 0.72 * r, -0.22 * r);
        c.lineTo(0.30 * r, 0.82 * r); c.lineTo(-0.30 * r, 0.82 * r); c.closePath();
      }, () => flower(0, 0.18 * r, 0.13 * r));
      c.restore();
      break;
    case 'plate': /* 盘 */
      c.fillStyle = P.cer; c.strokeStyle = P.cerD; c.lineWidth = r * 0.045;
      c.beginPath(); c.ellipse(0, 0.18 * r, 0.90 * r, 0.34 * r, 0, 0, TAU); c.fill(); c.stroke();
      c.strokeStyle = P.blue; c.lineWidth = r * 0.06;
      c.beginPath(); c.ellipse(0, 0.18 * r, 0.60 * r, 0.21 * r, 0, 0, TAU); c.stroke();
      flower(0, 0.12 * r, 0.10 * r);
      break;
    case 'zun': /* 觚 / 玉壶春瓶 */
      porcelain(() => {
        c.beginPath();
        c.moveTo(-0.36 * r, -0.95 * r);
        c.quadraticCurveTo(-0.16 * r, -0.80 * r, -0.15 * r, -0.52 * r);
        c.bezierCurveTo(-0.46 * r, -0.30 * r, -0.56 * r, 0.20 * r, -0.26 * r, 0.50 * r);
        c.lineTo(-0.30 * r, 0.92 * r); c.lineTo(0.30 * r, 0.92 * r);
        c.lineTo(0.26 * r, 0.50 * r);
        c.bezierCurveTo(0.56 * r, 0.20 * r, 0.46 * r, -0.30 * r, 0.15 * r, -0.52 * r);
        c.quadraticCurveTo(0.16 * r, -0.80 * r, 0.36 * r, -0.95 * r);
        c.closePath();
      }, () => {
        c.strokeStyle = P.blue; c.lineWidth = r * 0.06;
        c.beginPath(); c.ellipse(0, -0.50 * r, 0.20 * r, 0.06 * r, 0, 0, TAU); c.stroke();
        c.beginPath(); c.ellipse(0, 0.42 * r, 0.34 * r, 0.09 * r, 0, 0, TAU); c.stroke();
      });
      break;
    case 'brush': /* 笔洗 */
      c.fillStyle = P.cer; c.strokeStyle = P.cerD; c.lineWidth = r * 0.045;
      c.beginPath(); c.ellipse(0, 0.28 * r, 0.82 * r, 0.42 * r, 0, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = P.cerD;
      c.beginPath(); c.ellipse(0, 0.20 * r, 0.58 * r, 0.26 * r, 0, 0, TAU); c.fill();
      c.strokeStyle = P.blue; c.lineWidth = r * 0.06;
      c.beginPath(); c.ellipse(0, 0.20 * r, 0.40 * r, 0.17 * r, 0, 0, TAU); c.stroke();
      break;
    case 'snuff': /* 鼻烟壶 */
      porcelain(() => {
        roundRect(c, -0.34 * r, -0.52 * r, 0.68 * r, 1.22 * r, 0.20 * r);
      }, () => {
        flower(0, 0.08 * r, 0.10 * r);
        c.fillStyle = P.blue; c.fillRect(-0.30 * r, 0.42 * r, 0.60 * r, 0.08 * r);
      });
      c.fillStyle = P.red;
      c.fillRect(-0.16 * r, -0.92 * r, 0.32 * r, 0.30 * r);
      c.strokeStyle = P.goldD; c.lineWidth = r * 0.03;
      c.beginPath(); c.moveTo(0, -0.92 * r); c.lineTo(0, -1.00 * r); c.stroke();
      break;
    case 'pillow': /* 孩儿枕 */
      porcelain(() => {
        roundRect(c, -0.85 * r, -0.12 * r, 1.70 * r, 0.52 * r, 0.26 * r);
      }, () => {
        c.strokeStyle = P.blue; c.lineWidth = r * 0.06;
        c.beginPath(); c.moveTo(-0.20 * r, 0.02 * r);
        c.quadraticCurveTo(0.10 * r, -0.14 * r, 0.42 * r, 0.02 * r); c.stroke();
      });
      c.fillStyle = P.cer; c.strokeStyle = P.cerD; c.lineWidth = r * 0.045;
      c.beginPath(); c.arc(-0.62 * r, -0.06 * r, 0.20 * r, 0, TAU); c.fill(); c.stroke();
      break;

    /* ---------- 青铜器 ---------- */
    case 'ding': /* 青铜鼎 */
      c.strokeStyle = P.brD; c.lineWidth = r * 0.11; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-0.48 * r, 0.05 * r); c.lineTo(-0.60 * r, 0.72 * r);
      c.moveTo(0, 0.10 * r); c.lineTo(0, 0.78 * r);
      c.moveTo(0.48 * r, 0.05 * r); c.lineTo(0.60 * r, 0.72 * r); c.stroke();
      c.beginPath();
      c.moveTo(-0.58 * r, -0.30 * r); c.arc(-0.58 * r, -0.46 * r, 0.17 * r, 0, Math.PI);
      c.moveTo(0.58 * r, -0.30 * r); c.arc(0.58 * r, -0.46 * r, 0.17 * r, 0, Math.PI); c.stroke();
      c.fillStyle = P.br; c.strokeStyle = P.brD; c.lineWidth = r * 0.05;
      c.beginPath();
      c.moveTo(-0.78 * r, -0.28 * r);
      c.quadraticCurveTo(0, 0.42 * r, 0.78 * r, -0.28 * r);
      c.quadraticCurveTo(0, -0.46 * r, -0.78 * r, -0.28 * r);
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = P.pat;
      for (const fx of [-0.42, 0, 0.42]) { c.beginPath(); c.arc(fx * r, -0.18 * r, r * 0.07, 0, TAU); c.fill(); }
      break;
    case 'li': /* 鬲 */
      c.fillStyle = P.br; c.strokeStyle = P.brD; c.lineWidth = r * 0.05;
      for (const fx of [-0.34, 0, 0.34]) {
        c.beginPath(); c.arc(fx * r, 0.32 * r, 0.30 * r, 0, TAU); c.fill(); c.stroke();
      }
      c.beginPath();
      c.moveTo(-0.42 * r, -0.62 * r); c.lineTo(0.42 * r, -0.62 * r);
      c.lineTo(0.30 * r, 0.10 * r); c.lineTo(-0.30 * r, 0.10 * r); c.closePath();
      c.fill(); c.stroke();
      break;
    case 'censer': /* 熏炉 */
      c.fillStyle = P.br; c.strokeStyle = P.brD; c.lineWidth = r * 0.05;
      c.beginPath();
      c.moveTo(-0.66 * r, 0.05 * r);
      c.quadraticCurveTo(0, 0.55 * r, 0.66 * r, 0.05 * r);
      c.quadraticCurveTo(0, -0.15 * r, -0.66 * r, 0.05 * r); c.closePath();
      c.fill(); c.stroke();
      c.beginPath(); c.arc(0, -0.28 * r, 0.44 * r, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.arc(0, -0.72 * r, 0.10 * r, 0, TAU); c.fill(); c.stroke();
      c.lineWidth = r * 0.07;
      c.beginPath(); c.arc(-0.66 * r, -0.02 * r, 0.14 * r, -Math.PI / 2, Math.PI / 2);
      c.arc(0.66 * r, -0.02 * r, 0.14 * r, Math.PI / 2, -Math.PI / 2); c.stroke();
      break;
    case 'bronze': /* 方壶 */
      c.fillStyle = P.br; c.strokeStyle = P.brD; c.lineWidth = r * 0.05;
      roundRect(c, -0.55 * r, -0.62 * r, 1.10 * r, 1.42 * r, 0.12 * r); c.fill(); c.stroke();
      c.fillStyle = P.brD;
      c.fillRect(-0.55 * r, -0.10 * r, 1.10 * r, 0.10 * r);
      c.fillRect(-0.55 * r, 0.34 * r, 1.10 * r, 0.10 * r);
      c.fillStyle = P.pat;
      for (const fx of [-0.28, 0, 0.28]) { c.beginPath(); c.arc(fx * r, 0.12 * r, r * 0.06, 0, TAU); c.fill(); }
      c.fillStyle = P.br;
      c.beginPath(); c.arc(0, -0.78 * r, 0.16 * r, 0, TAU); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(-0.12 * r, -0.92 * r, 0.07 * r, 0.10 * r, 0, 0, TAU);
      c.ellipse(0.12 * r, -0.92 * r, 0.07 * r, 0.10 * r, 0, 0, TAU); c.fill();
      break;
    case 'bell': /* 编钟 */
      c.fillStyle = P.br; c.strokeStyle = P.brD; c.lineWidth = r * 0.05;
      c.beginPath();
      c.moveTo(-0.30 * r, -0.78 * r); c.lineTo(0.30 * r, -0.78 * r);
      c.lineTo(0.68 * r, 0.42 * r);
      c.quadraticCurveTo(0, 0.66 * r, -0.68 * r, 0.42 * r);
      c.closePath(); c.fill(); c.stroke();
      c.lineWidth = r * 0.08;
      c.beginPath(); c.moveTo(0, -0.78 * r); c.lineTo(0, -0.92 * r); c.stroke();
      c.fillStyle = P.pat;
      for (const fy of [-0.42, -0.02]) for (const fx of [-0.34, 0, 0.34]) {
        c.beginPath(); c.arc(fx * r, fy * r, r * 0.06, 0, TAU); c.fill();
      }
      break;

    /* ---------- 书画 ---------- */
    case 'painting': /* 横卷 */
      c.fillStyle = P.paper; c.strokeStyle = P.wood; c.lineWidth = r * 0.05;
      roundRect(c, -0.62 * r, -0.42 * r, 1.24 * r, 0.84 * r, 0.05 * r); c.fill(); c.stroke();
      c.fillStyle = P.wood;
      c.beginPath(); c.arc(-0.70 * r, 0, 0.15 * r, 0, TAU); c.fill();
      c.beginPath(); c.arc(0.70 * r, 0, 0.15 * r, 0, TAU); c.fill();
      c.strokeStyle = P.ink; c.lineWidth = r * 0.07; c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(-0.42 * r, 0.22 * r);
      c.lineTo(-0.18 * r, -0.10 * r); c.lineTo(0.02 * r, 0.12 * r);
      c.lineTo(0.24 * r, -0.20 * r); c.lineTo(0.46 * r, 0.10 * r); c.stroke();
      c.lineWidth = r * 0.03;
      c.beginPath(); c.moveTo(-0.42 * r, 0.30 * r); c.quadraticCurveTo(0, 0.18 * r, 0.46 * r, 0.30 * r); c.stroke();
      break;
    case 'scroll': /* 法帖（竖卷） */
      c.fillStyle = P.paper; c.strokeStyle = P.wood; c.lineWidth = r * 0.05;
      roundRect(c, -0.38 * r, -0.78 * r, 0.76 * r, 1.56 * r, 0.05 * r); c.fill(); c.stroke();
      c.fillStyle = P.wood;
      roundRect(c, -0.46 * r, -0.92 * r, 0.92 * r, 0.16 * r, 0.06 * r); c.fill();
      roundRect(c, -0.46 * r, 0.76 * r, 0.92 * r, 0.16 * r, 0.06 * r); c.fill();
      c.strokeStyle = P.ink; c.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const x = (-0.21 + i * 0.14) * r;
        c.lineWidth = r * (0.035 + (i % 2) * 0.02);
        c.beginPath();
        c.moveTo(x, -0.55 * r); c.lineTo(x, (-0.55 + [0.42, 0.62, 0.5, 0.66][i]) * r);
        c.stroke();
      }
      break;

    /* ---------- 玉器 ---------- */
    case 'jade': /* 玉山子 */
      c.fillStyle = P.jadeD;
      c.beginPath();
      c.moveTo(-0.80 * r, 0.62 * r); c.lineTo(-0.20 * r, -0.55 * r);
      c.lineTo(0.12 * r, -0.05 * r); c.lineTo(0.42 * r, -0.72 * r);
      c.lineTo(0.85 * r, 0.62 * r); c.closePath(); c.fill();
      c.fillStyle = P.jade;
      c.beginPath();
      c.moveTo(-0.55 * r, 0.62 * r); c.lineTo(0.05 * r, -0.25 * r);
      c.lineTo(0.30 * r, 0.10 * r); c.lineTo(0.55 * r, -0.30 * r);
      c.lineTo(0.72 * r, 0.62 * r); c.closePath(); c.fill();
      c.fillStyle = '#d8f0e2';
      c.beginPath(); c.arc(0.25 * r, 0.18 * r, r * 0.05, 0, TAU);
      c.arc(0.42 * r, 0.36 * r, r * 0.04, 0, TAU); c.fill();
      break;
    case 'jadePlaque': /* 玉璧 */
      c.strokeStyle = P.jade; c.lineWidth = r * 0.26;
      c.beginPath(); c.arc(0, 0.12 * r, 0.50 * r, 0, TAU); c.stroke();
      c.strokeStyle = P.jadeD; c.lineWidth = r * 0.03;
      c.beginPath(); c.arc(0, 0.12 * r, 0.62 * r, 0, TAU);
      c.arc(0, 0.12 * r, 0.38 * r, 0, TAU); c.stroke();
      c.strokeStyle = P.cord; c.lineWidth = r * 0.06;
      c.beginPath(); c.moveTo(0, -0.42 * r); c.quadraticCurveTo(0.20 * r, -0.72 * r, 0.05 * r, -0.95 * r); c.stroke();
      c.beginPath(); c.moveTo(0.05 * r, -0.95 * r);
      c.lineTo(-0.05 * r, -0.78 * r); c.moveTo(0.05 * r, -0.95 * r);
      c.lineTo(0.16 * r, -0.78 * r); c.stroke();
      break;
    case 'ruyi': /* 如意 */
      c.strokeStyle = P.jadeD; c.lineWidth = r * 0.13; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-0.55 * r, 0.78 * r);
      c.bezierCurveTo(-0.20 * r, 0.35 * r, 0.42 * r, 0.42 * r, 0.30 * r, -0.12 * r);
      c.stroke();
      c.fillStyle = P.jade; c.strokeStyle = P.jadeD; c.lineWidth = r * 0.05;
      c.beginPath();
      c.arc(0.30 * r, -0.42 * r, 0.20 * r, 0, TAU);
      c.arc(0.12 * r, -0.30 * r, 0.15 * r, 0, TAU);
      c.arc(0.48 * r, -0.30 * r, 0.15 * r, 0, TAU);
      c.fill(); c.stroke();
      c.strokeStyle = P.jadeD; c.lineWidth = r * 0.04;
      c.beginPath(); c.arc(0.30 * r, -0.42 * r, 0.09 * r, 0.3, 5.4); c.stroke();
      break;

    /* ---------- 金银器 / 其他宫廷器用 ---------- */
    case 'goldCup': /* 金杯 */
      c.fillStyle = P.gold; c.strokeStyle = P.goldD; c.lineWidth = r * 0.05;
      c.beginPath();
      c.moveTo(-0.62 * r, -0.30 * r);
      c.quadraticCurveTo(0, 0.50 * r, 0.62 * r, -0.30 * r);
      c.lineTo(0.26 * r, 0.62 * r); c.lineTo(-0.26 * r, 0.62 * r); c.closePath();
      c.fill(); c.stroke();
      c.lineWidth = r * 0.07;
      for (const fx of [-0.26, 0, 0.26]) {
        c.beginPath(); c.moveTo(fx * r, 0.55 * r); c.lineTo((fx + 0.05) * r, 0.80 * r); c.stroke();
      }
      c.fillStyle = P.red;
      for (const fx of [-0.24, 0, 0.24]) { c.beginPath(); c.arc(fx * r, -0.05 * r, r * 0.07, 0, TAU); c.fill(); }
      break;
    case 'seal': /* 田黄玺 */
      c.fillStyle = '#d99a3f'; c.strokeStyle = '#a4701f'; c.lineWidth = r * 0.05;
      roundRect(c, -0.36 * r, -0.12 * r, 0.72 * r, 0.92 * r, 0.07 * r); c.fill(); c.stroke();
      c.fillStyle = '#e3a94c';
      c.beginPath(); c.ellipse(0, -0.32 * r, 0.24 * r, 0.18 * r, 0, 0, TAU); c.fill(); c.stroke();
      c.beginPath();
      c.ellipse(-0.15 * r, -0.50 * r, 0.08 * r, 0.12 * r, 0, 0, TAU);
      c.ellipse(0.15 * r, -0.50 * r, 0.08 * r, 0.12 * r, 0, 0, TAU); c.fill();
      c.fillStyle = P.red;
      c.fillRect(-0.18 * r, 0.42 * r, 0.36 * r, 0.20 * r);
      break;
    case 'clock': /* 钟表 */
      c.fillStyle = P.gold; c.strokeStyle = P.goldD; c.lineWidth = r * 0.05;
      c.beginPath();
      c.moveTo(-0.42 * r, -0.50 * r);
      c.quadraticCurveTo(0, -0.95 * r, 0.42 * r, -0.50 * r);
      c.lineTo(0.50 * r, 0.45 * r); c.lineTo(-0.50 * r, 0.45 * r); c.closePath();
      c.fill(); c.stroke();
      c.fillStyle = P.ivory;
      c.beginPath(); c.arc(0, -0.12 * r, 0.30 * r, 0, TAU); c.fill();
      c.strokeStyle = P.goldD; c.lineWidth = r * 0.03; c.stroke();
      c.strokeStyle = P.ink; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, -0.12 * r); c.lineTo(0, -0.32 * r);
      c.moveTo(0, -0.12 * r); c.lineTo(0.14 * r, -0.04 * r); c.stroke();
      c.beginPath(); c.arc(0, 0.62 * r, 0.08 * r, 0, TAU); c.stroke();
      break;
    case 'guqin': /* 古琴 */
      c.fillStyle = P.wood; c.strokeStyle = '#43301d'; c.lineWidth = r * 0.05;
      roundRect(c, -0.92 * r, -0.20 * r, 1.84 * r, 0.40 * r, 0.20 * r); c.fill(); c.stroke();
      c.strokeStyle = 'rgba(240,232,212,0.75)'; c.lineWidth = r * 0.018;
      for (let i = -3; i <= 3; i++) {
        c.beginPath(); c.moveTo(-0.80 * r, i * 0.045 * r); c.lineTo(0.80 * r, i * 0.045 * r); c.stroke();
      }
      c.fillStyle = P.gold;
      c.beginPath(); c.arc(-0.62 * r, 0, r * 0.06, 0, TAU);
      c.arc(0.62 * r, 0, r * 0.06, 0, TAU); c.fill();
      break;
    case 'beads': /* 朝珠 */
      for (let i = 0; i < 16; i++) {
        const a = -Math.PI / 2 + (i / 16) * TAU;
        const bx = Math.cos(a) * 0.58 * r, by = Math.sin(a) * 0.68 * r + 0.08 * r;
        c.fillStyle = (i % 4 === 0) ? P.gold : P.jade;
        c.beginPath(); c.arc(bx, by, r * 0.075, 0, TAU); c.fill();
      }
      c.fillStyle = P.cord;
      c.beginPath(); c.arc(0, -0.60 * r, r * 0.10, 0, TAU); c.fill();
      c.strokeStyle = P.cord; c.lineWidth = r * 0.05;
      c.beginPath(); c.moveTo(0, -0.50 * r); c.lineTo(0, -0.28 * r); c.stroke();
      break;
    case 'ring': /* 戒指 */
      c.strokeStyle = P.gold; c.lineWidth = r * 0.12;
      c.beginPath(); c.arc(0, 0.28 * r, 0.34 * r, 0, TAU); c.stroke();
      c.fillStyle = P.red; c.strokeStyle = P.goldD; c.lineWidth = r * 0.04;
      c.beginPath();
      c.moveTo(0, -0.42 * r); c.lineTo(0.20 * r, -0.20 * r);
      c.lineTo(0, -0.02 * r); c.lineTo(-0.20 * r, -0.20 * r); c.closePath();
      c.fill(); c.stroke();
      break;
    case 'ivory': /* 象牙册页 */
      c.fillStyle = P.red;
      roundRect(c, -0.58 * r, -0.74 * r, 0.20 * r, 1.48 * r, 0.05 * r); c.fill();
      c.fillStyle = P.ivory; c.strokeStyle = '#c8bd9f'; c.lineWidth = r * 0.03;
      roundRect(c, -0.38 * r, -0.74 * r, 0.92 * r, 1.48 * r, 0.05 * r); c.fill(); c.stroke();
      c.strokeStyle = 'rgba(110,74,44,0.55)'; c.lineWidth = r * 0.02;
      for (const fy of [-0.42, -0.10, 0.22, 0.54]) {
        c.beginPath(); c.moveTo(-0.30 * r, fy * r); c.lineTo(0.46 * r, fy * r); c.stroke();
      }
      break;
    case 'globe': /* 天球仪 */
      c.strokeStyle = P.goldD; c.lineWidth = r * 0.05; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-0.28 * r, 0.55 * r); c.lineTo(0, 0.35 * r); c.lineTo(0.28 * r, 0.55 * r);
      c.moveTo(0, 0.35 * r); c.lineTo(0, 0.70 * r); c.stroke();
      c.beginPath(); c.ellipse(0, -0.12 * r, 0.52 * r, 0.62 * r, 0, 0, TAU); c.stroke();
      c.fillStyle = P.gold;
      c.beginPath(); c.arc(0, -0.12 * r, 0.42 * r, 0, TAU); c.fill();
      c.fillStyle = P.ivory;
      for (const [gx, gy] of [[-0.18, -0.30], [0.12, -0.34], [0.22, -0.08], [-0.10, 0.02], [0.02, 0.14], [-0.24, -0.02]]) {
        c.beginPath(); c.arc(gx * r, gy * r, r * 0.045, 0, TAU); c.fill();
      }
      break;
    case 'stoneDrum': /* 石鼓 */
      c.fillStyle = P.stone; c.strokeStyle = P.stoneD; c.lineWidth = r * 0.05;
      roundRect(c, -0.56 * r, -0.52 * r, 1.12 * r, 1.30 * r, 0.26 * r); c.fill(); c.stroke();
      c.fillStyle = P.stoneD;
      c.beginPath(); c.ellipse(0, -0.52 * r, 0.44 * r, 0.15 * r, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(70,66,58,0.7)'; c.lineWidth = r * 0.04;
      c.beginPath();
      c.moveTo(-0.40 * r, -0.10 * r); c.lineTo(0.40 * r, -0.10 * r);
      c.moveTo(-0.42 * r, 0.24 * r); c.lineTo(0.42 * r, 0.24 * r); c.stroke();
      c.lineWidth = r * 0.03;
      c.beginPath(); c.moveTo(0.10 * r, -0.30 * r); c.lineTo(-0.05 * r, 0.55 * r); c.stroke();
      break;
    case 'ornament': /* 珊瑚盆景 */
      c.fillStyle = P.gold; c.strokeStyle = P.goldD; c.lineWidth = r * 0.04;
      c.beginPath();
      c.moveTo(-0.42 * r, 0.55 * r); c.lineTo(0.42 * r, 0.55 * r);
      c.lineTo(0.30 * r, 0.92 * r); c.lineTo(-0.30 * r, 0.92 * r); c.closePath();
      c.fill(); c.stroke();
      c.strokeStyle = P.red; c.lineWidth = r * 0.11; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, 0.55 * r); c.lineTo(0, -0.30 * r);
      c.moveTo(0, -0.05 * r); c.lineTo(-0.30 * r, -0.45 * r);
      c.moveTo(0, -0.05 * r); c.lineTo(0.30 * r, -0.42 * r);
      c.moveTo(-0.16 * r, -0.28 * r); c.lineTo(-0.34 * r, -0.72 * r);
      c.moveTo(0.16 * r, -0.26 * r); c.lineTo(0.36 * r, -0.66 * r); c.stroke();
      c.fillStyle = '#e06a5e';
      for (const [bx, by] of [[0, -0.30], [-0.30, -0.45], [0.30, -0.42], [-0.34, -0.72], [0.36, -0.66]]) {
        c.beginPath(); c.arc(bx * r, by * r, r * 0.08, 0, TAU); c.fill();
      }
      break;
    default: /* 兜底：金镶宝珠 */
      c.fillStyle = P.gold; c.strokeStyle = P.goldD; c.lineWidth = r * 0.05;
      c.beginPath();
      c.moveTo(0, -0.80 * r); c.lineTo(0.55 * r, 0); c.lineTo(0, 0.80 * r);
      c.lineTo(-0.55 * r, 0); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = P.red;
      c.beginPath(); c.arc(0, 0, r * 0.22, 0, TAU); c.fill();
  }
  c.restore();
}

/* 路上的文物：品质光柱 + 光晕 + 悬浮图标 */
function drawRelic(rl) {
  const sx = rl.x - scroll;
  if (sx < -90 * S || sx > W + 90 * S) return;
  const R = window.ARTIFACTS.RARITY[rl.relic.rv];
  const x = sx, y = rl.y + Math.sin(t * 2.2 + rl.ph) * 4 * S;
  const pulse = 0.75 + 0.25 * Math.sin(t * 4 + rl.ph);

  const g = ctx.createLinearGradient(0, y, 0, y - 190 * S);
  g.addColorStop(0, relicColA(R.color, 0.30 * pulse));
  g.addColorStop(1, relicColA(R.color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - 10 * S, y - 190 * S, 20 * S, 190 * S);

  const rg = ctx.createRadialGradient(x, y, 2 * S, x, y, 36 * S);
  rg.addColorStop(0, relicColA(R.color, 0.55));
  rg.addColorStop(1, relicColA(R.color, 0));
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(x, y, 36 * S, 0, TAU); ctx.fill();

  ctx.strokeStyle = relicColA(R.color, 0.75 * pulse);
  ctx.lineWidth = 2 * S;
  ctx.beginPath(); ctx.ellipse(x, y + 15 * S, 23 * S, 7 * S, 0, 0, TAU); ctx.stroke();

  drawRelicIcon(ctx, x, y, 17 * S, rl.relic.cat);
}

/* 锦衣卫（拾取文物后自身后追来；飞鱼服 / 乌纱帽 / 绣春刀） */
function drawChaser() {
  const n = ninja;
  const ground = n.y;
  let back = 150 * S, alpha = 1;
  if (chaser.lunge > 0) back -= 60 * S * (chaser.lunge / 0.45);   /* 出刀前扑 */
  if (chaser.retreat > 0) {                                        /* 被甩开后撤 */
    const k = 1 - chaser.retreat / 0.7;
    back += k * 240 * S; alpha = 1 - k;
  }
  const x = n.sx - back;
  if (x < -130 * S) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  /* 红色杀气 */
  const rg = ctx.createRadialGradient(x, ground - 42 * S, 8 * S, x, ground - 42 * S, 62 * S);
  rg.addColorStop(0, 'rgba(227,66,52,0.25)');
  rg.addColorStop(1, 'rgba(227,66,52,0)');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(x, ground - 42 * S, 62 * S, 0, TAU); ctx.fill();

  /* 影子 */
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(x, ground + 2 * S, 26 * S, 7 * S, 0, 0, TAU); ctx.fill();

  const sw = Math.sin(chaser.runPh * 10);
  const bob = Math.abs(Math.cos(chaser.runPh * 10)) * 3 * S;

  /* 披风（向后飘） */
  ctx.fillStyle = '#6e1c1c';
  ctx.beginPath();
  ctx.moveTo(x - 4 * S, ground - 56 * S + bob);
  ctx.quadraticCurveTo(x - 36 * S, ground - 46 * S + bob, x - 30 * S - sw * 6 * S, ground - 16 * S);
  ctx.quadraticCurveTo(x - 14 * S, ground - 30 * S, x - 2 * S, ground - 26 * S);
  ctx.closePath(); ctx.fill();

  /* 腿 */
  ctx.strokeStyle = '#24222e'; ctx.lineWidth = 6.5 * S; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 5 * S, ground - 26 * S);
  ctx.lineTo(x - 5 * S + sw * 13 * S, ground - 2 * S);
  ctx.moveTo(x + 5 * S, ground - 26 * S);
  ctx.lineTo(x + 5 * S - sw * 13 * S, ground - 2 * S);
  ctx.stroke();

  /* 飞鱼服躯干 */
  ctx.fillStyle = '#a52a24';
  ctx.beginPath();
  ctx.moveTo(x - 13 * S, ground - 56 * S + bob);
  ctx.lineTo(x + 13 * S, ground - 56 * S + bob);
  ctx.lineTo(x + 10 * S, ground - 24 * S);
  ctx.lineTo(x - 10 * S, ground - 24 * S);
  ctx.closePath(); ctx.fill();
  /* 飞鱼纹（金色鳞弧） */
  ctx.strokeStyle = 'rgba(232,196,94,0.7)'; ctx.lineWidth = 1.6 * S;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x, ground - (50 - i * 7) * S + bob, 7 * S, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  /* 腰带 + 带牌 */
  ctx.fillStyle = '#1d1b26';
  ctx.fillRect(x - 11 * S, ground - 32 * S, 22 * S, 5 * S);
  ctx.fillStyle = P_GOLD();
  ctx.fillRect(x - 3 * S, ground - 33 * S, 6 * S, 7 * S);

  /* 后臂（摆动） */
  ctx.strokeStyle = '#8a231d'; ctx.lineWidth = 5.5 * S;
  ctx.beginPath();
  ctx.moveTo(x - 6 * S, ground - 52 * S + bob);
  ctx.lineTo(x - 8 * S - sw * 8 * S, ground - 36 * S + Math.abs(sw) * 3 * S);
  ctx.stroke();

  /* 头 */
  const hy = ground - 64 * S + bob;
  ctx.fillStyle = '#c9916b';
  ctx.beginPath(); ctx.arc(x + 2 * S, hy, 8.5 * S, 0, TAU); ctx.fill();
  /* 乌纱帽 + 帽翅 */
  ctx.fillStyle = '#16131f';
  ctx.beginPath(); ctx.arc(x + 2 * S, hy - 3 * S, 8.5 * S, Math.PI, 0); ctx.fill();
  roundRect(ctx, x - 14 * S, hy - 8 * S, 8 * S, 3.5 * S, 1.5 * S); ctx.fill();
  roundRect(ctx, x + 10 * S, hy - 8 * S, 8 * S, 3.5 * S, 1.5 * S); ctx.fill();
  /* 怒目（红点） */
  ctx.fillStyle = '#ff5a4a';
  ctx.beginPath();
  ctx.arc(x + 7 * S, hy + 1 * S, 1.5 * S, 0, TAU);
  ctx.arc(x + 10.5 * S, hy + 1 * S, 1.5 * S, 0, TAU); ctx.fill();

  /* 前臂高举握刀 */
  ctx.strokeStyle = '#8a231d'; ctx.lineWidth = 5.5 * S;
  const armX = x + 13 * S, armY = ground - 54 * S + bob;
  const handX = x + 17 * S, handY = ground - 66 * S + bob;
  ctx.beginPath(); ctx.moveTo(armX, armY); ctx.lineTo(handX, handY); ctx.stroke();
  /* 绣春刀 */
  const lungeK = chaser.lunge > 0 ? (1 - chaser.lunge / 0.45) : 0;
  const tipX = handX + (14 + lungeK * 16) * S;
  const tipY = handY - (40 - lungeK * 22) * S;
  ctx.strokeStyle = '#d8dde8'; ctx.lineWidth = 3 * S;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.quadraticCurveTo(handX + 8 * S, handY - 22 * S, tipX, tipY);
  ctx.stroke();
  ctx.strokeStyle = P_GOLD(); ctx.lineWidth = 2.5 * S;
  ctx.beginPath();
  ctx.moveTo(handX - 4 * S, handY - 2 * S);
  ctx.lineTo(handX + 5 * S, handY + 3 * S); ctx.stroke();
  /* 出刀白光 */
  if (chaser.lunge > 0) {
    ctx.strokeStyle = `rgba(255,255,255,${chaser.lunge / 0.45 * 0.6})`;
    ctx.lineWidth = 4 * S;
    ctx.beginPath();
    ctx.arc(n.sx - 20 * S, ground - 40 * S, 30 * S, -1.4, 0.6);
    ctx.stroke();
  }
  ctx.restore();
}
function P_GOLD() { return '#e9c563'; }

/* 追缉时的红色屏边警示 */
function drawWantedVignette() {
  if (!ninja.wanted) return;
  const a = 0.10 + 0.06 * Math.sin(t * 5);
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.36, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(227,66,52,0)');
  g.addColorStop(1, `rgba(227,66,52,${a + 0.12})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* 拾取飘字 */
function drawPopups() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `bold ${Math.round(17 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  for (const p of popups) {
    const k = p.life / p.max;
    let a = 1;
    if (k < 0.12) a = k / 0.12;
    else if (k > 0.7) a = (1 - k) / 0.3;
    ctx.globalAlpha = Math.max(0, a);
    ctx.lineWidth = 4 * S; ctx.strokeStyle = 'rgba(10,12,28,0.85)';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

function drawParts() {
  for (const p of parts) {
    const k = 1 - p.life / p.max;
    if (p.type === 'dust') {
      ctx.globalAlpha = k * 0.5;
      ctx.fillStyle = '#9aa3c9';
    } else {
      ctx.globalAlpha = k;
      ctx.fillStyle = p.type === 'rspark' ? p.c : '#f2c14e';
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.5 + k * 0.5), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSpeedLines() {
  if (state !== 'play' || speed < 480 * S) return;
  const k = (speed - 480 * S) / ((CFG.spMax - 480) * S);
  ctx.strokeStyle = 'rgba(220,228,255,0.16)';
  ctx.lineWidth = 1.5 * S;
  for (let i = 0; i < 5; i++) {
    const yy = mod(i * 137.5 + i * i * 31 + t * 900 * S * (0.6 + k), H);
    const len = (60 + i * 26) * S;
    ctx.beginPath();
    ctx.moveTo(W - ((t * 1300 * k + i * 260) % (W + 300 * S)), yy);
    ctx.lineTo(W - ((t * 1300 * k + i * 260) % (W + 300 * S)) + len, yy);
    ctx.stroke();
  }
}

function drawHUD() {
  ctx.textBaseline = 'top';
  /* 铜钱数 */
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath(); ctx.arc(26 * S, 26 * S, 10 * S, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#9a6d1a'; ctx.lineWidth = 1.6 * S;
  ctx.beginPath(); ctx.arc(26 * S, 26 * S, 10 * S, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#7a5414';
  ctx.fillRect(26 * S - 3.2 * S, 26 * S - 3.2 * S, 6.4 * S, 6.4 * S);
  ctx.fillStyle = '#e8e6f5';
  ctx.font = `bold ${Math.round(19 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(String(coins), 42 * S, 26 * S - 10 * S);

  /* 钩索数（金色飞钩 + 数量；冷却中/无存量时变灰并显示剩余秒数） */
  const cd = ninja.hookCD > 0, noHook = ninja.hooks <= 0;
  const hookCol = (cd || noHook) ? '#62626e' : '#e8c45e';
  ctx.save();
  ctx.translate(26 * S, 52 * S);
  if (!(cd || noHook)) {
    ctx.fillStyle = 'rgba(232,196,94,0.16)';
    ctx.beginPath(); ctx.arc(0, 0, 13 * S, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = hookCol; ctx.lineWidth = 2 * S; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, -5 * S, 3 * S, 0, TAU); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -2 * S); ctx.lineTo(0, 3 * S);
  ctx.moveTo(0, 3 * S); ctx.quadraticCurveTo(-4.5 * S, 4.5 * S, -5.5 * S, -0.5 * S);
  ctx.moveTo(0, 3 * S); ctx.quadraticCurveTo(4.5 * S, 4.5 * S, 5.5 * S, -0.5 * S);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = (cd || noHook) ? '#9a9aa4' : '#e8e6f5';
  ctx.fillText('×' + ninja.hooks, 42 * S, 52 * S - 10 * S);
  if (cd) {
    ctx.fillStyle = 'rgba(232,196,94,0.85)';
    ctx.font = `bold ${Math.round(13 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText(Math.ceil(ninja.hookCD) + 's', 42 * S, 52 * S + 9 * S);
  }

  /* 金币换购提示（≥50 常亮；可买金色 / 不可灰 / 已持有青色） */
  if (coins >= 50) {
    ctx.font = `${Math.round(13 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'left';
    const items = [
      ['1盾·50', 50, ninja.shield, false],
      ['2狼·80', 80, ninja.mount === 'wolf', !!ninja.mount],
      ['3鹏·100', 100, ninja.mount === 'roc', !!ninja.mount],
    ];
    let ix = 26 * S;
    for (const [label, need, owned, busy] of items) {
      const col = owned ? '#6fd8c8' : (!busy && coins >= need) ? '#f2c14e' : '#8a8a94';
      ctx.fillStyle = col;
      ctx.fillText(label, ix, 80 * S);
      ix += label.length * 15.5 * S + 10 * S;
    }
  }

  /* 里程 */
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f0d48a';
  ctx.font = `bold ${Math.round(21 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillText(`${distM} 米`, W / 2, 18 * S);

  /* 最佳 / 藏品 */
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(232,230,245,0.65)';
  ctx.font = `${Math.round(15 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillText(`最佳 ${Math.max(best, distM)} 米`, W - 20 * S, 20 * S);
  ctx.fillStyle = '#d9b25f';
  ctx.fillText(`藏品 ${ownedRelics.size}/1000`, W - 20 * S, 42 * S);

  /* 锦衣卫追缉横幅：剩余甩开距离 + 两条命 */
  if (ninja.wanted) {
    const left = Math.max(0, 150 - (distM - ninja.wantedM0));
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff7a6b';
    ctx.font = `bold ${Math.round(18 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText(`锦衣卫追缉中 · 再奔 ${left} 米甩开（押运 ${ninja.carried.length} 件）`, W / 2, 48 * S);
    /* 命数印记 */
    for (let i = 0; i < 2; i++) {
      const lx = W / 2 - 18 * S + i * 36 * S;
      ctx.globalAlpha = i < ninja.lives ? 1 : 0.25;
      ctx.fillStyle = '#e34234';
      ctx.beginPath(); ctx.arc(lx, 78 * S, 7 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f5efe0';
      ctx.font = `bold ${Math.round(10 * S)}px "PingFang SC",sans-serif`;
      ctx.fillText('命', lx, 78 * S - 5.5 * S);
    }
    ctx.globalAlpha = 1;
  }

  /* 大鹏力竭提醒（最后 5 米） */
  if (ninja.mount === 'roc' && distM - ninja.rocM0 >= 95) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 14);
    ctx.fillStyle = '#ffd76b';
    ctx.font = `bold ${Math.round(18 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText('大鹏力竭，即将降落！', W / 2, ninja.wanted ? 98 * S : 48 * S);
    ctx.globalAlpha = 1;
  }

  /* 钩索可用提示（掉落窗口内闪烁） */
  const n = ninja;
  if (!n.dead && !n.grap && !n.grounded && n.hooks > 0 && n.hookCD <= 0
      && n.y > n.lastEaveY + 10 * S && n.y < baseGround + 235 * S) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 10);
    ctx.fillStyle = '#f2c14e';
    ctx.font = `bold ${Math.round(20 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText(IS_TOUCH ? '点左下「钩」· 荡檐' : '按 J · 钩索荡檐', W / 2, H * 0.3);
    ctx.globalAlpha = 1;
  }

  /* ---- 触屏虚拟按键（仅触屏设备、进行中、未暂停时显示） ---- */
  if (IS_TOUCH && !paused && !n.dead) {
    /* 左下：钩索（含剩余数与冷却灰显） */
    const hw = 62 * S, hx = 16 * S, hy = H - hw - Math.max(14 * S, (screenSafeBottom()));
    const cd = n.hookCD > 0, noHook = n.hooks <= 0;
    uiBtn(hx, hy, hw, hw, '钩' + (cd ? ' ' + Math.ceil(n.hookCD) + 's' : '×' + n.hooks),
      () => { if (state === 'play') fireHook(); },
      { disabled: cd || noHook, fs: 17,
        color: (cd || noHook) ? '#8a8a94' : '#e8c45e' });
    /* 右下：换购三件套 盾/狼/鹏 */
    const bw = 64 * S, bh = 46 * S, gap = 10 * S;
    const items = [
      ['盾·50', 50, !n.shield && coins >= 50],
      ['狼·80', 80, !n.mount && coins >= 80],
      ['鹏·100', 100, !n.mount && coins >= 100],
    ];
    let bx = W - 16 * S - bw;
    for (let i = items.length - 1; i >= 0; i--) {
      const [label, need, ok] = items[i];
      const by = H - bh - Math.max(14 * S, screenSafeBottom()) - i * (bh + gap);
      uiBtn(bx, by, bw, bh, label, () => buyPower(i + 1),
        { disabled: !ok, fs: 14, color: ok ? '#f2c14e' : '#8a8a94' });
    }
    /* 右上：暂停 */
    uiBtn(W - 52 * S, 14 * S, 40 * S, 40 * S, '❚❚', () => { paused = true; }, { fs: 13 });
  }
}

/* iPhone 等底部安全区高度（横屏时 home 条可能压住按钮） */
function screenSafeBottom() {
  return 0;   /* viewport-fit=cover 下横屏 home 条在侧面，底部预留由布局常量保证 */
}

function drawSeal(x, y, size, char) {
  ctx.fillStyle = '#c0392b';
  roundRect(ctx, x, y, size, size, size * 0.16); ctx.fill();
  ctx.fillStyle = '#f5efe0';
  ctx.font = `bold ${Math.round(size * 0.68)}px "Kaiti SC","KaiTi","STKaiti",serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(char, x + size / 2, y + size / 2 + size * 0.04);
  ctx.textBaseline = 'top';
}

function drawMenu() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';

  const ty = H * 0.17;
  /* 标题 */
  ctx.save();
  ctx.shadowColor = 'rgba(242,193,78,0.45)';
  ctx.shadowBlur = 22 * S;
  ctx.fillStyle = '#f0d48a';
  ctx.font = `bold ${Math.round(64 * S)}px "Kaiti SC","KaiTi","STKaiti","PingFang SC",serif`;
  ctx.fillText('月夜疾行', W / 2, ty);
  ctx.restore();

  drawSeal(W / 2 + 150 * S, ty + 14 * S, 34 * S, '夜');

  ctx.fillStyle = 'rgba(232,230,245,0.8)';
  ctx.font = `${Math.round(19 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillText('屋 顶 狂 奔 · Q 版古风忍者', W / 2, ty + 84 * S);

  /* 闪烁提示 */
  const a = 0.55 + 0.45 * Math.sin(t * 4);
  ctx.globalAlpha = a;
  ctx.fillStyle = '#f2c14e';
  ctx.font = `bold ${Math.round(22 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  if (!IS_TOUCH) {
    ctx.globalAlpha = a;
    ctx.fillText('点击屏幕 / 按下空格  开始夜行', W / 2, H * 0.47);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = 'rgba(232,230,245,0.55)';
  ctx.font = `${Math.round(15 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  if (IS_TOUCH) {
    ctx.fillText('点屏幕：跳 / 二段跳 · 左下「钩」荡檐 · 右下买道具', W / 2, H * 0.47 + 10 * S);
  } else {
    ctx.fillText('空格 / 点击：跳跃　·　空中再按：二段跳　·　J：钩索荡檐　·　P：暂停', W / 2, H * 0.47 + 56 * S);
  }

  /* 账号与图鉴入口 */
  const uname = (window.Account && Account.isLogin()) ? Account.getName() : '';
  if (!IS_TOUCH) {
    ctx.fillStyle = 'rgba(240,212,138,0.9)';
    ctx.font = `${Math.round(15 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText(`G 故宫展品图鉴（已藏 ${ownedRelics.size}/1000）　·　L 退出登录`, W / 2, H * 0.47 + 88 * S);
  }
  if (uname) {
    ctx.fillStyle = 'rgba(232,230,245,0.5)';
    ctx.font = `${Math.round(13 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText(`当前账号：${uname}`, W / 2, H - 26 * S - (IS_TOUCH ? 110 * S : 0));
  }

  /* ---- 触屏菜单按钮：开始 / 图鉴 / 全屏 / 退出登录 ---- */
  if (IS_TOUCH) {
    const bw = 220 * S, bh = 52 * S, cx = W / 2 - bw / 2;
    let by = H * 0.58;
    uiBtn(cx, by, bw, bh, '开 始 夜 行', () => startGame(), {
      bg: 'rgba(160,48,36,0.85)', border: 'rgba(240,212,138,0.9)', color: '#fff3d6', fs: 21,
    });
    by += bh + 12 * S;
    const gw = (bw - 12 * S) / 2;
    uiBtn(cx, by, gw, bh * 0.82, `图鉴 ${ownedRelics.size}/1000`, () => Gallery.open(), { fs: 14 });
    uiBtn(cx + gw + 12 * S, by, gw, bh * 0.82, '全 屏', toggleFullscreen, { fs: 14 });
    if (uname) {
      by += bh * 0.82 + 12 * S;
      uiBtn(cx, by, bw, bh * 0.7, `退出登录（${uname}）`, () => {
        if (confirm('确定退出当前账号吗？')) { Account.logout(); location.reload(); }
      }, { fs: 13, dim: 0.8 });
    }
  }
}

/* 全屏切换（安卓/桌面有效；不支持的浏览器静默忽略） */
function toggleFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
  } else {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el);
  }
}

function drawOver() {
  if (overT < 0.45) return;
  const a = Math.min(0.62, (overT - 0.45) / 0.4);
  ctx.fillStyle = `rgba(8,10,24,${a})`;
  ctx.fillRect(0, 0, W, H);

  const pw = Math.max(140, Math.min(440 * S, W - 40)), phh = 250 * S + (IS_TOUCH ? 66 * S : 0);
  const px = (W - pw) / 2, py = (H - phh) / 2;
  ctx.fillStyle = 'rgba(18,22,48,0.95)';
  roundRect(ctx, px, py, pw, phh, 14 * S); ctx.fill();
  ctx.strokeStyle = 'rgba(240,212,138,0.7)'; ctx.lineWidth = 2 * S;
  roundRect(ctx, px, py, pw, phh, 14 * S); ctx.stroke();

  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#f0d48a';
  ctx.font = `bold ${Math.round(34 * S)}px "Kaiti SC","KaiTi","STKaiti",serif`;
  ctx.fillText('夜色未尽 · 来日再战', W / 2, py + 26 * S);

  const isNew = distM >= best && distM > 0;
  ctx.fillStyle = '#e8e6f5';
  ctx.font = `${Math.round(19 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillText(`里程 ${distM} 米　·　铜钱 ${coins} 枚`, W / 2, py + 92 * S);
  ctx.fillStyle = 'rgba(232,230,245,0.65)';
  ctx.fillText(`最佳纪录 ${best} 米`, W / 2, py + 128 * S);

  if (isNew) drawSeal(W / 2 + 90 * S, py + 118 * S, 34 * S, '新');

  if (!IS_TOUCH) {
    const a2 = 0.55 + 0.45 * Math.sin(t * 4);
    ctx.globalAlpha = a2;
    ctx.fillStyle = '#f2c14e';
    ctx.font = `bold ${Math.round(20 * S)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText('R 重新出发　·　A 返回主页', W / 2, py + 186 * S);
    ctx.globalAlpha = 1;
  } else if (overT > 0.6) {
    /* 触屏：面板内两颗大按钮 */
    const bwd = Math.min(160 * S, (pw - 42 * S) / 2);
    uiBtn(px + pw / 2 - bwd - 10 * S, py + phh - 66 * S, bwd, 50 * S, '重新出发', () => startGame(), {
      bg: 'rgba(160,48,36,0.9)', border: 'rgba(240,212,138,0.9)', color: '#fff3d6', fs: 17,
    });
    uiBtn(px + pw / 2 + 10 * S, py + phh - 66 * S, bwd, 50 * S, '返回主页', () => { reset(); state = 'menu'; }, { fs: 17 });
  }
}

/* ============================================================
 * 主渲染
 * ============================================================ */
function render() {
  uiBtns = [];   /* 每帧重建触屏按钮命中区 */
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake) * S * 0.5, rand(-shake, shake) * S * 0.5);

  drawSky();
  drawFar();
  drawMid();

  /* 屋顶（先画，再画其上物件） */
  for (const sg of segments) drawRoof(sg);

  /* 障碍 / 铜钱 / 乌鸦 / 文物 */
  for (const sg of segments) for (const ob of sg.obs) drawObstacle(ob);
  for (const sg of segments) for (const c of sg.coins) drawCoin(c);
  for (const sg of segments) if (sg.upper) for (const c of sg.upper.coins) drawCoin(c);
  for (const sg of segments) if (sg.hook) drawHookItem(sg.hook);
  for (const c of gapCoins) drawCoin(c);
  for (const cr of crows) drawCrow(cr);
  for (const rl of relics) drawRelic(rl);

  /* 锦衣卫在忍者身后（先画） */
  if (state === 'play' && (ninja.wanted || chaser.retreat > 0)) drawChaser();

  /* 大鹏最后 5 米：整体闪烁提醒即将降落 */
  const rocWarn = state === 'play' && ninja.mount === 'roc' && (distM - ninja.rocM0) >= 95;
  if (rocWarn) ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 16));
  drawNinja();
  if (rocWarn) ctx.globalAlpha = 1;
  drawParts();
  drawSpeedLines();
  drawPopups();

  ctx.restore();

  /* 暗角 */
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);
  drawWantedVignette();

  if (state === 'play' || state === 'over') drawHUD();
  if (state === 'menu') drawMenu();
  if (state === 'over') drawOver();
  if (paused && state === 'play') {
    ctx.fillStyle = 'rgba(8,10,24,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f0d48a';
    ctx.font = `bold ${Math.round(30 * S)}px "Kaiti SC","KaiTi","STKaiti",serif`;
    ctx.fillText(IS_TOUCH ? '已暂停' : '已暂停 · 按 P 继续', W / 2, H / 2 - 60 * S);
    if (IS_TOUCH) {
      const bw = 180 * S, bh = 50 * S;
      uiBtn(W / 2 - bw / 2, H / 2 - 14 * S, bw, bh, '继 续 游 戏', () => { paused = false; }, {
        bg: 'rgba(160,48,36,0.85)', border: 'rgba(240,212,138,0.9)', color: '#fff3d6', fs: 18,
      });
      uiBtn(W / 2 - bw / 2, H / 2 + 46 * S, bw, bh * 0.78, '返回主页', () => { reset(); state = 'menu'; paused = false; }, { fs: 14 });
    }
  }
}

/* ============================================================
 * 输入 & 主循环
 * ============================================================ */
function overlayShown(id) {
  const el = document.getElementById(id);
  return !!(el && el.classList.contains('show'));
}
function anyOverlay() {
  return overlayShown('loginOverlay') || overlayShown('galleryOverlay');
}

function action() {
  if (anyOverlay()) return;
  if (state === 'menu') startGame();
  else if (state === 'play') tryJump();
  else if (state === 'over' && overT > 0.6) startGame();
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const x = e.clientX, y = e.clientY;
  /* 触屏虚拟按键优先命中（后画的在上层；任意手指可点） */
  for (let i = uiBtns.length - 1; i >= 0; i--) {
    const b = uiBtns[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.cb(); return; }
  }
  /* 双指同按只算一次，防止误触发二段跳 */
  if (!e.isPrimary) return;
  action();
});
window.addEventListener('keydown', (e) => {
  /* 图鉴打开时只响应关闭键 */
  if (overlayShown('galleryOverlay')) {
    if (e.code === 'Escape' || e.code === 'KeyG') Gallery.close();
    return;
  }
  if (overlayShown('loginOverlay')) return;   /* 登录面板的回车由面板自己处理 */
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    if (state === 'over') { if (overT > 0.6) startGame(); }
    else action();
  } else if (e.code === 'KeyJ') {
    if (state === 'play') fireHook();
  } else if (e.code === 'Digit1' || e.code === 'Numpad1') {
    buyPower(1);
  } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
    buyPower(2);
  } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
    buyPower(3);
  } else if (e.code === 'KeyR') {
    if (state === 'over') startGame();
  } else if (e.code === 'KeyA') {
    /* 死亡后按 A 返回初始菜单页面 */
    if (state === 'over' && overT > 0.6) { reset(); state = 'menu'; }
  } else if (e.code === 'KeyP') {
    if (state === 'play') paused = !paused;
  } else if (e.code === 'KeyG') {
    if (state === 'menu') Gallery.open();
  } else if (e.code === 'KeyL') {
    if (state === 'menu' && window.Account && Account.isLogin() &&
        confirm('确定退出当前账号吗？')) {
      Account.logout();
      location.reload();
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') paused = true;
});

let tPrev = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - tPrev) / 1000);
  tPrev = now;
  /* 手机竖屏时自动暂停（横屏提示遮罩由 CSS 控制） */
  if (IS_TOUCH && H > W && state === 'play' && !paused) paused = true;
  if (!(state === 'play' && paused)) update(dt);
  render();
  requestAnimationFrame(loop);
}

/* ============================================================
 * 展品图鉴（DOM 面板 + 卡片小 canvas 复用 drawRelicIcon）
 * ============================================================ */
const Gallery = (() => {
  const PER = 48;
  let rv = 0, page = 0, built = false;

  function curList() {
    const all = window.ARTIFACTS.RELICS;
    if (rv === -1) return all.filter(r => ownedRelics.has(r.id));
    if (rv > 0) return all.filter(r => r.rv === rv);
    return all;
  }

  function buildFilters() {
    const box = document.getElementById('gpFilters');
    const defs = [['0', '全部'], ['5', '传奇'], ['4', '罕见'], ['3', '完美'], ['2', '精美'], ['1', '一般'], ['-1', '已收藏']];
    box.innerHTML = '';
    for (const [v, label] of defs) {
      const b = document.createElement('button');
      b.className = 'gp-f' + (String(rv) === v ? ' on' : '');
      b.dataset.rv = v;
      b.textContent = label;
      b.onclick = () => {
        rv = parseInt(v, 10); page = 0;
        box.querySelectorAll('.gp-f').forEach(f => f.classList.remove('on'));
        b.classList.add('on');
        render();
      };
      box.appendChild(b);
    }
  }

  function render() {
    const list = curList();
    const pages = Math.max(1, Math.ceil(list.length / PER));
    page = Math.min(page, pages - 1);
    const grid = document.getElementById('gpGrid');
    grid.innerHTML = '';
    const R = window.ARTIFACTS.RARITY;
    const slice = list.slice(page * PER, page * PER + PER);
    for (const item of slice) {
      const owned = ownedRelics.has(item.id);
      const meta = R[item.rv];
      const card = document.createElement('div');
      card.className = 'relic-card' + (owned ? '' : ' locked');
      card.style.background = `linear-gradient(160deg, ${meta.dark} 0%, #14172e 92%)`;

      const tag = document.createElement('div');
      tag.className = 'rc-tag';
      tag.textContent = meta.name;
      tag.style.background = meta.color;
      card.appendChild(tag);

      const cv = document.createElement('canvas');
      cv.width = 120; cv.height = 120;
      const cc = cv.getContext('2d');
      drawRelicIcon(cc, 60, 62, 44, item.cat);
      card.appendChild(cv);

      const name = document.createElement('div');
      name.className = 'rc-name';
      name.textContent = owned ? item.name : '？？？';
      card.appendChild(name);

      const dy = document.createElement('div');
      dy.className = 'rc-dy';
      dy.textContent = owned ? item.dy : '未寻获';
      card.appendChild(dy);

      grid.appendChild(card);
    }

    document.getElementById('gpCount').textContent =
      `已收藏 ${ownedRelics.size} / 1000 件　·　当前 ${list.length} 件`;
    document.getElementById('gpPage').textContent = `${page + 1} / ${pages}`;
    document.getElementById('gpPrev').disabled = page <= 0;
    document.getElementById('gpNext').disabled = page >= pages - 1;
  }

  function open() {
    if (!built) { buildFilters(); built = true; }
    document.getElementById('galleryOverlay').classList.add('show');
    render();
  }
  function close() {
    document.getElementById('galleryOverlay').classList.remove('show');
  }

  document.getElementById('gpClose').onclick = close;
  document.getElementById('gpPrev').onclick = () => { page--; render(); };
  document.getElementById('gpNext').onclick = () => { page++; render(); };

  return { open, close };
})();

/* ============================================================
 * 登录 / 注册面板
 * ============================================================ */
const LoginUI = (() => {
  let mode = 'login';
  const ov = document.getElementById('loginOverlay');
  const tabs = document.querySelectorAll('.lp-tab');
  const pw2Wrap = document.getElementById('lpPw2Wrap');
  const btn = document.getElementById('lpBtn');
  const msg = document.getElementById('lpMsg');
  const nameEl = document.getElementById('lpName');
  const pwEl = document.getElementById('lpPw');
  const pw2El = document.getElementById('lpPw2');

  function setMode(m) {
    mode = m;
    tabs.forEach(t => t.classList.toggle('on', t.dataset.mode === m));
    pw2Wrap.style.display = m === 'register' ? '' : 'none';
    btn.textContent = m === 'register' ? '注 册' : '登 录';
    msg.textContent = '';
  }
  tabs.forEach(t => t.onclick = () => setMode(t.dataset.mode));

  function fail(txt) { msg.textContent = txt; }

  async function submit() {
    const name = nameEl.value.trim();
    const pw = pwEl.value;
    if (name.length < 2 || name.length > 12) return fail('用户名需 2~12 位');
    if (pw.length < 4) return fail('密码至少 4 位');
    btn.disabled = true;
    try {
      if (mode === 'register') {
        if (pw !== pw2El.value) { btn.disabled = false; return fail('两次输入的密码不一致'); }
        const r = await Account.register(name, pw);
        if (!r.ok) { btn.disabled = false; return fail(r.msg); }
      } else {
        const r = await Account.login(name, pw);
        if (!r.ok) { btn.disabled = false; return fail(r.msg); }
      }
      onAccountReady();
    } catch (err) {
      btn.disabled = false;
      fail('系统不支持安全加密（需 https 或本地环境）');
    }
  }
  btn.onclick = submit;
  [nameEl, pwEl, pw2El].forEach(el =>
    el.addEventListener('keydown', e => { if (e.code === 'Enter') submit(); }));

  /* 已登录（自动恢复）：直接进游戏 */
  function onAccountReady() {
    btn.disabled = false;
    ov.classList.remove('show');
    ownedRelics = Account.ownedSet();
    const d = Account.getData();
    best = d.best | 0;
    reset();
  }
  return { onAccountReady };
})();

/* 启动 */
resize();
window.addEventListener('resize', () => {
  resize();
  if (ninja) {
    ninja.sx = Math.round(W * 0.26);
    if (state === 'menu') ninja.y = baseGround;
  }
});
reset();   /* 预生成菜单场景（ Ninja 站在屋顶 ） */

/* 尝试恢复本机会话；失败则停在登录面板 */
(async function boot() {
  let ok = false;
  if (window.Account) {
    try { ok = await Account.restore(); } catch (e) { ok = false; }
    if (ok) LoginUI.onAccountReady();
  }
})();

requestAnimationFrame(loop);

})();
