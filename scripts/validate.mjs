#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function scan(value, location) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["sourceAliases", "sourceTreatmentAliases"].includes(key)) failures.push(`${location}.${key}: запрещённое поле происхождения`);
    if (key === "system" && typeof child === "string" && child.toLowerCase().includes("medkit")) {
      failures.push(`${location}.system: запрещённая внешняя система`);
    }
    scan(child, `${location}.${key}`);
  }
}

const jsonFiles = [
  ...walk(path.join(repositoryRoot, "data")),
  ...walk(path.join(repositoryRoot, "runtime")),
].filter((filePath) => filePath.endsWith(".json"));

for (const filePath of jsonFiles) {
  try {
    scan(JSON.parse(fs.readFileSync(filePath, "utf8")), path.relative(repositoryRoot, filePath));
  } catch (error) {
    failures.push(`${path.relative(repositoryRoot, filePath)}: ${error.message}`);
  }
}

const casesRoot = path.join(repositoryRoot, "data", "cases");
const collections = fs.readdirSync(casesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
let caseCount = 0;
for (const collection of collections) {
  const rulesPath = path.join(casesRoot, collection, "rules.json");
  if (!fs.existsSync(rulesPath)) {
    failures.push(`${collection}: отсутствует rules.json`);
    continue;
  }
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  caseCount += rules.cases.length;
  for (const scenario of rules.cases) {
    const [reference, fragment] = scenario.clinicalAuditRef.split("#");
    const auditPath = path.resolve(path.dirname(rulesPath), reference);
    if (!fs.existsSync(auditPath)) {
      failures.push(`${scenario.id}: не найден clinicalAuditRef ${scenario.clinicalAuditRef}`);
    } else if (fragment && !fs.readFileSync(auditPath, "utf8").includes(`id="${fragment}"`)) {
      failures.push(`${scenario.id}: не найден якорь #${fragment} в ${reference}`);
    }
  }
}

if (!failures.length) {
  for (const collection of collections) {
    const check = spawnSync(process.execPath, [path.join(scriptDir, "generate-runtime.mjs"), "--collection", collection, "--check"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (check.status !== 0) failures.push(check.stderr.trim() || check.stdout.trim() || `Проверка runtime ${collection} завершилась ошибкой`);
  }
}

const result = {
  passed: failures.length === 0,
  jsonFiles: jsonFiles.length,
  collections,
  cases: caseCount,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
