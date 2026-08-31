import "dotenv/config";
import { client } from "../lib/db";
import * as analysis from "../lib/services/analysis";

/**
 * Queue every finished game that has no analysis row.
 *
 * Games finished before the worker existed, or before a change that makes the
 * old numbers worth redoing. Ordinary games queue themselves as they finish, so
 * this is a one-off rather than a cron job.
 */
async function main() {
  const added = await analysis.enqueueMissing();
  const counts = await analysis.queueCounts();

  console.log(
    added === 0
      ? "Nothing to add: every finished game already has an analysis row."
      : `Queued ${added} game(s).`,
  );
  console.log(
    `Queue: ${counts.queued} queued, ${counts.running} running, ` +
      `${counts.done} done, ${counts.failed} failed.`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
