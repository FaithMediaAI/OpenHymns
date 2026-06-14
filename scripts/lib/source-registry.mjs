import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadSourceRegistry(rootDir, registryPath = "config/sources.json") {
  const raw = await readFile(path.join(rootDir, registryPath), "utf8");
  return JSON.parse(raw);
}

export function resolveSourcePath(rootDir, source, relativePath = "") {
  return path.join(rootDir, source.localPath, relativePath);
}

export function sourceCloneUrl(source) {
  if (source.url) return source.url;
  return `https://github.com/${source.repo}.git`;
}
