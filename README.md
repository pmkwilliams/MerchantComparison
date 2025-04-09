# Merchant Domain Comparison

This project analyzes sitemap files from Dealspotr and competitor websites to identify merchant domain overlaps and calculate similarity percentages.

## Features

- Parse XML sitemaps from different sources
- Extract domains from sitemap URLs
- Calculate domain overlap between Dealspotr and competitors
- Generate sorted results by overlap percentage
- Create CSV files with detailed domain matches for each competitor
- Generate pie charts showing the ratio of matched to unmatched domains for each competitor
- Create a summary bar chart comparing overlap percentages across all competitors

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn

## Installation

1. Clone the repository

   ```bash
   git clone <repository-url>
   cd MerchantComparison
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Complete Analysis

Run the complete domain comparison analysis and CSV generation in one command:

```bash
npm run generate
```

This will:

1. Build the TypeScript project
2. Clean previous output files (removes the `output` directory)
3. Process all sitemap files in the `dealspotr` directory
4. Process all sitemap files in the `competitors` directory
5. Calculate domain overlap percentages
6. Display results in the console
7. Save detailed results to `output/domain-overlap-results.json`
8. Generate CSV files for each competitor in the `output/csv-output` directory
9. Generate pie charts showing match ratios in the `output/charts` directory

### Individual Commands

If you prefer to run steps individually:

```bash
# Build the TypeScript project
npm run build

# Run only the domain analysis
npm run start

# Run analysis in dev mode (using ts-node)
npm run dev

# Generate CSV files only
npm run csv

# Generate charts only (requires results from previous analysis)
npm run charts
```

## Input Data Structure

The project expects sitemap files in XML format to be organized in the following directories:

- `dealspotr/`: Contains DealsPotr sitemap XML files
- `competitors/`: Contains competitor sitemap XML files, either directly in the directory or in subdirectories named after each competitor

## Output Files

### CSV Files

For each competitor, a CSV file is generated in the `output/csv-output` directory with:

- `URL`: The competitor's URL for the domain
- `Match_Status`: Either "Matched" or "Not Matched" depending on if DealsPotr has this domain
- `domain`: The extracted domain name
- `dealspotr loc`: The corresponding DealsPotr URL for matched domains, empty for non-matched domains

### Charts

The project generates visual representations of the analysis in the `output/charts` directory:

- Individual pie charts for each competitor showing the ratio of matched to unmatched domains
- A summary bar chart comparing the overlap percentages across all competitors

### Analysis Results

The analysis produces a `output/domain-overlap-results.json` file with:

- Total number of domains in DealsPotr
- List of competitors with overlap statistics:
  - Competitor name
  - Total domains for that competitor
  - Number of overlapping domains with DealsPotr
  - Percentage of overlap

Example output:

```json
{
  "dealsptrDomainsCount": 5000,
  "competitors": [
    {
      "competitorName": "RetailMeNot",
      "totalDomains": 3000,
      "overlappingDomains": 1500,
      "overlapPercentage": 50.0
    },
    {
      "competitorName": "Rakuten",
      "totalDomains": 4000,
      "overlappingDomains": 1800,
      "overlapPercentage": 45.0
    }
  ]
}
```

## Project Structure

- `src/index.ts` - Main application file for overlap analysis
- `src/generateCSV.ts` - Script to generate CSV files for each competitor
- `src/generateCharts.ts` - Script to generate pie charts and summary charts
- `src/sitemapParser.ts` - Utilities for parsing XML sitemaps and extracting domains
- `src/comparison.ts` - Functions for comparing domains and calculating overlap
- `src/types.ts` - TypeScript interfaces and types

## Adding New Competitors

To add a new competitor for analysis:

1. Add their sitemap XML file directly to the `competitors/` directory, or
2. Create a new subdirectory with the competitor's name in the `competitors/` directory and place their sitemap XML files there

Then run the analysis again using `npm run generate`
