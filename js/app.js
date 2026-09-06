/* PsicoLab / PsychLab — núcleo partilhado: i18n, tema, header/footer, helpers */
(function () {
  const PAGE = window.PAGE || {};
  const ROOT = PAGE.root || "";
  const APP_SCRIPT = document.currentScript;

  /* bandeiras em SVG (não emoji): a sequência de emoji de bandeira exige uma fonte com
     suporte próprio, que falta em muitos sistemas (ex.: Linux mostra só "GB"/"PT") */
  const FLAG_GB =
    "<svg class=\"flag\" viewBox=\"0 0 30 20\" width=\"20\" height=\"14\" aria-hidden=\"true\">" +
    "<clipPath id=\"flag-clip-gb\"><rect width=\"30\" height=\"20\" rx=\"3\"/></clipPath>" +
    "<g clip-path=\"url(#flag-clip-gb)\">" +
    "<rect width=\"30\" height=\"20\" fill=\"#00247d\"/>" +
    "<path d=\"M0,0 L30,20 M30,0 L0,20\" stroke=\"#fff\" stroke-width=\"4\"/>" +
    "<path d=\"M0,0 L30,20 M30,0 L0,20\" stroke=\"#cf142b\" stroke-width=\"2\"/>" +
    "<path d=\"M15,0 V20 M0,10 H30\" stroke=\"#fff\" stroke-width=\"7\"/>" +
    "<path d=\"M15,0 V20 M0,10 H30\" stroke=\"#cf142b\" stroke-width=\"4\"/>" +
    "</g></svg>";
  const FLAG_PT =
    "<svg class=\"flag\" viewBox=\"0 0 30 20\" width=\"20\" height=\"14\" aria-hidden=\"true\">" +
    "<clipPath id=\"flag-clip-pt\"><rect width=\"30\" height=\"20\" rx=\"3\"/></clipPath>" +
    "<g clip-path=\"url(#flag-clip-pt)\">" +
    "<rect width=\"30\" height=\"20\" fill=\"#da291c\"/>" +
    "<rect width=\"12\" height=\"20\" fill=\"#046a38\"/>" +
    "<circle cx=\"12\" cy=\"10\" r=\"4.5\" fill=\"#ffcc00\"/>" +
    "<circle cx=\"12\" cy=\"10\" r=\"3.2\" fill=\"#046a38\"/>" +
    "</g></svg>";

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
      "theme.toggle": "Alternar tema claro/escuro",
      "nav.account": "Conta",
      "habit.days": "dias cumpridos",
      "worry.open": "em aberto", "worry.happened": "aconteceu", "worry.nothappened": "não aconteceu"
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
      "theme.toggle": "Toggle light/dark theme",
      "nav.account": "Account",
      "habit.days": "days completed",
      "worry.open": "open", "worry.happened": "happened", "worry.nothappened": "did not happen"
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
      "<a class=\"logo\" href=\"" + ROOT + "index.html\"><span class=\"mark\"><img src=\"" + ROOT + "img/logo-tree.png\" alt=\"\"></span><span data-i18n=\"site.name\"></span></a>" +
      "<nav class=\"main-nav\">" + links + "</nav>" +
      "<div class=\"header-actions\">" +
      "<a id=\"account-btn\" class=\"icon-btn\" href=\"" + ROOT + "account.html\" style=\"text-decoration:none\">👤</a>" +
      "<div id=\"lang-toggle\" class=\"lang-toggle\" role=\"group\" aria-label=\"Idioma / Language\">" +
      "<button type=\"button\" class=\"lang-opt\" data-lang=\"en\" aria-label=\"English\">" + FLAG_GB + "<span class=\"code\">EN</span></button>" +
      "<button type=\"button\" class=\"lang-opt\" data-lang=\"pt\" aria-label=\"Português\">" + FLAG_PT + "<span class=\"code\">PT</span></button>" +
      "</div>" +
      "<button id=\"theme-btn\" class=\"icon-btn\"></button>" +
      "</div></div></header>";
    document.querySelectorAll("#lang-toggle .lang-opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setLang(btn.getAttribute("data-lang"));
      });
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
    const tb = document.getElementById("theme-btn");
    document.querySelectorAll("#lang-toggle .lang-opt").forEach(function (btn) {
      const active = btn.getAttribute("data-lang") === lang;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
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
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      const k = el.getAttribute("data-i18n-aria");
      if (d[k] !== undefined) el.setAttribute("aria-label", d[k]);
    });
    if (d["page.title"]) {
      document.title = d["page.title"] + " · " + d["site.name"];
    } else {
      document.title = d["site.name"] + " · " + d["site.tagline"];
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

  /* ---------- formatadores de dados partilhados (dashboard profissional e Ficha) ---------- */
  function fmtMood(obj) {
    var keys = Object.keys(obj || {}).sort().reverse().slice(0, 10);
    if (!keys.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + keys.map(function (iso) {
      var e = obj[iso];
      return "<li><strong>" + fmtDate(iso) + "</strong> · " + e.m + "/5" + (e.note ? " · " + esc(e.note) : "") + "</li>";
    }).join("") + "</ul>";
  }
  function fmtGratitude(obj) {
    var keys = Object.keys(obj || {}).sort().reverse().slice(0, 10);
    if (!keys.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + keys.map(function (iso) {
      var items = (obj[iso] || []).filter(Boolean).map(esc).join("; ");
      return "<li><strong>" + fmtDate(iso) + "</strong> · " + items + "</li>";
    }).join("") + "</ul>";
  }
  function fmtSleep(obj) {
    var keys = Object.keys(obj || {}).sort().reverse().slice(0, 10);
    if (!keys.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + keys.map(function (iso) {
      var e = obj[iso];
      return "<li><strong>" + fmtDate(iso) + "</strong> · " + e.b + "→" + e.w + " · " + e.q + "/5" + (e.note ? " · " + esc(e.note) : "") + "</li>";
    }).join("") + "</ul>";
  }
  function fmtHabits(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + arr.map(function (h) {
      var days = Object.keys(h.c || {}).filter(function (k) { return h.c[k]; }).length;
      return "<li>" + h.e + " " + esc(h.n) + " · " + days + " " + t("habit.days") + "</li>";
    }).join("") + "</ul>";
  }
  function fmtWorries(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + arr.slice(-15).reverse().map(function (w) {
      var tag = !w.done ? t("worry.open") : (w.happened ? t("worry.happened") : t("worry.nothappened"));
      return "<li>" + esc(w.text) + " <span class='chip'>" + tag + "</span></li>";
    }).join("") + "</ul>";
  }
  function fmtThoughts(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + arr.slice(-10).reverse().map(function (e) {
      var delta = (typeof e.int1 === "number" && typeof e.int2 === "number") ? (e.int1 + "% → " + e.int2 + "%") : "";
      return "<li><strong>" + fmtDate(e.date) + "</strong> · " + esc(e.thought) + (delta ? " <span class='chip'>" + delta + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  function fmtCopingCards(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + arr.slice(-10).reverse().map(function (c) {
      return "<li>" + (c.situation ? "<strong>" + esc(c.situation) + "</strong> · " : "") + esc(c.text) + "</li>";
    }).join("") + "</ul>";
  }
  function fmtAchievements(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    var SIZE_ICON = { small: "🌱", medium: "🌿", big: "🌳" };
    return "<ul style='margin:0;padding-left:20px'>" + arr.slice(-10).reverse().map(function (a) {
      return "<li>" + (SIZE_ICON[a.size] || "🌿") + " " + esc(a.text) + "</li>";
    }).join("") + "</ul>";
  }
  function fmtCompassionBreak(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + arr.slice(-10).reverse().map(function (e) {
      return "<li><strong>" + fmtDate(e.date) + "</strong>" + (e.note ? " · " + esc(e.note) : "") + "</li>";
    }).join("") + "</ul>";
  }
  function fmtFears(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + arr.slice().sort(function (a, b) { return a.suds - b.suds; }).map(function (f) {
      return "<li>" + esc(f.situation) + " <span class='chip'>" + f.suds + "/100</span></li>";
    }).join("") + "</ul>";
  }
  var VALUES_POOL = [
    { pt: "Amizade", en: "Friendship" }, { pt: "Amor", en: "Love" }, { pt: "Família", en: "Family" },
    { pt: "Saúde", en: "Health" }, { pt: "Liberdade", en: "Freedom" }, { pt: "Honestidade", en: "Honesty" },
    { pt: "Justiça", en: "Justice" }, { pt: "Segurança", en: "Security" }, { pt: "Aventura", en: "Adventure" },
    { pt: "Criatividade", en: "Creativity" }, { pt: "Aprendizagem", en: "Learning" }, { pt: "Autonomia", en: "Autonomy" },
    { pt: "Compaixão", en: "Compassion" }, { pt: "Coragem", en: "Courage" }, { pt: "Equilíbrio", en: "Balance" },
    { pt: "Espiritualidade", en: "Spirituality" }, { pt: "Excelência", en: "Excellence" }, { pt: "Generosidade", en: "Generosity" },
    { pt: "Gratidão", en: "Gratitude" }, { pt: "Humildade", en: "Humility" }, { pt: "Humor", en: "Humour" },
    { pt: "Independência", en: "Independence" }, { pt: "Lealdade", en: "Loyalty" }, { pt: "Ordem", en: "Order" },
    { pt: "Paz", en: "Peace" }, { pt: "Perdão", en: "Forgiveness" }, { pt: "Reconhecimento", en: "Recognition" },
    { pt: "Respeito", en: "Respect" }, { pt: "Responsabilidade", en: "Responsibility" }, { pt: "Sabedoria", en: "Wisdom" },
    { pt: "Simplicidade", en: "Simplicity" }, { pt: "Sinceridade", en: "Sincerity" }, { pt: "Sucesso", en: "Success" },
    { pt: "Sustentabilidade", en: "Sustainability" }, { pt: "Tradição", en: "Tradition" }, { pt: "Confiança", en: "Trust" },
    { pt: "Tolerância", en: "Tolerance" }, { pt: "Curiosidade", en: "Curiosity" }, { pt: "Diversão", en: "Fun" },
    { pt: "Beleza", en: "Beauty" }, { pt: "Colaboração", en: "Collaboration" }, { pt: "Autenticidade", en: "Authenticity" }
  ];
  function fmtValues(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return "<ul style='margin:0;padding-left:20px'>" + arr.slice(-10).reverse().map(function (e) {
      var words = (e.top5 || []).map(function (i) { return VALUES_POOL[i] ? VALUES_POOL[i][lang] : "?"; }).join(", ");
      return "<li><strong>#" + e.n + " · " + fmtDate(e.date) + "</strong> · " + esc(words) + "</li>";
    }).join("") + "</ul>";
  }
  const FORMATTERS = {
    mood: fmtMood, gratitude: fmtGratitude, sleep: fmtSleep, habits: fmtHabits, worries: fmtWorries,
    thoughts: fmtThoughts, copingcards: fmtCopingCards, achievements: fmtAchievements,
    compassionbreak: fmtCompassionBreak, fears: fmtFears, values: fmtValues
  };
  const CAT_ICONS = {
    mood: "📔", thoughts: "💭", gratitude: "🙏", habits: "✅", sleep: "😴", worries: "📦",
    copingcards: "🗂️", achievements: "🏆", compassionbreak: "🫶", fears: "🪜", values: "🧭"
  };

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
    formatters: FORMATTERS,
    catIcons: CAT_ICONS,
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
