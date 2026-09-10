"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../public/js/i18n.js"), "utf8");

class Element {
  constructor(tag, attributes = {}, text = "") {
    this.nodeType = 1;
    this.tagName = tag;
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    if (text) this.textContent = text;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  matches(selector) {
    return selector.split(",").some((item) => {
      const part = item.trim();
      if (part === "*") return true;
      const attr = part.match(/^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attr) return (!attr[1] || attr[1] === this.tagName) && this.hasAttribute(attr[2]) &&
        (attr[3] === undefined || this.getAttribute(attr[2]) === attr[3]);
      return this.tagName === part;
    });
  }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element;
    return null;
  }
  append(...children) {
    for (const child of children) {
      const node = typeof child === "string" ? { nodeType: 3, nodeValue: child } : child;
      node.parentElement = this;
      this.children.push(node);
    }
  }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.nodeType !== 1) continue;
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
  get textContent() { return this.children.map((node) => node.nodeType === 3 ? node.nodeValue : node.textContent).join(""); }
  set textContent(value) { this.children = []; this.append(String(value)); }
}

function browser({ saved, languages = ["en"], storageBlocked = false } = {}) {
  const values = new Map(saved ? [["mavmole.language", saved]] : []);
  const listeners = {};
  const documentElement = new Element("html");
  const document = {
    nodeType: 9,
    readyState: "loading",
    documentElement,
    addEventListener(type, callback) { listeners[`document:${type}`] = callback; },
    querySelectorAll(selector) {
      return [...(documentElement.matches(selector) ? [documentElement] : []), ...documentElement.querySelectorAll(selector)];
    },
    createTreeWalker(root) {
      const nodes = [];
      function collect(node) {
        if (node.nodeType === 3) nodes.push(node);
        else for (const child of node.children || []) collect(child);
      }
      collect(root.nodeType === 9 ? root.documentElement : root);
      return { nextNode() { return nodes.shift() || null; } };
    },
  };
  const events = [];
  const window = {
    document,
    navigator: { languages, language: languages[0] },
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error("Blocked"); return values.get(key); },
      setItem(key, value) { if (storageBlocked) throw new Error("Blocked"); values.set(key, value); },
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    addEventListener(type, callback) { listeners[type] = callback; },
    dispatchEvent(event) { events.push(event); listeners[event.type]?.(event); },
  };
  const context = vm.createContext({ window, Intl });
  vm.runInContext(script, context);
  return { i18n: window.MavMoleI18n, window, document, root: documentElement, values, listeners, events, context };
}

test("language preference persists across pages and falls back to a supported browser locale", () => {
  assert.equal(browser({ languages: ["es-ES", "de-AT", "fr-FR"] }).i18n.locale, "de");
  assert.equal(browser({ saved: "fr", languages: ["de-DE"] }).i18n.locale, "fr");
  assert.equal(browser({ saved: "invalid", languages: ["ja-JP"] }).i18n.locale, "en");
  const env = browser({ languages: ["en-US"] });
  env.i18n.setLocale("fr-FR");
  assert.equal(env.values.get("mavmole.language"), "fr");
  assert.equal(env.root.lang, "fr");
  assert.equal(env.events[0].type, "mavmole:languagechange");
  assert.equal(env.events[0].detail.locale, "fr");
  assert.equal(browser({ saved: env.values.get("mavmole.language") }).i18n.locale, "fr");
});

test("translation works when storage is unavailable and supports safe interpolation and fallback", () => {
  const { i18n } = browser({ languages: ["fr"], storageBlocked: true });
  assert.equal(i18n.t("Home"), "Accueil");
  assert.equal(i18n.t("Unknown {label}", { label: "$& <sample>" }), "Unknown $& <sample>");
  assert.equal(i18n.t("Unknown {missing}"), "Unknown {missing}");
  i18n.register({ fr: { "Live from {city}": "En direct de {city}" }, de: { "Live from {city}": "Live aus {city}" } });
  assert.equal(i18n.t("Live from {city}", { city: "Paris" }), "En direct de Paris");
  i18n.setLocale("de");
  assert.equal(i18n.t("Live from {city}", { city: "Berlin" }), "Live aus Berlin");
  assert.equal(i18n.number(1234.5, { maximumFractionDigits: 1 }), "1.234,5");
});

