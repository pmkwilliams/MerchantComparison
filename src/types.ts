export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface ParsedSitemap {
  sourceName: string;
  urls: SitemapUrl[];
}

export interface Domain {
  full: string;
  name: string;
}

export interface CompetitorOverlap {
  competitorName: string;
  totalDomains: number;
  overlappingDomains: number;
  overlapPercentage: number;
}

export interface AnalysisResult {
  dealsptrDomains: Set<string>;
  competitorResults: CompetitorOverlap[];
}
