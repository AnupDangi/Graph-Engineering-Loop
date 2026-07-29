import { GraphValidationError, type ValidationIssue } from "../errors/errors.js";
import type { CompletionCondition, LoopDefinition, LoopGraph } from "./types.js";

const LOOP_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function parseLoopGraphJson(input: string): LoopGraph {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new GraphValidationError([{ path: "$", message: `Invalid JSON: ${message}` }]);
  }

  return assertValidLoopGraph(parsed);
}

export function assertValidLoopGraph(value: unknown): LoopGraph {
  const issues = validateLoopGraph(value);

  if (issues.length > 0) {
    throw new GraphValidationError(issues);
  }

  return value as LoopGraph;
}

export function validateLoopGraph(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isRecord(value)) {
    return [{ path: "$", message: "Graph must be an object" }];
  }

  if (value.version !== 1) {
    issues.push({ path: "$.version", message: "Only schema version 1 is supported" });
  }

  requireString(value, "name", "$.name", issues);
  requireString(value, "goal", "$.goal", issues);

  if (value.defaults !== undefined) {
    if (!isRecord(value.defaults)) {
      issues.push({ path: "$.defaults", message: "Defaults must be an object" });
    } else {
      validatePositiveInteger(value.defaults.maxIterations, "$.defaults.maxIterations", issues);
      validatePositiveInteger(value.defaults.maxConcurrentLoops, "$.defaults.maxConcurrentLoops", issues);
    }
  }

  if (!Array.isArray(value.loops)) {
    issues.push({ path: "$.loops", message: "Loops must be an array" });
    return issues;
  }

  if (value.loops.length === 0) {
    issues.push({ path: "$.loops", message: "Graph must contain at least one loop" });
    return issues;
  }

  const loopIds = new Set<string>();
  const duplicateIds = new Set<string>();

  value.loops.forEach((loop, index) => {
    if (!isRecord(loop)) {
      issues.push({ path: `$.loops[${index}]`, message: "Loop must be an object" });
      return;
    }

    validateLoopShape(loop, index, issues);

    if (typeof loop.id === "string") {
      if (loopIds.has(loop.id)) {
        duplicateIds.add(loop.id);
      }
      loopIds.add(loop.id);
    }
  });

  for (const id of duplicateIds) {
    issues.push({ path: "$.loops", message: `Duplicate loop id '${id}'` });
  }

  const typedLoops = value.loops.filter(isRecord) as unknown as LoopDefinition[];
  validateDependencies(typedLoops, loopIds, issues);

  return issues;
}

function validateLoopShape(loop: Record<string, unknown>, index: number, issues: ValidationIssue[]): void {
  const path = `$.loops[${index}]`;

  requireString(loop, "id", `${path}.id`, issues);
  if (typeof loop.id === "string" && !LOOP_ID_PATTERN.test(loop.id)) {
    issues.push({
      path: `${path}.id`,
      message: "Loop id must match ^[a-z][a-z0-9-]{0,63}$"
    });
  }

  requireString(loop, "objective", `${path}.objective`, issues);
  validateOptionalString(loop.title, `${path}.title`, issues);
  validateStringArray(loop.tasks, `${path}.tasks`, issues);
  validateStringArray(loop.sources, `${path}.sources`, issues);
  validatePositiveInteger(loop.maxIterations, `${path}.maxIterations`, issues);

  if (!Array.isArray(loop.dependsOn)) {
    issues.push({ path: `${path}.dependsOn`, message: "dependsOn must be an array" });
  } else {
    for (const [dependencyIndex, dependency] of loop.dependsOn.entries()) {
      if (typeof dependency !== "string") {
        issues.push({
          path: `${path}.dependsOn[${dependencyIndex}]`,
          message: "Dependency id must be a string"
        });
      }
    }
  }

  if (!Array.isArray(loop.completionConditions) || loop.completionConditions.length === 0) {
    issues.push({
      path: `${path}.completionConditions`,
      message: "completionConditions must be a non-empty array"
    });
  } else {
    loop.completionConditions.forEach((condition, conditionIndex) => {
      validateCondition(condition, `${path}.completionConditions[${conditionIndex}]`, issues);
    });
  }
}

