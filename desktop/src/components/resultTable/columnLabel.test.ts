import { describe, expect, it } from "vitest";
import type { ColumnLabelsDto } from "../../types";
import { displayColumnLabel } from "./columnLabel";

const labels: ColumnLabelsDto = {
  parent: { Name: "Account Name", "Owner.Name": "Full Name" },
  children: {
    License_Copy_Borrowing_Requests__r: {
      label: "Borrowing Requests",
      columns: { Id: "Record ID", "Owner.Name": "Full Name" },
    },
    Contacts: { label: null, columns: { LastName: "Last Name" } },
  },
};

describe("displayColumnLabel", () => {
  it("resolves parent columns (plain and dotted)", () => {
    expect(displayColumnLabel("Name", labels)).toBe("Account Name");
    expect(displayColumnLabel("Owner.Name", labels)).toBe("Full Name");
  });

  it("resolves relationship columns via the children map", () => {
    expect(displayColumnLabel("License_Copy_Borrowing_Requests__r", labels)).toBe(
      "Borrowing Requests",
    );
  });

  it("decomposes flattened child columns, keeping the index", () => {
    expect(
      displayColumnLabel("License_Copy_Borrowing_Requests__r[0].Id", labels),
    ).toBe("Borrowing Requests[0].Record ID");
    // Dotted child column path resolves as one key.
    expect(
      displayColumnLabel("License_Copy_Borrowing_Requests__r[12].Owner.Name", labels),
    ).toBe("Borrowing Requests[12].Full Name");
  });

  it("falls back per segment when pieces are missing", () => {
    // Relationship label missing → API relationship name kept.
    expect(displayColumnLabel("Contacts[0].LastName", labels)).toBe(
      "Contacts[0].Last Name",
    );
    // Child column missing → API column kept, relationship still swaps.
    expect(
      displayColumnLabel(
        "License_Copy_Borrowing_Requests__r[1].ApprovalWorkItems",
        labels,
      ),
    ).toBe("Borrowing Requests[1].ApprovalWorkItems");
    // Unknown relationship → whole id kept.
    expect(displayColumnLabel("Ghosts[0].Name", labels)).toBe("Ghosts[0].Name");
  });

  it("returns the id verbatim for unknown columns or absent labels", () => {
    expect(displayColumnLabel("Bogus__c", labels)).toBe("Bogus__c");
    expect(displayColumnLabel("Name", null)).toBe("Name");
    expect(displayColumnLabel("Name", undefined)).toBe("Name");
  });
});
