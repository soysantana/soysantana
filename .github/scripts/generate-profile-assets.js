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
query ProfileData($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    name
    login
    followers {
      totalCount
    }
    repositories(first: 100, ownerAffiliations: [OWNER], isFork: false, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        name
        stargazerCount
        primaryLanguage {
          name
          color
        }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges {
            size
            node {
              name
              color
            }
          }
        }
      }
    }
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalRepositoryContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
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

  return json.data.user;
}

function baseSvg({ title, description, width, height, body }) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(description)}</desc>
  <style>
    .bg { fill: #ffffff; }
    .card { fill: #f6f8fa; stroke: #d0d7de; }
    .title { fill: #24292f; font: 700 24px Segoe UI, Arial, sans-serif; }
    .subtitle { fill: #57606a; font: 500 13px Segoe UI, Arial, sans-serif; }
    .label { fill: #57606a; font: 600 12px Segoe UI, Arial, sans-serif; letter-spacing: 0; }
    .value { fill: #0969da; font: 700 25px Segoe UI, Arial, sans-serif; letter-spacing: 0; }
    .text { fill: #24292f; font: 600 13px Segoe UI, Arial, sans-serif; }
    .muted { fill: #57606a; font: 500 12px Segoe UI, Arial, sans-serif; }
    .line { stroke: #0969da; }
    .area { fill: #0969da; opacity: .15; }
    .bar-bg { fill: #d8dee4; }
    .bar { fill: #2da44e; }
    .axis { stroke: #d8dee4; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #0d1117; }
      .card { fill: #161b22; stroke: #30363d; }
      .title { fill: #f0f6fc; }
      .subtitle, .label, .muted { fill: #8b949e; }
      .value { fill: #58a6ff; }
      .text { fill: #f0f6fc; }
      .line { stroke: #58a6ff; }
      .area { fill: #58a6ff; opacity: .18; }
      .bar-bg { fill: #30363d; }
      .bar { fill: #3fb950; }
      .axis { stroke: #30363d; }
    }
  </style>
  <rect class="bg" width="${width}" height="${height}" rx="16" />
  ${body}
</svg>
`;
}

function card(x, y, width, height, label, value) {
  return `<rect class="card" x="${x}" y="${y}" width="${width}" height="${height}" rx="10" />
  <text class="label" x="${x + 18}" y="${y + 30}">${escapeXml(label)}</text>
  <text class="value" x="${x + 18}" y="${y + 65}">${escapeXml(value)}</text>`;
}

function flattenDays(user) {
  return user.contributionsCollection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function calculateStreak(days) {
  let current = 0;
  let longest = 0;
  let running = 0;
  let lastIndex = days.length - 1;

  if (days[lastIndex] && days[lastIndex].contributionCount === 0) {
    lastIndex -= 1;
  }

  for (let index = lastIndex; index >= 0; index -= 1) {
    if (days[index].contributionCount <= 0) break;
    current += 1;
  }

  for (const day of days) {
    if (day.contributionCount > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  return {
    current,
    longest,
    total: days.reduce((sum, day) => sum + day.contributionCount, 0),
  };
}

function collectLanguages(user) {
  const totals = new Map();

  for (const repo of user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      const previous = totals.get(edge.node.name) || { size: 0, color: edge.node.color || "#2da44e" };
      totals.set(edge.node.name, {
        size: previous.size + edge.size,
        color: previous.color,
      });
    }
  }

  const totalSize = [...totals.values()].reduce((sum, item) => sum + item.size, 0);

  return [...totals.entries()]
    .map(([name, data]) => ({
      name,
      color: data.color,
      size: data.size,
      percent: totalSize ? (data.size / totalSize) * 100 : 0,
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 8);
}

function renderMetrics(user, stars) {
  const c = user.contributionsCollection;
  const totalContributions = c.contributionCalendar.totalContributions + c.restrictedContributionsCount;
  const items = [
    ["Commits", c.totalCommitContributions],
    ["Pull Requests", c.totalPullRequestContributions],
    ["Issues", c.totalIssueContributions],
    ["Code Reviews", c.totalPullRequestReviewContributions],
    ["Stars", stars],
    ["Contributions", totalContributions],
  ];

  const cards = items
    .map(([label, value], index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      return card(30 + col * 280, 76 + row * 92, 250, 72, label, formatNumber(value));
    })
    .join("\n");

  return baseSvg({
    title: "GitHub Analytics",
    description: "GitHub contribution analytics for soysantana",
    width: 900,
    height: 290,
    body: `<text class="title" x="30" y="42">GitHub Analytics</text>
  <text class="subtitle" x="30" y="62">Public contribution data from the last year</text>
  ${cards}`,
  });
}

function renderLanguages(languages) {
  const rows = languages.length
    ? languages
        .map((language, index) => {
          const y = 78 + index * 31;
          const width = Math.max(4, Math.round(language.percent * 6.2));
          return `<circle cx="38" cy="${y - 5}" r="5" fill="${escapeXml(language.color)}" />
  <text class="text" x="52" y="${y}">${escapeXml(language.name)}</text>
  <rect class="bar-bg" x="210" y="${y - 16}" width="620" height="12" rx="6" />
  <rect class="bar" x="210" y="${y - 16}" width="${width}" height="12" rx="6" />
  <text class="muted" x="845" y="${y}" text-anchor="end">${language.percent.toFixed(1)}%</text>`;
        })
        .join("\n")
    : `<text class="muted" x="30" y="90">No public language data available yet.</text>`;

  return baseSvg({
    title: "Most Used Languages",
    description: "Most used languages across public repositories",
    width: 900,
    height: Math.max(150, 88 + languages.length * 31),
    body: `<text class="title" x="30" y="42">Most Used Languages</text>
  <text class="subtitle" x="30" y="62">Repository usage, not a measure of skill level</text>
  ${rows}`,
  });
}

function renderStreak(streak) {
  const cards = [
    ["Current Streak", `${streak.current} days`],
    ["Longest Streak", `${streak.longest} days`],
    ["Total Contributions", formatNumber(streak.total)],
  ]
    .map(([label, value], index) => card(30 + index * 280, 76, 250, 72, label, value))
    .join("\n");

  return baseSvg({
    title: "GitHub Streak",
    description: "Current streak, longest streak, and total contributions",
    width: 900,
    height: 178,
    body: `<text class="title" x="30" y="42">GitHub Streak</text>
  <text class="subtitle" x="30" y="62">Calculated from the public contribution calendar</text>
  ${cards}`,
  });
}

function renderTrophies(user, stars, streak) {
  const c = user.contributionsCollection;
  const items = [
    ["Commits", c.totalCommitContributions],
    ["PRs", c.totalPullRequestContributions],
    ["Issues", c.totalIssueContributions],
    ["Reviews", c.totalPullRequestReviewContributions],
    ["Stars", stars],
    ["Repos", user.repositories.totalCount],
    ["Best Streak", streak.longest],
  ];

  const trophies = items
    .map(([label, value], index) => {
      const x = 30 + index * 121;
      return `<rect class="card" x="${x}" y="76" width="105" height="110" rx="10" />
  <circle cx="${x + 52}" cy="103" r="15" fill="#f2cc60" opacity=".9" />
  <rect x="${x + 45}" y="116" width="14" height="18" rx="3" fill="#bf8700" opacity=".9" />
  <text class="label" x="${x + 52}" y="143" text-anchor="middle">${escapeXml(label)}</text>
  <text class="value" x="${x + 52}" y="172" text-anchor="middle">${escapeXml(formatNumber(value))}</text>`;
    })
    .join("\n");

  return baseSvg({
    title: "GitHub Trophies",
    description: "Compact GitHub achievement cards",
    width: 900,
    height: 215,
    body: `<text class="title" x="30" y="42">GitHub Trophies</text>
  <text class="subtitle" x="30" y="62">Useful categories only, generated without third-party trophy services</text>
  ${trophies}`,
  });
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

  return baseSvg({
    title: "Contribution Activity",
    description: "Contribution activity graph for the last 90 days",
    width: 900,
    height: 275,
    body: `<text class="title" x="30" y="42">Contribution Activity</text>
  <text class="subtitle" x="30" y="62">Last 90 days of public GitHub contributions</text>
  <line class="axis" x1="${left}" y1="${bottom}" x2="${left + width}" y2="${bottom}" stroke-width="1" />
  <path class="area" d="${area}" />
  <path class="line" d="${line}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  ${labels}`,
  });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const user = await fetchGraphQL();
  const days = flattenDays(user);
  const streak = calculateStreak(days);
  const stars = user.repositories.nodes.reduce((sum, repo) => sum + repo.stargazerCount, 0);
  const languages = collectLanguages(user);

  await Promise.all([
    fs.writeFile(path.join(outputDir, "github-metrics.svg"), renderMetrics(user, stars)),
    fs.writeFile(path.join(outputDir, "top-languages.svg"), renderLanguages(languages)),
    fs.writeFile(path.join(outputDir, "github-streak.svg"), renderStreak(streak)),
    fs.writeFile(path.join(outputDir, "github-trophies.svg"), renderTrophies(user, stars, streak)),
    fs.writeFile(path.join(outputDir, "activity-graph.svg"), renderActivityGraph(days)),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
