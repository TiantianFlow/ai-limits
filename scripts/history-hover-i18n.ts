/** Stand-in for the extension i18n module. The page stub fills `browser`. */
export const i18n = {
  t(key: string, substitutions?: Record<string, string | number>): string {
    const browser = (globalThis as { browser?: { i18n: { getMessage: (key: string) => string } } }).browser;
    const template = browser?.i18n.getMessage(key.replaceAll(".", "_")) ?? key;
    if (!substitutions) return template;
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(substitutions, name) ? String(substitutions[name]) : match,
    );
  },
  count(key: string, count: number, substitutions?: Record<string, string | number>): string {
    return this.t(key, { count, ...(substitutions ?? {}) });
  },
  localeTag(): string { return "en"; },
};
