// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import type { OrgConfig, OrgDto } from "../types";

let orgState: {
  orgs: OrgDto[];
  selected: string | null;
  configs: Record<string, OrgConfig>;
} = { orgs: [], selected: null, configs: {} };

vi.mock("../org", () => ({ useOrgs: () => orgState }));

import { TargetOrg } from "./TargetOrg";

const ORG = { username: "me@example.com", alias: "CliAlias" } as OrgDto;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TargetOrg", () => {
  it("updates the locale while keeping the org name literal / 更新语言并保留组织名称原文", () => {
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    orgState = {
      orgs: [ORG], selected: ORG.username,
      configs: { [ORG.username]: { alias: "{name}<组织>" } },
    };
    render(<TargetOrg />);
    expect(screen.getByLabelText("Target org: {name}<组织>")).toBeTruthy();
    languages.mockReturnValue(["zh-CN"]);
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(screen.getByLabelText("目标组织：{name}<组织>")).toBeTruthy();
  });
  it("renders nothing when no org is selected", () => {
    orgState = { orgs: [ORG], selected: null, configs: {} };
    const { container } = render(<TargetOrg />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the selection is not in the org list", () => {
    orgState = { orgs: [ORG], selected: "gone@example.com", configs: {} };
    const { container } = render(<TargetOrg />);
    expect(container.firstChild).toBeNull();
  });

  // Regression: an early version showed the raw username while the titlebar
  // badge showed the alias, so one org appeared under two different names.
  it("prefers the configured alias, matching what OrgBadge shows", () => {
    orgState = {
      orgs: [ORG],
      selected: ORG.username,
      configs: { [ORG.username]: { alias: "Staging" } as OrgConfig },
    };
    render(<TargetOrg />);
    expect(screen.getByLabelText("Target org: Staging")).toBeTruthy();
  });

  it("falls back to the CLI alias when no alias is configured", () => {
    orgState = { orgs: [ORG], selected: ORG.username, configs: {} };
    render(<TargetOrg />);
    expect(screen.getByLabelText("Target org: CliAlias")).toBeTruthy();
  });

  it("paints the dot with the org's preset color when one is set", () => {
    orgState = {
      orgs: [ORG],
      selected: ORG.username,
      configs: { [ORG.username]: { color: "red" } as OrgConfig },
    };
    const { container } = render(<TargetOrg />);
    const dot = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(dot.style.background).toBeTruthy();
  });

  it("leaves the dot on the accent default when no color is set", () => {
    orgState = { orgs: [ORG], selected: ORG.username, configs: {} };
    const { container } = render(<TargetOrg />);
    const dot = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(dot.style.background).toBe("");
    expect(dot.className).toContain("bg-primary/60");
  });
});
