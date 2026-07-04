#!/usr/bin/env node
/**
 * PsicoLab — recolha diária de artigos de psicologia.
 *
 * Fontes CC (The Conversation, licença CC BY-ND): texto integral + imagens,
 * sempre com crédito ao autor e ligação ao original. Sem alterações ao texto
 * (a licença ND não permite derivados — por isso ficam na língua original).
 * Outras fontes: apenas título + resumo + imagem (se o feed a fornecer) + link.
 *
 * Saída: data/articles.json — máximo 30 artigos, mais recentes primeiro;
 * os mais antigos são descartados. Corre via GitHub Action (ver
 * .github/workflows/update-articles.yml) ou manualmente: node scripts/fetch-articles.js
 */

const fs = require("fs");
const path = require("path");

const MAX_ARTICLES = 30;
const OUT = path.join(__dirname, "..", "data", "articles.json");

let FEEDS = [
  // The Conversation — vários tópicos/edições; os que falharem são ignorados
  { url: "https://theconversation.com/us/topics/psychology-566/articles.atom", source: "The Conversation", cc: true },
  { url: "https://theconversation.com/uk/topics/psychology-566/articles.atom", source: "The Conversation", cc: true },
  { url: "https://theconversation.com/us/topics/mental-health-343/articles.atom", source: "The Conversation", cc: true },
  { url: "https://theconversation.com/us/topics/neuroscience-301/articles.atom", source: "The Conversation", cc: true },
  { url: "https://theconversation.com/uk/topics/mental-health-343/articles.atom", source: "The Conversation", cc: true },
  // Fontes não-CC — só título + resumo + ligação
  { url: "https://www.sciencedaily.com/rss/mind_brain/psychology.xml", source: "ScienceDaily", cc: false },
  { url: "https://www.sciencedaily.com/rss/mind_brain/mental_health.xml", source: "ScienceDaily", cc: false },
  { url: "https://psyche.co/feed", source: "Psyche", cc: false }
];

// para testes locais: PL_TEST_FEEDS='[{"url":"http://...","source":"X","cc":true}]'
if (process.env.PL_TEST_FEEDS) FEEDS = JSON.parse(process.env.PL_TEST_FEEDS);

/* ---------- parsing XML minimalista (sem dependências) ---------- */

function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function blocks(xml, tag) {
  const re = new RegExp("<" + tag + "[\\s>][\\s\\S]*?<\\/" + tag + ">", "g");
  return xml.match(re) || [];
}

function field(block, tag) {
  const m = block.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  if (!m) return "";
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1].trim();
  return v;
}

function attr(block, tag, name) {
  const m = block.match(new RegExp("<" + tag + "[^>]*\\s" + name + "=\"([^\"]*)\"", "i"));
  return m ? m[1] : "";
}

/* ---------- sanitização do HTML importado ---------- */

const ALLOWED_TAGS = ["p", "br", "strong", "em", "b", "i", "u", "a", "img", "figure",
  "figcaption", "h2", "h3", "h4", "ul", "ol", "li", "blockquote"];

