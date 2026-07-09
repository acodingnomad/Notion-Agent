import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planBrandUpdates, planNotionCascades } from "./status-sync.js";

const noSignals = {
  script_requested: false,
  script_submitted: false,
  script_approved: false,
  draft_submitted: false,
  draft_approved: false,
  live_date_scheduled: false,
  posted_live: false,
  live_date: null,
};

function page(id, name, contentType, status, postingDate = null) {
  return { id, name, contentType, status, postingDate };
}

describe("planBrandUpdates", () => {
  it("moves Script to 'Due next' when a script is requested", () => {
    const pages = [page("s", "Acme Script", "SCRIPT", "Not started")];
    const { statusChanges } = planBrandUpdates(
      { ...noSignals, script_requested: true },
      pages
    );
    assert.equal(statusChanges.length, 1);
    assert.equal(statusChanges[0].to, "Due next");
  });

  it("script approval sets Script=Done and cascades Filming to 'Ready to film'", () => {
    const pages = [
      page("s", "Acme Script", "SCRIPT", "Awaiting approval"),
      page("f", "TO DO: Film Acme", "FILMING DAY", "Not started"),
    ];
    const { statusChanges } = planBrandUpdates(
      { ...noSignals, script_approved: true },
      pages
    );
    const byName = Object.fromEntries(statusChanges.map((c) => [c.page.name, c.to]));
    assert.equal(byName["Acme Script"], "Done");
    assert.equal(byName["TO DO: Film Acme"], "Ready to film");
  });

  it("is forward-only: never rewinds a more-advanced status", () => {
    const pages = [page("s", "Acme Script", "SCRIPT", "Awaiting approval")];
    // script_requested targets "Due next" which is BEHIND "Awaiting approval"
    const { statusChanges } = planBrandUpdates(
      { ...noSignals, script_requested: true },
      pages
    );
    assert.equal(statusChanges.length, 0);
  });

  it("leaves manual/unknown statuses (e.g. 'Update requested') untouched", () => {
    const pages = [page("d", "Acme Draft", "DRAFT DUE", "Update requested")];
    const { statusChanges } = planBrandUpdates(
      { ...noSignals, draft_submitted: true },
      pages
    );
    assert.equal(statusChanges.length, 0);
  });

  it("cascades Filming=Done -> matching-number Draft 'Ready for editing'", () => {
    const pages = [
      page("f1", "TO DO: Film Acme 1", "FILMING DAY", "Done"),
      page("d1", "Acme 1 Draft", "DRAFT DUE", "Not started"),
      page("d2", "Acme 2 Draft", "DRAFT DUE", "Not started"),
    ];
    const { statusChanges } = planBrandUpdates({ ...noSignals }, pages);
    assert.equal(statusChanges.length, 1);
    assert.equal(statusChanges[0].page.id, "d1");
    assert.equal(statusChanges[0].to, "Ready for editing");
  });

  it("advances only the earliest pending page for FIFO stages", () => {
    const pages = [
      page("d1", "Acme 1 Draft", "DRAFT DUE", "Awaiting approval", "2026-07-01"),
      page("d2", "Acme 2 Draft", "DRAFT DUE", "Awaiting approval", "2026-07-08"),
      page("p1", "Acme 1 Post", "BRAND POST", "Not started", "2026-07-05"),
      page("p2", "Acme 2 Post", "BRAND POST", "Not started", "2026-07-12"),
    ];
    const { statusChanges } = planBrandUpdates(
      { ...noSignals, draft_approved: true },
      pages
    );
    const draftChange = statusChanges.find((c) => c.page.contentType === "DRAFT DUE");
    const postChange = statusChanges.find((c) => c.page.contentType === "BRAND POST");
    assert.equal(draftChange.page.id, "d1");
    assert.equal(draftChange.to, "Done");
    assert.equal(postChange.page.id, "p1");
    assert.equal(postChange.to, "Ready to post");
  });

  it("sets Posting Date on the earliest not-posted Brand Post when a live date is scheduled", () => {
    const pages = [
      page("p1", "Acme Post", "BRAND POST", "Ready to post", null),
    ];
    const { dateChanges } = planBrandUpdates(
      { ...noSignals, live_date_scheduled: true, live_date: "2026-08-15" },
      pages
    );
    assert.equal(dateChanges.length, 1);
    assert.equal(dateChanges[0].page.id, "p1");
    assert.equal(dateChanges[0].to, "2026-08-15");
  });

  it("targets the specific post number when the thread names one", () => {
    const pages = [
      page("d1", "Acme 1 Draft", "DRAFT DUE", "Awaiting approval", "2026-07-01"),
      page("d2", "Acme 2 Draft", "DRAFT DUE", "Awaiting approval", "2026-07-08"),
    ];
    const { statusChanges } = planBrandUpdates(
      { ...noSignals, draft_approved: true, post_number: 2 },
      pages
    );
    const draftChange = statusChanges.find((c) => c.page.contentType === "DRAFT DUE");
    assert.equal(draftChange.page.id, "d2");
    assert.equal(draftChange.to, "Done");
  });

  it("posted_live sets Brand Post to Done", () => {
    const pages = [page("p1", "Acme Post", "BRAND POST", "Ready to post")];
    const { statusChanges } = planBrandUpdates(
      { ...noSignals, posted_live: true },
      pages
    );
    assert.equal(statusChanges[0].to, "Done");
  });
});

describe("planNotionCascades", () => {
  it("Filming Done cascades the matching-name Draft to 'Ready for editing'", () => {
    const pages = [
      page("f1", "TO DO: Film Flodesk 1", "FILMING DAY", "Done"),
      page("d1", "Flodesk 1 Draft", "DRAFT DUE", "Not started"),
      page("d2", "Flodesk 2 Draft", "DRAFT DUE", "Not started"),
    ];
    const changes = planNotionCascades(pages);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].page.id, "d1");
    assert.equal(changes[0].to, "Ready for editing");
  });

  it("is forward-only (won't touch a Draft already past 'Ready for editing')", () => {
    const pages = [
      page("f1", "TO DO: Film Flodesk 1", "FILMING DAY", "Done"),
      page("d1", "Flodesk 1 Draft", "DRAFT DUE", "Awaiting approval"),
    ];
    assert.equal(planNotionCascades(pages).length, 0);
  });

  it("does not cascade Script Done to Filming (that is agency-email driven)", () => {
    const pages = [
      page("s", "Flodesk Script", "SCRIPT", "Done"),
      page("f1", "TO DO: Film Flodesk 1", "FILMING DAY", "Not started"),
    ];
    assert.equal(planNotionCascades(pages).length, 0);
  });

  it("Draft Done cascades the matching Post to 'Ready to post'", () => {
    const pages = [
      page("d1", "Flodesk 1 Draft", "DRAFT DUE", "Done"),
      page("p1", "Flodesk 1 Post", "BRAND POST", "Not started"),
      page("p2", "Flodesk 2 Post", "BRAND POST", "Not started"),
    ];
    const changes = planNotionCascades(pages);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].page.id, "p1");
    assert.equal(changes[0].to, "Ready to post");
  });

  it("does nothing when no page is marked Done", () => {
    const pages = [
      page("f1", "TO DO: Film Flodesk 1", "FILMING DAY", "Ready to film"),
      page("d1", "Flodesk 1 Draft", "DRAFT DUE", "Not started"),
    ];
    assert.equal(planNotionCascades(pages).length, 0);
  });
});
