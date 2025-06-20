import fs from "fs-extra";
import path from "path";
import dotenv from "dotenv";
import { JSDOM } from "jsdom";

// Unified record for each merchant URL
interface MerchantRecord {
  url: string;
  urlPath: string;
  status: "pending" | "completed" | "failed";
  attempts: number;
  processedAt?: string; // Timestamp when successfully processed
  lastAttempt?: string; // Timestamp of the last attempt (successful or failed)
  storeName?: string | null; // Extracted store name
  hasAmazonDeal?: boolean | null; // This might not be relevant for Refermate
  dataId?: string | null; // This might not be relevant for Refermate
  screenshotUrl?: string | null;
}

// Overall state of the scraping process
interface ScrapeState {
  totalLinks: number;
  pendingLinks: number;
  completedLinks: number;
  failedLinks: number;
  pagesWithAmazonDeals: number;
  totalSitemapPages: number;
  scrapedSitemapPages: number;
  extractedAt: string;
  lastUpdated: string;
  testMode: boolean;
  merchantRecords: MerchantRecord[];
}

// Load environment variables
dotenv.config();

/**
 * Parses an XML sitemap and extracts URLs.
 * @param sitemapContent The XML content of the sitemap.
 * @returns An array of URLs.
 */
function parseSitemap(sitemapContent: string): string[] {
  const dom = new JSDOM(sitemapContent, { contentType: "application/xml" });
  const locs = dom.window.document.getElementsByTagName("loc");
  console.log(locs[0]);
  const urls = Array.from(locs).map((loc) => loc.textContent || "");
  console.log("urls", urls.length);
  return urls;
}

/**
 * Extract merchant links from Refermate sitemaps.
 * @param testMode If true, only process a small number of links for testing.
 */
async function extractRefermateLinks(
  testMode = false
): Promise<MerchantRecord[]> {
  try {
    console.time("Total execution time");

    const sitemapPaths = [
      path.join("refermate", "sitemap1.xml"),
      path.join("refermate", "sitemap2.xml"),
    ];

    let allLinks: string[] = [];
    console.log("Reading and parsing sitemaps...");

    for (const sitemapPath of sitemapPaths) {
      if (!fs.existsSync(sitemapPath)) {
        console.warn(`Sitemap not found at ${sitemapPath}, skipping.`);
        continue;
      }
      const sitemapContent = await fs.readFile(sitemapPath, "utf-8");
      const urls = parseSitemap(sitemapContent);
      console.log("urls", urls.length);
      allLinks.push(...urls);
      console.log(allLinks);
      console.log(`Found ${urls.length} links in ${sitemapPath}`);
    }

    console.log(`Found a total of ${allLinks.length} links in all sitemaps.`);

    // Filter for merchant links
    const merchantLinks = allLinks.filter(
      (link) =>
        typeof link === "string" &&
        link.startsWith("https://refermate.com/stores/") &&
        link.endsWith("-promo-codes")
    );

    console.log(
      `Extracted ${merchantLinks.length} merchant links from sitemaps.`
    );

    // Clean and deduplicate merchant links
    const cleanedLinks = merchantLinks
      .map((link) => link.split("?")[0].split("#")[0]) // Remove query params and fragments
      .filter(Boolean); // Remove any empty strings

    let uniqueLinks = [...new Set(cleanedLinks)];

    if (testMode) {
      console.log("TEST MODE: Using only the first 50 links.");
      uniqueLinks = uniqueLinks.slice(0, 50);
    }

    // Transform to the new MerchantRecord format
    const initialMerchantRecords: MerchantRecord[] = uniqueLinks.map((url) => {
      const urlPath = url.substring(
        url.indexOf("/stores/") + "/stores/".length
      );
      return {
        url,
        urlPath,
        status: "pending",
        attempts: 0,
      };
    });

    console.log(
      `After deduplication: ${uniqueLinks.length} unique merchant links.`
    );

    // Create output directory if it doesn't exist
    const outputDir = "output";
    await fs.ensureDir(outputDir);

    // Define the single state file path
    const filePrefix = testMode ? "test-" : "";
    const stateFilePath = path.join(
      outputDir,
      `${filePrefix}refermate-scrape-state.json`
    );

    // Prepare the initial scrape state
    const initialState: ScrapeState = {
      totalLinks: initialMerchantRecords.length,
      pendingLinks: initialMerchantRecords.length,
      completedLinks: 0,
      failedLinks: 0,
      pagesWithAmazonDeals: 0, // Not applicable for refermate initially
      totalSitemapPages: sitemapPaths.length,
      scrapedSitemapPages: sitemapPaths.length,
      extractedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      testMode: testMode,
      merchantRecords: initialMerchantRecords,
    };

    // Save the initial state to the JSON file
    await fs.writeJSON(stateFilePath, initialState, { spaces: 2 });

    console.log(`\nInitial scrape state saved to: ${stateFilePath}`);

    console.timeEnd("Total execution time");

    return initialMerchantRecords;
  } catch (error) {
    console.error("Error extracting Refermate links:", error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const testMode = args.includes("--test");

    if (testMode) {
      console.log("Starting Refermate link extractor in TEST MODE.");
    } else {
      console.log("Starting Refermate link extractor in FULL MODE.");
    }

    const records = await extractRefermateLinks(testMode);
    console.log(
      `Successfully extracted ${records.length} initial merchant records.`
    );

    if (records.length > 0) {
      console.log("\nSample of initial merchant records:");
      records
        .slice(0, 10)
        .forEach((record) =>
          console.log(`  - ${record.url} (${record.status})`)
        );
    }
  } catch (error) {
    console.error("Unhandled error in main:", error);
    process.exit(1);
  }
}

main();
