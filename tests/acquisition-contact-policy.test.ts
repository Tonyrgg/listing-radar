import { describe, expect, it } from "vitest";
import { outreachBlockReason,sourceRequiresContactReview } from "../src/lib/acquisition/contact-policy";

describe("acquisition outreach policy", () => {
  it("requires an identified contact", () => {
    expect(outreachBlockReason(null)).toMatch(/Collega un contatto/);
  });

  it("blocks do-not-contact, blocked and sensitive contacts", () => {
    expect(outreachBlockReason({do_not_contact:true,contact_status:"reviewed",contact_review_required:false}))
      .toMatch(/non contattare/);
    expect(outreachBlockReason({do_not_contact:false,contact_status:"blocked",contact_review_required:false}))
      .toMatch(/non contattare/);
    expect(outreachBlockReason({do_not_contact:false,contact_status:"unreviewed",contact_review_required:true}))
      .toMatch(/Rivedi/);
  });

  it("allows ordinary contacts without a review flag", () => {
    expect(outreachBlockReason({do_not_contact:false,contact_status:"unreviewed",contact_review_required:false}))
      .toBeNull();
  });

  it("requires review for sensitive and third-party intelligence", () => {
    for (const source of ["succession","property_intelligence","neighborhood_intelligence",
      "professional_network","crm_mining"])
      expect(sourceRequiresContactReview(source)).toBe(true);
    for (const source of ["fsbo_radar","private_sign","buyer_to_seller"])
      expect(sourceRequiresContactReview(source)).toBe(false);
  });
});
