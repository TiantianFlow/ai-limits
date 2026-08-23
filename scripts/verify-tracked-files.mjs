import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { FORBIDDEN_TRACKED_FILE_LITERALS } from "./artifact-contract.mjs";

const execFileAsync = promisify(execFile);

export async function findForbiddenTrackedFileMatches(root = process.cwd()) {
  const args = ["grep", "--cached", "-nIi", "-F"];
  for (const literal of FORBIDDEN_TRACKED_FILE_LITERALS) {
    args.push("-e", literal);
  }
  args.push("--", ".");

  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trimEnd().split("\n").filter(Boolean);
  } catch (error) {
    if (error && typeof error === "object" && error.code === 1) return [];
    throw error;
  }
}

export async function verifyTrackedFiles(root = process.cwd()) {
  const matches = await findForbiddenTrackedFileMatches(root);
  if (matches.length > 0) {
    throw new Error(
      `Tracked files contain forbidden reference or release literals:\n${matches.join("\n")}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await verifyTrackedFiles();
  console.log("AI Limits tracked files verified");
}
