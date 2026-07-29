import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";
import type {
  CompletionCondition,
  ConditionEvidence,
  LoopExecutionResult
} from "../schema/types.js";

export interface CompletionEvaluation {
  passed: boolean;
  evidence: ConditionEvidence[];
}

export interface CompletionEvaluatorOptions {
  projectRoot: string;
  commandOutputLimit?: number;
}

export async function evaluateCompletionConditions(
  conditions: CompletionCondition[],
  adapterResult: LoopExecutionResult,
  options: CompletionEvaluatorOptions
): Promise<CompletionEvaluation> {
  const evidence: ConditionEvidence[] = [];

  for (const [index, condition] of conditions.entries()) {
    const result = await evaluateCondition(condition, index, adapterResult, options);
    evidence.push(result);
  }

  return {
    passed: evidence.every((entry) => entry.passed),
    evidence
  };
}

async function evaluateCondition(
  condition: CompletionCondition,
  conditionIndex: number,
  adapterResult: LoopExecutionResult,
  options: CompletionEvaluatorOptions
): Promise<ConditionEvidence> {
  const checkedAt = new Date().toISOString();

  switch (condition.type) {
    case "fileExists": {
      const path = resolveProjectPath(options.projectRoot, condition.path);
      try {
        await access(path, constants.F_OK);
        return {
          conditionIndex,
          passed: true,
          checkedAt,
          evidence: { type: "fileExists", path: condition.path }
        };
      } catch {
        return {
          conditionIndex,
          passed: false,
          checkedAt,
          evidence: { type: "fileExists", path: condition.path, reason: "File does not exist" }
        };
      }
    }
    case "fileContains": {
      const path = resolveProjectPath(options.projectRoot, condition.path);
      try {
        const text = await readFile(path, "utf8");
        return {
          conditionIndex,
          passed: text.includes(condition.text),
          checkedAt,
          evidence: {
            type: "fileContains",
            path: condition.path,
            text: condition.text,
            found: text.includes(condition.text)
          }
        };
      } catch (error) {
        return {
          conditionIndex,
          passed: false,
          checkedAt,
          evidence: {
            type: "fileContains",
            path: condition.path,
            reason: error instanceof Error ? error.message : "Unable to read file"
          }
        };
      }
    }
    case "command": {
      const commandResult = await runCommand(condition.command, options.projectRoot, options.commandOutputLimit);
      const expectedExitCode = condition.expectExitCode ?? 0;
      return {
        conditionIndex,
        passed: commandResult.exitCode === expectedExitCode,
        checkedAt,
        evidence: {
          type: "command",
          command: condition.command,
          expectExitCode: expectedExitCode,
          exitCode: commandResult.exitCode,
          outputSummary: commandResult.outputSummary
        }
      };
    }
    case "assertion": {
      const matchingEvidence = adapterResult.completionEvidence.find(
        (entry) => entry.conditionIndex === conditionIndex && entry.passed
      );

      return {
        conditionIndex,
        passed: matchingEvidence !== undefined && hasConcreteEvidence(matchingEvidence),
        checkedAt,
        evidence: {
          type: "assertion",
          description: condition.description,
          adapterEvidence: matchingEvidence?.evidence ?? null,
          reason:
            matchingEvidence === undefined
              ? "No passing adapter evidence for assertion"
              : hasConcreteEvidence(matchingEvidence)
                ? "Assertion evidence accepted"
                : "Assertion evidence was empty"
        }
      };
    }
    case "all": {
      const nested = await evaluateCompletionConditions(condition.conditions, adapterResult, options);
      return {
        conditionIndex,
        passed: nested.passed,
        checkedAt,
        evidence: {
          type: "all",
          conditions: nested.evidence
        }
      };
    }
  }
}

function resolveProjectPath(projectRoot: string, path: string): string {
  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(resolvedRoot, path);
  const relativePath = relative(resolvedRoot, resolvedPath);

  if (relativePath.startsWith("..") || relativePath === "..") {
    throw new Error(`Path escapes project root: ${path}`);
  }

  return resolvedPath;
}

function hasConcreteEvidence(evidence: ConditionEvidence): boolean {
  return Object.keys(evidence.evidence).length > 0;
}

async function runCommand(
  command: string,
  cwd: string,
  outputLimit = 8_000
): Promise<{ exitCode: number; outputSummary: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    const collectOutput = (chunk: Buffer): void => {
      if (output.length >= outputLimit) {
        return;
      }

      output += chunk.toString("utf8");
      if (output.length > outputLimit) {
        output = `${output.slice(0, outputLimit)}\n[output truncated]`;
      }
    };

    child.stdout.on("data", collectOutput);
    child.stderr.on("data", collectOutput);
    child.on("close", (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        outputSummary: output.trim()
      });
    });
    child.on("error", (error) => {
      resolvePromise({
        exitCode: 1,
        outputSummary: error.message
      });
    });
  });
}
