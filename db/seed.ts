import { fakerEN_IN as faker } from "@faker-js/faker";
import { count } from "drizzle-orm";
import { createDatabase } from "./index";
import {
  branches,
  claims,
  customers,
  endorsements,
  policies,
  products,
  relationshipManagers,
  renewals,
  vehicles,
} from "./schema";

const seed = 20260810;
faker.seed(seed);

const scale = Math.max(0.1, Number(process.env.SEED_SCALE ?? "1"));
const counts = {
  customers: Math.round(3_000 * scale),
  policies: Math.round(8_000 * scale),
  claims: Math.round(1_400 * scale),
  renewals: Math.round(2_500 * scale),
  endorsements: Math.round(900 * scale),
};

const anchorDate = startOfDay(new Date());

const branchSeed = [
  ["HYD01", "Hyderabad Central", "Hyderabad", "Telangana", "south"],
  ["BLR01", "Bengaluru Central", "Bengaluru", "Karnataka", "south"],
  ["CHN01", "Chennai Central", "Chennai", "Tamil Nadu", "south"],
  ["VJA01", "Vijayawada", "Vijayawada", "Andhra Pradesh", "south"],
  ["KOC01", "Kochi", "Kochi", "Kerala", "south"],
  ["MUM01", "Mumbai Central", "Mumbai", "Maharashtra", "west"],
  ["PUN01", "Pune", "Pune", "Maharashtra", "west"],
  ["AMD01", "Ahmedabad", "Ahmedabad", "Gujarat", "west"],
  ["DEL01", "Delhi NCR", "New Delhi", "Delhi", "north"],
  ["JAI01", "Jaipur", "Jaipur", "Rajasthan", "north"],
  ["LKO01", "Lucknow", "Lucknow", "Uttar Pradesh", "north"],
  ["KOL01", "Kolkata Central", "Kolkata", "West Bengal", "east"],
] as const;

const productSeed = [
  ["MTR-PC-COMP", "Private Car Comprehensive", "private_car"],
  ["MTR-PC-SAOD", "Private Car Standalone Own Damage", "private_car"],
  ["MTR-PC-TP", "Private Car Third Party", "private_car"],
  ["MTR-TW-COMP", "Two Wheeler Comprehensive", "two_wheeler"],
  ["MTR-TW-TP", "Two Wheeler Third Party", "two_wheeler"],
  ["MTR-CV-COMP", "Commercial Vehicle Comprehensive", "commercial_vehicle"],
] as const;

type VehicleCategory = "private_car" | "two_wheeler" | "commercial_vehicle";

const vehicleCatalogue: Record<
  VehicleCategory,
  readonly (readonly [string, string, string])[]
> = {
  private_car: [
    ["Maruti Suzuki", "Baleno", "Zeta"],
    ["Hyundai", "Creta", "SX"],
    ["Tata", "Nexon", "Creative Plus"],
    ["Honda", "Amaze", "VX"],
    ["Mahindra", "XUV700", "AX5"],
    ["Toyota", "Innova Crysta", "GX"],
  ],
  two_wheeler: [
    ["Honda", "Activa 6G", "DLX"],
    ["TVS", "Jupiter", "ZX"],
    ["Bajaj", "Pulsar N160", "Dual ABS"],
    ["Royal Enfield", "Classic 350", "Signals"],
    ["Ather", "450X", "Pro"],
  ],
  commercial_vehicle: [
    ["Tata", "Ace Gold", "Diesel"],
    ["Ashok Leyland", "Dost Plus", "LS"],
    ["Mahindra", "Bolero Pik-Up", "ExtraLong"],
    ["Eicher", "Pro 2049", "CNG"],
  ],
} as const;

