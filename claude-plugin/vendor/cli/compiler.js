export async function compileRequirementsWithGraph(provider, projectRoot, input, inputKind) {
    const goal = input.trim().replace(/\s+/g, " ").slice(0, 240);
    const resolvedGoal = goal.length > 0 ? goal : `Implement requirements from ${inputKind}.`;
    const signal = new AbortController().signal;
    await provider.initialize(projectRoot);
    await provider.ensureCurrent({ incremental: true, signal });
    const goalLoop = {
        id: "goal",
        objective: resolvedGoal,
        dependsOn: [],
        completionConditions: []
    };
    const goalQueryGraph = { version: 1, name: "goal-query", goal: resolvedGoal, loops: [goalLoop] };
    const goalContext = await provider.query({ graph: goalQueryGraph, loop: goalLoop, dependencyResults: [] }, signal);
    const communities = [...new Set(goalContext.communities)].filter((entry) => entry.trim().length > 0);
    if (communities.length < 2) {
        return null;
    }
    const loops = [];
    const selected = communities.slice(0, 6);
    for (let index = 0; index < selected.length; index += 1) {
        const community = selected[index];
        const loopId = communityLoopId(community, index);
        const communityLoop = {
            id: loopId,
            title: community,
            objective: `Implement the '${community}' subsystem to satisfy: ${resolvedGoal}`,
            dependsOn: [],
            completionConditions: [
                {
                    type: "assertion",
                    description: `The '${community}' subsystem satisfies its share of the goal with concrete file and verification evidence.`
                }
            ]
        };
        try {
            const communityContext = await provider.query({ graph: goalQueryGraph, loop: communityLoop, dependencyResults: [] }, signal);
            const files = capFiles(communityContext.relevantFiles, 50);
            if (files.length > 0) {
                communityLoop.sources = files;
            }
        }
        catch {
            // Keep the deterministic assertion loop when scoped queries fail.
        }
        loops.push(communityLoop);
    }
    loops.push({
        id: "integration",
        title: "Integration and verification",
        objective: `Integrate the implemented subsystems and verify the goal: ${resolvedGoal}`,
        dependsOn: loops.map((loop) => loop.id),
        completionConditions: [
            {
                type: "assertion",
                description: "The combined implementation satisfies the goal and integration evidence is recorded."
            }
        ],
        maxIterations: 5
    });
    return {
        $schema: "https://loopgraph.dev/schemas/loops.v1.json",
        version: 1,
        name: "generated-loopgraph",
        goal: resolvedGoal,
        defaults: {
            maxIterations: 4,
            maxConcurrentLoops: 2
        },
        loops
    };
}
export function compileRequirementsToGraph(requirements, sourceLabel) {
    const trimmedGoal = requirements.trim().replace(/\s+/g, " ").slice(0, 240);
    const goal = trimmedGoal.length > 0 ? trimmedGoal : `Implement requirements from ${sourceLabel}.`;
    return {
        $schema: "https://loopgraph.dev/schemas/loops.v1.json",
        version: 1,
        name: "generated-loopgraph",
        goal,
        defaults: {
            maxIterations: 4,
            maxConcurrentLoops: 2
        },
        loops: [
            {
                id: "foundation",
                title: "Foundation and plan",
                objective: "Inspect the project and requirements, then establish the implementation plan and shared contracts.",
                tasks: [
                    "Inspect repository structure",
                    "Identify implementation boundaries",
                    "Document contracts and validation approach"
                ],
                dependsOn: [],
                completionConditions: [
                    {
                        type: "assertion",
                        description: "The project structure, implementation boundaries, and validation approach are understood and represented in durable files."
                    }
                ]
            },
            {
                id: "implementation",
                title: "Implementation workstream",
                objective: "Implement the requested behavior while respecting the project architecture.",
                tasks: ["Make focused source changes", "Add or update tests", "Keep generated context minimal"],
                dependsOn: ["foundation"],
                completionConditions: [
                    {
                        type: "assertion",
                        description: "The requested implementation is present in source files with appropriate tests or verification."
                    }
                ]
            },
            {
                id: "verification",
                title: "Final verification",
                objective: "Run validation, fix defects, and produce a concise handoff.",
                tasks: ["Run relevant checks", "Fix validation failures", "Write final handoff"],
                dependsOn: ["implementation"],
                completionConditions: [
                    {
                        type: "assertion",
                        description: "The requested goal is verified and remaining limitations are documented."
                    }
                ],
                maxIterations: 5
            }
        ]
    };
}
export function communityLoopId(community, index) {
    const slug = community
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    if (/^[a-z][a-z0-9-]{0,63}$/.test(slug)) {
        return slug;
    }
    return `loop-${index + 1}`;
}
function capFiles(files, limit) {
    return files.slice(0, limit);
}
//# sourceMappingURL=compiler.js.map