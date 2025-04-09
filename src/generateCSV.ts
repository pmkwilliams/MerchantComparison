import fs from "fs-extra";
import path from "path";
import { createObjectCsvWriter } from "csv-writer";
import {
  processDirectory,
  parseSitemapFile,
  extractDomainsFromSitemap,
  extractDomain,
} from "./sitemapParser";

interface CsvRow {
  loc: string;
  Match_Status: string;
  domain: string;
  dealspotr_loc: string;
}

/**
 * Builds a map of domain names to their DealsPotr URLs
 */
async function buildDealsptrDomainUrlMap(
  dealsptrFiles: string[]
): Promise<Map<string, string>> {
  console.log("Building DealsPotr domain to URL lookup map...");
  const domainUrlMap = new Map<string, string>();

  for (const file of dealsptrFiles) {
    const sitemap = await parseSitemapFile(file, path.basename(file, ".xml"));

    for (const url of sitemap.urls) {
      const extractedDomain = extractDomain(url.loc);
      if (extractedDomain) {
        // Store the first URL we find for each domain (if multiple exist)
        if (!domainUrlMap.has(extractedDomain.name)) {
          domainUrlMap.set(extractedDomain.name, url.loc);
        }
      }
    }
  }

  console.log(`Built lookup map with ${domainUrlMap.size} entries`);
  return domainUrlMap;
}

/**
 * Process a single sitemap file and return rows for CSV
 */
async function processSitemapFile(
  sitemapFile: string,
  sourceName: string,
  dealsptrDomains: Set<string>,
  domainUrlMap: Map<string, string>
): Promise<CsvRow[]> {
  const sitemap = await parseSitemapFile(sitemapFile, sourceName);
  const rows: CsvRow[] = [];

  // Process each URL in the sitemap
  for (const url of sitemap.urls) {
    const domainObj = extractDomain(url.loc);

    if (domainObj) {
      const domain = domainObj.name;
      const isMatched = dealsptrDomains.has(domain);
      const matchStatus = isMatched ? "Matched" : "Not Matched";

      // Get the corresponding DealsPotr URL from our map
      const dealsptrUrl = isMatched ? domainUrlMap.get(domain) || "" : "";

      rows.push({
        loc: url.loc,
        Match_Status: matchStatus,
        domain,
        dealspotr_loc: dealsptrUrl,
      });
    }
  }

  return rows;
}

/**
 * Generate a single CSV file for a competitor, combining all their sitemap files
 */
async function generateCompetitorCsv(
  competitorName: string,
  sitemapFiles: string[],
  dealsptrDomains: Set<string>,
  domainUrlMap: Map<string, string>
) {
  console.log(
    `Generating CSV for ${competitorName} (${sitemapFiles.length} sitemaps)...`
  );

  // Process all sitemap files
  let allRows: CsvRow[] = [];

  for (const file of sitemapFiles) {
    const fileName = path.basename(file, ".xml");
    console.log(`  Processing ${fileName}...`);
    const rows = await processSitemapFile(
      file,
      fileName,
      dealsptrDomains,
      domainUrlMap
    );
    allRows = allRows.concat(rows);
  }

  // Create output directory if it doesn't exist
  const outputDir = "output";
  const csvOutputDir = path.join(outputDir, "csv-output");
  await fs.ensureDir(csvOutputDir);

  // Create CSV writer
  const csvWriter = createObjectCsvWriter({
    path: path.join(csvOutputDir, `${competitorName}-comparison.csv`),
    header: [
      { id: "loc", title: "URL" },
      { id: "Match_Status", title: "Match_Status" },
      { id: "domain", title: "domain" },
      { id: "dealspotr_loc", title: "dealspotr loc" },
    ],
  });

  // Write CSV
  await csvWriter.writeRecords(allRows);
  console.log(
    `CSV file generated: ${csvOutputDir}/${competitorName}-comparison.csv with ${allRows.length} entries`
  );
}

async function main() {
  try {
    console.time("Total execution time");

    // First get all DealsPotr domains
    console.log("Processing DealsPotr sitemaps...");
    const dealsptrFiles = await fs.readdir("dealspotr");
    const dealsptrFilePaths = dealsptrFiles
      .filter((file) => file.endsWith(".xml"))
      .map((file) => path.join("dealspotr", file));

    // Extract all DealsPotr domains
    const dealsptrDomains = await processDirectory("dealspotr", "DealsPotr");
    console.log(`Found ${dealsptrDomains.size} unique domains in DealsPotr`);

    // Build lookup map from domain to DealsPotr URL
    const domainUrlMap = await buildDealsptrDomainUrlMap(dealsptrFilePaths);

    // Group competitor files by competitor name
    const competitorGroups = new Map<string, string[]>();

    // Process direct competitor files
    const competitorDir = "competitors";
    const directCompetitors = (await fs.readdir(competitorDir))
      .filter((item) => item.endsWith(".xml") && !item.startsWith("."))
      .map((file) => {
        const filePath = path.join(competitorDir, file);
        // Extract base competitor name without numbers or special chars
        const baseName = path
          .basename(file, ".xml")
          .replace(/[\(\d+,\d+\)]/g, "") // Remove (numbers) from name
          .replace(/-\d+$/, ""); // Remove trailing numbers

        // Add to groups
        if (!competitorGroups.has(baseName)) {
          competitorGroups.set(baseName, []);
        }
        competitorGroups.get(baseName)!.push(filePath);

        return {
          name: baseName,
          path: filePath,
        };
      });

    // Process competitor subdirectories
    const subdirectories = (
      await fs.readdir(competitorDir, { withFileTypes: true })
    ).filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."));

    for (const subdir of subdirectories) {
      const subdirPath = path.join(competitorDir, subdir.name);
      const files = await fs.readdir(subdirPath);

      // Get base competitor name
      const baseName = subdir.name
        .replace(/[\(\d+,\d+\)]/g, "") // Remove (numbers) from name
        .replace(/-\d+$/, ""); // Remove trailing numbers

      // Initialize the group if needed
      if (!competitorGroups.has(baseName)) {
        competitorGroups.set(baseName, []);
      }

      // Add all XML files from this directory
      const xmlFiles = files
        .filter((f) => f.endsWith(".xml") && !f.startsWith("."))
        .map((f) => path.join(subdirPath, f));

      competitorGroups.get(baseName)!.push(...xmlFiles);
    }

    // Generate one CSV per competitor
    for (const [competitor, files] of competitorGroups.entries()) {
      await generateCompetitorCsv(
        competitor,
        files,
        dealsptrDomains,
        domainUrlMap
      );
    }

    console.log("All CSV files generated successfully!");
    console.timeEnd("Total execution time");
  } catch (error) {
    console.error("Error generating CSVs:", error);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
