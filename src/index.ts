import fs from "fs-extra";
import path from "path";
import {
  processDirectory,
  parseSitemapFile,
  extractDomainsFromSitemap,
} from "./sitemapParser";
import { compareAllCompetitors } from "./comparison";
import { AnalysisResult } from "./types";

/**
 * Find unique domains in DealsPotr that no competitors have
 */
function findUniqueDomainsInDealsPotr(
  dealsptrDomains: Set<string>,
  competitorDomainSets: Map<string, Set<string>>
): string[] {
  // Combine all competitor domains into one set
  const allCompetitorDomains = new Set<string>();
  for (const domains of competitorDomainSets.values()) {
    domains.forEach((domain) => allCompetitorDomains.add(domain));
  }

  // Find domains in DealsPotr that aren't in any competitor's set
  const uniqueDomains: string[] = [];
  for (const domain of dealsptrDomains) {
    if (!allCompetitorDomains.has(domain)) {
      uniqueDomains.push(domain);
    }
  }

  return uniqueDomains;
}

async function main() {
  try {
    console.time("Total execution time");

    // Process DealsPotr sitemaps
    console.log("Processing DealsPotr sitemaps...");
    const dealsptrDomains = await processDirectory("dealspotr", "DealsPotr");
    console.log(`Found ${dealsptrDomains.size} unique domains in DealsPotr`);

    // Process competitors sitemaps
    console.log("\nProcessing competitor sitemaps...");
    const competitorMap = new Map<string, Set<string>>();

    // Get all direct competitor XML files
    const competitorDir = "competitors";
    const directCompetitors = (await fs.readdir(competitorDir))
      .filter((item) => item.endsWith(".xml") && !item.startsWith("."))
      .map((file) => ({
        name: path.basename(file, ".xml"),
        path: path.join(competitorDir, file),
      }));

    // Process each direct competitor XML file
    for (const competitor of directCompetitors) {
      console.log(`Processing competitor file: ${competitor.name}`);
      try {
        // Parse the individual XML file
        const sitemap = await parseSitemapFile(
          competitor.path,
          competitor.name
        );
        const domains = extractDomainsFromSitemap(sitemap);

        console.log(`Found ${domains.size} domains in ${competitor.name}`);
        competitorMap.set(competitor.name, domains);
      } catch (error) {
        console.error(`Error processing ${competitor.path}:`, error);
        competitorMap.set(competitor.name, new Set<string>());
      }
    }

    // Get all competitor subdirectories
    const subdirectories = (
      await fs.readdir(competitorDir, { withFileTypes: true })
    )
      .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
      .map((dirent) => ({
        name: dirent.name,
        path: path.join(competitorDir, dirent.name),
      }));

    // Process each competitor subdirectory
    for (const subdir of subdirectories) {
      const domains = await processDirectory(subdir.path, subdir.name);
      competitorMap.set(subdir.name, domains);
    }

    // Compare DealsPotr against all competitors
    console.log("\nCalculating domain overlap with competitors...");
    const competitorResults = compareAllCompetitors(
      dealsptrDomains,
      competitorMap
    );

    // Build the final result
    const result: AnalysisResult = {
      dealsptrDomains,
      competitorResults,
    };

    // Output the results
    console.log("\n--- Domain Overlap Analysis Results ---");
    console.log(`DealsPotr has ${dealsptrDomains.size} unique domains`);
    // console.log(`Average overlap with competitors: ${averageOverlap}%`);

    console.log("\nCompetitor Overlap (sorted by percentage):");
    console.log("----------------------------------------");
    console.log("Competitor | Total Domains | Overlapping | Percentage");
    console.log("----------------------------------------");

    for (const competitor of competitorResults) {
      console.log(
        `${competitor.competitorName.padEnd(20)} | ` +
          `${competitor.totalDomains.toString().padEnd(13)} | ` +
          `${competitor.overlappingDomains.toString().padEnd(11)} | ` +
          `${competitor.overlapPercentage.toFixed(2)}%`
      );
    }

    // Create output directory if it doesn't exist
    const outputDir = "output";
    await fs.ensureDir(outputDir);

    // Save results to file
    await fs.writeJSON(
      path.join(outputDir, "domain-overlap-results.json"),
      {
        dealsptrDomainsCount: dealsptrDomains.size,
        competitors: competitorResults,
      },
      { spaces: 2 }
    );

    console.log(`\nResults saved to ${outputDir}/domain-overlap-results.json`);
    console.timeEnd("Total execution time");
  } catch (error) {
    console.error("Error in main execution:", error);
  }
}

main().catch((err) => {
  console.error("Unhandled error in main:", err);
  process.exit(1);
});
