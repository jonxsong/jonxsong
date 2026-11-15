import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const username = process.env.GITHUB_USERNAME || "jonxsong";
const token = process.env.GITHUB_TOKEN || "";
const outputPath = resolve(process.env.OUTPUT_PATH || "assets/live-signal/weekly-commits.svg");
const focusOutputPath = resolve("assets/live-signal/weekly-focus.svg");
const timeZone = "America/Los_Angeles";

function dateInTimeZone(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const today = new Date();
const pacificToday = new Date(`${dateInTimeZone(today)}T12:00:00Z`);
const dates = Array.from({ length: 7 }, (_, index) => {
  const day = new Date(Date.UTC(
    pacificToday.getUTCFullYear(),
    pacificToday.getUTCMonth(),
    pacificToday.getUTCDate() - (6 - index),
  ));
  return day.toISOString().slice(0, 10);
});
const queryEnd = new Date(`${dates.at(-1)}T12:00:00Z`);
queryEnd.setUTCDate(queryEnd.getUTCDate() + 1);

const counts = new Map(dates.map((date) => [date, 0]));
const repositoryCounts = new Map();

async function fetchGraphqlCommits() {
  if (!token) return false;

  const query = `
    query WeeklyCommits($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 100) {
            repository {
              name
            }
            contributions(first: 100) {
              nodes {
                occurredAt
                commitCount
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "jonxsong-profile-live-signal",
    },
    body: JSON.stringify({
      query,
      variables: {
        login: username,
        from: `${dates[0]}T00:00:00Z`,
        to: queryEnd.toISOString(),
      },
    }),
  });

  if (!response.ok) return false;
  const payload = await response.json();
  if (payload.errors?.length) return false;

  const repositories = payload.data?.user?.contributionsCollection
    ?.commitContributionsByRepository ?? [];
  for (const repository of repositories) {
    const repositoryName = repository.repository?.name || "Private work";
    let repositoryCommitCount = 0;
    for (const contribution of repository.contributions?.nodes ?? []) {
      const date = contribution.occurredAt
        ? dateInTimeZone(new Date(contribution.occurredAt))
        : undefined;
      if (counts.has(date)) {
        const commitCount = contribution.commitCount || 0;
        counts.set(date, counts.get(date) + commitCount);
        repositoryCommitCount += commitCount;
      }
    }
    if (repositoryCommitCount > 0) {
      repositoryCounts.set(
        repositoryName,
        (repositoryCounts.get(repositoryName) || 0) + repositoryCommitCount,
      );
    }
  }
  return true;
}

async function fetchPublicPushEvents() {
  const headers = { "User-Agent": "jonxsong-profile-live-signal" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(
    `https://api.github.com/users/${username}/events/public?per_page=100`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`GitHub events request failed with ${response.status}`);
  }

  const events = await response.json();
  for (const event of events) {
    if (event.type !== "PushEvent") continue;
    const date = event.created_at
      ? dateInTimeZone(new Date(event.created_at))
      : undefined;
    if (!counts.has(date)) continue;
    const commitCount = event.payload?.commits?.length || 1;
    counts.set(date, counts.get(date) + commitCount);
    const repositoryName = event.repo?.name?.split("/").at(-1) || "Other";
    repositoryCounts.set(
      repositoryName,
      (repositoryCounts.get(repositoryName) || 0) + commitCount,
    );
  }
}

if (!(await fetchGraphqlCommits())) {
  await fetchPublicPushEvents();
}

