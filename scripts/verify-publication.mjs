import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validatePublicationDocuments } from "./publication-contract.mjs";

const documents = {
  readme: await readFile(resolve("README.md"), "utf8"),
  readmeZh: await readFile(resolve("README.zh-CN.md"), "utf8"),
  faq: await readFile(resolve("FAQ.md"), "utf8"),
  faqZh: await readFile(resolve("FAQ.zh-CN.md"), "utf8"),
  supported: await readFile(resolve("SUPPORTED_PROVIDERS.md"), "utf8"),
  supportedZh: await readFile(resolve("SUPPORTED_PROVIDERS.zh-CN.md"), "utf8"),
  privacy: await readFile(resolve("PRIVACY.md"), "utf8"),
  security: await readFile(resolve("SECURITY.md"), "utf8"),
  listing:
    (await readFile(resolve("STORE_LISTING.md"), "utf8")) +
    "\n" +
    (await readFile(
      resolve("store-assets/chrome-web-store/listing-en.md"),
      "utf8",
    )),
  license: await readFile(resolve("LICENSE"), "utf8"),
};

const errors = validatePublicationDocuments(documents);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log("AI Limits publication content verified");
}
