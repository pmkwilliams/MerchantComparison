import fs from "fs-extra";
import path from "path";
import { createObjectCsvWriter } from "csv-writer";
import {
  processDirectory,
  parseSitemapFile,
  extractDomainsFromSitemap,
  extractDomain,
} from "./sitemapParser";
import { compareAllCompetitors } from "./comparison";
import { AnalysisResult, CompetitorOverlap } from "./types";

interface MerchantRecord {
  url: string;
  urlPath: string;
  status: string;
  attempts: number;
  storeName: string;
  hasAmazonDeal: boolean;
  dataId: string | null;
  screenshotUrl: string | null;
  lastAttempt: string;
  processedAt: string;
}

interface ScrapeState {
  totalLinks: number;
  pagesWithAmazonDeals: number;
  totalSitemapPages: number;
  scrapedSitemapPages: number;
  extractedAt: string;
  lastUpdated: string;
  testMode: boolean;
  merchantRecords: MerchantRecord[];
}

interface ComparisonRecord {
  URL: string;
  Match_Status: string;
  Last_Segment: string;
  "3rd Party Link": boolean;
  "Match URL": string;
  dataId: string | null;
  Merchant_Name: string | null;
}

/**
 * Extract domains from scrape-state.json
 */
async function extractDomainsFromScrapeState(
  scrapeStateFilePath: string
): Promise<Set<string>> {
  console.log(`Reading domains from ${scrapeStateFilePath}...`);

  try {
    // Create a read stream for the scrape-state.json file
    const data = (await fs.readJSON(scrapeStateFilePath)) as ScrapeState;

    const domains = new Set<string>();

    // Log the total links from the scrape-state summary data
    console.log(`Total links in scrape-state: ${data.totalLinks}`);

    console.log(
      `\nProcessing ${data.merchantRecords.length} records from scrape-state.json...`
    );

    // Extract urlPath from each merchant record
    for (const record of data.merchantRecords) {
      domains.add(record.urlPath);
    }

    console.log(`Found ${domains.size} unique domains in scrape-state.json`);
    return domains;
  } catch (error) {
    console.error(`Error reading scrape-state.json:`, error);
    return new Set<string>();
  }
}

/**
 * Builds a map of domain names to their DealsPotr URLs
 */
