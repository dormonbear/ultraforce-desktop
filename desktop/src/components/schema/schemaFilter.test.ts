import { describe, expect, it } from "vitest";
import { filterFields, filterObjects } from "./schemaFilter";
import type { SchemaField, SchemaObject } from "../../types";

const objects: SchemaObject[] = [
  { name: "Account", label: "Account", custom: false, keyPrefix: "001" },
  { name: "Opportunity", label: "Deal", custom: false, keyPrefix: "006" },
  { name: "My_Widget__c", label: "Gadget", custom: true, keyPrefix: "a01" },
];

const field = (name: string, label: string): SchemaField => ({
  name,
  label,
  fieldType: "string",
  custom: false,
  nillable: true,
  referenceTo: [],
  relationshipName: null,
  picklistValues: [],
  restrictedPicklist: false,
  dependentPicklist: false,
  calculated: false,
  calculatedFormula: null,
  length: 0,
  unique: false,
  inlineHelpText: null,
});

const fields: SchemaField[] = [
  field("Name", "Account Name"),
  field("Industry", "Industry"),
  field("My_Amount__c", "Total Amount"),
];

describe("filterObjects", () => {
  it("matches on API name", () => {
    expect(filterObjects(objects, "Opportunity").map((o) => o.name)).toEqual([
      "Opportunity",
    ]);
  });

  it("matches on label", () => {
    expect(filterObjects(objects, "Gadget").map((o) => o.name)).toEqual([
      "My_Widget__c",
    ]);
  });

  it("is case-insensitive", () => {
    expect(filterObjects(objects, "account").map((o) => o.name)).toEqual([
      "Account",
    ]);
  });

  it("returns all for an empty query", () => {
    expect(filterObjects(objects, "")).toHaveLength(3);
    expect(filterObjects(objects, "   ")).toHaveLength(3);
  });
});

describe("filterFields", () => {
  it("matches on API name", () => {
    expect(filterFields(fields, "My_Amount__c").map((f) => f.name)).toEqual([
      "My_Amount__c",
    ]);
  });

  it("matches on label", () => {
    expect(filterFields(fields, "total").map((f) => f.name)).toEqual([
      "My_Amount__c",
    ]);
  });

  it("is case-insensitive", () => {
    expect(filterFields(fields, "INDUSTRY").map((f) => f.name)).toEqual([
      "Industry",
    ]);
  });

  it("returns all for an empty query", () => {
    expect(filterFields(fields, "")).toHaveLength(3);
  });
});
