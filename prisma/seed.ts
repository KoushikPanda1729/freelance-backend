import { PrismaClient, AddressLevel } from "@prisma/client";
import { normalizeKey } from "../src/utils/normalize";

const prisma = new PrismaClient();

async function upsertNode(level: AddressLevel, name: string, parentId: string | null, code?: string) {
  const normalizedKey = normalizeKey(name);
  const existing = await prisma.addressNode.findFirst({ where: { level, parentId, normalizedKey } });
  if (existing) return existing;
  return prisma.addressNode.create({
    data: { level, name, normalizedKey, parentId, code, status: "ACTIVE" },
  });
}

async function main() {
  const india = await upsertNode("COUNTRY", "India", null, "IN");

  const haryana = await upsertNode("STATE", "Haryana", india.id, "HR");
  const delhiState = await upsertNode("STATE", "Delhi", india.id, "DL");
  const karnataka = await upsertNode("STATE", "Karnataka", india.id, "KA");

  const gurugram = await upsertNode("CITY", "Gurugram", haryana.id);
  const faridabad = await upsertNode("CITY", "Faridabad", haryana.id);
  const newDelhi = await upsertNode("CITY", "New Delhi", delhiState.id);
  const bengaluru = await upsertNode("CITY", "Bengaluru", karnataka.id);

  const pin122001 = await upsertNode("PINCODE", "122001", gurugram.id, "122001");
  const pin122018 = await upsertNode("PINCODE", "122018", gurugram.id, "122018");
  const pin110001 = await upsertNode("PINCODE", "110001", newDelhi.id, "110001");
  const pin560001 = await upsertNode("PINCODE", "560001", bengaluru.id, "560001");
  const pin121001 = await upsertNode("PINCODE", "121001", faridabad.id, "121001");

  const sector62 = await upsertNode("AREA", "Sector 62", pin122018.id);
  await upsertNode("AREA", "Sector 63", pin122018.id);
  await upsertNode("AREA", "DLF Phase 1", pin122001.id);
  await upsertNode("AREA", "DLF Phase 2", pin122001.id);
  await upsertNode("AREA", "Connaught Place", pin110001.id);
  await upsertNode("AREA", "MG Road", pin560001.id);
  await upsertNode("AREA", "Sector 21", pin121001.id);

  await upsertNode("SUBAREA", "Block A", sector62.id);
  await upsertNode("SUBAREA", "Block B", sector62.id);

  // eslint-disable-next-line no-console
  console.log("Seed complete: India > {Haryana, Delhi, Karnataka} > cities > pincodes > areas");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
