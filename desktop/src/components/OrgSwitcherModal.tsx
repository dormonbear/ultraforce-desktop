import { useEffect, useId, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { FieldLabel } from "@astryxdesign/core/Field";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { useOrgs } from "../org";
import { orgApiVersion } from "../ipc/org";
import { formatIpcError } from "../errorFormat";
import {
  DEFAULT_TIMEOUT_SECS,
  ORG_COLORS,
  normalizeApiVersion,
  orgColor,
  orgDisplayName,
  parseTimeoutSecs,
  type OrgColor,
} from "../orgConfig";
import type { OrgConfig, OrgDto } from "../types";

/** Coarse org-type chip from the flags `sf org list` returns (empty for prod). */
function orgTypeLabel(org: OrgDto): string | null {
  if (org.isScratch) return "Scratch";
  if (org.isSandbox) return "Sandbox";
  return null;
}

/** Detected (dynamic) API version per org, loaded each time the modal opens —
 * the list fallback and the edit-view placeholder. */
function useOrgApiVersions(
  open: boolean,
  orgs: OrgDto[],
): Record<string, string> {
  const [versions, setVersions] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all(
      orgs.map(async (o) => {
        try {
          return [o.username, await orgApiVersion(o.username)] as const;
        } catch {
          return [o.username, ""] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setVersions(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [open, orgs]);

  return versions;
}

/** The org switcher: a list of orgs (click to switch) with an inline config
 * editor view. Fully replaces the former titlebar dropdown. */
export function OrgSwitcherModal({
  open,
  onOpenChange,
  onConnect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: () => void;
}) {
  const { orgs, selected, configs, select, saveConfig } = useOrgs();
  const [editing, setEditing] = useState<string | null>(null);
  const versions = useOrgApiVersions(open, orgs);

  // Reset to the list view each time the modal opens.
  useEffect(() => {
    if (open) setEditing(null);
  }, [open]);

  const editingOrg = orgs.find((o) => o.username === editing);

  // Switch to the clicked org; close on success. Clicking the current org is a
  // no-op switch that just dismisses the modal.
  const selectOrg = async (username: string) => {
    if (username === selected) {
      onOpenChange(false);
      return;
    }
    if (await select(username)) onOpenChange(false);
  };

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={460}>
      {editingOrg ? (
        <OrgEditView
          org={editingOrg}
          config={configs[editingOrg.username] ?? {}}
          dynamicVersion={versions[editingOrg.username] ?? ""}
          onOpenChange={onOpenChange}
          onBack={() => setEditing(null)}
          onSave={async (next) => {
            await saveConfig(editingOrg.username, next);
            setEditing(null);
          }}
        />
      ) : (
        <OrgListView
          orgs={orgs}
          selected={selected}
          configs={configs}
          versions={versions}
          onSelect={selectOrg}
          onEdit={setEditing}
          onConnect={onConnect}
          onOpenChange={onOpenChange}
        />
      )}
    </Dialog>
  );
}

/** Fixed-width leading swatch: renders the org's color dot when configured, an
 * invisible spacer of the same width otherwise, so every row stays aligned.
 * (astryx `StatusDot` only exposes semantic variants, not arbitrary colors.) */
function ColorDot({ color }: { color: OrgColor | undefined }) {
  return (
    <span
      aria-hidden
      className="flex size-2.5 items-center justify-center"
    >
      {color && (
        <span
          className="size-2.5 rounded-full"
          style={{ background: color.bg }}
        />
      )}
    </span>
  );
}

/** One org row: click to switch, wrench to open the config editor. */
function OrgRow({
  org,
  config,
  version,
  isCurrent,
  onSelect,
  onEdit,
}: {
  org: OrgDto;
  config: OrgConfig;
  version: string;
  isCurrent: boolean;
  onSelect: (username: string) => void;
  onEdit: (username: string) => void;
}) {
  const typeLabel = orgTypeLabel(org);
  const name = orgDisplayName(config, org);
  return (
    <ListItem
      label={name}
      description={version ? `${org.username} · v${version}` : org.username}
      isSelected={isCurrent}
      onClick={() => onSelect(org.username)}
      startContent={<ColorDot color={orgColor(config.color)} />}
      endContent={
        <HStack gap={2} vAlign="center">
          {typeLabel && <Badge variant="neutral" label={typeLabel} />}
          {isCurrent && <Icon icon="check" color="accent" size="sm" />}
          <IconButton
            variant="ghost"
            label={`Configure ${name}`}
            icon={<Icon icon="wrench" />}
            onClick={() => onEdit(org.username)}
          />
        </HStack>
      }
    />
  );
}

/** The list view: one astryx `ListItem` per org (click to switch), plus a
 * "Connect org…" action in the footer. */
function OrgListView({
  orgs,
  selected,
  configs,
  versions,
  onSelect,
  onEdit,
  onConnect,
  onOpenChange,
}: {
  orgs: OrgDto[];
  selected: string | null;
  configs: Record<string, OrgConfig>;
  versions: Record<string, string>;
  onSelect: (username: string) => void;
  onEdit: (username: string) => void;
  onConnect: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Layout
      header={<DialogHeader title="Switch org" onOpenChange={onOpenChange} />}
      content={
        <LayoutContent>
          <List>
            {orgs.map((o) => {
              const cfg = configs[o.username] ?? {};
              return (
                <OrgRow
                  key={o.username}
                  org={o}
                  config={cfg}
                  version={cfg.apiVersion ?? versions[o.username] ?? ""}
                  isCurrent={o.username === selected}
                  onSelect={onSelect}
                  onEdit={onEdit}
                />
              );
            })}
          </List>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider>
          <Button
            label="Connect org…"
            variant="ghost"
            icon={<Plus size={14} />}
            onClick={onConnect}
          />
        </LayoutFooter>
      }
    />
  );
}

/** Raw editor field values, as typed by the user. */
interface OrgConfigInput {
  alias: string;
  color: string | undefined;
  apiVersion: string;
  timeout: string;
}

/** The display-only fields (alias / color), normalized, empty omitted. */
function displayConfig(input: OrgConfigInput): OrgConfig {
  const config: OrgConfig = {};
  if (input.alias.trim()) config.alias = input.alias.trim();
  if (input.color) config.color = input.color;
  return config;
}

/** Validate the optional apiVersion field into `config`; error string when invalid. */
function applyApiVersion(raw: string, config: OrgConfig): string | null {
  const s = raw.trim();
  if (!s) return null;
  const norm = normalizeApiVersion(s);
  if (!norm) return "API version must be a number like 58 or 58.0";
  config.apiVersion = norm;
  return null;
}

/** Validate the optional timeout field into `config`; error string when invalid. */
function applyTimeout(raw: string, config: OrgConfig): string | null {
  const s = raw.trim();
  if (!s) return null;
  const secs = parseTimeoutSecs(s);
  if (!secs) return "Timeout must be a positive whole number of seconds";
  config.timeoutSecs = secs;
  return null;
}

/** Validate + normalize the editor fields into an {@link OrgConfig} with empty
 * fields omitted (pure). Returns a user-readable error for invalid input. */
export function validateOrgConfig(
  input: OrgConfigInput,
): { config: OrgConfig } | { error: string } {
  const config = displayConfig(input);
  const error =
    applyApiVersion(input.apiVersion, config) ??
    applyTimeout(input.timeout, config);
  return error ? { error } : { config };
}

/** Swatch classes; the active one gets a selection ring. */
function swatchClass(isActive: boolean): string {
  return `focus-accent size-6 rounded-full border border-border ${
    isActive ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
  }`;
}

/** Labeled row of color swatches ("no color" + the preset palette). Custom
 * control (astryx has no swatch picker); the label reuses astryx `FieldLabel`
 * in group mode so typography matches the TextInputs around it. */
function ColorSwatchRow({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (color: string | undefined) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel
        label="Color"
        isGroupLabel
        inputID={labelId}
        labelID={labelId}
      />
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1.5"
      >
        <button
          type="button"
          aria-label="No color"
          aria-pressed={!value}
          onClick={() => onChange(undefined)}
          className={swatchClass(!value)}
        />
        {ORG_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.label}
            aria-pressed={value === c.id}
            onClick={() => onChange(c.id)}
            style={{ background: c.bg }}
            className={swatchClass(value === c.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** The per-org config editor view (alias / color / apiVersion / timeout).
 * Validates on save via {@link validateOrgConfig}. Save lives in the footer;
 * the back arrow lives in the header. */
function OrgEditView({
  org,
  config,
  dynamicVersion,
  onOpenChange,
  onBack,
  onSave,
}: {
  org: OrgDto;
  config: OrgConfig;
  dynamicVersion: string;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  onSave: (next: OrgConfig) => Promise<void>;
}) {
  const [alias, setAlias] = useState(config.alias ?? "");
  const [color, setColor] = useState<string | undefined>(config.color);
  const [apiVersion, setApiVersion] = useState(config.apiVersion ?? "");
  const [timeout, setTimeout] = useState(
    config.timeoutSecs != null ? String(config.timeoutSecs) : "",
  );
  const [busy, setBusy] = useState(false);

  const versionPlaceholder = useMemo(
    () => (dynamicVersion ? `${dynamicVersion} (default)` : "e.g. 58.0"),
    [dynamicVersion],
  );

  const save = async () => {
    const result = validateOrgConfig({ alias, color, apiVersion, timeout });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setBusy(true);
    try {
      await onSave(result.config);
    } catch (e) {
      toast.error(formatIpcError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout
      header={
        <DialogHeader
          title={`Edit ${orgDisplayName(config, org)}`}
          onOpenChange={onOpenChange}
          startContent={
            // astryx's DialogHeader compensates only the END actions
            // (marginBlock/-inline-end = -spacing-2) so the close button hugs
            // the edge and centers on the title; the START slot gets no such
            // compensation, dropping a same-height icon button ~8px low. Mirror
            // astryx's own compensation on the start side instead of hacking a
            // descendant selector into its DOM.
            <span
              style={{
                display: "flex",
                marginBlock: "-8px",
                marginInlineStart: "-8px",
              }}
            >
              <Button
                isIconOnly
                variant="ghost"
                label="Back to org list"
                icon={<Icon icon="chevronLeft" />}
                onClick={onBack}
              />
            </span>
          }
        />
      }
      content={
        <LayoutContent>
          <div className="flex flex-col gap-3">
            <TextInput
              label="Alias"
              isOptional
              value={alias}
              onChange={setAlias}
              placeholder={org.username}
              isDisabled={busy}
            />

            <ColorSwatchRow value={color} onChange={setColor} />

            <TextInput
              label="API version"
              isOptional
              value={apiVersion}
              onChange={setApiVersion}
              placeholder={versionPlaceholder}
              isDisabled={busy}
            />

            <TextInput
              label="Timeout (seconds)"
              isOptional
              value={timeout}
              onChange={setTimeout}
              placeholder={`${DEFAULT_TIMEOUT_SECS} (default)`}
              isDisabled={busy}
            />
          </div>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider>
          <HStack hAlign="end">
            <Button label="Save" isLoading={busy} clickAction={save} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
