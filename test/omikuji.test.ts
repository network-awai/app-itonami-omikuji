import { describe, it, beforeEach } from "node:test";
import { expect } from "./expect.mjs";
import { LocalStore } from "../dist/local-store.js";
import { createShrine, updateShrine, listShrines, getShrine, drawFortune, listFortunes, getFortune, resetFortune, pickRank, DEFAULT_WEIGHTS } from "../dist/domain/index.js";

describe("omikuji", () => {
  let e: any;
  beforeEach(async () => { e = new LocalStore({ did: "did:web:omikuji.itonami.cloud" }); await createShrine(e, { shrineId: "s1", name: "鎮守の杜" }); });

  it("creates shrines with valid weight tables only", async () => {
    expect((await createShrine(e, { shrineId: "s1", name: "x" })).status).toBe("alreadyExists");
    expect((await createShrine(e, { shrineId: "s2", name: "x", weights: { "大吉": -1 } })).error).toBe("invalidWeights");
    expect((await createShrine(e, { shrineId: "s3", name: "x", weights: { "最高": 5 } as any })).error).toBe("invalidWeights");
    const zero = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]));
    expect((await createShrine(e, { shrineId: "s4", name: "x", weights: zero })).error).toBe("invalidWeights");
    expect((await listShrines(e)).total).toBe(1);
    expect((await getShrine(e, { shrineId: "s1" })).odds["吉"]).toBe(0.35);
  });

  it("picks ranks by cumulative weight", () => {
    expect(pickRank(DEFAULT_WEIGHTS, 0)).toBe("大吉");
    expect(pickRank(DEFAULT_WEIGHTS, 15)).toBe("大吉");
    expect(pickRank(DEFAULT_WEIGHTS, 16)).toBe("吉");
    expect(pickRank(DEFAULT_WEIGHTS, 99)).toBe("大凶");
  });

  it("allows one untied draw per person per shrine per day", async () => {
    const day = new Date(2026, 10, 17, 9);
    const d1 = await drawFortune(e, { drawId: "d1", shrineId: "s1", person: "jun" }, day, 20);
    expect(d1.rank).toBe("吉");
    expect((await drawFortune(e, { drawId: "d2", shrineId: "s1", person: "jun" }, day)).status).toBe("alreadyDrawnToday");
    expect((await drawFortune(e, { drawId: "d3", shrineId: "s1", person: "aya" }, day)).status).toBe("drawn");
    expect((await drawFortune(e, { drawId: "d4", shrineId: "s1", person: "jun" }, new Date(2026, 10, 18, 9))).status).toBe("drawn");
    expect((await drawFortune(e, { drawId: "d1", shrineId: "s1", person: "x" }, day)).error).toBe("drawIdExists");
    expect((await drawFortune(e, { drawId: "d9", shrineId: "nope", person: "x" }, day)).error).toBe("shrineNotFound");
  });

  it("tying a fortune releases it so the person may draw again", async () => {
    const day = new Date(2026, 10, 17, 9);
    await drawFortune(e, { drawId: "d1", shrineId: "s1", person: "jun" }, day, 70);
    expect((await getFortune(e, { drawId: "d1" })).fortune.rank).toBe("凶");
    expect((await resetFortune(e, { drawId: "d1" })).status).toBe("tied");
    expect((await resetFortune(e, { drawId: "d1" })).status).toBe("alreadyTied");
    expect((await drawFortune(e, { drawId: "d2", shrineId: "s1", person: "jun" }, day, 0)).rank).toBe("大吉");
    const list = await listFortunes(e, { person: "jun" });
    expect(list.total).toBe(2);
    expect(list.byRank["凶"]).toBe(1);
  });

  it("updates the table and the random draw always lands on a weighted rank", async () => {
    await updateShrine(e, { shrineId: "s1", weights: { "大吉": 0, "吉": 0, "中吉": 0, "小吉": 0, "末吉": 0, "凶": 0, "大凶": 1 } });
    for (let i = 0; i < 5; i++) expect((await drawFortune(e, { drawId: `r${i}`, shrineId: "s1", person: `p${i}` })).rank).toBe("大凶");
    expect((await updateShrine(e, { shrineId: "s1", name: "" })).error).toBe("nameEmpty");
  });
});
