import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, RefreshCw } from "lucide-react";
import type { SfStatus } from "../types";
import { Button } from "@/components/ui/button";

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
    invoke<SfStatus>("sf_status")
      .then((s) => alive && setStatus(s))
      // On an unexpected failure, assume not-found so the user still gets help.
      .catch(
        () =>
          alive &&
          setStatus({
            state: "not_found",
            version: null,
            min_version: "2.0.0",
            found_at: null,
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
      <code className="truncate text-[12px] text-foreground">{cmd}</code>
      <button
        type="button"
        onClick={() => void copy(cmd)}
        aria-label="Copy command"
        className="cursor-pointer text-text-dim hover:text-foreground"
      >
        <Copy size={14} />
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
      {children}
    </div>
  );
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
    <Button onClick={onRetry} variant="outline" className="cursor-pointer gap-2">
      <RefreshCw size={14} />
      Retry
    </Button>
  );

  if (status.state === "outdated") {
    return (
      <Centered>
        <AlertTriangle className="text-primary" size={28} />
        <h2 className="text-lg font-medium text-foreground">
          Salesforce CLI is too old
        </h2>
        <p className="max-w-sm text-center text-sm text-text-dim">
          Ultraforce needs <code>sf</code> {status.min_version} or newer.
          {status.version ? ` Detected: ${status.version}.` : ""} Upgrade, then
          retry.
        </p>
        <CopyRow cmd={UPGRADE_CMD} />
        <p className="text-[12px] text-text-dim">
          Docs: <span className="select-all text-foreground">{DOCS}</span>
        </p>
        {retry}
      </Centered>
    );
  }

  if (status.state === "path_issue") {
    return (
      <Centered>
        <AlertTriangle className="text-primary" size={28} />
        <h2 className="text-lg font-medium text-foreground">
          Salesforce CLI not on this app’s PATH
        </h2>
        <p className="max-w-sm text-center text-sm text-text-dim">
          <code>sf</code> is installed
          {status.found_at ? ` at ${status.found_at}` : ""}, but Ultraforce
          can’t see it. This happens when the app is launched from the Dock, or
          with shells like <code>fish</code>.
        </p>
        <p className="max-w-sm text-center text-[12px] text-text-dim">
          Fix: relaunch Ultraforce from a terminal, or add <code>sf</code>’s
          directory to your login shell’s <code>PATH</code>, then retry.
        </p>
        {retry}
      </Centered>
    );
  }

  // not_found
  return (
    <Centered>
      <AlertTriangle className="text-primary" size={28} />
      <h2 className="text-lg font-medium text-foreground">
        Salesforce CLI not found
      </h2>
      <p className="max-w-sm text-center text-sm text-text-dim">
        Ultraforce drives the <code>sf</code> CLI. Install it, then retry.
      </p>
      <CopyRow cmd={INSTALL_CMD} />
      <p className="text-[12px] text-text-dim">
        Or use the installer — docs:{" "}
        <span className="select-all text-foreground">{DOCS}</span>
      </p>
      {retry}
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
        <Loader2 className="spin text-muted-foreground" size={20} />
        <p className="text-sm text-text-dim">Checking Salesforce CLI…</p>
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
