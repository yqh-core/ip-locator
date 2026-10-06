/**
 * dd-i18n.js — DigDevBox 站点群共享 i18n 内核（v1.1）
 * @sync-hash: 114462f34885
 * 真源：digdevbox-design-system/dd-i18n.js，由 _ops/sync-design-tokens.mjs 分发到各站。
 *
 * 架构定位（yqh 裁定 2026-10-06，路线 C "Unified Runtime i18n Foundation"）：
 *   - Phase 1 渲染方式 = 运行时替换（data-i18n / data-i18n-attr + t()）
 *   - 架构必须允许未来构建期渲染：全部 locale 逻辑集中在本文件，
 *     组件一律 t(key) / data-i18n，禁止把 navigator.language 判定散落到业务代码。
 *     Phase 2/3 做 /en/ 构建期静态页时，直接消费同一份 locales/*.json（扁平 key），
 *     本文件的 detect/apply 即被构建脚本替代，前端无需推翻。
 *   - 词条槽位包含 SEO：seo.title / seo.description 运行时同步 document.title
 *     与 og:title/og:description。
 *
 * ⚠ SEO 口径（yqh 裁定 2026-10-06，必须原样保留，不得回退成「利于收录」类表述）：
 *   本文件**只做运行时 DOM 同步**。链路是：服务器返回中文 HTML → JS 执行 → DOM 变英文。
 *   因此「Googlebot 类 JS 执行环境下最终 DOM 为英文」只能说明客户端呈现，
 *   **不能等价于搜索引擎把英文版作为可索引 HTML 版本**。
 *   真正的构建期英文 HTML 属 Phase 2（/en/ 静态目录，服务器直接输出 English HTML），
 *   本阶段不作为 SEO 收录保证。
 *
 * 数据契约：window.DD_I18N_DATA = { <locale>: { <key>: <string> } }
 *   由 _ops/inject-dd-shell.mjs 从各站 locales/*.json 读取并内联进 <head>
 *   （零 fetch、零 FOUC；无 JS 时页面保持 HTML 原文 = 中文兜底）。
 *
 * locale 解析优先级（I18N 验收硬规则）：
 *   1. localStorage('dd-locale') 用户手动选择 —— 必须高于一切自动判定
 *   2. navigator.languages 逐个匹配：zh* → zh，其余按 DATA 已有 locale 匹配
 *   3. 默认 'en'（English default，Chinese optional）
 */
