import type { EvidenceStatus } from "./quality-evidence.js";
import type { GateDecision } from "./types.js";

/**
 * Gate-facing evidence disposition (maps existing `EvidenceStatus` + safe paths).
 * - sufficient: empirical quality floor can be applied (probabilistic guarantee)
 * - insufficient: abstain — do not treat downgrade as quality-safe
 * - unknown: catalog/evidence not established (unknown model, routing not evaluated)
 */
export type EvidenceDisposition = "sufficient" | "insufficient" | "unknown";

export const ABSTAIN_QUALITY_FLOOR_REASON =
  "Insufficient quality evidence to establish that the lower-cost model satisfies the configured quality floor.";

export function mapEvidenceStatusToDisposition(
  status: EvidenceStatus,
  guaranteeLevel: import("./routing-assurance.js").QualityGuaranteeLevel | undefined,
): EvidenceDisposition {
  if (guaranteeLevel === "probabilistic" && status === "known") return "sufficient";
  if (guaranteeLevel === "abstain") return "insufficient";
  if (status === "insufficient" || status === "none") return "insufficient";
  if (status === "known") return "sufficient";
  return "insufficient";
}

export function deriveEvidenceDisposition(decision: GateDecision): EvidenceDisposition {
  if (decision.reason.includes("unknown model") || decision.resolvedModel?.matched === false) {
    return "unknown";
  }
  const qa = decision.routing?.qualityAssurance;
  if (!qa) return "unknown";
  return mapEvidenceStatusToDisposition(qa.evidenceStatus, qa.guarantee.level);
}

export function deriveAbstainReason(decision: GateDecision): string {
  const qa = decision.routing?.qualityAssurance;
  if (qa?.guarantee.level === "abstain" || qa?.result.preserveCurrentModel) {
    if (
      qa.evidenceStatus === "none" ||
      qa.evidenceStatus === "insufficient" ||
      qa.result.requiredQuality != null
    ) {
      return ABSTAIN_QUALITY_FLOOR_REASON;
    }
    return qa.guarantee.statement;
  }
  if (decision.routingConfidence?.state === "insufficient_information") {
    return (
      decision.routingConfidence.clarification.summary ||
      "Insufficient task description to safely recommend a cheaper model."
    );
  }
  if (decision.routingConfidence?.noOpReason) {
    return decision.routingConfidence.noOpReason;
  }
  return ABSTAIN_QUALITY_FLOOR_REASON;
}

/** True when the gate must not emit a downgrade switch (quality-safe). */
export function isUnsafeDowngrade(decision: GateDecision): boolean {
  return (
    decision.action === "suggest_switch" &&
    decision.suggestSwitch?.switch_direction === "downgrade" &&
    deriveEvidenceDisposition(decision) === "insufficient"
  );
}