async function buildDealsptrDomainUrlMap(
  dealsptrDomains: Set<string>
): Promise<Map<string, string>> {
  console.log("Building DealsPotr domain to URL lookup map...");
  const domainUrlMap = new Map<string, string>();

  // Find all sitemap files in the dealspotr directory
  const dealsptrFiles = (await fs.readdir("dealspotr"))
    .filter((file) => file.endsWith(".xml"))
    .map((file) => path.join("dealspotr", file));

  for (const file of dealsptrFiles) {
    const sitemap = await parseSitemapFile(file, path.basename(file, ".xml"));

    for (const url of sitemap.urls) {
      const extractedDomain = extractDomain(url.loc);
      if (extractedDomain && dealsptrDomains.has(extractedDomain.name)) {
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
 * Export a set of domains to a CSV file
 */
async function exportDomainsToCSV(
  domains: Set<string>,
  outputPath: string,
  title: string
): Promise<void> {
  console.log(`Exporting ${domains.size} ${title} to ${outputPath}...`);

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [{ id: "domain", title: "Domain" }],
  });

  const records = Array.from(domains).map((domain) => ({ domain }));

  await csvWriter.writeRecords(records);
  console.log(`Exported ${domains.size} domains to ${outputPath}`);
}

/**
 * Generate comparison records from scrape state
 */
function generateComparisonRecords(
  scrapeState: ScrapeState,
  dealsptrDomains: Set<string>,
  dealsptrUrlMap: Map<string, string>
): ComparisonRecord[] {
  return scrapeState.merchantRecords
    .filter((record) => record.urlPath)
    .map((record) => {
      const domain = record.urlPath;
      const isMatched = dealsptrDomains.has(domain);
      return {
        URL: record.url,
        Match_Status: isMatched ? "Matched" : "Not Matched",
        Last_Segment: domain,
        "3rd Party Link": record.hasAmazonDeal || false,
        "Match URL": isMatched ? dealsptrUrlMap.get(domain) || "" : "",
        dataId: record.dataId,
        Merchant_Name: record.storeName || null,
      };
    });
}

/**
 * Export comparison data to CSV and JSON
 */
async function exportComparisonData(
  scrapeState: ScrapeState,
  dealsptrDomains: Set<string>,
  dealsptrUrlMap: Map<string, string>,
  csvOutputPath: string,
  jsonOutputPath: string,
  competitorResults: CompetitorOverlap[]
): Promise<void> {
  console.log(`Exporting comparison data to CSV and JSON...`);

  const records = generateComparisonRecords(
    scrapeState,
    dealsptrDomains,
    dealsptrUrlMap
  );

  // Calculate overlapping merchants with Amazon deals
  const overlappingRecords = records.filter(
    (record) => record.Match_Status === "Matched"
  );
  const overlappingWithAmazonDeals = overlappingRecords.filter(
    (record) => record["3rd Party Link"] === true
  );
  const amazonDealPercentage =
    overlappingRecords.length > 0
      ? (overlappingWithAmazonDeals.length / overlappingRecords.length) * 100
      : 0;

  // Export to CSV
  const csvWriter = createObjectCsvWriter({
    path: csvOutputPath,
    header: [
      { id: "URL", title: "URL" },
      { id: "Match_Status", title: "Match_Status" },
      { id: "Last_Segment", title: "Last_Segment" },
      { id: "3rd Party Link", title: "3rd Party Link" },
      { id: "Match URL", title: "Match URL" },
      { id: "dataId", title: "dataId" },
      { id: "Merchant_Name", title: "Merchant Name" },
    ],
  });

  await csvWriter.writeRecords(records);
  console.log(`Exported ${records.length} records to ${csvOutputPath}`);

  // Create combined JSON with summary and records
  const combinedJson = {
    summary: {
      dealsptrDomainsCount: dealsptrDomains.size,
      dontpayfullDomainsCount: scrapeState.merchantRecords.length,
      overlappingDomainsCount: competitorResults[0].overlappingDomains,
      overlapPercentage: competitorResults[0].overlapPercentage,
      overlappingWithAmazonDealsCount: overlappingWithAmazonDeals.length,
      inOverlapAmazonDealPercentage: parseFloat(
        amazonDealPercentage.toFixed(2)
      ),
      extractedAt: scrapeState.extractedAt,
      lastUpdated: new Date().toISOString(),
    },
    records: records,
  };

  // Export to JSON
  await fs.writeJSON(jsonOutputPath, combinedJson, { spaces: 2 });
  console.log(
    `Exported combined summary and ${records.length} records to ${jsonOutputPath}`
  );
  console.log(
    `Found ${
      overlappingWithAmazonDeals.length
    } overlapping merchants with Amazon deals (${amazonDealPercentage.toFixed(
      2
    )}%)`
  );
}

async function main() {
  try {
    console.time("Total execution time");

    // Process DealsPotr sitemaps
    console.log("Processing DealsPotr sitemaps...");
    const dealsptrDomains = await processDirectory("dealspotr", "DealsPotr");
    console.log(`Found ${dealsptrDomains.size} unique domains in DealsPotr`);

    // Build a map of domain names to DealsPotr URLs
    const dealsptrUrlMap = await buildDealsptrDomainUrlMap(dealsptrDomains);

    // Extract domains from scrape-state.json
    const scrapeStateFilePath = path.join("output", "scrape-state.json");
    const scrapeStateData = (await fs.readJSON(
      scrapeStateFilePath
    )) as ScrapeState;
    const scrapeStateDomains = await extractDomainsFromScrapeState(
      scrapeStateFilePath
    );

    // Create a Map to use with the comparison function
    const competitorMap = new Map<string, Set<string>>();
    competitorMap.set("ScrapeState", scrapeStateDomains);

    // Compare DealsPotr against scrape-state domains
    console.log(
      "\nCalculating domain overlap between DealsPotr and scrape-state domains..."
    );
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

    console.log("\nScrape State Overlap:");
    console.log("----------------------------------------");
    console.log("Source | Total Domains | Overlapping | Percentage");
    console.log("----------------------------------------");

    for (const competitor of competitorResults) {
      console.log(
        `${competitor.competitorName.padEnd(20)} | ` +
          `${competitor.totalDomains.toString().padEnd(13)} | ` +
          `${competitor.overlappingDomains.toString().padEnd(11)} | ` +
          `${competitor.overlapPercentage.toFixed(2)}%`
      );
    }

    // Find unique domains in DealsPotr that aren't in scrape-state
    const uniqueInDealspotr = new Set<string>();
    for (const domain of dealsptrDomains) {
      if (!scrapeStateDomains.has(domain)) {
        uniqueInDealspotr.add(domain);
      }
    }

    // Find unique domains in scrape-state that aren't in DealsPotr
    const uniqueInScrapeState = new Set<string>();
    for (const domain of scrapeStateDomains) {
      if (!dealsptrDomains.has(domain)) {
        uniqueInScrapeState.add(domain);
      }
    }

    console.log(`\nUnique domains in DealsPotr: ${uniqueInDealspotr.size}`);
    console.log(`Unique domains in ScrapeState: ${uniqueInScrapeState.size}`);

    // Create output directory if it doesn't exist
    const outputDir = "output";
    const csvOutputDir = path.join(outputDir, "csv-output");
    await fs.ensureDir(outputDir);
    await fs.ensureDir(csvOutputDir);

    // Export comprehensive data with all domains from scrape-state as both CSV and JSON
    await exportComparisonData(
      scrapeStateData,
      dealsptrDomains,
      dealsptrUrlMap,
      path.join(csvOutputDir, "dontpayfull.com-comparison.csv"),
      path.join(outputDir, "dontpayfull.com-comparison.json"),
      competitorResults
    );

    console.log(
      `\nResults saved to ${outputDir}/dontpayfull.com-comparison.json`
    );
    console.timeEnd("Total execution time");
  } catch (error) {
    console.error("Error in main execution:", error);
  }
}

main().catch((err) => {
  console.error("Unhandled error in main:", err);
  process.exit(1);
});
