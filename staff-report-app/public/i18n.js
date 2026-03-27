// ======================================================
// i18n - Internationalization Engine
// ãã©ã¦ã¶èªåå¤å® + æååãæ¿ãå¯¾å¿
// ======================================================

const I18N = (() => {
  // å¯¾å¿è¨èªä¸è¦§
  const LANGUAGES = {
    ja: { label: 'æ¥æ¬èª', flag: 'ð¯ðµ' },
    en: { label: 'English', flag: 'ðºð¸' },
    vi: { label: 'Tiáº¿ng Viá»t', flag: 'ð»ð³' },
    my: { label: 'áá¼ááºáá¬', flag: 'ð²ð²' },
    zh: { label: 'ä¸­æ', flag: 'ð¨ð³' },
    ne: { label: 'à¤¨à¥à¤ªà¤¾à¤²à¥', flag: 'ð³ðµ' },
    id: { label: 'Bahasa', flag: 'ð®ð©' },
    km: { label: 'ááááá', flag: 'ð°ð­' },
    ko: { label: 'íêµ­ì´', flag: 'ð°ð·' },
  };

  let currentLang = 'ja';

  // ãã©ã¦ã¶è¨èªããèªåå¤å®
  function detectLang() {
    const saved = localStorage.getItem('i18n_lang');
    if (saved && LANGUAGES[saved]) return saved;

    const navLangs = navigator.languages || [navigator.language || 'ja'];
    for (const lang of navLangs) {
      const code = lang.toLowerCase().split('-')[0];
      if (LANGUAGES[code]) return code;
      // zh-TW, zh-CN ãªã©ã zh ã«ããã
      if (code === 'zh') return 'zh';
      // my-MM -> my
      if (code === 'my') return 'my';
    }
    return 'ja';
  }

  // ç¿»è¨³ãã­ã¹ãåå¾
  function t(key) {
    if (!window.TRANSLATIONS) return key;
    const dict = window.TRANSLATIONS[currentLang] || window.TRANSLATIONS['ja'];
    return dict[key] || (window.TRANSLATIONS['ja'] && window.TRANSLATIONS['ja'][key]) || key;
  }

  // ãã¼ã¸åã® data-i18n è¦ç´ ãå¨ã¦ç¿»è¨³
  function applyAll() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const text = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = text;
      } else {
        el.innerHTML = text;
      }
    });
    // data-i18n-placeholder (placeholderã ãç¿»è¨³)
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    });
    // html langå±æ§
    document.documentElement.lang = currentLang;
  }

  // è¨èªåæ¿
  function setLang(code) {
    if (!LANGUAGES[code]) return;
    currentLang = code;
    localStorage.setItem('i18n_lang', code);
    applyAll();
    // ã«ã¹ã¿ã ã¤ãã³ãçºç«
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: code } }));
  }

  // è¨èªåæ¿ã»ã¬ã¯ã¿ã¼çæ
  function createSwitcher(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'lang-switcher';
    wrapper.innerHTML = `
      <button class="lang-btn" id="lang-toggle">
        <span class="lang-flag" id="lang-flag">${LANGUAGES[currentLang].flag}</span>
        <span class="lang-code" id="lang-code">${LANGUAGES[currentLang].label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <div class="lang-dropdown" id="lang-dropdown"></div>
    `;
    container.appendChild(wrapper);

    const dropdown = wrapper.querySelector('#lang-dropdown');
    Object.entries(LANGUAGES).forEach(([code, info]) => {
      const item = document.createElement('button');
      item.className = 'lang-item' + (code === currentLang ? ' active' : '');
      item.innerHTML = `<span>${info.flag}</span> ${info.label}`;
      item.onclick = (e) => {
        e.stopPropagation();
        setLang(code);
        updateSwitcherUI();
        dropdown.classList.remove('open');
      };
      dropdown.appendChild(item);
    });

    wrapper.querySelector('#lang-toggle').onclick = (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    };

    document.addEventListener('click', () => dropdown.classList.remove('open'));
  }

  function updateSwitcherUI() {
    const flagEl = document.getElementById('lang-flag');
    const codeEl = document.getElementById('lang-code');
    if (flagEl) flagEl.textContent = LANGUAGES[currentLang].flag;
    if (codeEl) codeEl.textContent = LANGUAGES[currentLang].label;
    document.querySelectorAll('.lang-item').forEach(item => {
      item.classList.remove('active');
    });
    // find active item
    const dropdown = document.getElementById('lang-dropdown');
    if (dropdown) {
      const items = dropdown.querySelectorAll('.lang-item');
      const codes = Object.keys(LANGUAGES);
      codes.forEach((code, idx) => {
        if (code === currentLang && items[idx]) items[idx].classList.add('active');
      });
    }
  }

  // åæå
  function init() {
    currentLang = detectLang();
    applyAll();
    updateSwitcherUI();
  }

  return { init, t, setLang, getLang: () => currentLang, createSwitcher, applyAll, LANGUAGES };
})();