const values = dates.map((date) => counts.get(date) || 0);
const total = values.reduce((sum, value) => sum + value, 0);
const max = Math.max(...values, 1);
const baseline = 211;
const maxHeight = 116;
const barWidth = 34;
const gap = 14;
const startX = 234;
const labels = dates.map((date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(
  "en-US",
  { weekday: "short", timeZone: "UTC" },
));

const bars = values.map((value, index) => {
  const height = value === 0 ? 3 : Math.max(12, Math.round((value / max) * maxHeight));
  const x = startX + index * (barWidth + gap);
  const y = baseline - height;
  const delay = (index * 0.09).toFixed(2);
  const color = index === values.length - 1 ? "#2DD4BF" : "#4F7CFF";
  return `
    <g>
      <rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="7" fill="${color}" fill-opacity=".78">
        <animate attributeName="y" from="${baseline}" to="${y}" dur=".65s" begin="${delay}s" fill="freeze" />
        <animate attributeName="height" from="0" to="${height}" dur=".65s" begin="${delay}s" fill="freeze" />
      </rect>
      <text x="${x + barWidth / 2}" y="${Math.max(82, y - 8)}" text-anchor="middle" fill="#D8E0ED" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="10" font-weight="700">${value}</text>
      <text x="${x + barWidth / 2}" y="232" text-anchor="middle" fill="#7F8FA8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="9">${labels[index]}</text>
    </g>`;
}).join("");

const rangeLabel = `${dates[0].slice(5).replace("-", "/")} — ${dates.at(-1).slice(5).replace("-", "/")}`;
const updatedLabel = dates.at(-1);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260" viewBox="0 0 600 260" role="img" aria-labelledby="title desc">
  <title id="title">Commits over the last seven days</title>
  <desc id="desc">A daily bar chart showing ${total} commits by ${username} during the rolling seven-day period.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="600" y2="260" gradientUnits="userSpaceOnUse"><stop stop-color="#07101F"/><stop offset="1" stop-color="#101A2B"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#4F7CFF"/><stop offset="1" stop-color="#2DD4BF"/></linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#91A0B8" stroke-opacity=".05"/></pattern>
    <clipPath id="clip"><rect width="600" height="260" rx="18"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="600" height="260" fill="url(#bg)"/>
    <rect width="600" height="260" fill="url(#grid)"/>
    <text x="28" y="33" fill="#71809A" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="2">COMMITS / LAST 7 DAYS</text>
    <text x="28" y="92" fill="#F2F5FC" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="48" font-weight="650">${total}</text>
    <text x="28" y="116" fill="#91A0B8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="11" letter-spacing="1">COMMITS THIS WEEK</text>
    <text x="28" y="173" fill="#D8E0ED" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="13">${rangeLabel}</text>
    <text x="28" y="196" fill="#71809A" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="9">Updated ${updatedLabel} · public activity</text>
    <line x1="220" y1="211" x2="580" y2="211" stroke="#91A0B8" stroke-opacity=".16"/>
    ${bars}
    <rect x=".75" y=".75" width="598.5" height="258.5" rx="17.25" fill="none" stroke="#91A0B8" stroke-opacity=".14" stroke-width="1.5"/>
    <rect y="257" width="600" height="3" fill="url(#accent)"><animate attributeName="opacity" values=".45;1;.45" dur="4s" repeatCount="indefinite"/></rect>
  </g>
</svg>\n`;

const excludedFocusRepositories = new Set([username.toLowerCase(), "jonzhang"]);
const sortedRepositories = [...repositoryCounts.entries()]
  .filter(([repository]) => !excludedFocusRepositories.has(repository.toLowerCase()))
  .sort((left, right) => right[1] - left[1]);
const focusEntries = sortedRepositories.slice(0, 4);
const otherCommits = sortedRepositories
  .slice(4)
  .reduce((sum, [, count]) => sum + count, 0);
if (otherCommits > 0) focusEntries.push(["Other", otherCommits]);
if (focusEntries.length === 0) focusEntries.push(["No public commits", 0]);

const focusMax = Math.max(...focusEntries.map(([, count]) => count), 1);
const focusColors = ["#4F7CFF", "#2DD4BF", "#A78BFA", "#F59E42", "#91A0B8"];
const focusRows = focusEntries.map(([repository, count], index) => {
  const y = 85 + index * 31;
  const width = count === 0 ? 3 : Math.max(14, Math.round((count / focusMax) * 325));
  const color = focusColors[index % focusColors.length];
  const label = repository.length > 18 ? `${repository.slice(0, 17)}…` : repository;
  return `
    <g>
      <text x="28" y="${y}" fill="#D8E0ED" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="11" font-weight="650">${label}</text>
      <rect x="170" y="${y - 12}" width="325" height="12" rx="6" fill="#91A0B8" fill-opacity=".08" />
      <rect x="170" y="${y - 12}" width="${width}" height="12" rx="6" fill="${color}" fill-opacity=".82">
        <animate attributeName="width" from="0" to="${width}" dur=".75s" begin="${(index * 0.1).toFixed(2)}s" fill="freeze" />
      </rect>
      <text x="550" y="${y}" text-anchor="end" fill="#F2F5FC" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="11" font-weight="700">${count}</text>
    </g>`;
}).join("");

const focusSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260" viewBox="0 0 600 260" role="img" aria-labelledby="title desc">
  <title id="title">This week's project focus</title>
  <desc id="desc">Commit distribution across ${focusEntries.length} active project groups during the last seven days.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="600" y2="260" gradientUnits="userSpaceOnUse"><stop stop-color="#07101F"/><stop offset="1" stop-color="#101A2B"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#2DD4BF"/><stop offset=".52" stop-color="#4F7CFF"/><stop offset="1" stop-color="#A78BFA"/></linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#91A0B8" stroke-opacity=".05"/></pattern>
    <clipPath id="clip"><rect width="600" height="260" rx="18"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="600" height="260" fill="url(#bg)"/>
    <rect width="600" height="260" fill="url(#grid)"/>
    <text x="28" y="33" fill="#71809A" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="2">THIS WEEK / PROJECT FOCUS</text>
    <text x="28" y="58" fill="#D7DEEA" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="13">Where the last seven days of work landed.</text>
    <text x="550" y="34" text-anchor="end" fill="#2DD4BF" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="10" font-weight="700">${sortedRepositories.length} ACTIVE REPOS</text>
    ${focusRows}
    <text x="28" y="239" fill="#71809A" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="9">Updated ${updatedLabel} · public activity</text>
    <rect x=".75" y=".75" width="598.5" height="258.5" rx="17.25" fill="none" stroke="#91A0B8" stroke-opacity=".14" stroke-width="1.5"/>
    <rect y="257" width="600" height="3" fill="url(#accent)"><animate attributeName="opacity" values=".45;1;.45" dur="4s" repeatCount="indefinite"/></rect>
  </g>
</svg>\n`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, svg, "utf8");
writeFileSync(focusOutputPath, focusSvg, "utf8");

const readmePath = resolve("README.md");
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  const refreshedReadme = readme
    .replace(
      /(\.\/assets\/live-signal\/weekly-commits\.svg\?v=)[0-9-]+/,
      `$1${updatedLabel}`,
    )
    .replace(
      /(\.\/assets\/live-signal\/weekly-focus\.svg\?v=)[0-9-]+/,
      `$1${updatedLabel}`,
    );
  if (refreshedReadme !== readme) {
    writeFileSync(readmePath, refreshedReadme, "utf8");
  }
}

console.log(`Wrote weekly signals with ${total} commits across ${sortedRepositories.length} repositories.`);
