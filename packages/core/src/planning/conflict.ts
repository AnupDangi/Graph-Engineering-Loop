export interface PlannedWriteSet {
  loopId: string;
  files: string[];
}

export interface OverlapDecision {
  loopA: string;
  loopB: string;
  sharedFiles: string[];
  overlapRatio: number;
  serialized: boolean;
}

export interface WavePlan {
  waves: string[][];
  serializations: OverlapDecision[];
}

export const DEFAULT_MAX_OVERLAP_RATIO = 0.25;

export function assessOverlap(
  a: PlannedWriteSet,
  b: PlannedWriteSet,
  maxOverlapRatio = DEFAULT_MAX_OVERLAP_RATIO
): OverlapDecision {
  const aSet = normalizeFiles(a.files);
  const bSet = normalizeFiles(b.files);
  const shared = [...aSet].filter((file) => bSet.has(file)).sort();
  const unionSize = new Set([...aSet, ...bSet]).size;
  const overlapRatio = unionSize === 0 ? 0 : shared.length / unionSize;

  return {
    loopA: a.loopId,
    loopB: b.loopId,
    sharedFiles: shared,
    overlapRatio,
    serialized: overlapRatio > maxOverlapRatio
  };
}

export function planExecutionWaves(
  plans: PlannedWriteSet[],
  maxConcurrent: number,
  maxOverlapRatio = DEFAULT_MAX_OVERLAP_RATIO
): WavePlan {
  const ordered = [...plans].sort((a, b) => a.loopId.localeCompare(b.loopId));
  const waves: string[][] = [];
  const serializations: OverlapDecision[] = [];
  const recorded = new Set<string>();

  for (const plan of ordered) {
    let placed = false;

    for (const wave of waves) {
      if (wave.length >= maxConcurrent) {
        continue;
      }

      const wavePlans = wave.map((loopId) => ordered.find((entry) => entry.loopId === loopId)!);
      const decisions = wavePlans.map((other) => assessOverlap(plan, other, maxOverlapRatio));
      const conflicts = decisions.filter((decision) => decision.serialized);

      if (conflicts.length === 0) {
        wave.push(plan.loopId);
        placed = true;
        break;
      }

      for (const decision of conflicts) {
        const key = [decision.loopA, decision.loopB].sort().join("|");
        if (!recorded.has(key)) {
          recorded.add(key);
          serializations.push(decision);
        }
      }
    }

    if (!placed) {
      waves.push([plan.loopId]);
    }
  }

  return { waves, serializations };
}

export function isOverlappingSet(
  loopIds: string[],
  plans: PlannedWriteSet[],
  maxOverlapRatio?: number
): boolean {
  for (let i = 0; i < loopIds.length; i += 1) {
    for (let j = i + 1; j < loopIds.length; j += 1) {
      const planA = plans.find((plan) => plan.loopId === loopIds[i]);
      const planB = plans.find((plan) => plan.loopId === loopIds[j]);
      if (planA === undefined || planB === undefined) {
        continue;
      }
      if (assessOverlap(planA, planB, maxOverlapRatio).serialized) {
        return true;
      }
    }
  }

  return false;
}

function normalizeFiles(files: string[]): Set<string> {
  const normalized = new Set<string>();
  for (const file of files) {
    const trimmed = file.trim().replace(/^\.\//, "");
    if (trimmed.length > 0) {
      normalized.add(trimmed);
    }
  }
  return normalized;
}
