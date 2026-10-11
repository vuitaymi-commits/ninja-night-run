/* ============================================================
 * accounts.js —— 本地账号系统（注册 / 登录 / 存档）
 *
 * 当前实现：localStorage 本地存档（零成本、无需后端）。
 * 数据层全部收敛到 Account API，日后改联网账号时只需把
 *   _readAll / _writeAll / data 读写 换成服务端 fetch 即可，
 *   上层游戏代码（game.js / 图鉴）无需改动。
 *
 * 存储结构（localStorage）：
 *   nnr_accounts_v1 : { "用户名": { salt, hash, data } }
 *   nnr_session_v1  : "用户名"（记住登录）
 * ============================================================ */

const Account = (() => {
  const K_ACC = 'nnr_accounts_v1';
  const K_SES = 'nnr_session_v1';
  const SALT_MAGIC = 'nnr::yueye::2026';

  let current = null;   /* { name, data } 已登录账号 */

  /* ---- 底层读写（未来换联网：替换这两个函数即可） ---- */
  function _readAll() {
    try { return JSON.parse(localStorage.getItem(K_ACC)) || {}; }
    catch (e) { return {}; }
  }
  function _writeAll(all) {
    localStorage.setItem(K_ACC, JSON.stringify(all));
  }

  /* ---- 密码哈希（SHA-256 + 账号盐；仅防本地明文，非银行级安全） ----
     手机经局域网 http://IP 访问时 crypto.subtle 不可用，降级为纯 JS 实现 */
  function _sha256Sync(bytes) {
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const l = bytes.length, bl = l * 8;
    const padded = new Uint8Array((((l + 9) + 63) >> 6) << 6);   /* 补齐到 64 字节块（标准填充） */
    padded.set(bytes); padded[l] = 0x80;
    new DataView(padded.buffer).setUint32(padded.length - 4, bl >>> 0);
    const dv = new DataView(padded.buffer);
    const w = new Int32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
        const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
      }
      let [a,b,c,d,e,f,g,h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  async function _hash(pw, salt) {
    const raw = new TextEncoder().encode(SALT_MAGIC + '|' + salt + '|' + pw);
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', raw);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return _sha256Sync(raw);   /* 非安全环境（局域网 http）降级 */
  }
  function _newSalt() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---- 新账号的初始存档（版本号便于日后迁移 / 联网） ---- */
  function _blankData() {
    return {
      v: 1,
      owned: [],          /* 已收藏文物 id 列表（永久保存） */
      best: 0,            /* 最远米数 */
      coins: 0,           /* 结余铜钱 */
      runs: 0,            /* 总奔逃次数 */
      relicsGot: 0,       /* 累计追缴文物数 */
    };
  }

  /* ---- 注册 ---- */
  async function register(name, pw) {
    name = (name || '').trim();
    if (!/^[\u4e00-\u9fa5\w]{2,12}$/.test(name))
      return { ok: false, msg: '用户名需 2~12 位（中文/字母/数字）' };
    if (!pw || pw.length < 4) return { ok: false, msg: '密码至少 4 位' };
    const all = _readAll();
    if (all[name]) return { ok: false, msg: '该用户名已被注册' };
    const salt = _newSalt();
    all[name] = { salt, hash: await _hash(pw, salt), data: _blankData() };
    _writeAll(all);
    localStorage.setItem(K_SES, name);
    current = { name, data: all[name].data };
    return { ok: true };
  }

  /* ---- 登录 ---- */
  async function login(name, pw) {
    name = (name || '').trim();
    const all = _readAll();
    const acc = all[name];
    if (!acc) return { ok: false, msg: '账号不存在，请先注册' };
    if (acc.hash !== await _hash(pw || '', acc.salt)) return { ok: false, msg: '密码错误' };
    localStorage.setItem(K_SES, name);
    current = { name, data: acc.data };
    return { ok: true };
  }

  /* ---- 自动登录（记住会话） ---- */
  function restore() {
    const name = localStorage.getItem(K_SES);
    if (!name) return false;
    const all = _readAll();
    if (!all[name]) { localStorage.removeItem(K_SES); return false; }
    current = { name, data: all[name].data };
    return true;
  }

  function logout() {
    localStorage.removeItem(K_SES);
    current = null;
  }

  function isLogin() { return !!current; }
  function getName() { return current ? current.name : ''; }
  function getData() { return current ? current.data : null; }

  /* ---- 存档：局部更新并立即落盘（文物收藏等关键操作即时保存） ---- */
  function save(patch) {
    if (!current) return;
    Object.assign(current.data, patch);
    const all = _readAll();
    if (all[current.name]) {
      all[current.name].data = current.data;
      _writeAll(all);
    }
  }

  /* ---- 收藏一件文物（已拥有返回 false） ---- */
  function addRelic(id) {
    if (!current) return false;
    if (current.data.owned.includes(id)) return false;
    current.data.owned.push(id);
    current.data.relicsGot = current.data.owned.length;
    save();
    return true;
  }

  function ownedSet() {
    return new Set(current ? current.data.owned : []);
  }

  return { register, login, restore, logout, isLogin, getName, getData, save, addRelic, ownedSet };
})();

/* 暴露到 window，方便其他脚本以 window.Account 安全引用 */
window.Account = Account;
