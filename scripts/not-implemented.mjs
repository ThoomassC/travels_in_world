/**
 * Placeholder for the content-tooling scripts declared in package.json.
 *
 * These commands have a reserved name so that documentation, CI and editors can
 * already refer to them, but they must fail loudly: a script that exists and
 * silently does nothing is worse than a missing one.
 *
 * Usage: node scripts/not-implemented.mjs <script-name> <ticket>
 */
const [scriptName = "this script", ticket = "the follow-up ticket"] = process.argv.slice(2);

process.stderr.write(
  `\n  ${scriptName}: not implemented yet — see ${ticket}.\n` +
    `  The content pipeline (YAML/MDX loading, geocoding, photo indexing) is\n` +
    `  delivered by TIW-9 / TIW-10. This placeholder fails on purpose so that no\n` +
    `  pipeline can mistake it for a successful run.\n\n`
);

process.exit(1);
