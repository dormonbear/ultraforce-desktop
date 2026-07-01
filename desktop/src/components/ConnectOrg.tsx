import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useOrgs } from "../org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Env = "production" | "sandbox" | "custom";

const INSTANCE_URL: Record<Env, string | undefined> = {
  production: undefined,
  sandbox: "https://test.salesforce.com",
  custom: undefined,
};

/**
 * The `sf org login web` form: pick environment + optional alias, then open the
 * browser for OAuth. Shared by the first-run setup page and the "connect another
 * org" dialog. `onConnected` fires after a successful login.
 */
export function ConnectOrgForm({ onConnected }: { onConnected?: () => void }) {
  const [env, setEnv] = useState<Env>("production");
  const [customUrl, setCustomUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);

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
      onConnected?.();
    } catch (e) {
      toast.error(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-md border border-border bg-card p-4 text-[12px]">
      <label className="flex flex-col gap-1">
        <span className="text-text-dim">Environment</span>
        <select
          value={env}
          onChange={(e) => setEnv(e.target.value as Env)}
          disabled={busy}
          className="native-select cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <option value="production">Production / Developer (login.salesforce.com)</option>
          <option value="sandbox">Sandbox (test.salesforce.com)</option>
          <option value="custom">Custom domain / My Domain…</option>
        </select>
      </label>

      {env === "custom" && (
        <label className="flex flex-col gap-1">
          <span className="text-text-dim">Instance URL</span>
          <Input
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://mydomain.my.salesforce.com"
            disabled={busy}
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-text-dim">Alias (optional)</span>
        <Input
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="my-org"
          disabled={busy}
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
  );
}

/** "Connect another org" dialog — wraps {@link ConnectOrgForm}; reloads the org
 * list and closes on success. */
export function ConnectOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { reload } = useOrgs();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>Connect a Salesforce org</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-dim">
          Log in via your browser. Pick the environment, optionally set an alias.
        </p>
        <ConnectOrgForm
          onConnected={() => {
            reload();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
