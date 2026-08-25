import { AddressNode, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { resolveFinalNode } from "./addressNode.service";

type WithNodes = {
  country: AddressNode;
  state: AddressNode;
  city: AddressNode;
  pincode: AddressNode;
  area: AddressNode;
  subArea?: AddressNode | null;
  line1?: string | null;
  line2?: string | null;
  landmark?: string | null;
};

export function buildFullAddressCache(ua: WithNodes): string {
  const parts = [
    ua.line1,
    ua.subArea?.name,
    ua.area.name,
    ua.city.name,
    ua.state.name,
    ua.country.name,
  ].filter(Boolean);
  return `${parts.join(", ")} - ${ua.pincode.name}`;
}

export async function createUserAddress(input: {
  entityType: string;
  entityId: string;
  countryId: string;
  stateId: string;
  cityId: string;
  pincodeId: string;
  areaId: string;
  subAreaId?: string | null;
  line1?: string;
  line2?: string;
  landmark?: string;
  rawAreaText?: string;
  rawSubAreaText?: string;
  createdBy?: string;
}) {
  // Always land on the live master in case any of these ids were merged after being resolved client-side.
  const [country, state, city, pincode, area, subArea] = await Promise.all([
    resolveFinalNode(input.countryId),
    resolveFinalNode(input.stateId),
    resolveFinalNode(input.cityId),
    resolveFinalNode(input.pincodeId),
    resolveFinalNode(input.areaId),
    input.subAreaId ? resolveFinalNode(input.subAreaId) : Promise.resolve(null),
  ]);

  const fullAddressCache = buildFullAddressCache({
    country,
    state,
    city,
    pincode,
    area,
    subArea,
    line1: input.line1,
  });

  return prisma.userAddress.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      countryId: country.id,
      stateId: state.id,
      cityId: city.id,
      pincodeId: pincode.id,
      areaId: area.id,
      subAreaId: subArea?.id ?? null,
      line1: input.line1,
      line2: input.line2,
      landmark: input.landmark,
      rawAreaText: input.rawAreaText,
      rawSubAreaText: input.rawSubAreaText,
      fullAddressCache,
      createdBy: input.createdBy,
    },
    include: { country: true, state: true, city: true, pincode: true, area: true, subArea: true },
  });
}

export async function updateUserAddress(
  id: string,
  input: Partial<Parameters<typeof createUserAddress>[0]>
) {
  const existing = await prisma.userAddress.findUniqueOrThrow({ where: { id } });

  const resolved = {
    countryId: input.countryId ? (await resolveFinalNode(input.countryId)).id : existing.countryId,
    stateId: input.stateId ? (await resolveFinalNode(input.stateId)).id : existing.stateId,
    cityId: input.cityId ? (await resolveFinalNode(input.cityId)).id : existing.cityId,
    pincodeId: input.pincodeId ? (await resolveFinalNode(input.pincodeId)).id : existing.pincodeId,
    areaId: input.areaId ? (await resolveFinalNode(input.areaId)).id : existing.areaId,
    subAreaId:
      input.subAreaId !== undefined
        ? input.subAreaId
          ? (await resolveFinalNode(input.subAreaId)).id
          : null
        : existing.subAreaId,
  };

  const [country, state, city, pincode, area, subArea] = await Promise.all([
    prisma.addressNode.findUniqueOrThrow({ where: { id: resolved.countryId } }),
    prisma.addressNode.findUniqueOrThrow({ where: { id: resolved.stateId } }),
    prisma.addressNode.findUniqueOrThrow({ where: { id: resolved.cityId } }),
    prisma.addressNode.findUniqueOrThrow({ where: { id: resolved.pincodeId } }),
    prisma.addressNode.findUniqueOrThrow({ where: { id: resolved.areaId } }),
    resolved.subAreaId ? prisma.addressNode.findUniqueOrThrow({ where: { id: resolved.subAreaId } }) : Promise.resolve(null),
  ]);

  const fullAddressCache = buildFullAddressCache({
    country,
    state,
    city,
    pincode,
    area,
    subArea,
    line1: input.line1 ?? existing.line1,
  });

  return prisma.userAddress.update({
    where: { id },
    data: {
      ...resolved,
      line1: input.line1 ?? existing.line1,
      line2: input.line2 ?? existing.line2,
      landmark: input.landmark ?? existing.landmark,
      rawAreaText: input.rawAreaText ?? existing.rawAreaText,
      rawSubAreaText: input.rawSubAreaText ?? existing.rawSubAreaText,
      fullAddressCache,
    },
    include: { country: true, state: true, city: true, pincode: true, area: true, subArea: true },
  });
}

export async function getUserAddressForEntity(entityType: string, entityId: string) {
  return prisma.userAddress.findFirst({
    where: { entityType, entityId },
    include: { country: true, state: true, city: true, pincode: true, area: true, subArea: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function searchUserAddresses(params: { q?: string; entityType?: string; page?: number; pageSize?: number }) {
  const { q, entityType, page = 1, pageSize = 25 } = params;
  const where: Prisma.UserAddressWhereInput = {};
  if (entityType) where.entityType = entityType;
  if (q) where.fullAddressCache = { contains: q, mode: "insensitive" };

  const [items, total] = await Promise.all([
    prisma.userAddress.findMany({
      where,
      include: { country: true, state: true, city: true, pincode: true, area: true, subArea: true },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.userAddress.count({ where }),
  ]);

  return { items, total, page, pageSize };
}
