import request from "supertest";
import { app } from "../src/app";

function withRole(role: "admin" | "user", email: string) {
  const withHeaders = (req: request.Test) => req.set("x-user-role", role).set("x-user-email", email);
  return {
    get: (url: string) => withHeaders(request(app).get(url)),
    post: (url: string) => withHeaders(request(app).post(url)),
    put: (url: string) => withHeaders(request(app).put(url)),
  };
}

export const admin = () => withRole("admin", "admin@test.com");
export const user = () => withRole("user", "user@test.com");

/** Creates a fresh Country > State > City > Pincode chain (all ACTIVE) for a test to build on. */
export async function makeGeoFixture(prefix: string) {
  const country = (
    await admin().post("/api/admin/nodes").send({ level: "COUNTRY", name: `${prefix} Country`, status: "ACTIVE" })
  ).body.node;
  const state = (
    await admin()
      .post("/api/admin/nodes")
      .send({ level: "STATE", name: `${prefix} State`, parentId: country.id, status: "ACTIVE" })
  ).body.node;
  const city = (
    await admin()
      .post("/api/admin/nodes")
      .send({ level: "CITY", name: `${prefix} City`, parentId: state.id, status: "ACTIVE" })
  ).body.node;
  const pincode = (
    await admin()
      .post("/api/admin/nodes")
      .send({ level: "PINCODE", name: "500001", parentId: city.id, status: "ACTIVE" })
  ).body.node;
  return { country, state, city, pincode };
}
