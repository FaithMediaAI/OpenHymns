import path from "node:path";
import { validateCatalog } from "./lib/validate-catalog.mjs";

const result = await validateCatalog(path.resolve(process.argv[2] ?? "data"));
const issueCounts = result.issues.reduce((counts, issue) => {
  counts[issue.type] = (counts[issue.type] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ ...result.counts, errors: result.errors, sourceIssues: issueCounts }, null, 2));
if (result.errors.length) process.exitCode = 1;
