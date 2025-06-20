import fs from "fs-extra";
import { extractDomain } from "./sitemapParser";
import csv from "csv-parser";
import { Readable } from "stream";

export interface AffiliateRecord {
  id: string;
  domain: string;
}

export async function loadAffiliateData(
  filePath: string
): Promise<Map<string, string>> {
  console.log(`Loading affiliate data from ${filePath}...`);
  const affiliateMap = new Map<string, string>();
  if (!(await fs.pathExists(filePath))) {
    console.warn(`Affiliate data file not found at: ${filePath}`);
    return affiliateMap;
  }

  const fileContent = await fs.readFile(filePath);
  const stream = Readable.from(fileContent);

  return new Promise((resolve, reject) => {
    stream
      .pipe(csv())
      .on("data", (row: any) => {
        const id = row["ID"];
        const targetUrl = row["Target URL"];
        if (id && targetUrl) {
          try {
            const domainInfo = extractDomain(targetUrl);
            if (domainInfo && domainInfo.name) {
              affiliateMap.set(domainInfo.name, id);
            }
          } catch (e) {
            // Ignore invalid URLs
          }
        }
      })
      .on("end", () => {
        console.log(`Loaded ${affiliateMap.size} records from affiliate data.`);
        resolve(affiliateMap);
      })
      .on("error", (error: Error) => {
        console.error("Error parsing affiliate data CSV:", error);
        reject(error);
      });
  });
}
