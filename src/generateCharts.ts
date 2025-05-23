import fs from "fs-extra";
import path from "path";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { createWriteStream } from "fs";

interface CompetitorOverlap {
  competitorName: string;
  totalDomains: number;
  overlappingDomains: number;
  overlapPercentage: number;
}

interface AnalysisResult {
  dealsptrDomainsCount: number;
  competitors: CompetitorOverlap[];
}

/**
 * Generates a pie chart for a competitor showing the ratio of matched to not matched merchants
 */
async function generatePieChart(
  competitor: CompetitorOverlap,
  outputDir: string
): Promise<void> {
  // Skip if no merchants
  if (competitor.totalDomains === 0) {
    console.log(
      `Skipping chart for ${competitor.competitorName} - no merchants found`
    );
    return;
  }

  const matched = competitor.overlappingDomains;
  const notMatched = competitor.totalDomains - competitor.overlappingDomains;

  // Configuration for the chart
  const width = 400;
  const height = 400;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "white",
  });

  // Create a pie chart configuration
  const configuration = {
    type: "pie" as const,
    data: {
      labels: ["Matched with Dealspotr", "Not Matched with Dealspotr"],
      datasets: [
        {
          data: [matched, notMatched],
          backgroundColor: ["#4BC0C0", "#FF6384"],
          hoverBackgroundColor: ["#3CB1B1", "#FF4D76"],
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: `${competitor.competitorName} - Dealspotr Merchant Match Ratio`,
          font: {
            size: 16,
          },
        },
        subtitle: {
          display: true,
          text: `Total Merchants: ${
            competitor.totalDomains
          } | Dealspotr Match Rate: ${competitor.overlapPercentage.toFixed(
            2
          )}%`,
          font: {
            size: 14,
          },
        },
        legend: {
          display: true,
          position: "bottom" as const,
          labels: {
            generateLabels: (chart: any) => {
              const data = chart.data;
              return data.labels.map((label: string, i: number) => {
                const value = data.datasets[0].data[i];
                const percentage = (
                  (value / competitor.totalDomains) *
                  100
                ).toFixed(1);
                return {
                  text: `${label}: ${value} (${percentage}%)`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  index: i,
                };
              });
            },
          },
        },
      },
      responsive: true,
    },
  };

  // Create chart directory
  const chartOutputDir = path.join(outputDir, "charts");
  await fs.ensureDir(chartOutputDir);

  // Generate chart image
  const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);

  // Sanitize competitor name for filename
  const sanitizedName = competitor.competitorName
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toLowerCase();
  const outputPath = path.join(
    chartOutputDir,
    `${sanitizedName}-pie-chart.png`
  );

  // Write image to file
  const stream = createWriteStream(outputPath);
  stream.write(buffer);
  stream.end();

  console.log(
    `Generated chart for ${competitor.competitorName} at ${outputPath}`
  );
}

/**
 * Generates a summary chart showing overlap percentages for all competitors
 */
