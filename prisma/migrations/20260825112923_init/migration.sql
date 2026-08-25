-- CreateEnum
CREATE TYPE "AddressLevel" AS ENUM ('COUNTRY', 'STATE', 'CITY', 'PINCODE', 'AREA', 'SUBAREA');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('ACTIVE', 'PENDING', 'MERGED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE', 'MERGE', 'CORRECT', 'RELINK');

-- CreateTable
CREATE TABLE "AddressNode" (
    "id" TEXT NOT NULL,
    "level" "AddressLevel" NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "code" TEXT,
    "status" "NodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "isUserSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "mergedIntoId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressAlias" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "aliasText" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddressAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAddress" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "pincodeId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "subAreaId" TEXT,
    "line1" TEXT,
    "line2" TEXT,
    "landmark" TEXT,
    "rawAreaText" TEXT,
    "rawSubAreaText" TEXT,
    "fullAddressCache" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "nodeId" TEXT,
    "targetNodeId" TEXT,
    "relinkedCount" INTEGER,
    "reason" TEXT,
    "meta" JSONB,
    "performedBy" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddressNode_level_status_idx" ON "AddressNode"("level", "status");

-- CreateIndex
CREATE INDEX "AddressNode_normalizedKey_idx" ON "AddressNode"("normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "AddressNode_parentId_level_normalizedKey_key" ON "AddressNode"("parentId", "level", "normalizedKey");

-- CreateIndex
CREATE INDEX "AddressAlias_normalizedKey_idx" ON "AddressAlias"("normalizedKey");

-- CreateIndex
CREATE INDEX "AddressAlias_nodeId_idx" ON "AddressAlias"("nodeId");

-- CreateIndex
CREATE INDEX "UserAddress_entityType_entityId_idx" ON "UserAddress"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "UserAddress_areaId_idx" ON "UserAddress"("areaId");

-- CreateIndex
CREATE INDEX "UserAddress_subAreaId_idx" ON "UserAddress"("subAreaId");

-- CreateIndex
CREATE INDEX "UserAddress_pincodeId_idx" ON "UserAddress"("pincodeId");

-- CreateIndex
CREATE INDEX "AuditLog_nodeId_idx" ON "AuditLog"("nodeId");

-- CreateIndex
CREATE INDEX "AuditLog_targetNodeId_idx" ON "AuditLog"("targetNodeId");

-- AddForeignKey
ALTER TABLE "AddressNode" ADD CONSTRAINT "AddressNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AddressNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressNode" ADD CONSTRAINT "AddressNode_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "AddressNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressAlias" ADD CONSTRAINT "AddressAlias_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "AddressNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "AddressNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "AddressNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "AddressNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_pincodeId_fkey" FOREIGN KEY ("pincodeId") REFERENCES "AddressNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "AddressNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_subAreaId_fkey" FOREIGN KEY ("subAreaId") REFERENCES "AddressNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "AddressNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "AddressNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
