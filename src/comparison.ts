import { CompetitorOverlap } from "./types";

/**
 * Calculates the overlap between two sets of domains
 */
export function calculateOverlap(
  sourceSet: Set<string>,
  targetSet: Set<string>
): CompetitorOverlap {
  // Find the intersection between the two sets
  const overlap = new Set<string>();
  for (const domain of sourceSet) {
    if (targetSet.has(domain)) {
      overlap.add(domain);
    }
  }

  // Calculate the percentage of overlap
  // Avoid division by zero
  const overlapPercentage =
    targetSet.size > 0 ? (overlap.size / targetSet.size) * 100 : 0;

  return {
    competitorName: "unknown", // Will be set by the caller
    totalDomains: targetSet.size,
    overlappingDomains: overlap.size,
    overlapPercentage: Math.round(overlapPercentage * 100) / 100, // Round to 2 decimal places
  };
}

/**
 * Compares DealsPotr domains against all competitors
 */
export function compareAllCompetitors(
  dealsptrDomains: Set<string>,
  competitorMap: Map<string, Set<string>>
): CompetitorOverlap[] {
  const results: CompetitorOverlap[] = [];

  for (const [competitorName, competitorDomains] of competitorMap.entries()) {
    const overlap = calculateOverlap(dealsptrDomains, competitorDomains);
    overlap.competitorName = competitorName;
    results.push(overlap);
  }

  // Sort results by overlap percentage in descending order, but place zero-domain competitors at the end
  return results.sort((a, b) => {
    // If either has zero domains, sort it to the end
    if (a.totalDomains === 0 && b.totalDomains === 0) return 0;
    if (a.totalDomains === 0) return 1;
    if (b.totalDomains === 0) return -1;

    // Normal sort by percentage for non-zero domain competitors
    return b.overlapPercentage - a.overlapPercentage;
  });
}
