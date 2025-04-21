import fs from "fs-extra";
import path from "path";
import dotenv from "dotenv";
import FirecrawlApp from "@mendable/firecrawl-js";
import { JSDOM } from "jsdom";

// Load environment variables
dotenv.config();

// Define interfaces
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

// Interface for Firecrawl's scrape response (simplified)
interface ScrapedPage {
  html?: string;
  metadata?: {
    sourceURL?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

// Removed old interfaces: MerchantData, TrackableMerchantLink, TrackableMerchantLinksFile

/**
 * Saves the current scrape state to the JSON file.
 * @param state The current ScrapeState object.
 * @param filePath The path to the state file.
 */
async function saveScrapeState(state: ScrapeState, filePath: string) {
  state.lastUpdated = new Date().toISOString();
  // Recalculate counts before saving
  state.completedLinks = state.merchantRecords.filter(
    (r) => r.status === "completed"
  ).length;
  state.failedLinks = state.merchantRecords.filter(
    (r) => r.status === "failed"
  ).length;
  state.pendingLinks =
    state.totalLinks - state.completedLinks - state.failedLinks;
  // Calculate pages with Amazon deals
  state.pagesWithAmazonDeals = state.merchantRecords.filter(
    (r) => r.hasAmazonDeal === true
  ).length;

  // Create a new object with the desired field order
  const orderedState = {
    totalLinks: state.totalLinks,
    pendingLinks: state.pendingLinks,
    completedLinks: state.completedLinks,
    failedLinks: state.failedLinks,
    pagesWithAmazonDeals: state.pagesWithAmazonDeals,
    totalSitemapPages: state.totalSitemapPages,
    scrapedSitemapPages: state.scrapedSitemapPages,
    extractedAt: state.extractedAt,
    lastUpdated: state.lastUpdated,
    testMode: state.testMode,
    merchantRecords: state.merchantRecords,
  };

  await fs.writeJSON(filePath, orderedState, { spaces: 2 });

  // Log progress
  console.log(`\nUpdated scrape state saved to ${filePath}:`);
  console.log(
    `  - Total completed: ${state.completedLinks}/${state.totalLinks} (${(
      (state.completedLinks / state.totalLinks) *
      100
    ).toFixed(2)}%)`
  );
  console.log(
    `  - Total failed: ${state.failedLinks}/${state.totalLinks} (${(
      (state.failedLinks / state.totalLinks) *
      100
    ).toFixed(2)}%)`
  );
  console.log(
    `  - Remaining pending: ${state.pendingLinks}/${state.totalLinks} (${(
      (state.pendingLinks / state.totalLinks) *
      100
    ).toFixed(2)}%)`
  );
  console.log(`  - Pages with Amazon deals: ${state.pagesWithAmazonDeals}`);
}

// Removed old function: updateMerchantLinkStatus

/**
 * Extracts merchant page information using Firecrawl and updates the state
 * @param recordsToProcess Array of MerchantRecord objects to scrape
 * @param scrapeState The complete ScrapeState object (will be modified in place)
 * @param stateFilePath The path to the state file for saving progress
 */
async function scrapeMerchantPages(
  recordsToProcess: MerchantRecord[],
  scrapeState: ScrapeState,
  stateFilePath: string
) {
  try {
    console.time("Total execution time for batch");

    const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
    console.log("Initialized FirecrawlApp with API key");

    console.log(
      `Will scrape ${recordsToProcess.length} merchant pages${
        scrapeState.testMode ? " (TEST MODE)" : ""
      }`
    );

    const batchSize = 50;
    let processedCount = 0;

    const recordMap = new Map<string, MerchantRecord>();
    scrapeState.merchantRecords.forEach((record) => {
      recordMap.set(record.url, record);
    });

    for (let i = 0; i < recordsToProcess.length; i += batchSize) {
      const batchRecords = recordsToProcess.slice(i, i + batchSize);
      const batchUrls = batchRecords.map((record) => record.url);

      console.log(
        `\nProcessing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(
          recordsToProcess.length / batchSize
        )} (URLs ${i + 1} to ${Math.min(
          i + batchSize,
          recordsToProcess.length
        )})`
      );
      console.log(`Batch contains ${batchUrls.length} URLs`);

      const batchResults = new Map<
        string,
        { success: boolean; error?: string }
      >();

      try {
        console.log("Starting batch scrape...");
        const batchResponse = await app.batchScrapeUrls(batchUrls, {
          formats: ["html"],
        });

        if (
          batchResponse &&
          batchResponse.success &&
          Array.isArray(batchResponse.data)
        ) {
          console.log(
            `Batch scrape completed. Received ${batchResponse.data.length} results.`
          );

          const responseMap = new Map<string, ScrapedPage>();
          batchResponse.data.forEach((result: ScrapedPage) => {
            if (result.metadata?.sourceURL) {
              responseMap.set(result.metadata.sourceURL, result);
            }
          });

          for (const url of batchUrls) {
            const record = recordMap.get(url);
            if (!record) {
              console.warn(`Record not found in state for URL: ${url}`);
              continue;
            }

            const result = responseMap.get(url);
            const now = new Date().toISOString();
            record.lastAttempt = now;

            if (!result) {
              console.error(`No scrape result found for URL: ${url}`);
              batchResults.set(url, {
                success: false,
                error: "No matching result found in batch response",
              });
            } else if (result.html) {
              try {
                const dom = new JSDOM(result.html);
                const doc = dom.window.document;

                let storeName: string | null = null;
                const storeHeader = doc.getElementById("storeHeader");
                if (storeHeader) {
                  const fullText = storeHeader.textContent?.trim() || "";
                  const storeNameMatch = fullText.match(
                    /^(.*?)(Promo Codes|Discount Codes|Coupons|$)/
                  );
                  storeName =
                    storeNameMatch && storeNameMatch[1]
                      ? storeNameMatch[1].trim()
                      : fullText.split(/\d/)[0].trim() || null;
                }

                let hasAmazonDeal: boolean | null = false;
                let dataId: string | null = null;
                const relMerchElements = doc.querySelectorAll("li.rel-merch");
                if (relMerchElements && relMerchElements.length > 0) {
                  hasAmazonDeal = true;
                  dataId = relMerchElements[0].getAttribute("data-id") || null;
                }

                record.storeName = storeName;
                record.hasAmazonDeal = hasAmazonDeal;
                record.dataId = dataId;
                record.status = "completed";
                record.processedAt = now;
                processedCount++;

                batchResults.set(url, { success: true });
              } catch (parseError) {
                console.error(`Error parsing HTML for ${url}:`, parseError);
                batchResults.set(url, {
                  success: false,
                  error: `HTML parsing error: ${
                    parseError instanceof Error
                      ? parseError.message
                      : String(parseError)
                  }`,
                });
              }
            } else {
              console.error(`Error or no HTML content in response for ${url}`);
              batchResults.set(url, {
                success: false,
                error: "No HTML content in scrape result",
              });
            }
          }
        } else {
          console.error("Invalid batch scrape response format:", batchResponse);
          batchUrls.forEach((url) =>
            batchResults.set(url, {
              success: false,
              error: "Invalid batch response from Firecrawl",
            })
          );
        }
      } catch (error) {
        console.error("Error processing batch scrape:", error);
        batchUrls.forEach((url) =>
          batchResults.set(url, {
            success: false,
            error: `Batch scrape failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          })
        );
      }

      batchUrls.forEach((url) => {
        const result = batchResults.get(url);
        if (result && !result.success) {
          const record = recordMap.get(url);
          if (record) {
            record.attempts += 1;
            if (record.attempts >= 3) {
              record.status = "failed";
              console.warn(
                `URL marked as failed after ${record.attempts} attempts: ${url} (Error: ${result.error})`
              );
            } else {
              console.warn(
                `Attempt ${record.attempts} failed for ${url}: ${result.error}`
              );
            }
          }
        }
      });

      await saveScrapeState(scrapeState, stateFilePath);

      if (i + batchSize < recordsToProcess.length) {
        console.log("Waiting for 2 seconds before processing next batch...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } // End of batch loop

    console.log(`\nFinished processing all batches for this run.`);
    console.log(
      `Successfully scraped and processed data for ${processedCount} pages.`
    );

    console.timeEnd("Total execution time for batch");
  } catch (error) {
    console.error("Error scraping merchant pages:", error);
    await saveScrapeState(scrapeState, stateFilePath);
    throw error;
  }
}

// Removed logic for saving separate merchant-page-data.json/csv files

/**
 * Main function
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const testMode = args.includes("--test");
    const batchSizeArg = args.includes("--batch-size")
      ? parseInt(args[args.indexOf("--batch-size") + 1])
      : 2000;
    const skipCompleted = !args.includes("--reprocess-completed");
    const skipFailed = !args.includes("--retry-failed");
    const maxAttempts = 3;
    const outputDir = "output"; // Define outputDir here
    await fs.ensureDir(outputDir); // Ensure output dir exists

    console.log(
      `Starting merchant page scraper using unified state file${
        testMode ? " (TEST MODE)" : ""
      }`
    );

    const filePrefix = testMode ? "test-" : "";
    const stateFilePath = path.join(
      outputDir,
      `${filePrefix}scrape-state.json`
    );

    if (!fs.existsSync(stateFilePath)) {
      console.error(`Error: State file not found at ${stateFilePath}`);
      console.log(
        "Please run merchantLinkExtractor.ts first to generate the state file."
      );
      process.exit(1);
    }

    console.log(`Loading scrape state from ${stateFilePath}...`);
    const scrapeState = (await fs.readJSON(stateFilePath)) as ScrapeState;

    if (
      !scrapeState.merchantRecords ||
      scrapeState.merchantRecords.length === 0
    ) {
      console.error("No merchant records found in the state file.");
      process.exit(1);
    }

    console.log(
      `Loaded state with ${scrapeState.totalLinks} total merchant records.`
    );
    console.log(`  - Pending: ${scrapeState.pendingLinks}`);
    console.log(`  - Completed: ${scrapeState.completedLinks}`);
    console.log(`  - Failed: ${scrapeState.failedLinks}`);

    let recordsToProcess = scrapeState.merchantRecords.filter((record) => {
      if (skipCompleted && record.status === "completed") return false;
      if (
        skipFailed &&
        record.status === "failed" &&
        record.attempts >= maxAttempts
      )
        return false;
      if (record.status === "pending") return true;
      if (!skipCompleted && record.status === "completed") return true;
      if (
        (!skipFailed || record.attempts < maxAttempts) &&
        record.status === "failed"
      )
        return true;
      return false;
    });

    recordsToProcess.sort((a, b) => {
      const statusOrder = { pending: 0, failed: 1, completed: 2 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.attempts - b.attempts;
    });

    console.log(`\nFiltering complete:`);
    console.log(
      `  - Found ${recordsToProcess.length} records requiring processing.`
    );
    if (!skipCompleted) console.log(`    (Including reprocessing completed)`);
    if (!skipFailed) console.log(`    (Including retrying failed)`);

    if (recordsToProcess.length > batchSizeArg) {
      console.log(
        `Limiting processing to the first ${batchSizeArg} records for this run.`
      );
      recordsToProcess = recordsToProcess.slice(0, batchSizeArg);
    }

    console.log(
      `\nWill attempt to process ${recordsToProcess.length} records in this run.`
    );
    if (recordsToProcess.length > 0) {
      console.log("Status breakdown of records to process:");
      const pendingCount = recordsToProcess.filter(
        (r) => r.status === "pending"
      ).length;
      const completedCount = recordsToProcess.filter(
        (r) => r.status === "completed"
      ).length;
      const failedCount = recordsToProcess.filter(
        (r) => r.status === "failed"
      ).length;
      console.log(`  - Pending: ${pendingCount}`);
      console.log(`  - Completed (to be reprocessed): ${completedCount}`);
      console.log(`  - Failed (to be retried): ${failedCount}`);

      console.log("\nFirst 10 records to process:");
      recordsToProcess.slice(0, 10).forEach((record, index) => {
        console.log(
          `  ${index + 1}. ${record.url} (${record.status}, attempts: ${
            record.attempts
          })`
        );
      });
    } else {
      console.log(
        "No records need processing based on current filters and status."
      );
      process.exit(0);
    }

    await scrapeMerchantPages(recordsToProcess, scrapeState, stateFilePath);

    console.log(`\nScraping run finished.`);
  } catch (error) {
    console.error("Unhandled error in main:", error);
    process.exit(1);
  }
}

// Run the main function
main();
