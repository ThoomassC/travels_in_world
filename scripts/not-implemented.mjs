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
    `  Content validation (TIW-9), the trip skeleton and geocoding (TIW-10) are\n` +
    `  delivered; photo indexing is not. This placeholder fails on purpose so\n` +
    `  that no pipeline can mistake it for a successful run.\n\n`
);

process.exit(1);
