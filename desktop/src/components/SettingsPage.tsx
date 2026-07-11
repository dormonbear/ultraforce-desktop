import { formatIpcError } from "../errorFormat";
import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Github } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Selector } from "@astryxdesign/core/Selector";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { getRoot, setRootOverride, type Tool } from "../fs/workspace";
import { getNamespacePolicy, setNamespacePolicy } from "../indexSettings";
import { getConfirmApexRun, setConfirmApexRun } from "../apexSettings";
import { useOrgs } from "../org";
import { reindexOrg } from "../ipc/schema";
import { getTelemetryConfig, setTelemetryConfig } from "../ipc/config";
import type { TelemetryConfig } from "../types";
import { useTheme } from "../theme";
import {
  HIGHLIGHT_SCHEMES,
  schemeColors,
  type HighlightScheme,
} from "../editor-themes";
import { checkForUpdates } from "../updater";

const REPO_URL = "https://github.com/dormonbear/ultraforce-desktop";

// Verbatim privacy disclosure — the contract of exactly what telemetry sends.
// Do not paraphrase, shorten, or reword; it was reviewed word-by-word.
const TELEMETRY_DISCLOSURE = `Both are OFF by default; nothing is recorded or sent until you turn them on.

"Anonymous usage statistics" (Aptabase) — when ON, each tool call sends a scrubbed
event to Aptabase's cloud:
  • tool name (e.g. soql_query, apex_run)
  • result: success / failure
  • duration (ms)
  • error CATEGORY label (e.g. INVALID_FIELD) — never the error text
  • whether the target org is production (a true/false flag)
  • basic system info: operating-system name, app version, and a random per-session id

"Local telemetry" — when ON, records the FULL detail of each tool call — including your
SOQL/Apex text, the org alias, and error messages — to a database on THIS computer only.
It never leaves your machine and is never uploaded anywhere; it is for your own
troubleshooting.

Sent to Aptabase's cloud — NEVER:
  • your SOQL / Apex query or code text
  • any record data: field values, record Ids, object contents
  • org names / aliases
  • error message text (only the category label)
  • any Salesforce business data

Recorded NOWHERE, under any setting:
  • access tokens / credentials / passwords

Aptabase does not store your IP address, name, email, or other personal data, and does no
cross-session tracking or device fingerprinting.`;

interface Props {
  /** Called after a workspace root changes so the owner can remount the panel. */
  onChanged: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Text type="label" color="secondary" display="block">
        {title}
      </Text>
      <Card padding={3}>{children}</Card>
    </section>
  );
}

/** Live sample of the selected highlight scheme, colored from its palette. */
function SchemePreview({ scheme, dark }: { scheme: HighlightScheme; dark: boolean }) {
  const c = schemeColors(scheme, dark);
  return (
    <pre
      className="overflow-x-auto rounded-md border border-border p-3 font-mono text-[11px] leading-relaxed"
      style={{ background: c.bg, color: c.fg }}
    >
      <div style={{ color: c.comment }}>// syntax highlighting preview</div>
      <div>
        <span style={{ color: c.keyword }}>public class</span>{" "}
        <span style={{ color: c.type }}>Demo</span> {"{"}
      </div>
      <div>
        {"  "}
        <span style={{ color: c.type }}>Integer</span> count ={" "}
        <span style={{ color: c.number }}>42</span>;
      </div>
      <div>
        {"  "}
        <span style={{ color: c.type }}>String</span> name ={" "}
        <span style={{ color: c.string }}>'Ultraforce'</span>;
      </div>
      <div>{"}"}</div>
    </pre>
  );
}