(function () {
  'use strict';

  var DATA = window.DD_I18N_DATA || {};
  var DEFAULT_LOCALE = 'en';
  var STORE_KEY = 'dd-locale';
  var ZH_TAG = 'zh-CN';
  var EN_TAG = 'en';

  if (!Object.keys(DATA).length) {
    window.DD_I18N = { t: function (k) { return k; }, apply: function () {}, setLocale: function () {} };
    return;
  }

  function readStored() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  /** locale 判定——唯一入口，业务代码禁止自行读 navigator.language */
  function detectLocale() {
    var saved = readStored();
    if (saved && DATA[saved]) return saved; // 1. 用户手动选择优先（验收硬规则）
    var langs = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || DEFAULT_LOCALE];
    for (var i = 0; i < langs.length; i++) {
      var tag = String(langs[i] || '').toLowerCase();
      if (!tag) continue;
      if (tag.indexOf('zh') === 0) return 'zh'; // 2a. 中文区 → zh
      for (var loc in DATA) {                    // 2b. 其它已配置 locale 前缀匹配
        if (tag.indexOf(loc) === 0) return loc;
      }
    }
    return DEFAULT_LOCALE;                      // 3. 兜底英文
  }

  var current = detectLocale();

  /** 翻译函数：current → DEFAULT → zh → 原样 key（四级兜底，永不返回 undefined） */
  function t(key) {
    var v = (DATA[current] || {})[key];
    if (typeof v === 'string') return v;
    v = (DATA[DEFAULT_LOCALE] || {})[key];
    if (typeof v === 'string') return v;
    v = (DATA.zh || {})[key];
    if (typeof v === 'string') return v;
    return key;
  }

  function langTag(loc) {
    return loc === 'zh' ? ZH_TAG : EN_TAG;
  }

  function ogTag(loc) {
    return loc === 'zh' ? 'zh_CN' : 'en_US';
  }

  /** 把 current 应用到 DOM：data-i18n / data-i18n-attr / SEO 槽位 / <html lang> */
  function apply() {
    var dict = DATA[current] || {};
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var v = dict[nodes[i].getAttribute('data-i18n')];
      if (typeof v === 'string') nodes[i].textContent = v;
    }
    var attrNodes = document.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j++) {
      // 格式：data-i18n-attr="placeholder:placeholder.ipInput,aria-label:aria.themeToggle"
      var pairs = (attrNodes[j].getAttribute('data-i18n-attr') || '').split(',');
      for (var p = 0; p < pairs.length; p++) {
        var seg = pairs[p].split(':');
        if (seg.length !== 2) continue;
        var attr = seg[0].trim(), key = seg[1].trim();
        var av = dict[key];
        if (typeof av === 'string') attrNodes[j].setAttribute(attr, av);
      }
    }
    // SEO 词条槽位（Phase 2 构建期接管前的运行时实现）
    // ⚠ 按页面 id 生效：只有 <html data-i18n-page="..."> 声明过的页面才被覆盖。
    //   原因：全站共用一份 locales，无条件覆盖会把内页（about / faq / guides …）各自的
    //   title / description 抹成首页文案 —— 这是元数据级误伤，必须按页隔离。
    //   取词顺序：seo.<page>.title →（page === 'home' 时）seo.title → 不覆盖（保留原生）。
    var page = document.documentElement.getAttribute('data-i18n-page') || '';
    function seoVal(base) {
      if (!page) return null;
      var v = dict['seo.' + page + '.' + base];
      if (typeof v === 'string') return v;
      if (page === 'home' && typeof dict['seo.' + base] === 'string') return dict['seo.' + base];
      return null;
    }
    var seoTitle = seoVal('title');
    var seoDesc = seoVal('description');
    if (seoTitle) document.title = seoTitle;
    var metas = { 'og:title': seoTitle, 'og:description': seoDesc };
    for (var prop in metas) {
      if (!metas[prop]) continue;
      var m = document.querySelector('meta[property="' + prop + '"]');
      if (m) m.setAttribute('content', metas[prop]);
    }
    var md = document.querySelector('meta[name="description"]');
    if (md && seoDesc) md.setAttribute('content', seoDesc);
    // 文档语言标记
    document.documentElement.setAttribute('lang', langTag(current));
    var ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.setAttribute('content', ogTag(current));
    // 语言切换按钮：显示「可切换到的目标语言」
    var btn = document.getElementById('dd-lang-toggle');
    if (btn) {
      btn.textContent = current === 'zh' ? 'EN' : '中文';
      btn.setAttribute('aria-label', t('aria.langToggle'));
      btn.setAttribute('title', t('aria.langToggle'));
    }
  }

  function setLocale(loc) {
    if (!DATA[loc] || loc === current) return;
    current = loc;
    try { localStorage.setItem(STORE_KEY, loc); } catch (e) { /* 隐私模式等：本次会话内仍生效 */ }
    apply();
  }

  function toggle() {
    setLocale(current === 'zh' ? DEFAULT_LOCALE : 'zh');
  }

  // 绑定切换按钮（脚本以 defer 注入，执行时 DOM 已就绪；重复绑定由闭包单实例保证）
  var toggleBtn = document.getElementById('dd-lang-toggle');
  if (toggleBtn) toggleBtn.addEventListener('click', toggle);

  window.DD_I18N = {
    t: t,
    apply: apply,
    setLocale: setLocale,
    toggle: toggle,
    get locale() { return current; }
  };

  apply();
})();
