import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

import { loadSourceRegistry, sourceCloneUrl } from "./lib/source-registry.mjs";

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

const rootDir = process.cwd();
const registry = await loadSourceRegistry(rootDir);

await mkdir(path.join(rootDir, "sources"), { recursive: true });

for (const source of registry.sources ?? []) {
  const target = path.join(rootDir, source.localPath);
  if (existsSync(path.join(target, ".git"))) {
    console.log(`Updating ${source.id}...`);
    runGit(["fetch", "--depth", "1", "origin", source.branch ?? "HEAD"], target);
    runGit(["checkout", source.branch ?? "HEAD"], target);
    runGit(["pull", "--ff-only", "--depth", "1"], target);
    continue;
  }

  if (existsSync(target)) {
    console.warn(`Skipping ${source.id}: ${target} exists but is not a git clone.`);
    continue;
  }

  console.log(`Cloning ${source.id} from ${sourceCloneUrl(source)}...`);
  const args = ["clone", "--depth", "1"];
  if (source.branch) args.push("--branch", source.branch);
  args.push(sourceCloneUrl(source), target);
  runGit(args, rootDir);
}
