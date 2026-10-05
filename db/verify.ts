import { createDatabase } from "./index";
import {
  getCurrentMonthClaimsByBranch,
  getExpiringPolicies,
  getInsuranceRecordCounts,
} from "./queries";

async function main() {
  const { db, client } = createDatabase();

  try {
    const [counts, expiringPolicies, claimsByBranch] = await Promise.all([
      getInsuranceRecordCounts(db),
      getExpiringPolicies(db, { days: 15, minimumPremium: 20_000, limit: 5 }),
      getCurrentMonthClaimsByBranch(db),
    ]);

    console.log("Database counts");
    console.table(counts);
    console.log("Sample: policies expiring in 15 days above ₹20,000");
    console.table(expiringPolicies);
    console.log("Sample: current-month high-value claims by branch");
    console.table(claimsByBranch.slice(0, 5));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
