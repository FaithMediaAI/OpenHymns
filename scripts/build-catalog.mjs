import process from "node:process";

import { buildCatalog } from "./lib/build-catalog.mjs";
import { loadSourceRegistry } from "./lib/source-registry.mjs";

const rootDir = process.cwd();
const registry = await loadSourceRegistry(rootDir);
const release = process.argv.includes("--release");
const result = await buildCatalog({
  rootDir,
  registry,
  outputDir: "data",
  release
});

console.log(
  JSON.stringify(
    {
      version: result.manifest.version,
      collections: result.manifest.collectionCount,
      hymns: result.manifest.hymnCount,
      warnings: result.warnings.length,
      release
    },
    null,
    2
  )
);

if (result.warnings.length) {
  console.warn("Warnings:");
  for (const warning of result.warnings) {
    console.warn(`- ${warning.source}${warning.path ? `:${warning.path}` : ""} ${warning.message}`);
  }
}
