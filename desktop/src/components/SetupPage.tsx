import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Loader2, Globe, AlertTriangle, Copy } from "lucide-react";
import { useOrgs } from "../org";
import type { SfStatus } from "../types";
import { Button } from "@/components/ui/button";

const INSTALL_CMD = "npm install -g @salesforce/cli";
const INSTALL_DOCS =
  "https://developer.salesforce.com/tools/salesforcecli";

type Env = "production" | "sandbox" | "custom";
const INSTANCE_URL: Record<Env, string | undefined> = {
  production: undefined,
  sandbox: "https://test.salesforce.com",
  custom: undefined,
};

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Copy failed");
  }
}

/**
 * Shown in the main area when there is no usable org. Probes whether the `sf`
 * CLI is installed and guides the user accordingly: install the CLI, or log in
 * to an org (one click, with knobs for sandbox / custom domain).
 */
export function SetupPage() {
  const { error, reload } = useOrgs();
  const [status, setStatus] = useState<SfStatus | null>(null);
  const [env, setEnv] = useState<Env>("production");
  const [customUrl, setCustomUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    invoke<SfStatus>("sf_status")
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus({ installed: true, version: null }));
    return () => {
      alive = false;
    };
  }, []);

  const login = async () => {
    const instanceUrl = env === "custom" ? customUrl.trim() : INSTANCE_URL[env];
    if (env === "custom" && !instanceUrl) {
      toast.error("Enter a custom instance URL");
      return;
    }
    setBusy(true);
    try {
      await invoke("login_org", {
        instanceUrl: instanceUrl ?? null,
        alias: alias.trim() || null,
        setDefault: true,
      });
      toast.success("Org connected");
      reload();
    } catch (e) {
      toast.error(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Still probing the CLI.
  if (!status) {
    return (
      <Centered>
        <Loader2 className="spin text-muted-foreground" size={20} />
        <p className="text-sm text-text-dim">Checking Salesforce CLI…</p>
      </Centered>
    );
  }

  // CLI missing → install guidance.
  if (!status.installed) {
    return (
      <Centered>
        <AlertTriangle className="text-primary" size={28} />
        <h2 className="text-lg font-medium text-foreground">
          Salesforce CLI not found
        </h2>
        <p className="max-w-sm text-center text-sm text-text-dim">
          Ultraforce drives the <code>sf</code> CLI. Install it, then reopen this
          app (or hit Retry).
        </p>
        <div className="flex w-full max-w-md items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
          <code className="truncate text-[12px] text-foreground">{INSTALL_CMD}</code>
          <button
            type="button"
            onClick={() => void copy(INSTALL_CMD)}
            aria-label="Copy install command"
            className="cursor-pointer text-text-dim hover:text-foreground"
          >
            <Copy size={14} />
          </button>
        </div>
        <p className="text-[12px] text-text-dim">
          Docs: <span className="select-all text-foreground">{INSTALL_DOCS}</span>
        </p>
        <Button onClick={reload} variant="outline" className="cursor-pointer">
          Retry
        </Button>
      </Centered>
    );
  }

  // CLI present → connect an org (also the fallback for a generic org error).
  return (
    <Centered>
      <Globe className="text-primary" size={28} />
      <h2 className="text-lg font-medium text-foreground">Connect a Salesforce org</h2>
      {error && (
        <p className="max-w-sm text-center text-[12px] text-destructive">{error}</p>
      )}
      <p className="max-w-sm text-center text-sm text-text-dim">
        Log in via your browser. Pick the environment, optionally set an alias.
      </p>

      <div className="flex w-full max-w-md flex-col gap-3 rounded-md border border-border bg-card p-4 text-[12px]">
        <label className="flex flex-col gap-1">
          <span className="uppercase tracking-wide text-text-dim">Environment</span>
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value as Env)}
            disabled={busy}
            className="cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-foreground"
          >
            <option value="production">Production / Developer (login.salesforce.com)</option>
            <option value="sandbox">Sandbox (test.salesforce.com)</option>
            <option value="custom">Custom domain / My Domain…</option>
          </select>
        </label>

        {env === "custom" && (
          <label className="flex flex-col gap-1">
            <span className="uppercase tracking-wide text-text-dim">Instance URL</span>
            <input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://mydomain.my.salesforce.com"
              disabled={busy}
              className="rounded-md border border-border bg-transparent px-2 py-1 text-foreground"
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="uppercase tracking-wide text-text-dim">Alias (optional)</span>
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="my-org"
            disabled={busy}
            className="rounded-md border border-border bg-transparent px-2 py-1 text-foreground"
          />
        </label>

        <Button onClick={() => void login()} disabled={busy} className="cursor-pointer">
          {busy ? (
            <>
              <Loader2 className="spin mr-2" size={14} />
              Waiting for browser…
            </>
          ) : (
            "Log in"
          )}
        </Button>
      </div>
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
