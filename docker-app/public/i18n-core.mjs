// English keys are canonical; legacy Persian UI strings remain supported during migration.
export function createTranslator({ english = {}, translations = {}, legacy = {}, language = "en" } = {}) {
  const dictionary = new Map();
  const useLocalized = language !== "en";
  for (const [key, englishValue] of Object.entries(english)) {
    const base = typeof englishValue === "string" ? englishValue : key;
    const translated = typeof translations[key] === "string" ? translations[key] : base;
    dictionary.set(key, useLocalized ? translated : base);
    dictionary.set(base, useLocalized ? translated : base);
  }
  for (const [source, englishKey] of Object.entries(legacy)) {
    const base = typeof english[englishKey] === "string" ? english[englishKey] : englishKey;
    const translated = typeof translations[englishKey] === "string" ? translations[englishKey] : base;
    dictionary.set(source, useLocalized ? translated : base);
  }
  const keys = [...dictionary.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!keys.length) return (value) => String(value ?? "");
  const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matcher = new RegExp(escaped.join("|"), "g");
  return (value) => String(value ?? "").replace(matcher, (source) => dictionary.get(source));
}
