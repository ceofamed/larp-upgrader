(function() {
  'use strict';

  // ==================== STATE ====================
  function jget(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function nget(k, d) { var v = parseFloat(localStorage.getItem(k)); return isNaN(v) ? d : v; }
  function fget(k, d) { var v = localStorage.getItem(k); return v === null ? d : v === '1'; }

  var S = {
    on: fget('uc_on', true),            // мастер: перехват API
    fakeBal: fget('uc_fb', true),       // фейковый баланс
    fakeInv: fget('uc_fi', true),       // фейковые покупка/продажа/инвентарь
    fakeUpg: fget('uc_fu', true),       // фейковый апгрейд
    fakeHist: fget('uc_fh', true),      // фейковые истории
    bal: nget('uc_b', 1000000),
    chance: nget('uc_chance', 50),
    nextId: nget('uc_next', 990000),
    inv: jget('uc_inv', []),
    spent: jget('uc_spent', []),
    invCache: jget('uc_invc', {}),
    shopCache: jget('uc_shopc', {}),
    betHist: jget('uc_bhist', []),
    itemHist: jget('uc_ihist', [])
  };
  var UI = jget('uc_ui', { bind: 'k' });

  function save() {
    localStorage.setItem('uc_on', S.on ? '1' : '0');
    localStorage.setItem('uc_fb', S.fakeBal ? '1' : '0');
    localStorage.setItem('uc_fi', S.fakeInv ? '1' : '0');
    localStorage.setItem('uc_fu', S.fakeUpg ? '1' : '0');
    localStorage.setItem('uc_fh', S.fakeHist ? '1' : '0');
    localStorage.setItem('uc_b', String(S.bal));
    localStorage.setItem('uc_chance', String(S.chance));
    localStorage.setItem('uc_next', String(S.nextId));
    jset('uc_inv', S.inv); jset('uc_spent', S.spent); jset('uc_invc', S.invCache);
    jset('uc_shopc', S.shopCache); jset('uc_bhist', S.betHist); jset('uc_ihist', S.itemHist);
  }
  function saveUI() { jset('uc_ui', UI); }

  // ==================== HELPERS ====================
  function apiPath(url) {
    var u = String(url || '').replace(/^https?:\/\/[^\/]+/i, '');
    var i = u.indexOf('/api/');
    return i === -1 ? null : u.slice(i + 4).split('?')[0];
  }
  function findInvEntry(id) {
    id = String(id);
    for (var i = 0; i < S.inv.length; i++) if (String(S.inv[i].id) === id) return S.inv[i];
    return S.invCache[id] || null;
  }
  function historyItemFrom(entry) {
    var it = (entry && entry.item) || entry || {};
    return { id: it.id, marketName: it.marketName || '', price: String(parseFloat(it.price) || 0),
             image: it.image || '', imageNew: it.imageNew, extra: it.extra || {} };
  }
  function newInvEntry(shopItem) {
    return { id: S.nextId++, price: String(parseFloat(shopItem.price) || 0), status: 'active',
             item: { id: shopItem.id, marketName: shopItem.marketName || '', image: shopItem.image || '',
                     imageNew: shopItem.imageNew, extra: shopItem.extra || {}, appId: 730 } };
  }
  function invSum() { var s = 0; S.inv.forEach(function(e) { s += parseFloat(e.price) || 0; }); return s; }
  function qParams(url) {
    var q = {}, i = String(url).indexOf('?');
    if (i === -1) return q;
    String(url).slice(i + 1).split('&').forEach(function(p) {
      var kv = p.split('=');
      q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return q;
  }
  function addHist(action, entry) {
    S.itemHist.unshift({ id: S.nextId++, price: String(parseFloat(entry.price) || 0), action: action,
                         item: entry.item || entry, createdAt: new Date().toISOString() });
    if (S.itemHist.length > 100) S.itemHist.length = 100;
  }

  function setBal(o) {
    if (!S.fakeBal || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(setBal); return; }
    for (var k in o) {
      if (!o.hasOwnProperty(k)) continue;
      if ((k === 'balance' || k === 'availableBalance') && (typeof o[k] === 'number' || typeof o[k] === 'string') && o[k] !== '' && !isNaN(parseFloat(o[k]))) o[k] = String(S.bal);
      else if (typeof o[k] === 'object' && o[k] !== null) setBal(o[k]);
    }
  }

  // ==================== ROUTES ====================
  function fakeRequest(method, path, body) {
    if (method !== 'POST') return null;

    if (S.fakeInv && /^\/items\/shop\/buy$/.test(path)) {
      var ids = (body && (body.itemIds || body.ids)) || [];
      var bought = [], total = 0;
      ids.forEach(function(id) {
        var si = S.shopCache[String(id)];
        if (!si) return;
        total += parseFloat(si.price) || 0;
        var e = newInvEntry(si);
        S.inv.push(e); bought.push(e);
      });
      if (S.fakeBal) S.bal = Math.max(0, S.bal - total);
      save();
      bought.forEach(function(e) { addHist('bought', e); });
      save();
      ucEmit('inventory.new_items', bought);
      pushBal();
      return { success: true, items: bought, balance: String(S.bal) };
    }

    if (S.fakeInv && /^\/items\/inventory\/sell$/.test(path)) {
      var sellIds = (body && (body.inventoryItemIds || body.ids)) || [];
      var back = 0;
      sellIds.forEach(function(id) {
        id = String(id);
        var e = findInvEntry(id);
        if (e) { back += parseFloat(e.price) || 0; addHist('sold', e); }
        S.inv = S.inv.filter(function(x) { return String(x.id) !== id; });
        if (S.spent.indexOf(id) === -1) S.spent.push(id);
        delete S.invCache[id];
      });
      if (S.fakeBal) S.bal += back;
      save();
      pushBal();
      return { success: true, balance: String(S.bal) };
    }

    if (S.fakeUpg && /^\/game\/upgrader\/bet$/.test(path)) {
      var betIds = (body && body.betInventoryItemIds) || [];
      var targetId = body && body.targetItemId;
      var targetPrice = parseFloat(body && body.targetItemPrice) || 0;
      var added = parseFloat(body && body.addedBalance) || 0;

      var betItems = [], fake = [];
      betIds.forEach(function(id) {
        id = String(id);
        var e = findInvEntry(id);
        if (e) betItems.push(historyItemFrom(e));
        if (S.inv.some(function(x) { return String(x.id) === id; })) fake.push(id);
        if (S.spent.indexOf(id) === -1) S.spent.push(id);
      });
      S.inv = S.inv.filter(function(x) { return fake.indexOf(String(x.id)) === -1; });
      if (S.fakeBal && added > 0) S.bal = Math.max(0, S.bal - added);

      var ti = S.shopCache[String(targetId)];
      var targetItem = historyItemFrom(ti || { item: { id: targetId, marketName: 'Target', price: targetPrice, image: '', extra: {} } });
      if (ti) targetItem.price = String(targetPrice || ti.price);

      var won = Math.random() * 100 < S.chance;
      var wonItem = null;
      if (won) {
        var e2 = newInvEntry(ti || { id: targetId, price: targetPrice, marketName: 'Won Item', image: '', extra: {} });
        if (parseFloat(e2.price) === 0 && targetPrice > 0) e2.price = String(targetPrice);
        S.inv.push(e2);
        wonItem = historyItemFrom(e2);
        addHist('won', e2);
      }
      save();
      if (won) ucEmit('inventory.new_items', [wonItem]);
      pushBal();

      var bet = { id: S.nextId++, status: won ? 'won' : 'lost', betItems: betItems,
                  addedBalance: String(added || '0'), targetItem: targetItem,
                  createdAt: new Date().toISOString() };
      if (won) bet.wonItem = wonItem;
      S.betHist.unshift(bet);
      if (S.betHist.length > 50) S.betHist.length = 50;
      save();
      return { bet: bet, balance: String(S.bal) };
    }
    return null;
  }

  function transformResponse(method, path, query, obj) {
    if (!obj || typeof obj !== 'object') return;

    setBal(obj);

    if (S.fakeInv && method === 'GET' && /^\/items\/inventory$/.test(path) && Array.isArray(obj.items)) {
      obj.items = obj.items.filter(function(it) { return S.spent.indexOf(String(it.id)) === -1; });
      obj.items.forEach(function(it) {
        if (S.invCache[String(it.id)] || Object.keys(S.invCache).length > 3000) return;
        S.invCache[String(it.id)] = { id: it.id, price: it.price, status: it.status, item: it.item };
      });
      if ((parseInt(query.offset, 10) || 0) === 0) {
        var merged = S.inv.concat(obj.items);
        var dir = (query.sortDirection || '').toLowerCase() === 'desc';
        if (query.sortBy === 'price') {
          merged.sort(function(a, b) {
            var d = (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
            return dir ? -d : d;
          });
        } else if (query.sortBy === 'name') {
          merged.sort(function(a, b) {
            var an = ((a.item || a).marketName) || '', bn = ((b.item || b).marketName) || '';
            var d = String(an).localeCompare(String(bn));
            return dir ? -d : d;
          });
        }
        var lim = parseInt(query.limit, 10);
        obj.items = isNaN(lim) ? merged : merged.slice(0, lim);
        obj.total = (obj.total || 0) + S.inv.length;
        if (obj.hasMore !== undefined) obj.hasMore = !isNaN(lim) && merged.length > lim;
      } else {
        obj.total = (obj.total || 0) + S.inv.length;
      }
      save();
    }
    if (S.fakeInv && method === 'GET' && /^\/items\/inventory\/total$/.test(path)) {
      obj.total = String((parseFloat(obj.total) || 0) + invSum());
    }
    if (method === 'GET' && /^\/items\/shop(\/.*)?$/.test(path) && Array.isArray(obj.items)) {
      obj.items.forEach(function(it) {
        if (S.shopCache[String(it.id)] || Object.keys(S.shopCache).length > 5000) return;
        S.shopCache[String(it.id)] = { id: it.id, price: it.price, marketName: it.marketName,
                                       image: it.image, imageNew: it.imageNew, extra: it.extra };
      });
      save();
    }
    if (S.fakeHist && method === 'GET' && /^\/game\/upgrader\/history/.test(path) && Array.isArray(obj.items)) {
      obj.items = S.betHist.concat(obj.items);
      if (typeof obj.total === 'number') obj.total += S.betHist.length;
    }
    if (S.fakeHist && method === 'GET' && /^\/users\/[^\/]+\/inventory\/history$/.test(path) && Array.isArray(obj.items)) {
      obj.items = S.itemHist.concat(obj.items);
      obj.total = (obj.total || 0) + S.itemHist.length;
    }
    if (S.fakeHist && S.fakeBal && method === 'GET' && /^\/payments\/history$/.test(path) && Array.isArray(obj.items) && obj.items.length) {
      var cl = JSON.parse(JSON.stringify(obj.items[0]));
      (function fix(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(fix); return; }
        for (var k in o) {
          if (!o.hasOwnProperty(k)) continue;
          if (/^(amount|sum|balance|price|total|availableBalance)$/i.test(k)) o[k] = String(S.bal);
          else if (/created|date|time|updated/i.test(k) && typeof o[k] === 'string') o[k] = new Date().toISOString();
          else if (typeof o[k] === 'object' && o[k] !== null) fix(o[k]);
        }
      })(cl);
      obj.items.unshift(cl);
    }
  }

  // ==================== FETCH INTERCEPT ====================
  var realFetch = window.fetch;
  window.fetch = function() {
    var args = arguments, input = args[0], init = args[1] || {};
    var method = (init.method || (input && input.method) || 'GET').toUpperCase();
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = apiPath(url);

    if (!S.on || !path) return realFetch.apply(this, args);

    var body = null;
    if (init.body && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) {} }
    var fake = fakeRequest(method, path, body);
    if (fake) {
      return Promise.resolve(new Response(JSON.stringify(fake), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }));
    }
    return realFetch.apply(this, args).then(function(resp) {
      var ct = resp.headers.get('content-type') || '';
      if (ct.indexOf('json') === -1) return resp;
      return resp.clone().json().then(function(d) {
        transformResponse(method, path, qParams(url), d);
        return new Response(JSON.stringify(d), { status: resp.status, headers: resp.headers });
      })['catch'](function() { return resp; });
    });
  };

  // ==================== XHR INTERCEPT (Angular использует XHR) ====================
  var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u) {
    this.__uc = { m: String(m || 'GET').toUpperCase(), u: String(u || '') };
    return XO.apply(this, [].slice.call(arguments));
  };
  XMLHttpRequest.prototype.send = function(body) {
    var xhr = this, req = xhr.__uc || { m: 'GET', u: '' };
    var path = apiPath(req.u);
    if (S.on && path) {
      var b = null;
      if (typeof body === 'string') { try { b = JSON.parse(body); } catch (e) {} }
      var fake = fakeRequest(req.m, path, b);
      if (fake) {
        setTimeout(function() {
          var text = JSON.stringify(fake);
          try {
            Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
            Object.defineProperty(xhr, 'responseText', { value: text, configurable: true });
            Object.defineProperty(xhr, 'response', { value: text, configurable: true });
          } catch (e) {}
          try { if (xhr.onreadystatechange) xhr.onreadystatechange(new Event('readystatechange')); } catch (e) {}
          try { if (xhr.onload) xhr.onload(new ProgressEvent('load')); } catch (e) {}
          try { xhr.dispatchEvent(new Event('readystatechange')); xhr.dispatchEvent(new ProgressEvent('load')); xhr.dispatchEvent(new ProgressEvent('loadend')); } catch (e) {}
        }, 30);
        return;
      }
      // переписываем ответ сервера на лету (все /api/ ответы: setBal сам точечно правит только balance-поля)
      ['onload', 'onreadystatechange'].forEach(function(prop) {
        var orig = xhr[prop];
        xhr[prop] = function(ev) {
          try { ucRewriteXhr(xhr, req.m, path, qParams(req.u)); } catch (e) {}
          if (orig) orig.call(xhr, ev);
        };
      });
    }
    return XS.apply(this, arguments);
  };
  function ucRewriteXhr(xhr, method, path, query) {
    if (xhr.__ucDone) return;
    var rt = (xhr.responseType || 'text');
    var text = null, obj = null;
    try { if (rt === 'text' || rt === '') text = xhr.responseText; } catch (e) {}
    if (text !== null) { try { obj = JSON.parse(text); } catch (e) {} }
    else { try { obj = JSON.parse(JSON.stringify(xhr.response)); } catch (e) {} }
    if (obj === null || typeof obj !== 'object') return;
    var out = JSON.parse(JSON.stringify(obj));
    transformResponse(method, path, query || {}, out);
    var outText = JSON.stringify(out);
    xhr.__ucDone = true;
    try {
      if (text !== null) Object.defineProperty(xhr, 'responseText', { value: outText, configurable: true });
      Object.defineProperty(xhr, 'response', { value: (rt === 'json') ? out : outText, configurable: true });
    } catch (e) {}
  }

  // ==================== WEBSOCKET ====================
  var ucSockets = [];
  function ucEmit(event, data) {
    var msg = JSON.stringify({ event: event, data: data });
    ucSockets.forEach(function(ws) {
      if (ws.readyState !== 1) return;
      try { ws.dispatchEvent(new MessageEvent('message', { data: msg })); } catch (e) {}
    });
  }
  var RealWS = window.WebSocket;
  function UCWebSocket(url, protocols) {
    var ws = protocols !== undefined ? new RealWS(url, protocols) : new RealWS(url);
    ucSockets.push(ws);
    var baseAdd0 = ws.addEventListener.bind(ws);
    baseAdd0('close', function() {
      var i = ucSockets.indexOf(ws);
      if (i !== -1) ucSockets.splice(i, 1);
    });
    function wrap(fn) {
      return function(ev) {
        try {
          var d = JSON.parse(ev.data);
          if (d && (d.event === 'users.update_balance' || d.type === 'users.update_balance') && S.fakeBal) {
            if (d.data !== undefined && (typeof d.data === 'number' || /^[\d.\-]+$/.test(String(d.data)))) d.data = String(S.bal);
            setBal(d);
            ev = new MessageEvent('message', { data: JSON.stringify(d) });
          }
        } catch (e) {}
        return fn.call(this, ev);
      };
    }
    var baseAdd = ws.addEventListener.bind(ws);
    ws.addEventListener = function(t, fn, o) { return baseAdd(t, t === 'message' ? wrap(fn) : fn, o); };
    Object.defineProperty(ws, 'onmessage', {
      set: function(f) { this.__ucm = f ? wrap(f) : f; },
      get: function() { return this.__ucm; },
      configurable: true
    });
    return ws;
  }
  UCWebSocket.prototype = RealWS.prototype;
  UCWebSocket.CONNECTING = 0; UCWebSocket.OPEN = 1; UCWebSocket.CLOSING = 2; UCWebSocket.CLOSED = 3;
  window.WebSocket = UCWebSocket;

  function pushBal() {
    if (!S.fakeBal) return;
    ucEmit('users.update_balance', String(S.bal));
    // повтор на случай, если обработчик сайта переподписался в этот момент
    setTimeout(function() { ucEmit('users.update_balance', String(S.bal)); }, 120);
  }

  // ==================== UI: СТИЛЬ ЧИТА ====================
  var CSS =
    '@keyframes ucFadeIn{from{opacity:0}to{opacity:1}}' +
    '@keyframes ucWinIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}' +
    '@keyframes ucBlink{0%,100%{opacity:1}50%{opacity:0}}' +
    '@keyframes ucGlitch{0%,88%,100%{transform:none;opacity:1}90%{transform:translate(-3px,1px) skewX(-4deg)}92%{transform:translate(3px,-1px) skewX(3deg)}94%{transform:translate(-2px,-1px)}96%{transform:translate(2px,1px)}}' +
    '@keyframes ucShine{0%{background-position:-220px 0}100%{background-position:220px 0}}' +
    '@keyframes ucBarStripe{0%{background-position:0 0}100%{background-position:24px 0}}' +
    '@keyframes ucMenuIn{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}' +
    '#uc-boot{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(2,2,4,.86);backdrop-filter:blur(8px);font-family:Consolas,Menlo,monospace;transition:opacity .5s}' +
    '#uc-boot.out{opacity:0;pointer-events:none}' +
    '.uc-inj{width:430px;background:#08080a;border:1px solid #26262c;border-radius:8px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 0 1px rgba(255,212,0,.06);animation:ucWinIn .35s cubic-bezier(.2,.9,.3,1.15)}' +
    '.uc-inj-top{height:3px;background:linear-gradient(90deg,#ffd400,#ffe98a,#ffd400);background-size:200% 100%;animation:ucShine 1.6s linear infinite}' +
    '.uc-inj-head{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:1px solid #1a1a1f;font-size:11px;color:#8a8a93;letter-spacing:.08em}' +
    '.uc-inj-head b{color:#ffd400;font-weight:700}' +
    '.uc-inj-log{padding:14px 16px 6px;min-height:168px;font-size:11.5px;line-height:1.75;color:#c9c9cf}' +
    '.uc-inj-ln{white-space:pre;opacity:0;animation:ucFadeIn .18s forwards}' +
    '.uc-inj-ln .ok{color:#ffd400;font-weight:700}' +
    '.uc-inj-ln .dim{color:#55555e}' +
    '.uc-inj-cur::after{content:"\u2588";color:#ffd400;animation:ucBlink .7s step-end infinite}' +
    '.uc-inj-barw{padding:10px 16px 0}' +
    '.uc-inj-bar{height:6px;background:#141418;border:1px solid #26262c;border-radius:3px;overflow:hidden}' +
    '.uc-inj-fill{height:100%;width:0;background:repeating-linear-gradient(45deg,#ffd400 0 8px,#b78f00 8px 16px);background-size:24px 100%;animation:ucBarStripe .5s linear infinite;transition:width .18s}' +
    '.uc-inj-foot{display:flex;justify-content:space-between;padding:10px 16px 12px;font-size:10px;color:#55555e;letter-spacing:.1em}' +
    '.uc-splash{width:430px;text-align:center;padding:30px 0 34px;background:#08080a;border:1px solid #26262c;border-radius:8px;box-shadow:0 30px 80px rgba(0,0,0,.7);animation:ucWinIn .3s}' +
    '.uc-splash-logo{font-family:Consolas,monospace;font-size:44px;font-weight:800;letter-spacing:.02em;color:#fff;animation:ucGlitch 1.8s steps(1) infinite}' +
    '.uc-splash-logo .y{color:#ffd400;text-shadow:0 0 18px rgba(255,212,0,.55)}' +
    '.uc-splash-sub{margin-top:8px;font-size:11px;letter-spacing:.34em;color:#8a8a93;text-transform:uppercase}' +
    '#uc-menu{position:fixed;top:76px;right:20px;width:308px;background:#0b0b0e;border:1px solid #232329;border-radius:10px;box-shadow:0 24px 70px rgba(0,0,0,.65);z-index:2147483000;font-family:Inter,Segoe UI,Tahoma,sans-serif;color:#e8e8ec;font-size:12px;overflow:hidden;animation:ucMenuIn .3s cubic-bezier(.2,.9,.3,1.1);user-select:none;-webkit-user-select:none}' +
    '#uc-menu.hidden{display:none}' +
    '#uc-menu::before{content:"";display:block;height:2px;background:linear-gradient(90deg,#ffd400,#3a3000)}' +
    '#uc-mh{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid #1a1a1f;cursor:grab;user-select:none}' +
    '#uc-mh:active{cursor:grabbing}' +
    '.uc-logo{flex:1;font-family:Consolas,monospace;font-size:14px;font-weight:800;letter-spacing:.02em;color:#fff}' +
    '.uc-logo .y{color:#ffd400}' +
    '.uc-logo .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#ffd400;box-shadow:0 0 8px rgba(255,212,0,.8);margin-left:7px;vertical-align:2px}' +
    '#uc-mh .uc-x{width:22px;height:22px;border:1px solid #26262c;border-radius:6px;background:transparent;color:#8a8a93;font-size:12px;line-height:1;cursor:pointer;transition:all .15s;font-family:inherit}' +
    '#uc-mh .uc-x:hover{border-color:#ffd400;color:#ffd400}' +
    '.uc-kbd{font-family:Consolas,monospace;font-size:10px;color:#ffd400;border:1px solid #3a3320;border-bottom-width:2px;border-radius:4px;padding:2px 7px;background:#141210}' +
    '#uc-mtabs{display:flex;border-bottom:1px solid #1a1a1f}' +
    '.uc-tab{flex:1;padding:9px 0;text-align:center;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6a6a74;background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit;transition:all .15s}' +
    '.uc-tab:hover{color:#c9c9cf}' +
    '.uc-tab.act{color:#ffd400;border-bottom-color:#ffd400;background:rgba(255,212,0,.04)}' +
    '#uc-mb{padding:13px 14px 14px;min-height:190px}' +
    '#uc-mb.act{display:block}' +
    '.uc-mod{border:1px solid #1c1c22;border-radius:8px;background:#101014;margin-bottom:9px;overflow:hidden}' +
    '.uc-mod-h{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;user-select:none;transition:background .15s}' +
    '.uc-mod-h:hover{background:rgba(255,212,0,.04)}' +
    '.uc-cb{flex:0 0 16px;width:16px;height:16px;border:1px solid #3a3a42;border-radius:4px;background:#0c0c0f;position:relative;transition:all .15s}' +
    '.uc-cb::after{content:"\u2713";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#0b0b0e;opacity:0;transform:scale(.4);transition:all .15s}' +
    '.uc-cb.on{background:#ffd400;border-color:#ffd400;box-shadow:0 0 10px rgba(255,212,0,.35)}' +
    '.uc-cb.on::after{opacity:1;transform:scale(1)}' +
    '.uc-mod-t{flex:1;font-size:12px;font-weight:600;color:#d6d6dc;letter-spacing:.02em}' +
    '.uc-mod-t small{display:block;font-size:9.5px;font-weight:400;color:#5c5c66;margin-top:2px;letter-spacing:.03em}' +
    '.uc-mod.armed .uc-mod-t{color:#fff}' +
    '.uc-mod.armed .uc-cb{border-color:#ffd400}' +
    '.uc-sub{max-height:0;opacity:0;overflow:hidden;transition:max-height .3s ease,opacity .25s ease;border-top:1px solid transparent}' +
    '.uc-sub.open{max-height:260px;opacity:1;border-top:1px solid #1c1c22}' +
    '.uc-sub-in{padding:11px 12px;display:flex;flex-direction:column;gap:9px}' +
    '.uc-bal{font-family:Consolas,monospace;font-size:21px;font-weight:800;color:#ffd400;text-shadow:0 0 14px rgba(255,212,0,.3)}' +
    '.uc-inp{width:100%;box-sizing:border-box;padding:8px 11px;border:1px solid #26262c;border-radius:7px;background:#0c0c0f;color:#fff;font-size:12px;outline:none;font-family:Consolas,monospace;transition:border .15s}' +
    '.uc-inp:focus{border-color:#ffd400}' +
    '.uc-btn{padding:8px;border:1px solid #26262c;border-radius:7px;cursor:pointer;font-weight:700;font-size:11px;font-family:inherit;letter-spacing:.06em;transition:all .15s;background:#141418;color:#d6d6dc}' +
    '.uc-btn:hover{border-color:#ffd400;color:#ffd400}' +
    '.uc-btn-y{background:linear-gradient(180deg,#ffd400,#e0b400);color:#0b0b0e;border-color:#ffd400;width:100%}' +
    '.uc-btn-y:hover{filter:brightness(1.1);color:#0b0b0e}' +
    '.uc-chips{display:flex;gap:5px}' +
    '.uc-chip{flex:1;padding:6px 0;text-align:center;border:1px solid #26262c;border-radius:6px;background:transparent;color:#8a8a93;font-size:10px;font-weight:700;cursor:pointer;font-family:Consolas,monospace;transition:all .15s}' +
    '.uc-chip:hover{border-color:#ffd400;color:#ffd400}' +
    '.uc-stat{display:flex;justify-content:space-between;font-size:11px;color:#8a8a93}' +
    '.uc-stat b{color:#e8e8ec;font-weight:600}' +
    '.uc-range{width:100%;-webkit-appearance:none;height:4px;border-radius:2px;background:linear-gradient(90deg,#ffd400 var(--p,50%),#26262c var(--p,50%));outline:none}' +
    '.uc-range::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:3px;background:#ffd400;box-shadow:0 0 8px rgba(255,212,0,.6);cursor:pointer}' +
    '.uc-foot{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-top:1px solid #1a1a1f;font-size:9px;letter-spacing:.14em;color:#4a4a52;text-transform:uppercase}' +
    '.uc-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:8px;background:#0b0b0e;border:1px solid #ffd400;color:#ffd400;font-weight:700;font-size:12px;z-index:2147483647;font-family:Consolas,monospace;box-shadow:0 8px 30px rgba(0,0,0,.5);animation:ucWinIn .25s;white-space:nowrap}';

  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function fmtBal(v) { return parseFloat(v).toFixed(2); }

  // ---------- BOOT: ИНЖЕКТОР ----------
  function showBoot(done) {
    var LINES = [
      ['> demas.lua v1.0 \u2014 loader', ''],
      ['> target: upgrader.vip', ''],
      ['> hooking fetch .............. ', 'OK'],
      ['> hooking XMLHttpRequest ..... ', 'OK'],
      ['> hooking WebSocket .......... ', 'OK'],
      ['> mapping api routes ......... ', 'OK'],
      ['> compiling ui ............... ', 'OK'],
      ['injection complete', '']
    ];
    var boot = el(
      '<div id="uc-boot"><div class="uc-inj">' +
        '<div class="uc-inj-top"></div>' +
        '<div class="uc-inj-head"><span><b>demas.lua</b> injector</span><span>build 1.0.0</span></div>' +
        '<div class="uc-inj-log" id="uc-log"></div>' +
        '<div class="uc-inj-barw"><div class="uc-inj-bar"><div class="uc-inj-fill" id="uc-fill"></div></div></div>' +
        '<div class="uc-inj-foot"><span>upgrader.vip</span><span id="uc-pct">0%</span></div>' +
      '</div></div>');
    document.body.appendChild(boot);
    var log = boot.querySelector('#uc-log'), fill = boot.querySelector('#uc-fill'), pct = boot.querySelector('#uc-pct');

    var li = 0;
    function nextLine() {
      if (li < LINES.length) {
        var ln = LINES[li];
        var d = document.createElement('div');
        d.className = 'uc-inj-ln' + (li === LINES.length - 2 ? ' uc-inj-cur' : '');
        d.innerHTML = ln[0].replace(/</g, '&lt;') + (ln[1] ? '<span class="ok">' + ln[1] + '</span>' : '');
        log.appendChild(d);
        if (li >= 2 && li <= 6) {
          var p = Math.round(((li - 1) / 5) * 100);
          fill.style.width = p + '%';
          pct.textContent = p + '%';
        }
        li++;
        setTimeout(function() { d.classList.remove('uc-inj-cur'); nextLine(); }, 150 + Math.random() * 120);
      } else {
        fill.style.width = '100%'; pct.textContent = '100%';
        setTimeout(function() {
          boot.firstElementChild.outerHTML =
            '<div class="uc-splash">' +
              '<div class="uc-splash-logo">demas<span class="y">.lua</span></div>' +
              '<div class="uc-splash-sub">injected successfully</div>' +
            '</div>';
          setTimeout(function() {
            boot.classList.add('out');
            setTimeout(function() { boot.remove(); done(); }, 520);
          }, 1000);
        }, 350);
      }
    }
    setTimeout(nextLine, 300);
  }

  // ---------- MENU ----------
  var menuEl = null;
  function buildMenu() {
    var m = el(
      '<div id="uc-menu" class="hidden">' +
        '<div id="uc-mh">' +
          '<span class="uc-logo">demas<span class="y">.lua</span><span class="dot"></span></span>' +
          '<span class="uc-kbd" id="uc-kbd">' + escK(UI.bind) + '</span>' +
          '<button class="uc-x" id="uc-m-close" title="\u0417\u0430\u043A\u0440\u044B\u0442\u044C">\u2715</button>' +
        '</div>' +
        '<div id="uc-mtabs">' +
          '<button class="uc-tab act" data-t="0">balance</button>' +
          '<button class="uc-tab" data-t="1">game</button>' +
          '<button class="uc-tab" data-t="2">misc</button>' +
        '</div>' +
        '<div id="uc-mb">' +
          // --- TAB 0: BALANCE ---
          '<div class="uc-tabp" data-p="0">' +
            '<div class="uc-mod" data-f="fakeBal">' +
              '<div class="uc-mod-h"><span class="uc-cb"></span><span class="uc-mod-t">Fake Balance<small>\u043F\u043E\u0434\u043C\u0435\u043D\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u0430 \u0438 \u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u043F\u043E\u0438\u043D\u0442\u043E\u0432</small></span></div>' +
              '<div class="uc-sub"><div class="uc-sub-in">' +
                '<div class="uc-bal" id="uc-m-bal">' + fmtBal(S.bal) + ' \u20BD</div>' +
                '<input class="uc-inp" id="uc-m-in" type="number" placeholder="\u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u0443\u043C\u043C\u0443...">' +
                '<button class="uc-btn uc-btn-y" id="uc-m-set">apply</button>' +
                '<div class="uc-chips">' +
                  ['1000','10000','100000','1000000'].map(function(a) {
                    return '<button class="uc-chip" data-a="' + a + '">' + (a.length > 3 ? a.slice(0, -3) + 'k' : a) + '</button>';
                  }).join('') +
                '</div>' +
              '</div></div>' +
            '</div>' +
          '</div>' +
          // --- TAB 1: GAME ---
          '<div class="uc-tabp" data-p="1" style="display:none">' +
            '<div class="uc-mod" data-f="fakeInv">' +
              '<div class="uc-mod-h"><span class="uc-cb"></span><span class="uc-mod-t">Fake Inventory<small>\u043F\u043E\u043A\u0443\u043F\u043A\u0430 / \u043F\u0440\u043E\u0434\u0430\u0436\u0430 / \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C</small></span></div>' +
              '<div class="uc-sub"><div class="uc-sub-in">' +
                '<div class="uc-stat"><span>\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0445 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u043E\u0432</span><b id="uc-m-inv">0</b></div>' +
                '<div class="uc-stat"><span>\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C</span><b id="uc-m-sum">0 \u20BD</b></div>' +
              '</div></div>' +
            '</div>' +
            '<div class="uc-mod" data-f="fakeUpg">' +
              '<div class="uc-mod-h"><span class="uc-cb"></span><span class="uc-mod-t">Fake Upgrade<small>\u0430\u043F\u0433\u0440\u0435\u0439\u0434 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u0441\u0430\u0439\u0442\u0430</small></span></div>' +
              '<div class="uc-sub"><div class="uc-sub-in">' +
                '<div class="uc-stat"><span>\u0428\u0430\u043D\u0441 \u0443\u0441\u043F\u0435\u0445\u0430</span><b id="uc-m-chv">' + S.chance + '%</b></div>' +
                '<input type="range" class="uc-range" id="uc-m-ch" min="1" max="100" value="' + S.chance + '" style="--p:' + S.chance + '%">' +
              '</div></div>' +
            '</div>' +
            '<div class="uc-mod" data-f="fakeHist">' +
              '<div class="uc-mod-h"><span class="uc-cb"></span><span class="uc-mod-t">Fake History<small>\u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u0430\u043F\u0433\u0440\u0435\u0439\u0434\u043E\u0432 \u0438 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u043E\u0432</small></span></div>' +
              '<div class="uc-sub"><div class="uc-sub-in">' +
                '<div class="uc-stat"><span>\u0410\u043F\u0433\u0440\u0435\u0439\u0434\u043E\u0432 \u0432 \u0438\u0441\u0442\u043E\u0440\u0438\u0438</span><b id="uc-m-bh">0</b></div>' +
                '<div class="uc-stat"><span>\u041F\u0440\u0435\u0434\u043C\u0435\u0442\u043E\u0432 \u0432 \u0438\u0441\u0442\u043E\u0440\u0438\u0438</span><b id="uc-m-ih">0</b></div>' +
              '</div></div>' +
            '</div>' +
          '</div>' +
          // --- TAB 2: MISC ---
          '<div class="uc-tabp" data-p="2" style="display:none">' +
            '<div class="uc-mod" data-f="on">' +
              '<div class="uc-mod-h"><span class="uc-cb"></span><span class="uc-mod-t">API Intercept<small>\u043C\u0430\u0441\u0442\u0435\u0440-\u0432\u044B\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u044C \u0432\u0441\u0435\u0433\u043E \u043F\u0435\u0440\u0435\u0445\u0432\u0430\u0442\u0430</small></span></div>' +
              '<div class="uc-sub"><div class="uc-sub-in">' +
                '<div class="uc-stat"><span>\u0412\u044B\u043A\u043B\u044E\u0447\u0438 \u0447\u0442\u043E\u0431\u044B \u0432\u0438\u0434\u0435\u0442\u044C \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u0439 \u0441\u0430\u0439\u0442</span><b></b></div>' +
              '</div></div>' +
            '</div>' +
            '<div class="uc-mod">' +
              '<div class="uc-mod-h" id="uc-m-bindh" style="cursor:default"><span class="uc-cb" style="visibility:hidden"></span><span class="uc-mod-t">\u041A\u043B\u0430\u0432\u0438\u0448\u0430 \u043C\u0435\u043D\u044E<small>\u043E\u0442\u043A\u0440\u044B\u0442\u044C / \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u043C\u0435\u043D\u044E</small></span><button class="uc-btn" id="uc-m-bind" style="padding:5px 12px">' + escK(UI.bind) + '</button></div>' +
            '</div>' +
            '<button class="uc-btn" id="uc-m-reset" style="width:100%">reset all data</button>' +
          '</div>' +
        '</div>' +
        '<div class="uc-foot"><span>demas.lua</span><span>v1.0.0</span></div>' +
      '</div>');
    document.body.appendChild(m);
    menuEl = m;

    // вкладки
    m.querySelectorAll('.uc-tab').forEach(function(t) {
      t.addEventListener('click', function() {
        m.querySelectorAll('.uc-tab').forEach(function(x) { x.classList.remove('act'); });
        t.classList.add('act');
        m.querySelectorAll('.uc-tabp').forEach(function(p) { p.style.display = p.dataset.p === t.dataset.t ? '' : 'none'; });
      });
    });

    // модули: чекбокс + раскрытие настроек
    function syncMod(mod) {
      var f = mod.dataset.f;
      if (!f) return;
      var on = !!S[f];
      mod.querySelector('.uc-cb').classList.toggle('on', on);
      mod.classList.toggle('armed', on);
      var sub = mod.querySelector('.uc-sub');
      if (sub) sub.classList.toggle('open', on);
    }
    m.querySelectorAll('.uc-mod[data-f]').forEach(function(mod) {
      mod.querySelector('.uc-mod-h').addEventListener('click', function(e) {
        if (e.target.id === 'uc-m-bind') return;
        var f = mod.dataset.f;
        S[f] = !S[f];
        save();
        syncMod(mod);
        if (f === 'fakeBal') pushBal();
        toast((S[f] ? '[+] ' : '[-] ') + mod.querySelector('.uc-mod-t').childNodes[0].textContent.trim());
      });
      syncMod(mod);
    });

    function refreshStats() {
      m.querySelector('#uc-m-inv').textContent = S.inv.length;
      m.querySelector('#uc-m-sum').textContent = invSum().toFixed(2) + ' \u20BD';
      m.querySelector('#uc-m-bh').textContent = S.betHist.length;
      m.querySelector('#uc-m-ih').textContent = S.itemHist.length;
    }
    refreshStats();
    m.__refreshStats = refreshStats;

    function refreshBal() { m.querySelector('#uc-m-bal').textContent = fmtBal(S.bal) + ' \u20BD'; }

    m.querySelector('#uc-m-set').addEventListener('click', function() {
      var v = parseFloat(m.querySelector('#uc-m-in').value);
      if (isNaN(v) || v < 0) return toast('[!] \u043D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430');
      S.bal = v; save(); refreshBal(); pushBal();
      toast('[+] balance: ' + fmtBal(v) + ' \u20BD');
    });
    m.querySelectorAll('.uc-chip').forEach(function(c) {
      c.addEventListener('click', function(e) {
        e.stopPropagation();
        S.bal = parseFloat(c.dataset.a); save(); refreshBal(); pushBal();
      });
    });
    var ch = m.querySelector('#uc-m-ch');
    ch.addEventListener('input', function() {
      S.chance = parseInt(ch.value, 10);
      ch.style.setProperty('--p', S.chance + '%');
      m.querySelector('#uc-m-chv').textContent = S.chance + '%';
    });
    ch.addEventListener('change', save);
    ch.addEventListener('click', function(e) { e.stopPropagation(); });

    // перебинд
    m.querySelector('#uc-m-bind').addEventListener('click', function(e) {
      e.stopPropagation();
      var btn = this;
      btn.textContent = '\u2026';
      function cap(ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (ev.key !== 'Escape') {
          UI.bind = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
          saveUI();
        }
        btn.textContent = escK(UI.bind);
        m.querySelector('#uc-kbd').textContent = escK(UI.bind);
        document.removeEventListener('keydown', cap, true);
      }
      setTimeout(function() { document.addEventListener('keydown', cap, true); }, 50);
    });

    // reset
    m.querySelector('#uc-m-reset').addEventListener('click', function(e) {
      e.stopPropagation();
      if (!confirm('\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435?')) return;
      ['uc_inv','uc_spent','uc_invc','uc_shopc','uc_bhist','uc_ihist'].forEach(function(k) { localStorage.removeItem(k); });
      S.inv = []; S.spent = []; S.invCache = {}; S.shopCache = {}; S.betHist = []; S.itemHist = [];
      refreshStats();
      toast('[+] reset');
    });

    // закрытие кнопкой
    m.querySelector('#uc-m-close').addEventListener('click', function(e) {
      e.stopPropagation();
      toggleMenu(false);
    });

    // drag за шапку (но не за кнопку закрытия)
    var hd = m.querySelector('#uc-mh'), dragging = false, ox = 0, oy = 0;
    hd.addEventListener('mousedown', function(e) {
      if (e.target.closest('#uc-m-close')) return;
      e.preventDefault(); // не выделяем текст сайта и меню
      dragging = true;
      ox = e.clientX - m.getBoundingClientRect().left;
      oy = e.clientY - m.getBoundingClientRect().top;
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      e.preventDefault();
      m.style.left = (e.clientX - ox) + 'px';
      m.style.top = (e.clientY - oy) + 'px';
      m.style.right = 'auto';
    });
    document.addEventListener('mouseup', function() { dragging = false; });
  }

  function escK(k) {
    if (k === ' ') return 'SPACE';
    if (k === 'Escape') return 'ESC';
    return k.length === 1 ? k.toUpperCase() : k;
  }

  function toggleMenu(show) {
    if (!menuEl) return;
    var hidden = menuEl.classList.contains('hidden');
    var next = (show === undefined) ? hidden : show;
    menuEl.classList.toggle('hidden', !next);
    if (next && menuEl.__refreshStats) menuEl.__refreshStats();
  }

  // ---------- HOTKEY ----------
  document.addEventListener('keydown', function(e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === UI.bind) { e.preventDefault(); toggleMenu(); }
  });

  function toast(msg) {
    var t = el('<div class="uc-toast">' + msg + '</div>');
    document.body.appendChild(t);
    setTimeout(function() { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, 1600);
    setTimeout(function() { t.remove(); }, 2000);
  }

  // ==================== BRIDGE (попап) ====================
  document.addEventListener('uc-cmd', function(e) {
    var m = e.detail || {};
    if (m.type === 'set-bal') {
      S.bal = parseFloat(m.balance) || 0; save();
      if (menuEl) menuEl.querySelector('#uc-m-bal').textContent = fmtBal(S.bal) + ' \u20BD';
      pushBal();
    } else if (m.type === 'get-state') {
      document.dispatchEvent(new CustomEvent('uc-state', { detail: { bal: S.bal, invCount: S.inv.length, histCount: S.betHist.length } }));
    }
  });

  // ==================== INIT ====================
  function init() {
    if (!document.body) return setTimeout(init, 80);
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head && document.head.appendChild(st);
    buildMenu();
    showBoot(function() { toggleMenu(true); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
