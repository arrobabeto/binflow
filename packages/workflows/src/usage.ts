import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';

import {
  usageResponseSchema,
  type UsageRange,
  type UsageResponse,
} from '@binflow/contracts';
import {
  schema,
  withPlatformOwnerScope,
  type Database,
} from '@binflow/db';
import { type Clock, systemClock } from '@binflow/domain';

export type UsageCallRow = Readonly<{
  createdAt: Date;
  estimatedCostCents: number;
  inputTokens: number;
  latencyMs: number;
  model: string;
  node: string;
  outputTokens: number;
  projectId: string;
  provider: string;
  requestId: string;
  requestVersionId: string;
  tenantId: string;
}>;

export type UsageCapabilityRow = Readonly<{
  capabilityId: string;
  requestVersionId: string;
}>;

export type UsageBudgetRow = Readonly<{
  maxEstimatedCostCentsPerDay: number;
  projectId: string;
  tenantId: string;
}>;

/** Inclusive lower bound for usage aggregation (mirrors Analytics ranges). */
export const usageRangeStart = (
  range: UsageRange,
  now: Date = new Date(),
): Date | null => {
  if (range === 'all') return null;
  if (range === '24h') {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (range === '7d' ? 6 : 29));
  return start;
};

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

const average = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const dayCountInRange = (range: UsageRange, start: Date | null, end: Date): number => {
  if (range === '24h') return 1;
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  if (start === null) return 1;
  const ms = Math.max(0, end.getTime() - start.getTime());
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
};

const efficiencyScore = (input: {
  avgLatencyMs: number | null;
  spendCents: number;
  totalTokens: number;
}): number => {
  const tokensPerCent = input.totalTokens / Math.max(input.spendCents, 1);
  const latencyPenalty =
    input.avgLatencyMs === null ? 0 : Math.min(40, input.avgLatencyMs / 250);
  const raw = Math.min(100, tokensPerCent * 2) - latencyPenalty;
  return Math.round(Math.min(100, Math.max(0, raw)));
};

