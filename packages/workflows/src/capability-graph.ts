import { DomainError } from '@binflow/domain';
import { getTool } from '@binflow/tools';

const catalogCapabilityId = (capabilityId: string): string =>
  capabilityId === 'create_project_draft'
    ? 'create_project_astro'
    : capabilityId;

/**
 * Resolve catalog `graphVersion` for a capability.
 * When `capabilityVersion` is omitted, uses the latest catalog tool version
 * (ADR-0038). Do not default to `1` — tools may bump past v1 (e.g. delete_blog_draft@2).
 */
export const graphVersionForCapability = async (
  capabilityId: string,
  capabilityVersion?: number,
): Promise<string> => {
  try {
    const tool = await getTool(
      catalogCapabilityId(capabilityId),
      capabilityVersion,
    );
    return tool.tool.graphVersion;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      'validation_error',
      `Unable to resolve graph version for ${capabilityId}.`,
    );
  }
};
