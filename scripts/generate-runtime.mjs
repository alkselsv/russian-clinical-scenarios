#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");

function parseArguments(args) {
  const result = { collection: "emergency", output: null, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") result.check = true;
    else if (argument === "--collection") result.collection = args[++index];
    else if (argument === "--output") result.output = args[++index];
    else throw new Error(`Неизвестный аргумент: ${argument}`);
  }
  assert(result.collection && !result.collection.includes(".."), "Некорректное имя коллекции");
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function uniqueMap(items, label) {
  const map = new Map();
  for (const item of items) {
    assert(item?.id, `${label}: у записи отсутствует id`);
    assert(!map.has(item.id), `${label}: повторяется id ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

function getFact(facts, factPath) {
  let value = facts;
  for (const segment of factPath.split(".")) {
    if (!value || !Object.hasOwn(value, segment)) return { exists: false };
    value = value[segment];
  }
  return { exists: true, value };
}

function evaluateCondition(condition, facts) {
  if (condition?.always === true) return true;
  if (Array.isArray(condition?.all)) {
    const values = condition.all.map((item) => evaluateCondition(item, facts));
    if (values.includes(false)) return false;
    return values.every((value) => value === true) ? true : null;
  }
  if (Array.isArray(condition?.any)) {
    const values = condition.any.map((item) => evaluateCondition(item, facts));
    if (values.includes(true)) return true;
    return values.every((value) => value === false) ? false : null;
  }
  if (condition?.not) {
    const value = evaluateCondition(condition.not, facts);
    return value === null ? null : !value;
  }
  if (typeof condition?.fact === "string" && typeof condition?.op === "string") {
    const fact = getFact(facts, condition.fact);
    if (condition.op === "exists") return fact.exists === Boolean(condition.value ?? true);
    if (!fact.exists) return null;
    switch (condition.op) {
      case "eq": return fact.value === condition.value;
      case "ne": return fact.value !== condition.value;
      case "lt": return fact.value < condition.value;
      case "lte": return fact.value <= condition.value;
      case "gt": return fact.value > condition.value;
      case "gte": return fact.value >= condition.value;
      case "in":
        assert(Array.isArray(condition.value), `Оператор in требует массив для ${condition.fact}`);
        return condition.value.includes(fact.value);
      default: throw new Error(`Неизвестный оператор условия: ${condition.op}`);
    }
  }
  throw new Error(`Некорректное условие: ${JSON.stringify(condition)}`);
}

const bucketNames = {
  required: "required",
  conditional: "conditional",
  optional: "optional",
  "not-routine": "avoid",
  "unsafe-or-delaying": "unsafe",
  "unscorable-as-specified": "avoid",
};

function grouped(items) {
  const output = { required: [], conditional: [], optional: [], avoid: [], unsafe: [] };
  for (const item of items) {
    const bucket = bucketNames[item.decision];
    assert(bucket, `Неизвестный класс оценки: ${item.decision}`);
    output[bucket].push(item);
  }
  return output;
}

function requiredInputs(action) {
  if (action.kind === "medication") return ["drug", "dose", "route", "timing"];
  if (action.kind === "communication") return ["content"];
  if (action.kind === "clinical-decision") return ["decision", "rationale"];
  return ["execution"];
}

function validateNoSourceFields(value, location = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSourceFields(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!["sourceAliases", "sourceTreatmentAliases"].includes(key), `${location}.${key}: поле происхождения запрещено`);
    if (key === "system" && typeof child === "string") {
      assert(!child.toLowerCase().includes("medkit"), `${location}.system: внешняя система источника запрещена`);
    }
    validateNoSourceFields(child, `${location}.${key}`);
  }
}

const options = parseArguments(process.argv.slice(2));
const collectionRoot = path.join(repositoryRoot, "data", "cases", options.collection);
const paths = {
  actions: path.join(repositoryRoot, "data", "catalogs", "actions.json"),
  studies: path.join(repositoryRoot, "data", "catalogs", "studies.json"),
  references: path.join(repositoryRoot, "data", "references", "clinical-recommendations.json"),
  content: path.join(collectionRoot, "content.json"),
  rules: path.join(collectionRoot, "rules.json"),
  config: path.join(collectionRoot, "runtime-config.json"),
};
const outputPath = path.resolve(options.output ?? path.join(repositoryRoot, "runtime", `${options.collection}.json`));

for (const [name, filePath] of Object.entries(paths)) {
  assert(fs.existsSync(filePath), `Не найден входной файл ${name}: ${filePath}`);
}

const documents = Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, readJson(filePath)]));
Object.entries(documents).forEach(([name, document]) => validateNoSourceFields(document, name));

const actionsById = uniqueMap(documents.actions.actions, "actions");
const studiesById = uniqueMap(documents.studies.studies, "studies");
const recommendationsById = uniqueMap(documents.references.clinicalRecommendations, "clinicalRecommendations");
const contentById = uniqueMap(documents.content.cases, "content.cases");
const rulesById = uniqueMap(documents.rules.cases, "rules.cases");
const configById = uniqueMap(documents.config.cases, "runtime-config.cases");

const caseIds = [...contentById.keys()].sort();
assert(caseIds.length > 0, "Коллекция не содержит случаев");
for (const id of caseIds) {
  assert(rulesById.has(id), `${id}: отсутствуют правила`);
  assert(configById.has(id), `${id}: отсутствует runtime-конфигурация`);
}
assert(rulesById.size === caseIds.length, "rules.json содержит лишние случаи");
assert(configById.size === caseIds.length, "runtime-config.json содержит лишние случаи");

function compileAction(rule, conditions, facts, caseId) {
  const action = actionsById.get(rule.actionId);
  assert(action, `${caseId}: не найдено действие ${rule.actionId}`);
  const condition = conditions[rule.actionId];
  assert(rule.evaluation === "conditional" ? Boolean(condition) : !condition, `${caseId}: некорректное условие действия ${rule.actionId}`);
  const when = condition ?? { always: true };
  return {
    id: action.id,
    label: action.preferredNameRu,
    decision: rule.evaluation,
    when,
    applicableNow: evaluateCondition(when, facts),
    requiredInputs: requiredInputs(action),
    instruction: rule.doseRouteTimingRu ?? rule.executionRu,
    indication: rule.indicationRu,
    checks: rule.conditionsRu,
    contraindications: rule.contraindicationsRu,
    success: rule.responseCriteriaRu,
  };
}

function compileStudy(rule, conditions, facts, results, caseId) {
  const study = studiesById.get(rule.studyId);
  assert(study, `${caseId}: не найдено исследование ${rule.studyId}`);
  const condition = conditions[rule.studyId];
  assert(rule.evaluation === "conditional" ? Boolean(condition) : !condition, `${caseId}: некорректное условие исследования ${rule.studyId}`);
  const when = condition ?? { always: true };
  assert(results[rule.studyId], `${caseId}: отсутствует результат ${rule.studyId}`);
  return {
    id: study.id,
    label: study.preferredNameRu,
    decision: rule.evaluation,
    when,
    applicableNow: evaluateCondition(when, facts),
    timing: rule.timingRu,
    rationale: rule.rationaleRu,
    mustNotDelay: rule.mustNotDelayRu,
    result: results[rule.studyId],
  };
}

const runtimeCases = caseIds.map((caseId) => {
  const content = contentById.get(caseId);
  const rules = rulesById.get(caseId);
  const config = configById.get(caseId);
  const conditionalActions = rules.actionRules.filter((item) => item.evaluation === "conditional").map((item) => item.actionId).sort();
  const configuredActions = Object.keys(config.actionConditions).sort();
  const conditionalStudies = rules.studyRules.filter((item) => item.evaluation === "conditional").map((item) => item.studyId).sort();
  const configuredStudies = Object.keys(config.studyConditions).sort();
  assert(JSON.stringify(conditionalActions) === JSON.stringify(configuredActions), `${caseId}: условия действий не покрывают conditional-правила`);
  assert(JSON.stringify(conditionalStudies) === JSON.stringify(configuredStudies), `${caseId}: условия исследований не покрывают conditional-правила`);

  const actionItems = rules.actionRules.map((rule) => compileAction(rule, config.actionConditions, config.facts, caseId));
  const studyItems = rules.studyRules.map((rule) => compileStudy(rule, config.studyConditions, config.facts, content.studyResults, caseId));
  const actionIds = new Set(actionItems.map((item) => item.id));
  for (const group of config.choiceGroups) {
    assert(group.kind === "actions", `${caseId}: неподдерживаемый choiceGroup ${group.kind}`);
    assert(group.minSelections >= 0 && group.maxSelections >= group.minSelections, `${caseId}: неверные границы choiceGroup`);
    group.memberIds.forEach((id) => assert(actionIds.has(id), `${caseId}: choiceGroup ссылается на ${id}`));
  }

  return {
    id: caseId,
    title: content.title,
    patient: content.patient,
    presentation: content.presentation,
    facts: config.facts,
    factNotes: config.factNotesRu,
    diagnosis: {
      id: rules.diagnosis.id,
      label: rules.diagnosis.preferredNameRu,
      externalCodes: rules.diagnosis.externalCodes,
    },
    actions: grouped(actionItems),
    studies: grouped(studyItems),
    choiceGroups: config.choiceGroups,
    references: rules.guidelineIds.map((id) => {
      const reference = recommendationsById.get(id);
      assert(reference, `${caseId}: не найдена рекомендация ${id}`);
      return { id: reference.id, title: reference.titleRu, url: reference.officialUrl };
    }),
    reviewStatus: rules.reviewStatus,
  };
});

const runtime = {
  _meta: {
    schemaVersion: "1.0.0",
    collection: options.collection,
    generator: "scripts/generate-runtime.mjs",
    caseCount: runtimeCases.length,
    language: "ru",
    clinicalSafety: documents.rules._meta.clinicalSafety,
    scoringMode: "rules-with-structured-conditions-and-parameter-review",
    conditionDsl: documents.config._meta.conditionDsl,
    inputSha256: Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, hashFile(filePath)])),
  },
  cases: runtimeCases,
};

validateNoSourceFields(runtime, "runtime");
const serialized = `${JSON.stringify(runtime, null, 2)}\n`;
if (options.check) {
  assert(fs.existsSync(outputPath), `Runtime-файл не найден: ${outputPath}`);
  assert(fs.readFileSync(outputPath, "utf8") === serialized, `Runtime ${options.collection} устарел; запустите генератор без --check`);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, "utf8");
}

const totals = runtimeCases.reduce((sum, item) => {
  Object.values(item.actions).forEach((group) => { sum.actions += group.length; });
  Object.values(item.studies).forEach((group) => { sum.studies += group.length; });
  return sum;
}, { actions: 0, studies: 0 });

console.log(JSON.stringify({
  mode: options.check ? "check" : "write",
  collection: options.collection,
  output: path.relative(repositoryRoot, outputPath),
  cases: runtimeCases.length,
  actionRules: totals.actions,
  studyRules: totals.studies,
}, null, 2));