export const buildUsageResponse = (input: {
  budgets: readonly UsageBudgetRow[];
  calls: readonly UsageCallRow[];
  capabilities: readonly UsageCapabilityRow[];
  now?: Date;
  range: UsageRange;
}): UsageResponse => {
  const now = input.now ?? new Date();
  const rangeStart = usageRangeStart(input.range, now);
  const calls =
    rangeStart === null
      ? input.calls
      : input.calls.filter((call) => call.createdAt.getTime() >= rangeStart.getTime());

  const capabilityByVersion = new Map(
    input.capabilities.map((row) => [row.requestVersionId, row.capabilityId]),
  );
  const budgetByProject = new Map(
    input.budgets.map((row) => [row.projectId, row]),
  );

  const totalSpendCents = calls.reduce(
    (sum, call) => sum + call.estimatedCostCents,
    0,
  );
  const requestIds = new Set(calls.map((call) => call.requestId));
  const latencies = calls.map((call) => call.latencyMs);
  const avgLatencyMs = average(latencies);
  const distinctRequestCount = requestIds.size;
  const avgCostCentsPerRequest =
    distinctRequestCount === 0 ? null : totalSpendCents / distinctRequestCount;

  const costByDay = new Map<string, number>();
  for (const call of calls) {
    const day = utcDay(call.createdAt);
    costByDay.set(day, (costByDay.get(day) ?? 0) + call.estimatedCostCents);
  }
  const costOverTime = [...costByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, spendCents]) => ({ day, spendCents }));

  const clientMap = new Map<
    string,
    { modelCalls: number; projectId: string; spendCents: number; tenantId: string }
  >();
  for (const call of calls) {
    const key = call.projectId;
    const current = clientMap.get(key) ?? {
      modelCalls: 0,
      projectId: call.projectId,
      spendCents: 0,
      tenantId: call.tenantId,
    };
    current.modelCalls += 1;
    current.spendCents += call.estimatedCostCents;
    clientMap.set(key, current);
  }
  const days = dayCountInRange(input.range, rangeStart, now);
  const byClient = [...clientMap.values()]
    .map((row) => {
      const budget = budgetByProject.get(row.projectId);
      const budgetCentsPerDay = budget?.maxEstimatedCostCentsPerDay ?? null;
      const budgetUtilizationPercent =
        budgetCentsPerDay === null
          ? null
          : (row.spendCents / (budgetCentsPerDay * days)) * 100;
      return {
        budgetCentsPerDay,
        budgetUtilizationPercent,
        modelCalls: row.modelCalls,
        projectId: row.projectId,
        spendCents: row.spendCents,
        tenantId: row.tenantId,
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents);

  const capabilityMap = new Map<
    string,
    { latencies: number[]; modelCalls: number; spendCents: number }
  >();
  for (const call of calls) {
    const capabilityId =
      capabilityByVersion.get(call.requestVersionId) ?? 'unknown';
    const current = capabilityMap.get(capabilityId) ?? {
      latencies: [],
      modelCalls: 0,
      spendCents: 0,
    };
    current.modelCalls += 1;
    current.spendCents += call.estimatedCostCents;
    current.latencies.push(call.latencyMs);
    capabilityMap.set(capabilityId, current);
  }
  const byCapability = [...capabilityMap.entries()]
    .map(([capabilityId, row]) => ({
      avgLatencyMs: average(row.latencies),
      capabilityId,
      modelCalls: row.modelCalls,
      spendCents: row.spendCents,
    }))
    .sort((a, b) => b.spendCents - a.spendCents);

  const nodeMap = new Map<
    string,
    { latencies: number[]; modelCalls: number; spendCents: number }
  >();
  for (const call of calls) {
    const current = nodeMap.get(call.node) ?? {
      latencies: [],
      modelCalls: 0,
      spendCents: 0,
    };
    current.modelCalls += 1;
    current.spendCents += call.estimatedCostCents;
    current.latencies.push(call.latencyMs);
    nodeMap.set(call.node, current);
  }
  const byNode = [...nodeMap.entries()]
    .map(([node, row]) => ({
      avgLatencyMs: average(row.latencies),
      modelCalls: row.modelCalls,
      node,
      spendCents: row.spendCents,
    }))
    .sort((a, b) => b.spendCents - a.spendCents);

  const modelMap = new Map<
    string,
    {
      inputTokens: number;
      latencies: number[];
      model: string;
      modelCalls: number;
      outputTokens: number;
      provider: string;
      spendCents: number;
    }
  >();
  for (const call of calls) {
    const key = `${call.provider}:${call.model}`;
    const current = modelMap.get(key) ?? {
      inputTokens: 0,
      latencies: [],
      model: call.model,
      modelCalls: 0,
      outputTokens: 0,
      provider: call.provider,
      spendCents: 0,
    };
    current.modelCalls += 1;
    current.spendCents += call.estimatedCostCents;
    current.inputTokens += call.inputTokens;
    current.outputTokens += call.outputTokens;
    current.latencies.push(call.latencyMs);
    modelMap.set(key, current);
  }
  const byModel = [...modelMap.values()]
    .map((row) => ({
      avgLatencyMs: average(row.latencies),
      inputTokens: row.inputTokens,
      model: row.model,
      modelCalls: row.modelCalls,
      outputTokens: row.outputTokens,
      provider: row.provider,
      spendCents: row.spendCents,
    }))
    .sort((a, b) => b.spendCents - a.spendCents);

  const alerts = byClient.flatMap((row) => {
    if (row.budgetUtilizationPercent === null) return [];
    if (row.budgetUtilizationPercent < 80) return [];
    const severity =
      row.budgetUtilizationPercent >= 100 ? ('critical' as const) : ('warning' as const);
    return [
      {
        kind: 'budget_day_utilization' as const,
        message:
          severity === 'critical'
            ? `Project ${row.projectId} exceeded its daily estimated cost budget in the selected range.`
            : `Project ${row.projectId} used ${Math.round(row.budgetUtilizationPercent)}% of its daily estimated cost budget in the selected range.`,
        projectId: row.projectId,
        severity,
        utilizationPercent: row.budgetUtilizationPercent,
      },
    ];
  });

  const efficiency = byModel
    .map((row) => {
      const totalTokens = row.inputTokens + row.outputTokens;
      return {
        avgLatencyMs: row.avgLatencyMs,
        model: row.model,
        provider: row.provider,
        score: efficiencyScore({
          avgLatencyMs: row.avgLatencyMs,
          spendCents: row.spendCents,
          totalTokens,
        }),
        spendCents: row.spendCents,
        totalTokens,
      };
    })
    .sort((a, b) => b.score - a.score);

  return usageResponseSchema.parse({
    alerts,
    avgCostCentsPerRequest,
    avgLatencyMs,
    byCapability,
    byClient,
    byModel,
    byNode,
    costOverTime,
    distinctRequestCount,
    efficiency,
    range: input.range,
    rangeEnd: now.toISOString(),
    rangeStart: rangeStart === null ? null : rangeStart.toISOString(),
    totalModelCalls: calls.length,
    totalSpendCents,
  });
};

export class UsageService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  async get(
    actorId: string,
    correlationId: string,
    range: UsageRange,
  ): Promise<UsageResponse> {
    const now = this.clock.now();
    const rangeStart = usageRangeStart(range, now);

    return withPlatformOwnerScope(
      this.database,
      {
        actorId,
        correlationId,
        reason: 'platform_owner_usage_analytics',
      },
      async (scoped) => {
        const callQuery = scoped
          .select({
            createdAt: schema.modelCalls.createdAt,
            estimatedCostCents: schema.modelCalls.estimatedCostCents,
            inputTokens: schema.modelCalls.inputTokens,
            latencyMs: schema.modelCalls.latencyMs,
            model: schema.modelCalls.model,
            node: schema.modelCalls.node,
            outputTokens: schema.modelCalls.outputTokens,
            projectId: schema.modelCalls.projectId,
            provider: schema.modelCalls.provider,
            requestId: schema.modelCalls.requestId,
            requestVersionId: schema.modelCalls.requestVersionId,
            tenantId: schema.modelCalls.tenantId,
          })
          .from(schema.modelCalls);

        const calls =
          rangeStart === null
            ? await callQuery
            : await callQuery.where(gte(schema.modelCalls.createdAt, rangeStart));

        const versionIds = [
          ...new Set(calls.map((call) => call.requestVersionId)),
        ];
        const capabilities =
          versionIds.length === 0
            ? []
            : await scoped
                .select({
                  capabilityId: schema.usageRecords.capabilityId,
                  requestVersionId: schema.usageRecords.requestVersionId,
                })
                .from(schema.usageRecords)
                .where(
                  inArray(schema.usageRecords.requestVersionId, versionIds),
                );

        // Fallback: requests.capabilityId when usage_records missing (e.g. mid-flight).
        const missingVersions = versionIds.filter(
          (id) => !capabilities.some((row) => row.requestVersionId === id),
        );
        const missingRequestIds = [
          ...new Set(
            calls
              .filter((call) => missingVersions.includes(call.requestVersionId))
              .map((call) => call.requestId),
          ),
        ];
        const requestCapabilities =
          missingRequestIds.length === 0
            ? []
            : await scoped
                .select({
                  capabilityId: schema.requests.capabilityId,
                  requestId: schema.requests.id,
                })
                .from(schema.requests)
                .where(inArray(schema.requests.id, missingRequestIds));

        const capabilityRows: UsageCapabilityRow[] = [
          ...capabilities,
          ...calls
            .filter((call) =>
              missingVersions.includes(call.requestVersionId),
            )
            .map((call) => {
              const request = requestCapabilities.find(
                (row) => row.requestId === call.requestId,
              );
              return {
                capabilityId: request?.capabilityId ?? 'unknown',
                requestVersionId: call.requestVersionId,
              };
            }),
        ];

        const budgets = await scoped
          .select({
            maxEstimatedCostCentsPerDay:
              schema.projectBudgetPolicies.maxEstimatedCostCentsPerDay,
            projectId: schema.projects.id,
            tenantId: schema.projects.tenantId,
          })
          .from(schema.projects)
          .innerJoin(
            schema.projectManifestVersions,
            and(
              eq(
                schema.projectManifestVersions.projectId,
                schema.projects.id,
              ),
              eq(
                schema.projectManifestVersions.tenantId,
                schema.projects.tenantId,
              ),
              eq(
                schema.projectManifestVersions.version,
                schema.projects.activeManifestVersion,
              ),
            ),
          )
          .innerJoin(
            schema.projectBudgetPolicies,
            eq(
              schema.projectBudgetPolicies.manifestVersionId,
              schema.projectManifestVersions.id,
            ),
          )
          .where(isNotNull(schema.projects.activeManifestVersion));

        return buildUsageResponse({
          budgets,
          calls,
          capabilities: capabilityRows,
          now,
          range,
        });
      },
    );
  }
}