type BranchInsert = typeof branches.$inferInsert;
type CustomerInsert = typeof customers.$inferInsert;
type ManagerInsert = typeof relationshipManagers.$inferInsert;
type ProductInsert = typeof products.$inferInsert;
type PolicyInsert = typeof policies.$inferInsert;
type VehicleInsert = typeof vehicles.$inferInsert;
type ClaimInsert = typeof claims.$inferInsert;
type RenewalInsert = typeof renewals.$inferInsert;
type EndorsementInsert = typeof endorsements.$inferInsert;

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://morphui:morphui_dev@localhost:5434/morphui";
  assertSafeSeedTarget(databaseUrl);

  const { db, client } = createDatabase(databaseUrl);

  try {
    const [{ value: existingPolicies }] = await db
      .select({ value: count() })
      .from(policies);

    if (Number(existingPolicies) > 0 && process.env.RESET_SEED !== "true") {
      console.log(
        `Seed skipped: ${existingPolicies} policies already exist. Set RESET_SEED=true to replace local synthetic data.`,
      );
      return;
    }

    if (Number(existingPolicies) > 0) {
      await client`
        truncate table
          endorsements,
          renewals,
          claims,
          vehicles,
          policies,
          products,
          relationship_managers,
          customers,
          branches
        restart identity cascade
      `;
    }

    const branchRows: BranchInsert[] = branchSeed.map(
      ([code, name, city, state, region]) => ({
        id: faker.string.uuid(),
        code,
        name,
        city,
        state,
        region,
      }),
    );
    await db.insert(branches).values(branchRows);

    const managerRows: ManagerInsert[] = branchRows.flatMap((branch, branchIndex) =>
      Array.from({ length: 3 }, (_, managerIndex) => {
        const sequence = branchIndex * 3 + managerIndex + 1;
        return {
          id: faker.string.uuid(),
          employeeCode: `RM${String(sequence).padStart(4, "0")}`,
          branchId: branch.id!,
          fullName: faker.person.fullName(),
          email: `rm${String(sequence).padStart(4, "0")}@morphui.example`,
          phone: syntheticPhone(sequence),
          joinedAt: faker.date.between({
            from: addDays(anchorDate, -2_000),
            to: addDays(anchorDate, -120),
          }),
        };
      }),
    );
    await db.insert(relationshipManagers).values(managerRows);

    const productRows: ProductInsert[] = productSeed.map(
      ([code, name, category]) => ({
        id: faker.string.uuid(),
        code,
        name,
        category,
        description: `${name} cover for the Indian motor insurance demonstration dataset.`,
      }),
    );
    await db.insert(products).values(productRows);

    const customerRows: CustomerInsert[] = Array.from(
      { length: counts.customers },
      (_, index) => {
        const corporate = faker.number.int({ min: 1, max: 100 }) <= 18;
        const branch = faker.helpers.arrayElement(branchRows);
        return {
          id: faker.string.uuid(),
          customerNumber: `CUS${String(index + 1).padStart(8, "0")}`,
          type: corporate ? "corporate" : "individual",
          segment: corporate
            ? faker.helpers.arrayElement(["sme", "corporate"] as const)
            : "retail",
          fullName: corporate ? faker.company.name() : faker.person.fullName(),
          email: `customer${String(index + 1).padStart(6, "0")}@example.test`,
          phone: syntheticPhone(index + 101),
          city: branch.city,
          state: branch.state,
          postalCode: String(faker.number.int({ min: 110001, max: 855999 })),
          createdAt: faker.date.between({
            from: addDays(anchorDate, -1_600),
            to: addDays(anchorDate, -60),
          }),
        };
      },
    );
    await insertBatches(customerRows, (batch) =>
      db.insert(customers).values(batch),
    );

    const policyRows: PolicyInsert[] = [];
    const vehicleRows: VehicleInsert[] = [];

    for (let index = 0; index < counts.policies; index += 1) {
      const customer = faker.helpers.arrayElement(customerRows);
      const branch = faker.helpers.arrayElement(branchRows);
      const managersForBranch = managerRows.filter(
        (manager) => manager.branchId === branch.id,
      );
      const manager = faker.helpers.arrayElement(managersForBranch);
      const product = faker.helpers.arrayElement(productRows);
      const expiryDate = faker.date.between({
        from: addDays(anchorDate, -330),
        to: addDays(anchorDate, 120),
      });
      const startDate = addDays(expiryDate, -365);
      const status = expiryDate < anchorDate ? "expired" : "active";
      const basePremium = premiumForCategory(product.category);
      const thirdPartyPremium = roundMoney(basePremium * faker.number.float({ min: 0.22, max: 0.38 }));
      const ownDamagePremium = roundMoney(basePremium - thirdPartyPremium);
      const gstAmount = roundMoney(basePremium * 0.18);
      const totalPremium = roundMoney(basePremium + gstAmount);
      const policyId = faker.string.uuid();

      policyRows.push({
        id: policyId,
        policyNumber: `MTR-${anchorDate.getFullYear()}-${String(index + 1).padStart(8, "0")}`,
        customerId: customer.id!,
        productId: product.id!,
        branchId: branch.id!,
        relationshipManagerId: manager.id!,
        businessType: faker.number.int({ min: 1, max: 100 }) <= 64 ? "renewal" : "new",
        status,
        channel: faker.helpers.weightedArrayElement([
          { value: "agent", weight: 35 },
          { value: "digital", weight: 24 },
          { value: "broker", weight: 18 },
          { value: "direct", weight: 14 },
          { value: "partner", weight: 9 },
        ] as const),
        startDate,
        expiryDate,
        sumInsured: insuredValueForCategory(product.category),
        ownDamagePremium,
        thirdPartyPremium,
        gstAmount,
        totalPremium,
        paymentStatus: "paid",
        issuedAt: addDays(startDate, -faker.number.int({ min: 1, max: 18 })),
        createdAt: addDays(startDate, -faker.number.int({ min: 1, max: 20 })),
        updatedAt: faker.date.between({ from: startDate, to: anchorDate }),
      });

      const [make, model, variant] = faker.helpers.arrayElement(
        vehicleCatalogue[product.category],
      );
      vehicleRows.push({
        id: faker.string.uuid(),
        policyId,
        registrationNumber: syntheticRegistration(branch.state, index),
        vehicleType: product.category,
        make,
        model,
        variant,
        fuelType:
          product.category === "two_wheeler"
            ? faker.helpers.arrayElement(["petrol", "electric"] as const)
            : faker.helpers.weightedArrayElement([
                { value: "petrol", weight: 44 },
                { value: "diesel", weight: 31 },
                { value: "cng", weight: 10 },
                { value: "electric", weight: 9 },
                { value: "hybrid", weight: 6 },
              ] as const),
        manufactureYear: faker.number.int({
          min: Math.max(2008, anchorDate.getFullYear() - 14),
          max: anchorDate.getFullYear(),
        }),
        engineNumber: `EN${faker.string.alphanumeric({ length: 14, casing: "upper" })}`,
        chassisNumber: `CH${faker.string.alphanumeric({ length: 17, casing: "upper" })}`,
        insuredDeclaredValue: insuredValueForCategory(product.category),
      });
    }

    await insertBatches(policyRows, (batch) => db.insert(policies).values(batch));
    await insertBatches(vehicleRows, (batch) => db.insert(vehicles).values(batch));

    const eligibleClaimPolicies = policyRows.filter(
      (policy) => policy.startDate! <= anchorDate,
    );
    const claimRows: ClaimInsert[] = Array.from(
      { length: counts.claims },
      (_, index) => {
        const policy = faker.helpers.arrayElement(eligibleClaimPolicies);
        const incidentTo = minDate(policy.expiryDate!, anchorDate);
        const incidentFrom = maxDate(policy.startDate!, addDays(incidentTo, -300));
        const incidentDate = faker.date.between({
          from: incidentFrom,
          to: incidentTo,
        });
        const intimationDate = addDays(
          incidentDate,
          faker.number.int({ min: 0, max: 4 }),
        );
        const claimStatus = faker.helpers.weightedArrayElement([
          { value: "intimated", weight: 8 },
          { value: "documents_pending", weight: 12 },
          { value: "under_assessment", weight: 18 },
          { value: "approved", weight: 12 },
          { value: "settled", weight: 34 },
          { value: "rejected", weight: 7 },
          { value: "closed", weight: 9 },
        ] as const);
        const claimedAmount = roundMoney(
          faker.number.float({ min: 8_000, max: 650_000 }),
        );
        const approved = ["approved", "settled", "closed"].includes(claimStatus);
        const approvedAmount = approved
          ? roundMoney(claimedAmount * faker.number.float({ min: 0.58, max: 0.96 }))
          : null;
        return {
          id: faker.string.uuid(),
          claimNumber: `CLM-${anchorDate.getFullYear()}-${String(index + 1).padStart(7, "0")}`,
          policyId: policy.id!,
          branchId: policy.branchId,
          type: faker.helpers.weightedArrayElement([
            { value: "own_damage", weight: 77 },
            { value: "theft", weight: 8 },
            { value: "third_party", weight: 15 },
          ] as const),
          status: claimStatus,
          incidentDate,
          intimationDate,
          claimedAmount,
          approvedAmount,
          settledAmount:
            claimStatus === "settled" || claimStatus === "closed"
              ? approvedAmount
              : null,
          cause: faker.helpers.arrayElement([
            "Road collision",
            "Flood or water damage",
            "Theft of vehicle",
            "Glass and windshield damage",
            "Accidental exterior damage",
            "Third-party property damage",
          ]),
          surveyorName:
            claimStatus === "intimated" ? null : faker.person.fullName(),
          garageName: `${faker.company.name()} Auto Works`,
          closedAt:
            claimStatus === "closed" || claimStatus === "settled"
              ? addDays(intimationDate, faker.number.int({ min: 7, max: 45 }))
              : null,
          createdAt: intimationDate,
          updatedAt: addDays(intimationDate, faker.number.int({ min: 0, max: 30 })),
        };
      },
    );
    await insertBatches(claimRows, (batch) => db.insert(claims).values(batch));

    const renewalPolicies = faker.helpers.arrayElements(
      policyRows,
      Math.min(counts.renewals, policyRows.length),
    );
    const renewalRows: RenewalInsert[] = renewalPolicies.map((policy) => {
      const daysFromDue = differenceInDays(anchorDate, policy.expiryDate!);
      const status = renewalStatusForDate(daysFromDue);
      const contacted = !["due", "lapsed"].includes(status);
      const quotedPremium = roundMoney(
        policy.totalPremium * faker.number.float({ min: 0.94, max: 1.14 }),
      );
      return {
        id: faker.string.uuid(),
        policyId: policy.id!,
        assignedToId: policy.relationshipManagerId,
        dueDate: policy.expiryDate!,
        status,
        currentPremium: policy.totalPremium,
        quotedPremium: status === "due" ? null : quotedPremium,
        propensityScore: roundMoney(faker.number.float({ min: 18, max: 98 })),
        lastContactedAt: contacted
          ? addDays(anchorDate, -faker.number.int({ min: 0, max: 28 }))
          : null,
        nextFollowUpAt:
          ["contacted", "quoted", "payment_pending"].includes(status)
            ? addDays(anchorDate, faker.number.int({ min: 1, max: 10 }))
            : null,
        lostReason:
          status === "lost"
            ? faker.helpers.arrayElement([
                "Price comparison",
                "Vehicle sold",
                "Moved to another insurer",
                "Customer unreachable",
              ])
            : null,
      };
    });
    await insertBatches(renewalRows, (batch) => db.insert(renewals).values(batch));

    const endorsementRows: EndorsementInsert[] = Array.from(
      { length: counts.endorsements },
      (_, index) => {
        const policy = faker.helpers.arrayElement(policyRows);
        const requestedAt = faker.date.between({
          from: policy.startDate!,
          to: minDate(policy.expiryDate!, anchorDate),
        });
        const status = faker.helpers.weightedArrayElement([
          { value: "requested", weight: 8 },
          { value: "documents_pending", weight: 10 },
          { value: "under_review", weight: 12 },
          { value: "approved", weight: 12 },
          { value: "rejected", weight: 6 },
          { value: "completed", weight: 52 },
        ] as const);
        const type = faker.helpers.arrayElement([
          "address_change",
          "name_correction",
          "vehicle_transfer",
          "hypothecation_add",
          "hypothecation_remove",
          "coverage_change",
          "cancellation",
        ] as const);
        return {
          id: faker.string.uuid(),
          endorsementNumber: `END-${anchorDate.getFullYear()}-${String(index + 1).padStart(7, "0")}`,
          policyId: policy.id!,
          type,
          status,
          requestedAt,
          effectiveDate: addDays(requestedAt, faker.number.int({ min: 0, max: 8 })),
          premiumDelta:
            type === "coverage_change"
              ? roundMoney(faker.number.float({ min: -3_000, max: 12_000 }))
              : 0,
          notes: `Synthetic ${type.replaceAll("_", " ")} request for dynamic workspace testing.`,
          processedAt:
            status === "completed" || status === "rejected"
              ? addDays(requestedAt, faker.number.int({ min: 1, max: 12 }))
              : null,
        };
      },
    );
    await insertBatches(endorsementRows, (batch) =>
      db.insert(endorsements).values(batch),
    );

    console.log("MorphUI synthetic insurance data created.");
    console.table({
      branches: branchRows.length,
      relationshipManagers: managerRows.length,
      products: productRows.length,
      customers: customerRows.length,
      policies: policyRows.length,
      vehicles: vehicleRows.length,
      claims: claimRows.length,
      renewals: renewalRows.length,
      endorsements: endorsementRows.length,
    });
  } finally {
    await client.end();
  }
}

