export function retryAtFromResponse(
  response: Response,
  now: number,
): number | undefined {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) {
    return undefined;
  }

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    const retryAt = now + seconds * 1_000;
    return Number.isFinite(retryAt) && retryAt >= now ? retryAt : undefined;
  }

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) && retryAt > now ? retryAt : undefined;
}
