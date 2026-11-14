import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const username = process.env.GITHUB_USERNAME || "jonxsong";
const token = process.env.GITHUB_TOKEN || "";
const outputPath = resolve(process.env.OUTPUT_PATH || "assets/live-signal/weekly-commits.svg");

const today = new Date();
const dates = Array.from({ length: 7 }, (_, index) => {
  const day = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - (6 - index),
  ));
  return day.toISOString().slice(0, 10);
});

const counts = new Map(dates.map((date) => [date, 0]));

async function fetchGraphqlCommits() {
  if (!token) return false;

  const query = `
    query WeeklyCommits($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 100) {
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
        to: `${dates.at(-1)}T23:59:59Z`,
      },
    }),
  });

  if (!response.ok) return false;
  const payload = await response.json();
  if (payload.errors?.length) return false;

  const repositories = payload.data?.user?.contributionsCollection
    ?.commitContributionsByRepository ?? [];
  for (const repository of repositories) {
    for (const contribution of repository.contributions?.nodes ?? []) {
      const date = contribution.occurredAt?.slice(0, 10);
      if (counts.has(date)) {
        counts.set(date, counts.get(date) + (contribution.commitCount || 0));
      }
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
    const date = event.created_at?.slice(0, 10);
    if (!counts.has(date)) continue;
    const commitCount = event.payload?.commits?.length || 1;
    counts.set(date, counts.get(date) + commitCount);
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
const updatedLabel = today.toISOString().slice(0, 10);
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

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, svg, "utf8");

const readmePath = resolve("README.md");
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  const refreshedReadme = readme.replace(
    /(\.\/assets\/live-signal\/weekly-commits\.svg\?v=)[0-9-]+/,
    `$1${updatedLabel}`,
  );
  if (refreshedReadme !== readme) {
    writeFileSync(readmePath, refreshedReadme, "utf8");
  }
}

console.log(`Wrote ${outputPath} with ${total} commits.`);
