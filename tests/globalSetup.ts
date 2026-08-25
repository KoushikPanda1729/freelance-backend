import { PrismaClient } from "@prisma/client";

// Runs once before the whole test run, in the test database only
// (package.json points DATABASE_URL at acrebytes_address_test_db for `npm test`).
// Wipes state so every run starts from a clean, known master.
export default async function globalSetup() {
  const prisma = new PrismaClient();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "UserAddress", "AuditLog", "AddressAlias", "AddressNode" RESTART IDENTITY CASCADE'
  );
  await prisma.$disconnect();
}
