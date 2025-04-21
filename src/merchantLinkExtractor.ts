import fs from "fs-extra";
import path from "path";
import dotenv from "dotenv";
import FirecrawlApp from "@mendable/firecrawl-js";

interface ScrapeResponse {
  links?: string[];
  metadata?: {
    sourceURL?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

// Unified record for each merchant URL
interface MerchantRecord {
  url: string;
  urlPath: string;
  status: "pending" | "completed" | "failed";
  attempts: number;
  processedAt?: string; // Timestamp when successfully processed
  lastAttempt?: string; // Timestamp of the last attempt (successful or failed)
  storeName?: string | null; // Extracted store name
  hasAmazonDeal?: boolean | null; // Presence of li.rel-merch
  dataId?: string | null; // data-id from rel-merch element
  screenshotUrl?: string | null; // Screenshot URL (if captured)
}

// Overall state of the scraping process
interface ScrapeState {
  totalLinks: number;
  pendingLinks: number;
  completedLinks: number;
  failedLinks: number;
  pagesWithAmazonDeals: number;
  totalSitemapPages: number;
  scrapedSitemapPages: number; // Renamed from scrapedPages for clarity
  extractedAt: string; // Timestamp when links were first extracted
  lastUpdated: string; // Timestamp when this state file was last saved
  testMode: boolean;
  merchantRecords: MerchantRecord[]; // Changed from merchantLinks
}

// Load environment variables
dotenv.config();

/**
 * Extract merchant links from DontPayFull using Firecrawl
 * @param testMode If true, only process a small number of pages for testing
 */
async function extractMerchantLinks(
  testMode = false
): Promise<MerchantRecord[]> {
  try {
    console.time("Total execution time");

    // Initialize Firecrawl with API key from environment variables
    const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
    console.log("Initialized FirecrawlApp with API key");

    // Create sitemap URLs for each letter (a-z) and numbers (0-9)
    const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
    const sitemapURLs = [
      ...alphabet.map(
        (letter) => `https://www.dontpayfull.com/sitemap/${letter}`
      ),
      "https://www.dontpayfull.com/sitemap/0-9",
    ];

    // If in test mode, only use a few letters
    const urlsToScrape = testMode
      ? sitemapURLs.slice(0, 2) // Just first 2 in test mode
      : sitemapURLs;

    console.log(
      `Will scrape ${urlsToScrape.length} sitemap pages${
        testMode ? " (TEST MODE)" : ""
      }`
    );

    console.log("Starting batch scrape...");

    // Use batch scrape instead of individual scrapes
    const batchResponse = await app.batchScrapeUrls(urlsToScrape, {
      formats: ["links"],
    });

    // Process batch results
    const allResults: ScrapeResponse[] = [];

    if (
      batchResponse &&
      batchResponse.success &&
      Array.isArray(batchResponse.data)
    ) {
      console.log(
        `Batch scrape completed. Received ${batchResponse.data.length} results.`
      );

      batchResponse.data.forEach((result, index) => {
        const url = urlsToScrape[index];
        if (result && result.links) {
          console.log(`Scraped ${result.links.length || 0} links from ${url}`);
          allResults.push(result as ScrapeResponse);
        } else {
          console.error(`Error or no links in response for ${url}`);
        }
      });
    } else {
      console.error("Invalid batch scrape response format:", batchResponse);
    }

    console.log(`Successfully scraped ${allResults.length} pages`);

    // Extract merchant links from all results
    let totalLinksFound = 0;
    const allMerchantLinks: string[] = [];

    allResults.forEach((result, index) => {
      // Ensure result.links exists
      if (!result.links) {
        console.warn(`No links found in result ${index + 1}`);
        return;
      }

      const links = result.links || [];
      totalLinksFound += links.length;

      // Get the original URL for this result
      const sourceURL = result.metadata?.sourceURL || `Page ${index + 1}`;
      console.log(`Processing ${sourceURL}, found ${links.length} total links`);

      // Filter for merchant links
      const merchantLinks = links.filter(
        (link: string) =>
          typeof link === "string" &&
          link.match(/https?:\/\/www\.dontpayfull\.com\/at\/.+/)
      );

      console.log(
        `Extracted ${merchantLinks.length} merchant links from ${sourceURL}`
      );
      allMerchantLinks.push(...merchantLinks);
    });

    // Clean and deduplicate merchant links
    const cleanedLinks = allMerchantLinks
      .map((link) => link.split("#")[0]) // Remove fragments
      .filter((link) => !link.includes("?")); // Remove query parameters

    const uniqueLinks = [...new Set(cleanedLinks)];

    // Transform to the new MerchantRecord format
    const initialMerchantRecords: MerchantRecord[] = uniqueLinks.map((url) => {
      const urlPath = url.split("/at/")[1];
      return {
        url,
        urlPath,
        status: "pending",
        attempts: 0,
        processedAt: undefined,
        lastAttempt: undefined,
        storeName: null, // Initialize extra fields as null/undefined
        hasAmazonDeal: null,
        dataId: null,
        screenshotUrl: null,
      };
    });

    console.log(`\nFound ${allMerchantLinks.length} total merchant links`);
    console.log(
      `After deduplication: ${uniqueLinks.length} unique merchant links`
    );
    console.log(
      `Scraped ${totalLinksFound} total links from ${allResults.length} sitemap pages`
    );

    // Create output directory if it doesn't exist
    const outputDir = "output";
    await fs.ensureDir(outputDir);

    // Define the single state file path
    const filePrefix = testMode ? "test-" : "";
    const stateFilePath = path.join(
      outputDir,
      `${filePrefix}scrape-state.json`
    );

    // Prepare the initial scrape state
    const initialState: ScrapeState = {
      totalLinks: initialMerchantRecords.length,
      pendingLinks: initialMerchantRecords.length,
      completedLinks: 0,
      failedLinks: 0,
      pagesWithAmazonDeals: 0,
      totalSitemapPages: urlsToScrape.length,
      scrapedSitemapPages: allResults.length,
      extractedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      testMode: testMode,
      merchantRecords: initialMerchantRecords,
    };

    // Save the initial state to the JSON file
    await fs.writeJSON(stateFilePath, initialState, { spaces: 2 });

    console.log(`\nInitial scrape state saved to: ${stateFilePath}`);

    console.timeEnd("Total execution time");

    return initialMerchantRecords; // Return the created records
  } catch (error) {
    console.error("Error extracting merchant links:", error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    const testMode = args.includes("--test");

    if (testMode) {
      console.log(
        "Starting merchant link extractor in TEST MODE - processing only first 2 sitemap pages"
      );
      console.log("Remove --test flag to scrape all sitemap pages");
    } else {
      console.log(
        "Starting merchant link extractor in FULL MODE - processing all sitemap pages"
      );
      console.log("Use --test flag to scrape only the first 2 sitemap pages");
    }

    const records = await extractMerchantLinks(testMode);
    console.log(
      `Successfully extracted ${records.length} initial merchant records`
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

// Run the main function
main();
