const fs = require("node:fs/promises");
const path = require("node:path");

const username = process.env.GITHUB_USERNAME || "soysantana";
const token = process.env.GITHUB_TOKEN;
const outputDir = path.join(process.cwd(), "dist");

if (!token) {
  throw new Error("GITHUB_TOKEN is required to generate profile assets.");
}

const oneYearAgo = new Date();
oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 365);

const query = `
query ActivityData($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}
`;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchGraphQL() {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "soysantana-profile-assets",
    },
    body: JSON.stringify({
      query,
      variables: {
        login: username,
        from: oneYearAgo.toISOString(),
        to: new Date().toISOString(),
      },
    }),
  });

  const json = await response.json();

  if (!response.ok || json.errors) {
    throw new Error(JSON.stringify(json.errors || json, null, 2));
  }

  return json.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderActivityGraph(days) {
  const recent = days.slice(-90);
  const max = Math.max(1, ...recent.map((day) => day.contributionCount));
  const left = 42;
  const top = 82;
  const width = 810;
  const height = 142;
  const bottom = top + height;

  const points = recent.map((day, index) => {
    const x = left + (index * width) / Math.max(1, recent.length - 1);
    const y = bottom - (day.contributionCount / max) * height;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });

  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const area = `${line} L ${left + width} ${bottom} L ${left} ${bottom} Z`;
  const labels = [0, 30, 60, 89]
    .filter((index) => recent[index])
    .map((index) => {
      const x = left + (index * width) / Math.max(1, recent.length - 1);
      return `<text class="muted" x="${x}" y="246" text-anchor="middle">${escapeXml(recent[index].date.slice(5))}</text>`;
    })
    .join("\n");

  return `<svg width="900" height="275" viewBox="0 0 900 275" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Contribution Activity</title>
  <desc id="desc">Contribution activity graph for the last 90 days</desc>
  <style>
    .bg { fill: #ffffff; }
    .title { fill: #24292f; font: 700 24px Segoe UI, Arial, sans-serif; }
    .subtitle { fill: #57606a; font: 500 13px Segoe UI, Arial, sans-serif; }
    .muted { fill: #57606a; font: 500 12px Segoe UI, Arial, sans-serif; }
    .axis { stroke: #d8dee4; }
    .line { stroke: #0969da; }
    .area { fill: #0969da; opacity: .15; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #0d1117; }
      .title { fill: #f0f6fc; }
      .subtitle, .muted { fill: #8b949e; }
      .axis { stroke: #30363d; }
      .line { stroke: #58a6ff; }
      .area { fill: #58a6ff; opacity: .18; }
    }
  </style>
  <rect class="bg" width="900" height="275" rx="16" />
  <text class="title" x="30" y="42">Contribution Activity</text>
  <text class="subtitle" x="30" y="62">Last 90 days of public GitHub contributions</text>
  <line class="axis" x1="${left}" y1="${bottom}" x2="${left + width}" y2="${bottom}" stroke-width="1" />
  <path class="area" d="${area}" />
  <path class="line" d="${line}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  ${labels}
</svg>
`;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const days = await fetchGraphQL();
  await fs.writeFile(path.join(outputDir, "activity-graph.svg"), renderActivityGraph(days));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
