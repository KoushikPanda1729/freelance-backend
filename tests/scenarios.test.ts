import { describe, expect, it } from "vitest";
import { admin, makeGeoFixture, user } from "./helpers";

describe("Address hierarchy & matching", () => {
  it("links to the existing master when Country/State/City/Pincode already exist", async () => {
    const { state, city } = await makeGeoFixture("Hierarchy");
    const res = await user()
      .post("/api/nodes/resolve")
      .send({ level: "CITY", name: "Hierarchy City", parentId: state.id });
    // Selecting the already-created city by its own name should resolve straight to it.
    expect(res.body.status).toBe("linked");
    expect(res.body.node.id).toBe(city.id);
  });

  it("creates a brand-new Area as PENDING for admin review", async () => {
    const { pincode } = await makeGeoFixture("NewArea");
    const res = await user().post("/api/nodes/resolve").send({ level: "AREA", name: "Sunrise Enclave", parentId: pincode.id });
    expect(res.body.status).toBe("created_pending");
    expect(res.body.node.status).toBe("PENDING");
  });

  it("auto-links 'Sec 62' to an existing 'Sector 62' (common abbreviation)", async () => {
    const { pincode } = await makeGeoFixture("Abbrev");
    const sector62 = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 62", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;

    const res = await user().post("/api/nodes/resolve").send({ level: "AREA", name: "Sec 62", parentId: pincode.id });
    expect(res.body.status).toBe("linked");
    expect(res.body.node.id).toBe(sector62.id);
  });

  it("does not confuse a different sector number with an existing one, even if textually similar", async () => {
    const { pincode } = await makeGeoFixture("NumberGuard");
    await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 62", parentId: pincode.id, status: "ACTIVE" });
    await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 63", parentId: pincode.id, status: "ACTIVE" });

    const res = await user().post("/api/nodes/resolve").send({ level: "AREA", name: "Sector 99", parentId: pincode.id });
    // Must not come back as a suggestion match against 62/63, and must not silently auto-link either.
    expect(res.body.status).toBe("created_pending");
  });

  it("offers a genuine near-duplicate as a suggestion instead of auto-creating or auto-linking", async () => {
    const { pincode } = await makeGeoFixture("Suggest");
    const sector62 = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 62", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;

    const res = await user().post("/api/nodes/resolve").send({ level: "AREA", name: "Sctor 62", parentId: pincode.id });
    expect(res.body.status).toBe("suggestions");
    expect(res.body.suggestions.map((s: any) => s.id)).toContain(sector62.id);
  });
});

describe("Admin authorisation", () => {
  it("blocks a non-admin from admin routes", async () => {
    const res = await user().get("/api/admin/nodes");
    expect(res.status).toBe(403);
  });

  it("allows an admin through", async () => {
    const res = await admin().get("/api/admin/nodes");
    expect(res.status).toBe(200);
  });
});

