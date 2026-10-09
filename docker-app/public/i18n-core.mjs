// English keys are canonical; legacy Persian UI strings remain supported during migration.
export function createTranslator({ english = {}, translations = {}, legacy = {}, language = "en" } = {}) {
  const dictionary = new Map();
  const useLocalized = language !== "en";
  for (const [key, englishValue] of Object.entries(english)) {
    const base = typeof englishValue === "string" ? englishValue : key;
    const translated = typeof translations[key] === "string" && translations[key].trim() ? translations[key] : base;
    dictionary.set(key, useLocalized ? translated : base);
    dictionary.set(base, useLocalized ? translated : base);
  }
  for (const [source, englishKey] of Object.entries(legacy)) {
    const base = typeof english[englishKey] === "string" ? english[englishKey] : englishKey;
    const translated = typeof translations[englishKey] === "string" && translations[englishKey].trim() ? translations[englishKey] : base;
    dictionary.set(source, useLocalized ? translated : base);
  }
  const keys = [...dictionary.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!keys.length) return (value) => String(value ?? "");
  const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matcher = new RegExp(escaped.join("|"), "g");
  return (value) => String(value ?? "").replace(matcher, (source) => dictionary.get(source));
}

// Explicit semantic keys never run through the legacy substring-replacement engine.
// Parameter values are inserted verbatim; callers escape them when rendering HTML.
export function createKeyTranslator({ english = {}, translations = {}, language = "en" } = {}) {
  return (key, params = {}) => {
    const id = String(key ?? "");
    const base = typeof english[id] === "string" ? english[id] : id;
    const localized = translations[id];
    const value = language !== "en" && typeof localized === "string" && localized.trim() ? localized : base;
    return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name) =>
      Object.prototype.hasOwnProperty.call(params || {}, name) ? String(params[name] ?? "") : placeholder);
  };
}
