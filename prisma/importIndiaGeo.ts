/**
 * One-time bulk loader for the full India reference geography:
 * Country -> State -> City -> Pincode -> Area (post office name).
 *
 * Source: prisma/data/india-post-offices.json (~39.7k post offices, 35 states,
 * ~2.7k state+city pairs, ~23.9k pincodes). Area here is the post office name
 * exactly as India Post records it - it's real reference data, not a guess, so
 * it seeds the Area dropdown with genuine local names. Users can still pick a
 * different/finer Sub-area or type an Area that isn't in this list; anything
 * new still goes to pending review and the matching/merge tooling still
 * applies exactly the same way on top of this starting set.
 *
 * Safe to re-run: every insert is a createMany({ skipDuplicates: true }) keyed
 * on the same (parentId, level, normalizedKey) uniqueness the app enforces
 * everywhere else, so re-running only fills in anything missing.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AddressLevel, PrismaClient } from "@prisma/client";
import { normalizeKey } from "../src/utils/normalize";

const prisma = new PrismaClient();

// Old/alternate names in the source data -> the name AB should standardise on.
const STATE_RENAME: Record<string, string> = {
  Orissa: "Odisha",
  Uttaranchal: "Uttarakhand",
  Pondicherry: "Puducherry",
  "Andaman Nicobar": "Andaman and Nicobar Islands",
};

const CITY_RENAME: Record<string, string> = {
  Gurgaon: "Gurugram",
  Bombay: "Mumbai",
  Calcutta: "Kolkata",
  Madras: "Chennai",
  Bangalore: "Bengaluru",
  Poona: "Pune",
  Baroda: "Vadodara",
  Mysore: "Mysuru",
  Cochin: "Kochi",
  Trivandrum: "Thiruvananthapuram",
};

interface SourceRow {
  PostOfficeName: string;
  Pincode: string;
  City: string;
  District: string;
  State: string;
}

type NodeInsert = {
  id: string;
  level: AddressLevel;
  name: string;
  normalizedKey: string;
  code: string | null;
  parentId: string | null;
  status: "ACTIVE";
};

async function chunkedCreateMany(rows: NodeInsert[], label: string, chunkSize = 3000) {
  let created = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const result = await prisma.addressNode.createMany({ data: chunk, skipDuplicates: true });
    created += result.count;
  }
  // eslint-disable-next-line no-console
  console.log(`${label}: inserted ${created} new / ${rows.length} candidate rows`);
}

async function main() {
  const raw = readFileSync(join(__dirname, "data/india-post-offices.json"), "utf-8").replace(/^﻿/, "");
  const rows: SourceRow[] = JSON.parse(raw).Sheet1;

  let india = await prisma.addressNode.findFirst({ where: { level: "COUNTRY", normalizedKey: normalizeKey("India") } });
  if (!india) {
    india = await prisma.addressNode.create({
      data: { id: randomUUID(), level: "COUNTRY", name: "India", normalizedKey: normalizeKey("India"), code: "IN", status: "ACTIVE" },
    });
  }

  // Existing nodes (from the earlier lightweight demo seed) must be reused,
  // not duplicated, so look everything up by normalizedKey first.
  const existingStates = await prisma.addressNode.findMany({ where: { level: "STATE", parentId: india.id } });
  const stateByKey = new Map(existingStates.map((s) => [s.normalizedKey, s]));

  const stateInserts: NodeInsert[] = [];
  for (const raw of new Set(rows.map((r) => (STATE_RENAME[r.State.trim()] ?? r.State.trim())))) {
    const key = normalizeKey(raw);
    if (stateByKey.has(key)) continue;
    const insert: NodeInsert = { id: randomUUID(), level: "STATE", name: raw, normalizedKey: key, code: null, parentId: india.id, status: "ACTIVE" };
    stateInserts.push(insert);
    stateByKey.set(key, insert as any);
  }
  await chunkedCreateMany(stateInserts, "States");

  // Re-read to get real ids for the ones that already existed / were just skipped-as-duplicate.
  const allStates = await prisma.addressNode.findMany({ where: { level: "STATE", parentId: india.id } });
  const stateIdByKey = new Map(allStates.map((s) => [s.normalizedKey, s.id]));

  const existingCities = await prisma.addressNode.findMany({ where: { level: "CITY" } });
  const cityByKey = new Map(existingCities.map((c) => [`${c.parentId}::${c.normalizedKey}`, c]));

  const cityInserts: NodeInsert[] = [];
  const cityPairs = new Set<string>();
  for (const r of rows) {
    const stateName = STATE_RENAME[r.State.trim()] ?? r.State.trim();
    const cityName = CITY_RENAME[r.City.trim()] ?? r.City.trim();
    if (!cityName) continue;
    const stateId = stateIdByKey.get(normalizeKey(stateName));
    if (!stateId) continue;
    const cityKey = normalizeKey(cityName);
    const dedupeKey = `${stateId}::${cityKey}`;
    if (cityPairs.has(dedupeKey) || cityByKey.has(dedupeKey)) continue;
    cityPairs.add(dedupeKey);
    const insert: NodeInsert = { id: randomUUID(), level: "CITY", name: cityName, normalizedKey: cityKey, code: null, parentId: stateId, status: "ACTIVE" };
    cityInserts.push(insert);
    cityByKey.set(dedupeKey, insert as any);
  }
  await chunkedCreateMany(cityInserts, "Cities");

  const allCities = await prisma.addressNode.findMany({ where: { level: "CITY" } });
  const cityIdByKey = new Map(allCities.map((c) => [`${c.parentId}::${c.normalizedKey}`, c.id]));

  const existingPincodes = await prisma.addressNode.findMany({ where: { level: "PINCODE" } });
  const pincodeByKey = new Map(existingPincodes.map((p) => [`${p.parentId}::${p.normalizedKey}`, p]));

  const pincodeInserts: NodeInsert[] = [];
  const pincodePairs = new Set<string>();
  for (const r of rows) {
    const pincode = r.Pincode.trim();
    if (!/^\d{6}$/.test(pincode)) continue;
    const stateName = STATE_RENAME[r.State.trim()] ?? r.State.trim();
    const cityName = CITY_RENAME[r.City.trim()] ?? r.City.trim();
    const stateId = stateIdByKey.get(normalizeKey(stateName));
    if (!stateId) continue;
    const cityId = cityIdByKey.get(`${stateId}::${normalizeKey(cityName)}`);
    if (!cityId) continue;
    const dedupeKey = `${cityId}::${pincode}`;
    if (pincodePairs.has(dedupeKey) || pincodeByKey.has(dedupeKey)) continue;
    pincodePairs.add(dedupeKey);
    const insert: NodeInsert = { id: randomUUID(), level: "PINCODE", name: pincode, normalizedKey: pincode, code: pincode, parentId: cityId, status: "ACTIVE" };
    pincodeInserts.push(insert);
    pincodeByKey.set(dedupeKey, insert as any);
  }
  await chunkedCreateMany(pincodeInserts, "Pincodes");

  const allPincodes = await prisma.addressNode.findMany({ where: { level: "PINCODE" } });
  const pincodeIdByKey = new Map(allPincodes.map((p) => [`${p.parentId}::${p.normalizedKey}`, p.id]));

  const existingAreas = await prisma.addressNode.findMany({ where: { level: "AREA" } });
  const areaByKey = new Set(existingAreas.map((a) => `${a.parentId}::${a.normalizedKey}`));

  const areaInserts: NodeInsert[] = [];
  const areaPairs = new Set<string>();
  for (const r of rows) {
    const pincode = r.Pincode.trim();
    if (!/^\d{6}$/.test(pincode)) continue;
    const areaName = r.PostOfficeName.trim();
    if (!areaName) continue;
    const stateName = STATE_RENAME[r.State.trim()] ?? r.State.trim();
    const cityName = CITY_RENAME[r.City.trim()] ?? r.City.trim();
    const stateId = stateIdByKey.get(normalizeKey(stateName));
    if (!stateId) continue;
    const cityId = cityIdByKey.get(`${stateId}::${normalizeKey(cityName)}`);
    if (!cityId) continue;
    const pincodeId = pincodeIdByKey.get(`${cityId}::${pincode}`);
    if (!pincodeId) continue;
    const areaKey = normalizeKey(areaName);
    const dedupeKey = `${pincodeId}::${areaKey}`;
    if (areaPairs.has(dedupeKey) || areaByKey.has(dedupeKey)) continue;
    areaPairs.add(dedupeKey);
    areaInserts.push({ id: randomUUID(), level: "AREA", name: areaName, normalizedKey: areaKey, code: null, parentId: pincodeId, status: "ACTIVE" });
  }
  await chunkedCreateMany(areaInserts, "Areas");

  // eslint-disable-next-line no-console
  console.log("India geography import complete: Country > State > City > Pincode > Area is now fully loaded.");
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
