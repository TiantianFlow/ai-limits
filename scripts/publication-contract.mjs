const issuesUrl = "https://github.com/wjcjttl/ai-limits/issues";
const limitedUseStatement =
  "AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.";

const requiredListingDefaults = [
  "Category: Productivity",
  "Primary language: English",
  "Mature content: No",
  "Distribution: Public, all regions",
  "Remote hosted code: No",
];

export function validatePublicationDocuments(documents) {
  const errors = [];
  const policies = [
    ["README", "readme"],
    ["Privacy policy", "privacy"],
    ["Security policy", "security"],
  ];

  for (const [label, key] of policies) {
    const document = documents[key] ?? "";
    if (document.includes("pre-publication acceptance")) {
      errors.push(`${label} still contains pre-publication placeholder copy.`);
    }
    if (!document.includes(issuesUrl)) {
      errors.push(`${label} is missing the GitHub Issues URL.`);
    }
  }

  if (!documents.privacy?.includes(limitedUseStatement)) {
    errors.push("Privacy policy is missing the Limited Use compliance statement.");
  }

  for (const defaultValue of requiredListingDefaults) {
    if (!documents.listing?.includes(defaultValue)) {
      errors.push(`Store listing is missing required default: ${defaultValue}.`);
    }
  }

  if (!documents.license?.includes("Copyright (c) 2026 wjcjttl")) {
    errors.push("LICENSE is missing the 2026 wjcjttl copyright notice.");
  }

  return errors;
}
