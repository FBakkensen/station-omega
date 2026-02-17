/**
 * Shared Layer 2 output type.
 *
 * The active generation pipeline now uses the deterministic
 * systems-items-procedural layer, but downstream creative/objective
 * layers still depend on this validated shape.
 */

import type { SystemId, FailureMode, ActionDomain } from '../../types.js';

export interface ValidatedSystemsItems {
    roomFailures: Array<{
        roomId: string;
        failures: Array<{
            systemId: SystemId;
            failureMode: FailureMode;
            severity: 1 | 2 | 3;
            requiredMaterials: string[];
            requiredSkill: ActionDomain;
            diagnosisHint: string;
            mitigationPaths: string[];
            cascadeTarget: string | null;
            minutesUntilCascade: number;
        }>;
    }>;
    items: Array<{
        id: string;
        roomId: string;
        baseItemKey: string;
        isKeyItem: boolean;
    }>;
}