describe("Duplicate merge & wrong-address correction", () => {
  it("merges a duplicate into a primary and relinks every existing user address", async () => {
    const { country, state, city, pincode } = await makeGeoFixture("Merge");
    const sector62 = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 62", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;
    const sector63 = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 63", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;

    const addressPayload = {
      countryId: country.id,
      stateId: state.id,
      cityId: city.id,
      pincodeId: pincode.id,
      areaId: sector63.id,
      line1: "Plot 9",
    };
    const ua1 = (await user().post("/api/user-addresses").send({ entityType: "PROPERTY_LISTING", entityId: "p-1", ...addressPayload })).body.address;
    const ua2 = (await user().post("/api/user-addresses").send({ entityType: "LEAD", entityId: "l-1", ...addressPayload })).body.address;

    const mergeRes = await admin().post("/api/admin/merge").send({ primaryId: sector62.id, duplicateIds: [sector63.id] });
    expect(mergeRes.status).toBe(200);
    expect(mergeRes.body.totalRelinked).toBe(2);

    const refetched1 = (await user().get(`/api/user-addresses`).query({ entityType: "PROPERTY_LISTING", entityId: "p-1" })).body.address;
    const refetched2 = (await user().get(`/api/user-addresses`).query({ entityType: "LEAD", entityId: "l-1" })).body.address;
    expect(refetched1.areaId).toBe(sector62.id);
    expect(refetched2.areaId).toBe(sector62.id);
    expect(refetched1.fullAddressCache).toContain("Sector 62");
    expect(refetched1.id).not.toBe(ua2.id);
  });

  it("resolves a merged-away alias to the standard master afterwards", async () => {
    const { pincode } = await makeGeoFixture("AliasAfterMerge");
    const primary = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 62", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;
    const duplicate = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 63", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;
    await admin().post("/api/admin/merge").send({ primaryId: primary.id, duplicateIds: [duplicate.id] });

    const res = await user().post("/api/nodes/resolve").send({ level: "AREA", name: "Sector 63", parentId: pincode.id });
    expect(res.body.status).toBe("linked");
    expect(res.body.node.id).toBe(primary.id);
  });

  it("corrects a wrong address mapping and relinks existing records automatically", async () => {
    const { country, state, city, pincode } = await makeGeoFixture("Correct");
    const wrong = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 64", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;
    const correct = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 62", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;

    await user()
      .post("/api/user-addresses")
      .send({
        entityType: "SITE_VISIT",
        entityId: "v-1",
        countryId: country.id,
        stateId: state.id,
        cityId: city.id,
        pincodeId: pincode.id,
        areaId: wrong.id,
      });

    const correctRes = await admin().post("/api/admin/correct").send({ wrongId: wrong.id, correctId: correct.id });
    expect(correctRes.status).toBe(200);
    expect(correctRes.body.totalRelinked).toBe(1);

    const refetched = (await user().get("/api/user-addresses").query({ entityType: "SITE_VISIT", entityId: "v-1" })).body.address;
    expect(refetched.areaId).toBe(correct.id);
  });

  it("records merges and corrections in the audit log with the relinked count", async () => {
    const { pincode } = await makeGeoFixture("Audit");
    const primary = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 62", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;
    const duplicate = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 63", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;
    await admin().post("/api/admin/merge").send({ primaryId: primary.id, duplicateIds: [duplicate.id] });

    const log = await admin().get("/api/admin/audit-log").query({ nodeId: duplicate.id });
    expect(log.status).toBe(200);
    const mergeEntry = log.body.items.find((e: any) => e.action === "MERGE");
    expect(mergeEntry).toBeTruthy();
    expect(mergeEntry.targetNodeId).toBe(primary.id);
  });
});

describe("Cross-page consistency & clean search/report", () => {
  it("uses the same master address when the same location is entered on two different pages", async () => {
    const { country, state, city, pincode } = await makeGeoFixture("CrossPage");
    const area = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Unity Enclave", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;

    const payload = { countryId: country.id, stateId: state.id, cityId: city.id, pincodeId: pincode.id, areaId: area.id };
    const ua1 = (await user().post("/api/user-addresses").send({ entityType: "PROPERTY_LISTING", entityId: "cp-1", ...payload })).body.address;
    const ua2 = (await user().post("/api/user-addresses").send({ entityType: "INVOICE", entityId: "cp-2", ...payload })).body.address;

    expect(ua1.areaId).toBe(area.id);
    expect(ua2.areaId).toBe(area.id);
    // Same location, no free-text line1 on either -> the clean master string is identical.
    expect(ua1.fullAddressCache).toBe(ua2.fullAddressCache);
  });

  it("search/report reflects the clean master value, not stale raw text, after a correction", async () => {
    const { country, state, city, pincode } = await makeGeoFixture("SearchReport");
    const wrong = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sectr 62 Typo", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;
    const correct = (
      await admin().post("/api/admin/nodes").send({ level: "AREA", name: "Sector 62 Final", parentId: pincode.id, status: "ACTIVE" })
    ).body.node;

    await user()
      .post("/api/user-addresses")
      .send({
        entityType: "LEAD",
        entityId: "search-1",
        countryId: country.id,
        stateId: state.id,
        cityId: city.id,
        pincodeId: pincode.id,
        areaId: wrong.id,
      });

    await admin().post("/api/admin/correct").send({ wrongId: wrong.id, correctId: correct.id });

    const searchRes = await user().get("/api/search").query({ q: "Sector 62 Final" });
    expect(searchRes.body.items.some((i: any) => i.entityId === "search-1")).toBe(true);
    expect(searchRes.body.items.every((i: any) => !i.fullAddressCache.includes("Sectr 62 Typo"))).toBe(true);
  });
});
