import { Loader2, Globe } from "lucide-react";
import { useOrgs } from "../org";
import { ConnectOrgForm } from "./ConnectOrg";
import { CliGuidance, useSfStatus } from "./CliGuidance";

/**
 * Shown in the main area when there is no usable org. Checks `sf` CLI health
 * first (install / upgrade / PATH guidance via {@link CliGuidance}); once the
 * CLI is healthy, guides the user to log in to an org.
 */
export function SetupPage() {
  const { error, reload } = useOrgs();
  const { status, refresh } = useSfStatus();

  // Still probing the CLI.
  if (!status) {
    return (
      <Centered>
        <Loader2 className="spin text-muted-foreground" size={20} />
        <p className="text-sm text-text-dim">Checking Salesforce CLI…</p>
      </Centered>
    );
  }

  // CLI missing / outdated / off-PATH → guidance (Retry re-checks, then reloads orgs).
  if (status.state !== "ok") {
    return (
      <CliGuidance
        status={status}
        onRetry={() => {
          refresh();
          reload();
        }}
      />
    );
  }

  // CLI healthy → connect an org (also the fallback for a generic org error).
  return (
    <Centered>
      <Globe className="text-primary" size={28} />
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">Connect a Salesforce org</h2>
      {error && (
        <p className="max-w-sm text-center text-[12px] text-destructive">{error}</p>
      )}
      <p className="max-w-sm text-center text-sm text-text-dim">
        Log in via your browser. Pick the environment, optionally set an alias.
      </p>

      <ConnectOrgForm onConnected={reload} />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
      {children}
    </div>
  );
}
