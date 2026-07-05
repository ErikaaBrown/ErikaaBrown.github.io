/* PsicoLab / PsychLab — núcleo partilhado: i18n, tema, header/footer, helpers */
(function () {
  const PAGE = window.PAGE || {};
  const ROOT = PAGE.root || "";
  const APP_SCRIPT = document.currentScript;

  const CHROME = {
    pt: {
      "site.name": "PsicoLab",
      "site.tagline": "Explora a tua mente",
      "nav.home": "Início",
      "nav.tests": "Testes",
      "nav.tools": "Ferramentas",
      "nav.games": "Jogos",
      "nav.learn": "Aprender",
      "footer.disclaimer": "<strong>Nota importante:</strong> o PsicoLab é um projecto educativo e recreativo. Os testes e as ferramentas aqui disponíveis não constituem diagnóstico nem substituem a avaliação ou o acompanhamento por profissionais de saúde mental. Se precisares de apoio, fala com um psicólogo ou contacta a linha SNS 24: 808 24 24 24.",
      "footer.privacy": "Privacidade primeiro: os teus registos são cifrados e só tu os consegues ler.",
      "footer.made": "Feito com calma 🌿",
      "lang.switch": "Switch to English",
      "theme.toggle": "Alternar tema claro/escuro",
      "nav.account": "Conta"
    },
    en: {
      "site.name": "PsychLab",
      "site.tagline": "Explore your mind",
      "nav.home": "Home",
      "nav.tests": "Tests",
      "nav.tools": "Tools",
      "nav.games": "Games",
      "nav.learn": "Learn",
      "footer.disclaimer": "<strong>Important note:</strong> PsychLab is an educational and recreational project. The tests and tools available here are not a diagnosis and do not replace assessment or care by mental-health professionals. If you need support, talk to a psychologist or reach out to a local helpline.",
      "footer.privacy": "Privacy first: your entries are encrypted and only you can read them.",
      "footer.made": "Made with calm 🌿",
      "lang.switch": "Mudar para Português",
      "theme.toggle": "Toggle light/dark theme",
      "nav.account": "Account"
    }
  };

  /* ---------- estado ---------- */
  let lang = localStorage.getItem("pl_lang");
  if (lang !== "pt" && lang !== "en") lang = "pt";

  let theme = localStorage.getItem("pl_theme");
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);

  function dict() {
    const page = (PAGE.i18n && PAGE.i18n[lang]) || {};
    return Object.assign({}, CHROME[lang], page);
  }

  function t(key) {
    const d = dict();
    return d[key] !== undefined ? d[key] : key;
  }

  /* ---------- header / footer ---------- */
  const NAV = [
    ["nav.home", "index.html", "home"],
    ["nav.tests", "index.html#tests", "tests"],
    ["nav.tools", "index.html#tools", "tools"],
    ["nav.games", "index.html#games", "games"],
    ["nav.learn", "index.html#learn", "learn"]
  ];

  function renderHeader() {
    const el = document.getElementById("site-header");
    if (!el) return;
    const links = NAV.map(function (n) {
      const active = PAGE.section === n[2] ? " class=\"active\"" : "";
      return "<a href=\"" + ROOT + n[1] + "\" data-i18n=\"" + n[0] + "\"" + active + "></a>";
    }).join("");
    el.innerHTML =
      "<header class=\"site-header\"><div class=\"bar\">" +
      "<a class=\"logo\" href=\"" + ROOT + "index.html\"><span class=\"mark\">🧠</span><span data-i18n=\"site.name\"></span></a>" +
      "<nav class=\"main-nav\">" + links + "</nav>" +
      "<div class=\"header-actions\">" +
      "<a id=\"account-btn\" class=\"icon-btn\" href=\"" + ROOT + "account.html\" style=\"text-decoration:none\">👤</a>" +
      "<button id=\"lang-btn\" class=\"icon-btn\"></button>" +
      "<button id=\"theme-btn\" class=\"icon-btn\"></button>" +
      "</div></div></header>";
    document.getElementById("lang-btn").addEventListener("click", function () {
      setLang(lang === "pt" ? "en" : "pt");
    });
    document.getElementById("theme-btn").addEventListener("click", function () {
      theme = theme === "dark" ? "light" : "dark";
      localStorage.setItem("pl_theme", theme);
      document.documentElement.setAttribute("data-theme", theme);
      syncButtons();
      document.dispatchEvent(new CustomEvent("pl:theme", { detail: { theme: theme } }));
    });
  }

  function renderFooter() {
    const el = document.getElementById("site-footer");
    if (!el) return;
    el.innerHTML =
      "<footer class=\"site-footer\"><div class=\"container\">" +
      "<div class=\"disclaimer\" data-i18n-html=\"footer.disclaimer\"></div>" +
      "<div class=\"foot-row\">" +
      "<span data-i18n=\"footer.made\"></span>" +
      "<span data-i18n=\"footer.privacy\"></span>" +
      "</div></div></footer>";
  }

  function syncButtons() {
    const lb = document.getElementById("lang-btn");
    const tb = document.getElementById("theme-btn");
    if (lb) {
      lb.textContent = lang === "pt" ? "EN" : "PT";
      lb.title = t("lang.switch");
      lb.setAttribute("aria-label", t("lang.switch"));
    }
    var ab = document.getElementById("account-btn");
    if (ab) {
      ab.title = t("nav.account");
      ab.setAttribute("aria-label", t("nav.account"));
    }
    if (tb) {
      tb.textContent = theme === "dark" ? "☀️" : "🌙";
      tb.title = t("theme.toggle");
      tb.setAttribute("aria-label", t("theme.toggle"));
    }
  }

  /* ---------- aplicar traduções ---------- */
  function applyI18n() {
    const d = dict();
    document.documentElement.lang = lang === "pt" ? "pt-PT" : "en";
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      const k = el.getAttribute("data-i18n");
      if (d[k] !== undefined) el.textContent = d[k];
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      const k = el.getAttribute("data-i18n-html");
      if (d[k] !== undefined) el.innerHTML = d[k];
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      const k = el.getAttribute("data-i18n-ph");
      if (d[k] !== undefined) el.setAttribute("placeholder", d[k]);
    });
    if (d["page.title"]) {
      document.title = d["page.title"] + " · " + d["site.name"];
    } else {
      document.title = d["site.name"] + " — " + d["site.tagline"];
    }
    syncButtons();
  }

  function setLang(l) {
    lang = l;
    localStorage.setItem("pl_lang", lang);
    applyI18n();
    document.dispatchEvent(new CustomEvent("pl:lang", { detail: { lang: lang } }));
  }

  /* ---------- helpers ---------- */
  function store(key, val) {
    localStorage.setItem("pl_" + key, JSON.stringify(val));
  }
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem("pl_" + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtDate(iso) {
    const d = new Date(iso + "T12:00:00");
    const s = d.toLocaleDateString(lang === "pt" ? "pt-PT" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
    return lang === "pt" ? s.replace(/ de ([a-zà-ú])/g, function (m, c) { return " de " + c.toUpperCase(); }) : s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- avatar: iniciais por omissão, foto se o utilizador tiver uma ---------- */
  function initials(displayName, email) {
    var name = (displayName || "").trim();
    if (name) {
      var parts = name.split(/\s+/).filter(Boolean);
      if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    return (email || "?").charAt(0).toUpperCase();
  }
  function avatarInto(el, profile) {
    profile = profile || {};
    if (profile.avatar) {
      el.textContent = "";
      var img = document.createElement("img");
      img.src = "data:image/jpeg;base64," + profile.avatar;
      img.alt = "";
      el.appendChild(img);
    } else {
      el.textContent = initials(profile.displayName, profile.email);
    }
  }

  function saveTestResult(test, scores) {
    var hist = load("test_results", []);
    if (!Array.isArray(hist)) hist = [];
    hist.push({ test: test, date: todayISO(), scores: scores });
    if (hist.length > 100) hist = hist.slice(hist.length - 100);
    store("test_results", hist);
  }

  let toastEl = null;
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2400);
  }

  /* ---------- API pública ---------- */
  window.PL = {
    get lang() { return lang; },
    t: t,
    setLang: setLang,
    store: store,
    load: load,
    todayISO: todayISO,
    fmtDate: fmtDate,
    esc: esc,
    toast: toast,
    initials: initials,
    avatarInto: avatarInto,
    saveTestResult: saveTestResult,
    onLang: function (fn) { document.addEventListener("pl:lang", fn); },
    onTheme: function (fn) { document.addEventListener("pl:theme", fn); }
  };

  /* ---------- indicador de scroll horizontal em tabelas largas ---------- */
  function wireTableScroll() {
    function sync(el) {
      el.classList.toggle("has-more", el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    }
    function scan() {
      document.querySelectorAll(".table-scroll").forEach(function (el) {
        sync(el);
        if (!el._plScrollWired) {
          el._plScrollWired = true;
          el.addEventListener("scroll", function () { sync(el); });
        }
      });
    }
    scan();
    window.addEventListener("resize", scan);
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- arranque ---------- */
  function boot() {
    renderHeader();
    renderFooter();
    applyI18n();
    wireTableScroll();
    document.dispatchEvent(new CustomEvent("pl:ready", { detail: { lang: lang } }));
    var s = document.createElement("script");
    var verMatch = APP_SCRIPT && APP_SCRIPT.src.match(/[?&]v=([^&]+)/);
    s.src = ROOT + "js/sync.js" + (verMatch ? "?v=" + verMatch[1] : "");
    document.body.appendChild(s);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
