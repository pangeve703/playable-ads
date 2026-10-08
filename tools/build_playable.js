#!/usr/bin/env node
/**
 * Packs a Cocos Creator Web Mobile build into one self-contained HTML file for ad networks (AppLovin etc.).
 *
 *   node tools/build_playable.js [--debug] [buildDir] [outFile]
 *   defaults: build/web-mobile  ->  build/playable/TravelSort_AppLovin.html
 *   --debug also writes <outFile>_debug.html, which prints its loading steps and any errors on screen (for ad
 *   containers that have no console, like the AppLovin preview app).
 *
 * AppLovin rules it follows: the game starts only once MRAID is ready (mraid.getState() is not 'loading'), and if
 * WebGL is missing or its context is lost a plain HTML card with a store button (mraid.open) is shown instead.
 *
 * Every file of the build is embedded: scripts and JSON deflate-compressed, images and audio as they are (already
 * compressed). Like the reference build (P020A_TEST.html), nothing global in the browser is patched, so the ad SDK's
 * own scripts in the same page are left alone:
 *   - the engine's `new XMLHttpRequest` calls are rewritten at pack time to an in-page request class that answers
 *     from the embedded files (settings, JSON, effect.bin, audio)
 *   - SystemJS gets its scripts from the embedded files (createScript)
 *   - Cocos's downloader gets images, scripts and bundles from the embedded files
 * It includes <script src="mraid.js">, which the ad SDK answers with its MRAID bridge. Decompression uses fflate
 * (MIT, tools/vendor).
 *
 * Build settings this expects: Web Mobile, main bundle not remote (tools/build-web-mobile.json). MD5 Cache can be on
 * or off: the entry file names are read from the build's index.html.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const DEBUG = process.argv.includes('--debug');
const buildDir = path.resolve(root, args[0] || 'build/web-mobile');
const outFile = path.resolve(root, args[1] || 'build/playable/TravelSort_AppLovin.html');
// store link for the WebGL fallback card: the one set on GameManager in the scene
const sceneText = fs.readFileSync(path.join(root, 'assets/scenes/main.scene'), 'utf8');
const STORE_URL = (sceneText.match(/"storeUrl":\s*"([^"]*)"/) || [])[1] || '';
const TITLE = 'Travel Sort';
const SIZE_LIMIT = 5 * 1024 * 1024; // AppLovin playable limit

const read = rel => fs.readFileSync(path.join(buildDir, rel));
const exists = rel => fs.existsSync(path.join(buildDir, rel));

if (!exists('index.html')) {
    console.error(`No index.html in ${buildDir}. Build Web Mobile first.`);
    process.exit(1);
}

// entry files as the build's index.html names them (with MD5 Cache on they carry a hash, e.g. index.5b8fc.js)
const indexHtml = read('index.html').toString();
const pick = (re, what) => {
    const m = indexHtml.match(re);
    if (!m) { console.error(`Cannot find the ${what} in index.html`); process.exit(1); }
    return m[1].replace(/^\.\//, '');
};
const ENTRY = {
    style: (indexHtml.match(/href="([^"]+\.css)"/) || [])[1],
    polyfills: (indexHtml.match(/src="([^"]*polyfills[^"]*\.js)"/) || [])[1],
    system: pick(/src="([^"]*system\.bundle[^"]*\.js)"/, 'SystemJS bundle'),
    importMap: pick(/src="([^"]*import-map[^"]*\.json)"/, 'import map'),
    main: pick(/System\.import\('([^']+)'\)/, 'start script'),
};

// files the HTML shell loads directly; everything else goes into the embedded file table
const INLINED = new Set(['index.html', 'favicon.ico', ENTRY.style, ENTRY.polyfills, ENTRY.system, ENTRY.importMap].filter(Boolean));
const STORED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.ogg', '.m4a', '.wav', '.mp4', '.ttf', '.woff', '.woff2']);

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : [path.relative(buildDir, full).split(path.sep).join('/')];
    });
}

const files = {};
let raw = 0, xhrPatched = 0;
for (const rel of walk(buildDir).sort()) {
    if (INLINED.has(rel)) continue;
    const data = read(rel);
    raw += data.length;
    const stored = STORED.has(path.extname(rel).toLowerCase());
    let body = data;
    if (rel.endsWith('.js')) {
        // the engine's requests go to the in-page request class instead of the browser's XMLHttpRequest
        const js = data.toString('utf8');
        const patched = js.replace(/new\s+(?:window\.)?XMLHttpRequest\b/g, 'new window.__PlayableXHR');
        if (patched !== js) { body = Buffer.from(patched, 'utf8'); xhrPatched += (js.match(/new\s+(?:window\.)?XMLHttpRequest\b/g) || []).length; }
    }
    files[rel] = [stored ? 0 : 1, (stored ? body : zlib.deflateRawSync(body, { level: 9 })).toString('base64')];
}

// SystemJS resolves the import map against the page, so point it at the build root instead of src/
const importMap = JSON.parse(read(ENTRY.importMap));
for (const k of Object.keys(importMap.imports || {})) importMap.imports[k] = importMap.imports[k].replace(/^\.\/\.\.\//, './');

const style = ENTRY.style ? read(ENTRY.style).toString() : '';
const polyfills = ENTRY.polyfills ? read(ENTRY.polyfills).toString() : '';
const fflate = fs.readFileSync(path.join(__dirname, 'vendor/fflate.umd.js'), 'utf8');

// runs before the engine: the embedded file table and the hooks that serve it
const loader = `(function () {
  var F = window.__PLAYABLE_FILES__, keys = Object.keys(F).sort(function (a, b) { return b.length - a.length; });
  var log = window.__plog, bytesCache = {}, urlCache = {};
  var MIME = { js: 'text/javascript', json: 'application/json', css: 'text/css', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav',
    wasm: 'application/wasm', bin: 'application/octet-stream' };
  function find(url) {
    if (!url || typeof url !== 'string' || url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return null;
    // inside an srcdoc iframe or about:blank, './index.js' resolves to 'about:index.js'
    var u = url.split('#')[0].split('?')[0].replace(/^\\.\\//, '');
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], before = u.charAt(u.length - k.length - 1);
      if (u === k || (u.slice(-k.length) === k && (before === '/' || before === ':'))) return k;
    }
    log('not embedded: ' + url.slice(0, 100));
    return null;
  }
  function bytes(k) {
    if (!bytesCache[k]) {
      var s = atob(F[k][1]), b = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
      bytesCache[k] = F[k][0] ? fflate.inflateSync(b) : b;
      if (/\\.js$/.test(k)) log('load ' + k);
    }
    return bytesCache[k];
  }
  function mime(k) { return MIME[k.split('.').pop().toLowerCase()] || 'application/octet-stream'; }
  function text(k) { return new TextDecoder().decode(bytes(k)); }
  function buffer(k) { var b = bytes(k); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  function blobUrl(k) { return urlCache[k] || (urlCache[k] = URL.createObjectURL(new Blob([bytes(k)], { type: mime(k) }))); }
  function dataUrl(k) { return 'data:' + mime(k) + ';base64,' + (F[k][0] ? btoa(String.fromCharCode.apply(null, bytes(k))) : F[k][1]); }
  function runScript(k) { (0, eval)(text(k) + '\\n//# sourceURL=' + k); }

  // the engine's requests (rewritten at pack time from new XMLHttpRequest): answered from the embedded files
  function PlayableXHR() {
    this.readyState = 0; this.status = 0; this.statusText = ''; this.response = null; this.responseText = '';
    this.responseType = ''; this.responseURL = ''; this.timeout = 0; this.withCredentials = false; this._on = {};
  }
  var X = PlayableXHR.prototype;
  X.open = function (method, url) { this._url = String(url); this._file = find(this._url); this.readyState = 1; };
  X.setRequestHeader = X.overrideMimeType = function () {};
  X.getResponseHeader = function (h) { return this._file && /content-type/i.test(h) ? mime(this._file) : null; };
  X.getAllResponseHeaders = function () { return this._file ? 'content-type: ' + mime(this._file) + '\\r\\n' : ''; };
  X.addEventListener = function (t, f) { (this._on[t] = this._on[t] || []).push(f); };
  X.removeEventListener = function (t, f) { var a = this._on[t], i = a ? a.indexOf(f) : -1; if (i >= 0) a.splice(i, 1); };
  X.abort = function () { this._aborted = true; };
  X._fire = function (t) {
    var e = { type: t, target: this, currentTarget: this, lengthComputable: false, loaded: 0, total: 0 }, self = this;
    if (typeof this['on' + t] === 'function') this['on' + t](e);
    (this._on[t] || []).slice().forEach(function (f) { f.call(self, e); });
  };
  X.send = function () {
    var x = this;
    setTimeout(function () {
      if (x._aborted) return;
      var k = x._file, t = x.responseType;
      x.readyState = 4;
      if (!k) { x.status = 0; x._fire('readystatechange'); x._fire('error'); x._fire('loadend'); return; }
      try {
        x.response = t === 'arraybuffer' ? buffer(k) : t === 'blob' ? new Blob([bytes(k)], { type: mime(k) })
          : t === 'json' ? JSON.parse(text(k)) : text(k);
        if (!t || t === 'text') x.responseText = x.response;
      } catch (e) { console.error('[playable] cannot read ' + k, e); }
      x.status = 200; x.statusText = 'OK'; x.responseURL = x._url;
      x._fire('readystatechange'); x._fire('progress'); x._fire('load'); x._fire('loadend');
    }, 0);
  };
  window.__PlayableXHR = PlayableXHR;

  // fetch (as the reference build does): only embedded files are answered, everything else passes through
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var k = find(typeof input === 'string' ? input : input && input.url);
    if (k) return Promise.resolve(new Response(bytes(k), { status: 200, headers: { 'Content-Type': mime(k) } }));
    return realFetch.apply(this, arguments);
  };

  // SystemJS (engine, application and chunks): scripts from blob URLs, without crossorigin, which WebKit refuses
  // for blobs inside an iframe
  window.__playableHookSystem = function () {
    var proto = Object.getPrototypeOf(System), createScript = proto.createScript;
    proto.createScript = function (url) {
      var k = find(url), el = createScript.call(this, k ? blobUrl(k) : url);
      if (k) el.removeAttribute('crossorigin');
      return el;
    };
  };

  // Cocos downloader: images, scripts and bundles from the embedded files (as the reference build does)
  window.__playableHookCocos = function (cc) {
    var d = cc.assetManager.downloader;
    function image(url, options, done) {
      var k = find(url);
      if (!k) { done(new Error('image not embedded: ' + url)); return; }
      var img = new Image();
      // detach first: the engine later clears src to free memory (CLEANUP_IMAGE_CACHE), which fires these again
      img.onload = function () { img.onload = img.onerror = null; done(null, img); };
      img.onerror = function () { img.onload = img.onerror = null; done(new Error('image failed: ' + url)); };
      img.src = dataUrl(k);
    }
    function script(url, options, done) {
      var k = find(url);
      if (!k) { if (done) done(new Error('script not embedded: ' + url)); return; }
      try { runScript(k); if (done) done(null); } catch (e) { if (done) done(e); }
    }
    function bundle(nameOrUrl, options, done) {
      var name = nameOrUrl.split('/').pop(), base = /^(?:\\w+:\\/\\/|\\.+\\/).+/.test(nameOrUrl) ? nameOrUrl : 'assets/' + name;
      var ver = options.version || d.bundleVers[name], suffix = ver ? ver + '.' : '';
      var k = find(base + '/config.' + suffix + 'json');
      if (!k) { done(new Error('bundle not embedded: ' + nameOrUrl)); return; }
      var config;
      try { config = JSON.parse(text(k)); config.base = base + '/'; } catch (e) { done(e); return; }
      script(base + '/index.' + suffix + 'js', options, function (err) { done(err || null, config); });
    }
    ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.image'].forEach(function (ext) { d.register(ext, image); });
    d.register('.js', script);
    d.register('bundle', bundle);
    d.downloadScript = script;
    log('cocos downloader hooked');
  };
})();`;

// the file table goes into several <script> tags of at most ~1.5 MB each, like the reference build
const CHUNK = 1.5 * 1024 * 1024;
const chunks = [];
let current = [], currentSize = 0;
for (const [k, v] of Object.entries(files)) {
    const entry = `F[${JSON.stringify(k)}]=${JSON.stringify(v)};`;
    if (currentSize && currentSize + entry.length > CHUNK) { chunks.push(current); current = []; currentSize = 0; }
    current.push(entry);
    currentSize += entry.length;
}
if (current.length) chunks.push(current);
const files_js = chunks.map(c => `<script>(function(F){${c.join('')}})(window.__PLAYABLE_FILES__=window.__PLAYABLE_FILES__||{});</script>`).join('\n');
// starts the engine once MRAID is ready; shows the fallback card if WebGL is missing or lost
const startup = `(function () {
  var log = window.__plog, started = false, STORE = ${JSON.stringify(STORE_URL)};
  function hasWebGL() {
    try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }
  function fallback(reason) {
    log('fallback: ' + reason);
    if (document.getElementById('fallback')) return;
    var d = document.createElement('div');
    d.id = 'fallback';
    d.innerHTML = '<div class="fb-title">Travel Sort</div><div class="fb-text">Sort the colours, fill the bags!</div><div class="fb-btn">Play Now</div>';
    d.onclick = function () { try { if (window.mraid && mraid.open) mraid.open(STORE); else window.open(STORE, '_blank'); } catch (e) {} };
    document.body.appendChild(d);
  }
  function start() {
    if (started) return;
    started = true;
    if (!hasWebGL()) { fallback('no WebGL'); return; }
    document.getElementById('GameCanvas').addEventListener('webglcontextlost', function () { fallback('WebGL context lost'); });
    log('starting engine, window ' + innerWidth + 'x' + innerHeight);
    window.__playableHookSystem();
    System.import('cc').then(function (cc) {
      window.__playableHookCocos(cc);
      return System.import('./${ENTRY.main}');
    }).then(function () { log('engine started'); }, function (err) { log('start failed: ' + err); console.error(err); });
  }
  var m = window.mraid;
  if (!m || !m.getState) { log('no MRAID'); start(); return; }
  try {
    log('MRAID state ' + m.getState());
    if (m.getState() !== 'loading') start();
    else m.addEventListener('ready', function () { log('MRAID ready'); start(); });
  } catch (e) { log('MRAID error ' + e); start(); }
})();`;

const fallbackCss = `
#fallback { position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 10; display: flex; flex-direction: column;
  align-items: center; justify-content: center; background: linear-gradient(#a8622e, #5a2f12); color: #fff; font-weight: bold; }
#fallback .fb-title { font-size: 40px; margin-bottom: 12px; text-shadow: 0 3px 0 #0005; }
#fallback .fb-text { font-size: 18px; margin-bottom: 28px; }
#fallback .fb-btn { font-size: 24px; padding: 14px 40px; border-radius: 40px; background: #45b31c; box-shadow: 0 5px 0 #2a7a0c; }`;

// release: logging is a no-op. Debug: a log panel on top of the game that also catches errors.
const logRelease = 'window.__plog=function(){};';
const logDebug = `(function () {
  var t0 = Date.now(), lines = [], box;
  function show() {
    if (!box && document.body) { box = document.createElement('pre'); box.style.cssText = 'position:fixed;left:0;top:0;right:0;max-height:60%;overflow:auto;margin:0;padding:6px;z-index:99;background:rgba(0,0,0,.75);color:#0f0;font:11px/1.3 monospace;white-space:pre-wrap;pointer-events:none'; document.body.appendChild(box); }
    if (box) box.textContent = lines.join('\\n');
  }
  window.__plog = function (msg) { lines.push(((Date.now() - t0) / 1000).toFixed(2) + 's ' + msg); show(); };
  window.addEventListener('error', function (e) { __plog('ERROR ' + e.message + ' @ ' + (e.filename || '').slice(-40) + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', function (e) { __plog('REJECTED ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
  ['error', 'warn'].forEach(function (k) { var o = console[k]; console[k] = function () { __plog(k.toUpperCase() + ' ' + [].slice.call(arguments).join(' ')); return o.apply(console, arguments); }; });
  document.addEventListener('DOMContentLoaded', function () { __plog('page loaded, url ' + location.href.slice(0, 60) + ', window ' + innerWidth + 'x' + innerHeight + ', mraid ' + !!window.mraid); });
  var n = 0, timer = setInterval(function () {
    var c = document.getElementById('GameCanvas'), info = 'window ' + innerWidth + 'x' + innerHeight + ', canvas ' + (c ? c.width + 'x' + c.height : '-');
    try { info += ', mraid ' + (window.mraid ? mraid.getState() + (mraid.isViewable ? ' viewable ' + mraid.isViewable() : '') : 'none'); } catch (e) {}
    try { var sc = cc.director.getScene(); info += ', scene ' + (sc ? sc.name + ' nodes ' + sc.children.length : 'none') + ', frames ' + cc.director.getTotalFrames(); } catch (e) { info += ', cc not ready'; }
    __plog(info);
    if (++n >= 15) clearInterval(timer);
  }, 1000);
})();`;

const page = debug => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${TITLE}</title>
<meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,minimal-ui=true,viewport-fit=cover"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="mobile-web-app-capable" content="yes"/>
<link rel="icon" href="data:,">
<script>${debug ? logDebug : logRelease}</script>
<script src="mraid.js"></script>
<style>${style}
body { background-color: #000; }${fallbackCss}
</style>
</head>
<body>
<div id="GameDiv" cc_exact_fit_screen="true">
  <div id="Cocos3dGameContainer">
    <canvas id="GameCanvas" oncontextmenu="event.preventDefault()" tabindex="99"></canvas>
  </div>
</div>
<script>${fflate}</script>
${files_js}
<script>${loader}</script>
<script>${polyfills}</script>
<script>${read(ENTRY.system)}</script>
<script type="systemjs-importmap">${JSON.stringify(importMap)}</script>
<script>${startup}</script>
</body>
</html>
`;
const html = page(false);
if (DEBUG) {
    const debugFile = outFile.replace(/\.html$/, '_debug.html');
    fs.writeFileSync(debugFile, page(true));
    console.log(`debug copy -> ${path.relative(root, debugFile)}`);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
const size = Buffer.byteLength(html);
if (!xhrPatched) console.warn('WARNING: found no XMLHttpRequest in the engine to redirect');
console.log(`redirected ${xhrPatched} engine XMLHttpRequest calls`);
console.log(`${Object.keys(files).length} files (${(raw / 1048576).toFixed(2)} MB) -> ${path.relative(root, outFile)}: ${(size / 1048576).toFixed(2)} MB`);
if (size > SIZE_LIMIT) {
    console.error(`WARNING: over the ${SIZE_LIMIT / 1048576} MB AppLovin limit`);
    process.exitCode = 2;
}
