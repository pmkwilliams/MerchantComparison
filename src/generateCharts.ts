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
 * Generates a pie chart for a competitor showing the ratio of matched to not matched domains
 */
async function generatePieChart(
  competitor: CompetitorOverlap,
  outputDir: string
): Promise<void> {
  // Skip if no domains
  if (competitor.totalDomains === 0) {
    console.log(
      `Skipping chart for ${competitor.competitorName} - no domains found`
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
          text: `${competitor.competitorName} - Dealspotr Domain Match Ratio`,
          font: {
            size: 16,
          },
        },
        subtitle: {
          display: true,
          text: `Total Domains: ${
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

  // Filter out competitors with no domains
  const validCompetitors = analysisResult.competitors
    .filter((comp) => comp.totalDomains > 0)
    .sort((a, b) => b.overlapPercentage - a.overlapPercentage);

  // Skip if no valid competitors
  if (validCompetitors.length === 0) {
    console.log("No valid competitors found for summary chart");
    return;
  }

  const width = Math.max(800, validCompetitors.length * 50);
  const height = 500;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "white",
  });

  // Create a bar chart configuration
  const configuration = {
    type: "bar" as const,
    data: {
      labels: validCompetitors.map((comp) => comp.competitorName),
      datasets: [
        {
          label: "Dealspotr Overlap Percentage",
          data: validCompetitors.map((comp) => comp.overlapPercentage),
          backgroundColor: "#4BC0C0",
          borderColor: "#3CB1B1",
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: "Dealspotr Domain Overlap Percentage by Competitor",
          font: {
            size: 18,
          },
        },
        subtitle: {
          display: true,
          text: `Dealspotr Total Domains: ${analysisResult.dealsptrDomainsCount}`,
          font: {
            size: 14,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: {
            display: true,
            text: "Percentage (%)",
          },
        },
        x: {
          title: {
            display: true,
            text: "Competitor",
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
    console.log("Generating summary chart...");
    await generateSummaryChart(analysisResult, outputDir);

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
