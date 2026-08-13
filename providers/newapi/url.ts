const KNOWN_SUFFIXES = [
  /\/api\/status\/?$/i,
  /\/api\/usage\/token\/?$/i,
  /\/v1(?:\/.*)?$/i,
  /\/console(?:\/.*)?$/i,
] as const;
const MAX_BASE_URL_LENGTH = 2_048;

export function normalizeNewApiBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.trim().length === 0 || value.trim().length > MAX_BASE_URL_LENGTH) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return undefined;
  }

  const localHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    (parsed.protocol !== "https:" && !localHttp) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hostname.includes("*")
  ) {
    return undefined;
  }

  let pathname = parsed.pathname.replace(/\/+$/, "");
  for (const suffix of KNOWN_SUFFIXES) {
    if (suffix.test(pathname)) {
      pathname = pathname.replace(suffix, "");
      break;
    }
  }
  pathname = pathname.replace(/\/+$/, "");

  return `${parsed.origin}${pathname === "" ? "" : pathname}`;
}

export function newApiPermissionOrigin(value: unknown): string | undefined {
  const baseUrl = normalizeNewApiBaseUrl(value);
  return baseUrl ? `${new URL(baseUrl).origin}/*` : undefined;
}
