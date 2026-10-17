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
      sourceHymns: result.manifest.sourceHymnCount,
      canonicalHymns: result.manifest.canonicalHymnCount,
      quarantined: result.manifest.quarantine.recordCount,
      warnings: result.warnings.length,
      release
    },
    null,
    2
  )
);

if (result.warnings.length) {
  console.warn("Warnings:");
  const grouped = new Map();
  for (const warning of result.warnings) {
    const key = JSON.stringify([warning.source, warning.message]);
    const group = grouped.get(key) ?? { source: warning.source, message: warning.message, count: 0 };
    group.count++;
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    console.warn(`- ${group.source} (${group.count}): ${group.message}`);
  }
  console.warn("Per-record details: data/quality-report.json");
}
