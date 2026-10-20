import {
  readPublicationDocuments,
  validatePublicationDocuments,
} from "./publication-contract.mjs";

// Provider counts are checked against the catalog by publication-contract.test.js,
// which can import the TypeScript catalog; this script checks everything else.
const errors = validatePublicationDocuments(await readPublicationDocuments());

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log("AI Limits publication content verified");
}