function sanitizeHtml(html) {
  let s = String(html || "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|iframe|object|embed|form|video|audio)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<(script|style|iframe|object|embed|form|video|audio)[^>]*\/?>/gi, "");
  // remove tags fora da lista, mantendo o texto interior
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag) => {
    tag = tag.toLowerCase();
    if (!ALLOWED_TAGS.includes(tag)) return "";
    const closing = m.startsWith("</");
    if (closing) return "</" + tag + ">";
    if (tag === "a") {
      const href = (m.match(/href="([^"]*)"/i) || [])[1] || "";
      const safe = /^https?:\/\//.test(href) ? href : "#";
      return '<a href="' + safe + '" target="_blank" rel="noopener nofollow">';
    }
    if (tag === "img") {
      const src = (m.match(/src="([^"]*)"/i) || [])[1] || "";
      const alt = (m.match(/alt="([^"]*)"/i) || [])[1] || "";
      if (!/^https:\/\//.test(src)) return "";
      return '<img src="' + src + '" alt="' + alt.replace(/"/g, "&quot;") + '" loading="lazy">';
    }
    return "<" + tag + ">";
  });
  return s.trim();
}

function textOnly(html, maxLen) {
  const t = decodeEntities(
    String(html || "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen - 1).replace(/\s\S*$/, "") + "…" : t;
}

function firstImage(html) {
  const m = String(html || "").match(/<img[^>]*src="(https:\/\/[^"]+)"/i);
  return m ? m[1] : "";
}

/* ---------- extracção por formato ---------- */

function parseAtom(xml, feed) {
  return blocks(xml, "entry").map((e) => {
    const contentRaw = decodeEntities(field(e, "content"));
    const summaryRaw = decodeEntities(field(e, "summary"));
    const link = attr(e, "link", "href") || field(e, "id");
    return {
      title: textOnly(decodeEntities(field(e, "title")), 200),
      url: link,
      author: textOnly(decodeEntities(field(e, "name")), 120),
      date: field(e, "published") || field(e, "updated"),
      image: firstImage(contentRaw),
      summary: textOnly(summaryRaw || contentRaw, 300),
      contentHtml: feed.cc ? sanitizeHtml(contentRaw) : "",
      source: feed.source,
      cc: feed.cc
    };
  });
}

function parseRss(xml, feed) {
  return blocks(xml, "item").map((e) => {
    const desc = decodeEntities(field(e, "description"));
    const contentEnc = decodeEntities(field(e, "content:encoded"));
    const media = attr(e, "media:thumbnail", "url") || attr(e, "media:content", "url") ||
      attr(e, "enclosure", "url") || firstImage(contentEnc || desc);
    return {
      title: textOnly(decodeEntities(field(e, "title")), 200),
      url: field(e, "link") || attr(e, "link", "href"),
      author: textOnly(decodeEntities(field(e, "dc:creator") || field(e, "author")), 120),
      date: field(e, "pubDate") || field(e, "dc:date"),
      image: /^https:\/\//.test(media) ? media : "",
      summary: textOnly(desc || contentEnc, 300),
      contentHtml: feed.cc ? sanitizeHtml(contentEnc || desc) : "",
      source: feed.source,
      cc: feed.cc
    };
  });
}

/* ---------- recolha ---------- */

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "PsicoLab/1.0 (+https://erikaabrown.github.io)" },
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const xml = await res.text();
    const items = xml.includes("<entry") ? parseAtom(xml, feed) : parseRss(xml, feed);
    console.log("ok  ", feed.url, "→", items.length, "artigos");
    return items;
  } catch (e) {
    console.log("SKIP", feed.url, "(" + e.message + ")");
    return [];
  }
}

function normDate(d) {
  const t = Date.parse(d);
  return isNaN(t) ? 0 : t;
}

(async () => {
  const results = [];
  for (const feed of FEEDS) results.push(...await fetchFeed(feed));

  // dedupe por URL, ordena por data, corta aos 30 mais recentes
  const seen = new Set();
  const unique = results.filter((a) => {
    if (!a.url || !a.title || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
  unique.sort((a, b) => normDate(b.date) - normDate(a.date));
  const top = unique.slice(0, MAX_ARTICLES).map((a, i) => ({
    id: i,
    source: a.source,
    cc: a.cc,
    lang: "en",
    title: a.title,
    author: a.author,
    date: a.date ? new Date(normDate(a.date)).toISOString().slice(0, 10) : "",
    url: a.url,
    image: a.image,
    summary: a.summary,
    contentHtml: a.contentHtml
  }));

  if (top.length === 0) {
    console.error("Nenhum artigo recolhido — mantém-se o ficheiro anterior.");
    process.exit(0); // não falhar o workflow nem apagar dados existentes
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), articles: top }, null, 1));
  console.log("Gravados", top.length, "artigos em", OUT);
})();
