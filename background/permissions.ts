const PROVIDER_PERMISSIONS = {
  chatgpt: { origins: ["https://chatgpt.com/*"] },
};

export async function hasProviderPermission(
  providerId: "chatgpt",
): Promise<boolean> {
  return browser.permissions.contains(PROVIDER_PERMISSIONS[providerId]);
}

export async function requestProviderPermission(
  providerId: "chatgpt",
): Promise<boolean> {
  return browser.permissions.request(PROVIDER_PERMISSIONS[providerId]);
}
