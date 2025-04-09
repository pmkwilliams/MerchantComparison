import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import { xml2js } from "xml-js";
import { Domain, ParsedSitemap, SitemapUrl } from "./types";

/**
 * Extracts the domain from a URL
 */
export function extractDomain(url: string): Domain | null {
  try {
    const urlObj = new URL(url);

    // Special case handling for capitaloneshopping.com - ignore 'all' and other non-domain segments
    if (urlObj.hostname.includes("capitaloneshopping.com")) {
      const pathParts = urlObj.pathname.split("/").filter((part) => part);
      if (pathParts.length > 1 && pathParts[0] === "s") {
        // Skip non-domain segments like 'all' or segments without dots
        if (pathParts[1] === "all" || !pathParts[1].includes(".")) {
          return null;
        }

        // If it has a dot, it's likely a domain
        if (pathParts[1].includes(".")) {
          return {
            full: pathParts[1],
            name: pathParts[1],
          };
        }
      }
    }

    // Common pattern: look for domain-like strings in the path
    const pathParts = urlObj.pathname.split("/").filter((part) => part);

    // First priority: Find domain-like strings in the path segments
    // Match anything that looks like a domain with any TLD
    const domainRegex =
      /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+$/;

    for (const part of pathParts) {
      if (domainRegex.test(part)) {
        return {
          full: part,
          name: part,
        };
      }
    }

    // Second priority: For dealspotr-like patterns, take what comes after a specific segment
    const knownSegments = [
      "promo-codes",
      "store",
      "coupons",
      "site",
      "coupon-codes",
      "s",
      "view",
    ];

    for (let i = 0; i < pathParts.length - 1; i++) {
      if (knownSegments.includes(pathParts[i])) {
        // The domain is likely the next segment after a known segment
        const potentialDomain = pathParts[i + 1];

        // For all sites, require a dot in the potential domain
        if (potentialDomain && potentialDomain.includes(".")) {
          return {
            full: potentialDomain,
            name: potentialDomain,
          };
        }
      }
    }

    // Special case for GoodSearch - if after 'coupons/' there's no dot, skip it
    if (urlObj.hostname.includes("goodsearch.com") && pathParts.length > 1) {
      const couponsIndex = pathParts.findIndex((part) => part === "coupons");
      if (couponsIndex >= 0 && couponsIndex + 1 < pathParts.length) {
        const afterCoupons = pathParts[couponsIndex + 1];
        if (!afterCoupons.includes(".")) {
          // This is not a domain, don't return the hostname
          return null;
        }
      }
    }

    // Last resort: use the hostname itself if it contains a dot AND the URL has no path
    // This avoids returning the site's own hostname when we should return null
    const hostname = urlObj.hostname;
    if (hostname.includes(".") && pathParts.length === 0) {
      return {
        full: hostname,
        name: hostname.replace(/^www\./, ""),
      };
    }

    // If no valid domain found, return null
    return null;
  } catch (error) {
    console.error(`Error extracting domain from ${url}:`, error);
    return null;
  }
}

/**
 * Parses an XML sitemap file and extracts URLs
 */
export async function parseSitemapFile(
  filePath: string,
  sourceName: string
): Promise<ParsedSitemap> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const result = xml2js(content, { compact: true }) as any;

    // Handle different sitemap formats
    let urls: SitemapUrl[] = [];

    // Standard urlset format (most common)
    if (result.urlset && result.urlset.url) {
      const urlEntries = Array.isArray(result.urlset.url)
        ? result.urlset.url
        : [result.urlset.url];

      urls = urlEntries
        .map((entry: any) => ({
          loc: entry.loc?._text || "",
          lastmod: entry.lastmod?._text,
          changefreq: entry.changefreq?._text,
          priority: entry.priority?._text,
        }))
        .filter((url: SitemapUrl) => url.loc);
    }
    // Non-standard format with different root element
    else if (result.xml && result.xml.url) {
      const urlEntries = Array.isArray(result.xml.url)
        ? result.xml.url
        : [result.xml.url];

      urls = urlEntries
        .map((entry: any) => ({
          loc: entry.loc?._text || "",
          lastmod: entry.lastmod?._text,
          changefreq: entry.changefreq?._text,
          priority: entry.priority?._text,
        }))
        .filter((url: SitemapUrl) => url.loc);
    }
    // Try to find any URLs in the document regardless of structure
    else {
      const findUrls = (obj: any, urls: SitemapUrl[] = []): SitemapUrl[] => {
        if (!obj) return urls;

        if (obj.loc && obj.loc._text) {
          urls.push({
            loc: obj.loc._text,
            lastmod: obj.lastmod?._text,
            changefreq: obj.changefreq?._text,
            priority: obj.priority?._text,
          });
        }

        // Recursively search in child objects
        for (const key in obj) {
          if (typeof obj[key] === "object") {
            findUrls(obj[key], urls);
          }
        }

        return urls;
      };

      urls = findUrls(result);

      // If still no URLs, try to extract any text that looks like a URL
      if (urls.length === 0) {
        const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
        const matches = content.match(urlRegex);

        if (matches) {
          urls = matches.map((url: string) => ({ loc: url }));
        }
      }
    }

    if (urls.length === 0) {
      console.warn(`No URLs found in ${filePath}`);
    }

    return {
      sourceName,
      urls,
    };
  } catch (error) {
    console.error(`Error parsing sitemap ${filePath}:`, error);
    return {
      sourceName,
      urls: [],
    };
  }
}

/**
 * Finds all sitemap files in a directory recursively
 */
export async function findSitemapFiles(directory: string): Promise<string[]> {
  try {
    return await glob(`${directory}/**/*.xml`);
  } catch (error) {
    console.error(`Error finding sitemap files in ${directory}:`, error);
    return [];
  }
}

/**
 * Extracts domains from a parsed sitemap
 */
export function extractDomainsFromSitemap(sitemap: ParsedSitemap): Set<string> {
  const domains = new Set<string>();
  const ignoredUrls: string[] = [];

  for (const url of sitemap.urls) {
    const domain = extractDomain(url.loc);
    if (domain) {
      domains.add(domain.name);
    } else {
      ignoredUrls.push(url.loc);
    }
  }

  if (ignoredUrls.length > 0) {
    console.log(
      `Ignored ${ignoredUrls.length} URLs without a proper domain in ${sitemap.sourceName}`
    );
    if (ignoredUrls.length <= 5) {
      ignoredUrls.forEach((url) => console.log(`  - ${url}`));
    } else {
      ignoredUrls.slice(0, 5).forEach((url) => console.log(`  - ${url}`));
      console.log(`  ... and ${ignoredUrls.length - 5} more`);
    }
  }

  return domains;
}

/**
 * Processes all sitemaps in a directory and returns a set of all domains
 */
export async function processDirectory(
  directory: string,
  sourceName: string
): Promise<Set<string>> {
  const allDomains = new Set<string>();
  const files = await findSitemapFiles(directory);
  let totalIgnored = 0;

  console.log(`Processing ${files.length} sitemap files in ${sourceName}...`);

  for (const file of files) {
    try {
      const sitemap = await parseSitemapFile(file, path.basename(file, ".xml"));
      const domains = extractDomainsFromSitemap(sitemap);

      console.log(`Found ${domains.size} domains in ${path.basename(file)}`);

      // Merge domains into the all domains set
      domains.forEach((domain) => allDomains.add(domain));
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
    }
  }

  return allDomains;
}