test("static text, nested icons, input placeholders and accessibility labels survive language round trips", () => {
  const { i18n, root } = browser();
  const link = new Element("a", { "aria-label": "MavMole home" });
  const icon = new Element("span", { "aria-hidden": "true" }, "→");
  link.append(" Open Digger ", icon);
  const password = new Element("input", { placeholder: "Only for private streams", title: "Password", value: "Home" });
  const label = new Element("label", {}, "Password ");
  label.append(password);
  const userLabel = new Element("span", { "data-i18n-ignore": "" }, "Home");
  const description = new Element("meta", { name: "description", content: "Connect Mission Planner to the MavMole relay." });
  root.append(link, label, userLabel, description);
  i18n.apply();
  i18n.setLocale("fr");
  assert.equal(link.textContent, " Ouvrir Digger →");
  assert.equal(link.children[1], icon);
  assert.equal(link.getAttribute("aria-label"), "Accueil MavMole");
  assert.equal(password.getAttribute("placeholder"), "Pour les flux privés uniquement");
  assert.equal(password.getAttribute("title"), "Mot de passe");
  assert.equal(password.getAttribute("value"), "Home");
  assert.equal(userLabel.textContent, "Home");
  assert.equal(description.getAttribute("content"), "Connectez Mission Planner au relais MavMole.");
  i18n.setLocale("de");
  assert.equal(link.textContent, " Digger öffnen →");
  assert.equal(password.getAttribute("placeholder"), "Nur für private Streams");
  i18n.setLocale("en");
  assert.equal(link.textContent, " Open Digger →");
  assert.equal(label.textContent, "Password ");
  assert.equal(password.getAttribute("placeholder"), "Only for private streams");
});

test("bound dynamic statuses keep their source and localize count formatting without a new server event", () => {
  const { i18n, root } = browser();
  const status = new Element("span");
  root.append(status);
  i18n.bind(status, "{count} viewers", { count: () => i18n.number(1234) });
  assert.equal(status.textContent, "1,234 viewers");
  i18n.setLocale("de");
  assert.equal(status.textContent, "1.234 Zuschauer");
  i18n.setLocale("fr");
  assert.equal(status.textContent, `${new Intl.NumberFormat("fr").format(1234)} spectateurs`);
  i18n.bind(status, i18n.t("Tunnel not found or credentials are incorrect."));
  i18n.setLocale("de");
  assert.equal(status.textContent, "Tunnel nicht gefunden oder Zugangsdaten falsch.");
  i18n.setLocale("en");
  assert.equal(status.textContent, "Tunnel not found or credentials are incorrect.");
});

test("language selectors and other open tabs update the shared preference", () => {
  const { i18n, root, listeners } = browser();
  const selector = new Element("select", { "data-language-select": "", "aria-label": "Language" });
  root.append(selector);
  i18n.apply();
  assert.equal(selector.value, "en");
  selector.value = "de";
  listeners["document:change"]({ target: selector });
  assert.equal(i18n.locale, "de");
  assert.equal(selector.getAttribute("aria-label"), "Sprache");
  listeners.storage({ key: "mavmole.language", newValue: "fr" });
  assert.equal(selector.value, "fr");
  assert.equal(selector.getAttribute("aria-label"), "Langue");
});

test("each base translation preserves its interpolation variables", () => {
  const rows = [...script.matchAll(/^    (\[".*\]),$/gm)].map((match) => JSON.parse(match[1]));
  assert.ok(rows.length > 200);
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [source, fr, de] of rows) {
    assert.deepEqual(placeholders(fr), placeholders(source), `French: ${source}`);
    assert.deepEqual(placeholders(de), placeholders(source), `German: ${source}`);
  }
});
