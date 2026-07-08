import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Code } from "@astryxdesign/core/Code";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { sfStatus } from "../ipc/org";
import type { SfStatus } from "../types";

const INSTALL_CMD = "npm install -g @salesforce/cli";
const UPGRADE_CMD = "npm update -g @salesforce/cli";
const DOCS = "https://developer.salesforce.com/tools/salesforcecli";

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Copy failed");
  }
}

/** Fetch the `sf` CLI health status, with a manual refresh (for Retry). */
export function useSfStatus(): { status: SfStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<SfStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    sfStatus()
      .then((s) => alive && setStatus(s))
      // On an unexpected failure, assume not-found so the user still gets help.
      .catch(
        () =>
          alive &&
          setStatus({
            state: "not_found",
            version: null,
            minVersion: "2.0.0",
            foundAt: null,
          }),
      );
    return () => {
      alive = false;
    };
  }, [tick]);
  const refresh = useCallback(() => {
    setStatus(null);
    setTick((t) => t + 1);
  }, []);
  return { status, refresh };
}

function CopyRow({ cmd }: { cmd: string }) {
  return (
    <div className="flex w-full max-w-md items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
      <Code>{cmd}</Code>
      <IconButton
        label="Copy command"
        variant="ghost"
        size="sm"
        icon={<Copy size={14} />}
        clickAction={() => copy(cmd)}
      />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {children}
    </div>
  );
}

/** Extra guidance rows rendered under an EmptyState (copy command, docs, retry). */
function GuidanceExtras({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-3">{children}</div>;
}

/**
 * Guidance for a non-ok `sf` CLI status: install it, upgrade it, or fix a PATH
 * problem. Presentational — the caller supplies the status and a retry handler.
 * Renders nothing when the CLI is healthy.
 */
export function CliGuidance({
  status,
  onRetry,
}: {
  status: SfStatus;
  onRetry: () => void;
}) {
  if (status.state === "ok") return null;

  const retry = (
    <Button
      label="Retry"
      variant="secondary"
      icon={<RefreshCw size={14} />}
      clickAction={() => onRetry()}
    />
  );
  const icon = <AlertTriangle className="text-primary" size={28} />;

  if (status.state === "outdated") {
    return (
      <Centered>
        <EmptyState
          icon={icon}
          title="Salesforce CLI is too old"
          description={`Ultraforce needs sf ${status.minVersion} or newer.${
            status.version ? ` Detected: ${status.version}.` : ""
          } Upgrade, then retry.`}
          actions={
            <GuidanceExtras>
              <CopyRow cmd={UPGRADE_CMD} />
              <Text type="supporting" display="block">
                Docs: <span className="select-all">{DOCS}</span>
              </Text>
              {retry}
            </GuidanceExtras>
          }
        />
      </Centered>
    );
  }

  if (status.state === "path_issue") {
    return (
      <Centered>
        <EmptyState
          icon={icon}
          title="Salesforce CLI not on this app’s PATH"
          description={`sf is installed${
            status.foundAt ? ` at ${status.foundAt}` : ""
          }, but Ultraforce can’t see it. This happens when the app is launched from the Dock, or with shells like fish.`}
          actions={
            <GuidanceExtras>
              <Text type="supporting" display="block" className="max-w-sm text-center">
                Fix: relaunch Ultraforce from a terminal, or add sf’s directory
                to your login shell’s PATH, then retry.
              </Text>
              {retry}
            </GuidanceExtras>
          }
        />
      </Centered>
    );
  }

  // not_found
  return (
    <Centered>
      <EmptyState
        icon={icon}
        title="Salesforce CLI not found"
        description="Ultraforce drives the sf CLI. Install it, then retry."
        actions={
          <GuidanceExtras>
            <CopyRow cmd={INSTALL_CMD} />
            <Text type="supporting" display="block">
              Or use the installer — docs:{" "}
              <span className="select-all">{DOCS}</span>
            </Text>
            {retry}
          </GuidanceExtras>
        }
      />
    </Centered>
  );
}

/** Self-fetching wrapper for runtime use: a tool command failed because the CLI
 * is unavailable, so fetch the status and render the matching guidance. */
export function CliGuidanceForError({ onRetry }: { onRetry: () => void }) {
  const { status, refresh } = useSfStatus();
  if (!status) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="spin text-muted-foreground" size={20} />
          <Text type="supporting" display="block">
            Checking Salesforce CLI…
          </Text>
        </div>
      </Centered>
    );
  }
  return (
    <CliGuidance
      status={status}
      onRetry={() => {
        refresh();
        onRetry();
      }}
    />
  );
}