async function insertBatches<T>(
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>,
) {
  const batchSize = 500;
  for (let index = 0; index < rows.length; index += batchSize) {
    await insert(rows.slice(index, index + batchSize));
  }
}

function assertSafeSeedTarget(databaseUrl: string) {
  const target = new URL(databaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
  if (
    !localHosts.has(target.hostname) ||
    target.username !== "morphui" ||
    target.pathname !== "/morphui"
  ) {
    throw new Error(
      "Seeding is restricted to the local MorphUI development database.",
    );
  }
}

function startOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function minDate(first: Date, second: Date) {
  return first < second ? first : second;
}

function maxDate(first: Date, second: Date) {
  return first > second ? first : second;
}

function differenceInDays(first: Date, second: Date) {
  return Math.round((first.getTime() - second.getTime()) / 86_400_000);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function syntheticPhone(sequence: number) {
  return `+919${String(10_000_000 + (sequence % 89_999_999)).padStart(9, "0")}`;
}

function syntheticRegistration(state: string, sequence: number) {
  const stateCodes: Record<string, string> = {
    Telangana: "TS",
    Karnataka: "KA",
    "Tamil Nadu": "TN",
    "Andhra Pradesh": "AP",
    Kerala: "KL",
    Maharashtra: "MH",
    Gujarat: "GJ",
    Delhi: "DL",
    Rajasthan: "RJ",
    "Uttar Pradesh": "UP",
    "West Bengal": "WB",
  };
  const stateCode = stateCodes[state] ?? "IN";
  const district = String((sequence % 40) + 1).padStart(2, "0");
  const series = String.fromCharCode(65 + (sequence % 26));
  const number = String((sequence % 9_999) + 1).padStart(4, "0");
  return `${stateCode}${district}${series}${number}`;
}

function premiumForCategory(category: ProductInsert["category"]) {
  const range = {
    private_car: [9_000, 95_000],
    two_wheeler: [1_800, 18_000],
    commercial_vehicle: [22_000, 180_000],
  }[category];
  return roundMoney(faker.number.float({ min: range[0], max: range[1] }));
}

function insuredValueForCategory(category: ProductInsert["category"]) {
  const range = {
    private_car: [250_000, 3_800_000],
    two_wheeler: [35_000, 450_000],
    commercial_vehicle: [400_000, 5_500_000],
  }[category];
  return roundMoney(faker.number.float({ min: range[0], max: range[1] }));
}

function renewalStatusForDate(daysAfterDueDate: number): RenewalInsert["status"] {
  if (daysAfterDueDate > 45) {
    return faker.helpers.arrayElement(["converted", "lost", "lapsed"] as const);
  }
  if (daysAfterDueDate > 0) {
    return faker.helpers.arrayElement(
      ["contacted", "quoted", "payment_pending", "converted", "lapsed"] as const,
    );
  }
  return faker.helpers.arrayElement(
    ["due", "contacted", "quoted", "payment_pending"] as const,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