function validateDependencies(
  loops: LoopDefinition[],
  loopIds: Set<string>,
  issues: ValidationIssue[]
): void {
  const graph = new Map<string, string[]>();
  const dependedOn = new Set<string>();
  let rootCount = 0;

  loops.forEach((loop, index) => {
    if (typeof loop.id !== "string" || !Array.isArray(loop.dependsOn)) {
      return;
    }

    if (loop.dependsOn.length === 0) {
      rootCount += 1;
    }

    graph.set(loop.id, loop.dependsOn);

    loop.dependsOn.forEach((dependency) => {
      if (typeof dependency !== "string") {
        return;
      }

      dependedOn.add(dependency);

      if (!loopIds.has(dependency)) {
        issues.push({
          path: `$.loops[${index}].dependsOn`,
          message: `Dependency '${dependency}' does not reference an existing loop`
        });
      }

      if (dependency === loop.id) {
        issues.push({
          path: `$.loops[${index}].dependsOn`,
          message: `Loop '${loop.id}' cannot depend on itself`
        });
      }
    });
  });

  if (rootCount === 0) {
    issues.push({ path: "$.loops", message: "Graph must contain at least one root loop" });
  }

  const terminalCount = loops.filter((loop) => typeof loop.id === "string" && !dependedOn.has(loop.id)).length;
  if (terminalCount === 0) {
    issues.push({ path: "$.loops", message: "Graph must contain at least one terminal loop" });
  }

  const cycle = findCycle(graph);
  if (cycle !== null) {
    issues.push({
      path: "$.loops",
      message: `Dependency cycle detected: ${cycle.join(" -> ")}`
    });
  }
}

function findCycle(graph: Map<string, string[]>): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  for (const node of graph.keys()) {
    const cycle = visit(node, graph, visiting, visited, stack);
    if (cycle !== null) {
      return cycle;
    }
  }

  return null;
}

function visit(
  node: string,
  graph: Map<string, string[]>,
  visiting: Set<string>,
  visited: Set<string>,
  stack: string[]
): string[] | null {
  if (visited.has(node)) {
    return null;
  }

  if (visiting.has(node)) {
    const start = stack.indexOf(node);
    return [...stack.slice(start), node];
  }

  visiting.add(node);
  stack.push(node);

  for (const dependency of graph.get(node) ?? []) {
    if (!graph.has(dependency)) {
      continue;
    }

    const cycle = visit(dependency, graph, visiting, visited, stack);
    if (cycle !== null) {
      return cycle;
    }
  }

  stack.pop();
  visiting.delete(node);
  visited.add(node);

  return null;
}

function validateCondition(condition: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(condition)) {
    issues.push({ path, message: "Completion condition must be an object" });
    return;
  }

  switch (condition.type) {
    case "command":
      requireString(condition, "command", `${path}.command`, issues);
      validateOptionalInteger(condition.expectExitCode, `${path}.expectExitCode`, issues);
      break;
    case "fileExists":
      requireString(condition, "path", `${path}.path`, issues);
      break;
    case "fileContains":
      requireString(condition, "path", `${path}.path`, issues);
      requireString(condition, "text", `${path}.text`, issues);
      break;
    case "assertion":
      requireString(condition, "description", `${path}.description`, issues);
      break;
    case "all":
      if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
        issues.push({ path: `${path}.conditions`, message: "all.conditions must be a non-empty array" });
      } else {
        condition.conditions.forEach((child, index) => {
          validateCondition(child, `${path}.conditions[${index}]`, issues);
        });
      }
      break;
    default:
      issues.push({
        path: `${path}.type`,
        message: `Unsupported completion condition type '${String(condition.type)}'`
      });
  }
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[]
): void {
  if (typeof record[key] !== "string" || record[key].length === 0) {
    issues.push({ path, message: `${key} must be a non-empty string` });
  }
}

function validateOptionalString(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && typeof value !== "string") {
    issues.push({ path, message: "Value must be a string" });
  }
}

function validateStringArray(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    issues.push({ path, message: "Value must be an array of strings" });
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      issues.push({ path: `${path}[${index}]`, message: "Value must be a string" });
    }
  });
}

function validatePositiveInteger(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || Number(value) <= 0) {
    issues.push({ path, message: "Value must be a positive integer" });
  }
}

function validateOptionalInteger(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && !Number.isInteger(value)) {
    issues.push({ path, message: "Value must be an integer" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCompletionCondition(value: unknown): value is CompletionCondition {
  return isRecord(value) && typeof value.type === "string";
}