async function generateSummaryChart(
  analysisResult: AnalysisResult,
  outputDir: string
): Promise<void> {
  // Skip if no competitors
  if (analysisResult.competitors.length === 0) {
    console.log("No competitors found for summary chart");
    return;
  }

  // Filter out competitors with no merchants
  const validCompetitors = analysisResult.competitors
    .filter((comp) => comp.totalDomains > 0)
    .sort((a, b) => b.overlapPercentage - a.overlapPercentage);

  // Skip if no valid competitors
  if (validCompetitors.length === 0) {
    console.log("No valid competitors found for summary chart");
    return;
  }

  const width = Math.max(900, validCompetitors.length * 60);
  const height = 600;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "white",
  });

  // Create a stacked bar chart configuration
  const configuration = {
    type: "bar" as const,
    data: {
      labels: validCompetitors.map((comp) => comp.competitorName),
      datasets: [
        {
          label: "Matched with Dealspotr",
          data: validCompetitors.map((comp) => comp.overlappingDomains),
          backgroundColor: "#4BC0C0",
          borderColor: "#3CB1B1",
          borderWidth: 1,
        },
        {
          label: "Not Matched with Dealspotr",
          data: validCompetitors.map(
            (comp) => comp.totalDomains - comp.overlappingDomains
          ),
          backgroundColor: "#FF6384",
          borderColor: "#FF4D76",
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: "Dealspotr Merchant Overlap by Competitor",
          font: {
            size: 18,
          },
        },
        subtitle: {
          display: true,
          text: `Dealspotr Total Merchants: ${analysisResult.dealsptrDomainsCount}`,
          font: {
            size: 14,
          },
        },
        tooltip: {
          callbacks: {
            footer: (tooltipItems: any) => {
              const competitorName = tooltipItems[0].label;
              const competitor = validCompetitors.find(
                (c) => c.competitorName === competitorName
              );
              if (competitor) {
                return `Match Rate: ${competitor.overlapPercentage.toFixed(
                  2
                )}%`;
              }
              return "";
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          title: {
            display: true,
            text: "Competitor",
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: {
            display: true,
            text: "Number of Merchants",
          },
        },
      },
      responsive: true,
    },
  };

  // Create chart directory
  const chartOutputDir = path.join(outputDir, "charts");
  await fs.ensureDir(chartOutputDir);

  // Generate chart image
  const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  const outputPath = path.join(chartOutputDir, "all-competitors-summary.png");

  // Write image to file
  const stream = createWriteStream(outputPath);
  stream.write(buffer);
  stream.end();

  console.log(`Generated summary chart at ${outputPath}`);

  // Also generate the percentage-based summary chart
  await generatePercentageSummaryChart(
    validCompetitors,
    analysisResult.dealsptrDomainsCount,
    chartOutputDir
  );
}

/**
 * Generates a percentage-based summary chart
 */
async function generatePercentageSummaryChart(
  competitors: CompetitorOverlap[],
  dealsptrDomainCount: number,
  outputDir: string
): Promise<void> {
  const width = Math.max(900, competitors.length * 60);
  const height = 600;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "white",
  });

  // Create a stacked percentage bar chart
  const configuration = {
    type: "bar" as const,
    data: {
      labels: competitors.map(
        (comp) =>
          `${comp.competitorName} (${Math.round(comp.overlapPercentage)}%)`
      ),
      datasets: [
        {
          label: "Matched with Dealspotr (%)",
          data: competitors.map((comp) => comp.overlapPercentage),
          backgroundColor: "#4BC0C0",
          borderColor: "#3CB1B1",
          borderWidth: 1,
        },
        {
          label: "Not Matched with Dealspotr (%)",
          data: competitors.map((comp) => 100 - comp.overlapPercentage),
          backgroundColor: "#FF6384",
          borderColor: "#FF4D76",
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: "Dealspotr Merchant Overlap Percentage by Competitor",
          font: {
            size: 18,
          },
        },
        subtitle: {
          display: true,
          text: `Dealspotr Total Merchants: ${dealsptrDomainCount}`,
          font: {
            size: 14,
          },
        },
        tooltip: {
          callbacks: {
            label: (context: any) => {
              const label = context.dataset.label || "";
              const value = context.parsed.y;
              return `${label}: ${value.toFixed(2)}%`;
            },
            footer: (tooltipItems: any) => {
              const fullLabel = tooltipItems[0].label;
              const competitorName = fullLabel.split(" (")[0]; // Extract name without percentage
              const competitor = competitors.find(
                (c) => c.competitorName === competitorName
              );
              if (competitor) {
                return `Total Merchants: ${competitor.totalDomains}`;
              }
              return "";
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          title: {
            display: true,
            text: "Competitor",
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          max: 100,
          title: {
            display: true,
            text: "Percentage (%)",
          },
        },
      },
      responsive: true,
    },
  };

  // Generate chart image
  const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  const outputPath = path.join(
    outputDir,
    "all-competitors-percentage-summary.png"
  );

  // Write image to file
  const stream = createWriteStream(outputPath);
  stream.write(buffer);
  stream.end();

  console.log(`Generated percentage summary chart at ${outputPath}`);
}

/**
 * Generates a bar chart showing total merchants per competitor
 */
async function generateTotalMerchantsChart(
  analysisResult: AnalysisResult,
  outputDir: string
): Promise<void> {
  // Skip if no competitors
  if (analysisResult.competitors.length === 0) {
    console.log("No competitors found for total merchants chart");
    return;
  }

  // Include all competitors including Dealspotr
  const allCompetitors = [...analysisResult.competitors];

  // Add Dealspotr as a "competitor" for comparison
  allCompetitors.push({
    competitorName: "Dealspotr",
    totalDomains: analysisResult.dealsptrDomainsCount,
    overlappingDomains: analysisResult.dealsptrDomainsCount, // All merchants match with itself
    overlapPercentage: 100,
  });

  // Sort by total merchants in descending order
  const sortedCompetitors = allCompetitors
    .filter((comp) => comp.totalDomains > 0)
    .sort((a, b) => b.totalDomains - a.totalDomains);

  // Skip if no valid competitors
  if (sortedCompetitors.length === 0) {
    console.log("No valid competitors found for total merchants chart");
    return;
  }

  const width = Math.max(900, sortedCompetitors.length * 60);
  const height = 600;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "white",
  });

  // Create a bar chart configuration
  const configuration = {
    type: "bar" as const,
    data: {
      labels: sortedCompetitors.map((comp) => comp.competitorName),
      datasets: [
        {
          label: "Total Merchant Sites",
          data: sortedCompetitors.map((comp) => comp.totalDomains),
          backgroundColor: sortedCompetitors.map((comp) =>
            comp.competitorName === "Dealspotr" ? "#6A5ACD" : "#36A2EB"
          ),
          borderColor: sortedCompetitors.map((comp) =>
            comp.competitorName === "Dealspotr" ? "#483D8B" : "#2980B9"
          ),
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: "Total Merchant Sites by Sitemap Source",
          font: {
            size: 18,
          },
        },
        subtitle: {
          display: true,
          text: "Comparison of merchant site counts across all sources",
          font: {
            size: 14,
          },
        },
        tooltip: {
          callbacks: {
            label: (context: any) => {
              const value = context.raw;
              return `Merchants: ${value.toLocaleString()}`;
            },
          },
        },
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Sitemap Source",
          },
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Number of Merchants",
          },
          ticks: {
            callback: function (value: any) {
              if (value >= 1000) {
                return value / 1000 + "k";
              }
              return value;
            },
          },
        },
      },
      responsive: true,
    },
  };

  // Create chart directory
  const chartOutputDir = path.join(outputDir, "charts");
  await fs.ensureDir(chartOutputDir);

  // Generate chart image
  const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  const outputPath = path.join(chartOutputDir, "total-merchants-by-source.png");

  // Write image to file
  const stream = createWriteStream(outputPath);
  stream.write(buffer);
  stream.end();

  console.log(`Generated total merchants chart at ${outputPath}`);
}

async function main() {
  try {
    console.time("Chart generation time");

    // Define output directory
    const outputDir = "output";

    // Read the analysis results
    const resultsPath = path.join(outputDir, "domain-overlap-results.json");

    if (!(await fs.pathExists(resultsPath))) {
      console.error(`Results file not found at ${resultsPath}`);
      console.error('Please run the analysis first using "npm run start"');
      process.exit(1);
    }

    const analysisResult = (await fs.readJSON(resultsPath)) as AnalysisResult;

    // Generate a pie chart for each competitor
    console.log("Generating pie charts for each competitor...");
    for (const competitor of analysisResult.competitors) {
      await generatePieChart(competitor, outputDir);
    }

    // Generate a summary chart
    console.log("Generating summary charts...");
    await generateSummaryChart(analysisResult, outputDir);

    // Generate total merchants chart
    console.log("Generating total merchants chart...");
    await generateTotalMerchantsChart(analysisResult, outputDir);

    console.log("All charts generated successfully!");
    console.timeEnd("Chart generation time");
  } catch (error) {
    console.error("Error generating charts:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