/** Full settings center: appearance, per-tool workspace roots, index scope, about. */
export function SettingsPage({ onChanged }: Props) {
  const { selected: org } = useOrgs();
  const { theme, toggle, scheme, setScheme } = useTheme();
  const [roots, setRoots] = useState<Record<Tool, string>>({ soql: "", apex: "" });
  const [ns, setNs] = useState<string>("all");
  const [version, setVersion] = useState("");
  const [confirmRun, setConfirmRun] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryConfig>({
    localEnabled: false,
    remoteEnabled: false,
  });

  useEffect(() => {
    void Promise.all([getRoot("soql"), getRoot("apex")]).then(([soql, apex]) =>
      setRoots({ soql, apex }),
    );
    void getNamespacePolicy().then(setNs);
    void getVersion().then(setVersion);
    void getConfirmApexRun().then(setConfirmRun);
    void getTelemetryConfig().then(setTelemetry);
  }, []);

  // Persist the updated telemetry pair whenever a toggle flips.
  const changeTelemetry = (next: TelemetryConfig) => {
    setTelemetry(next);
    void setTelemetryConfig(next);
  };

  // Change the index namespace scope and reindex the active org so it takes effect.
  const changeNs = async (value: string) => {
    setNs(value);
    await setNamespacePolicy(value);
    if (org) {
      try {
        await reindexOrg(org, value);
        toast.success("Reindexing org…");
      } catch (e) {
        toast.error(`Reindex failed: ${formatIpcError(e)}`);
      }
    }
  };

  const pick = async (tool: Tool) => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    await setRootOverride(tool, dir);
    setRoots((r) => ({ ...r, [tool]: dir }));
    onChanged();
  };

  const reset = async (tool: Tool) => {
    await setRootOverride(tool, null);
    const next = await getRoot(tool);
    setRoots((r) => ({ ...r, [tool]: next }));
    onChanged();
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 text-[12px]">
        <Heading level={1}>Settings</Heading>

        <Section title="Appearance">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Text>Theme</Text>
              <SegmentedControl
                label="Theme"
                size="sm"
                value={theme}
                onChange={(t) => {
                  if (theme !== t) toggle();
                }}
              >
                <SegmentedControlItem value="light" label="Light" />
                <SegmentedControlItem value="dark" label="Dark" />
              </SegmentedControl>
            </div>
            <div className="flex items-center justify-between">
              <Text>Syntax highlighting</Text>
              <Selector
                label="Syntax highlighting scheme"
                isLabelHidden
                size="sm"
                value={scheme}
                onChange={(v) =>
                  setScheme(v as (typeof HIGHLIGHT_SCHEMES)[number]["id"])
                }
                options={HIGHLIGHT_SCHEMES.map((s) => ({
                  value: s.id,
                  label: s.label,
                }))}
              />
            </div>
            <SchemePreview scheme={scheme} dark={theme === "dark"} />
          </div>
        </Section>

        <Section title="Workspace">
          <div className="flex flex-col gap-3">
            {(["soql", "apex"] as Tool[]).map((tool) => (
              <div key={tool} className="flex flex-col gap-1">
                <Text type="supporting" display="block">
                  {tool} workspace
                </Text>
                <span className="truncate text-foreground">
                  {roots[tool] || "…"}
                </span>
                <div className="flex gap-2">
                  <Button
                    label="Change…"
                    variant="ghost"
                    size="sm"
                    clickAction={() => pick(tool)}
                  />
                  <Button
                    label="Reset"
                    variant="ghost"
                    size="sm"
                    clickAction={() => reset(tool)}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Apex">
          <Switch
            label="Confirm before running anonymous Apex"
            description="Ask for confirmation on every run — a guard against executing DML in the wrong org."
            labelPosition="start"
            labelSpacing="spread"
            value={confirmRun}
            onChange={(next) => {
              setConfirmRun(next);
              void setConfirmApexRun(next);
            }}
          />
        </Section>

        <Section title="Privacy & Telemetry">
          <div className="flex flex-col gap-3">
            <Switch
              label="Local telemetry"
              description="Local telemetry — record tool calls to a local database on this computer for your own debugging. Never leaves your machine."
              labelPosition="start"
              labelSpacing="spread"
              value={telemetry.localEnabled}
              onChange={(next) =>
                changeTelemetry({ ...telemetry, localEnabled: next })
              }
            />
            <Switch
              label="Anonymous usage statistics"
              description="Anonymous usage statistics (Aptabase) — send scrubbed events to help improve the tool."
              labelPosition="start"
              labelSpacing="spread"
              value={telemetry.remoteEnabled}
              onChange={(next) =>
                changeTelemetry({ ...telemetry, remoteEnabled: next })
              }
            />
            <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-text-dim">
              {TELEMETRY_DISCLOSURE}
            </pre>
          </div>
        </Section>

        <Section title="Indexing">
          <Selector
            label="Index scope"
            value={ns}
            changeAction={changeNs}
            options={[
              { value: "all", label: "All objects" },
              {
                value: "unmanaged",
                label: "Unmanaged only (skip managed packages)",
              },
            ]}
          />
        </Section>

        <Section title="About">
          <div className="flex items-center justify-between">
            <Text>Ultraforce{version && ` v${version}`}</Text>
            <div className="flex items-center gap-1">
              <Button
                label="GitHub"
                variant="ghost"
                size="sm"
                icon={<Github size={14} />}
                clickAction={() => openUrl(REPO_URL)}
              />
              <Button
                label="Check for updates"
                variant="ghost"
                size="sm"
                clickAction={() => checkForUpdates(true)}
              />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
