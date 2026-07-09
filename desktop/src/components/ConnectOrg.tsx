import { formatIpcError } from "../errorFormat";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useOrgs } from "../org";
import { loginOrg } from "../ipc/org";

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
      await loginOrg({
        instanceUrl: instanceUrl ?? null,
        alias: alias.trim() || null,
        setDefault: true,
      });
      toast.success("Org connected");
      onConnected?.();
    } catch (e) {
      toast.error(formatIpcError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding={3} className="w-full max-w-md">
      <div className="flex flex-col gap-3">
        <Selector
          label="Environment"
          value={env}
          onChange={(v) => setEnv(v as Env)}
          isDisabled={busy}
          options={[
            {
              value: "production",
              label: "Production / Developer (login.salesforce.com)",
            },
            { value: "sandbox", label: "Sandbox (test.salesforce.com)" },
            { value: "custom", label: "Custom domain / My Domain…" },
          ]}
        />

        {env === "custom" && (
          <TextInput
            label="Instance URL"
            value={customUrl}
            onChange={(v) => setCustomUrl(v)}
            placeholder="https://mydomain.my.salesforce.com"
            isDisabled={busy}
          />
        )}

        <TextInput
          label="Alias"
          isOptional
          value={alias}
          onChange={(v) => setAlias(v)}
          placeholder="my-org"
          isDisabled={busy}
        />

        <Button
          label={busy ? "Waiting for browser…" : "Log in"}
          isLoading={busy}
          clickAction={login}
        />
      </div>
    </Card>
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={480}>
      <DialogHeader
        title="Connect a Salesforce org"
        onOpenChange={onOpenChange}
      />
      <div className="flex flex-col gap-4">
        <Text type="supporting" display="block">
          Log in via your browser. Pick the environment, optionally set an alias.
        </Text>
        <ConnectOrgForm
          onConnected={() => {
            reload();
            onOpenChange(false);
          }}
        />
      </div>
    </Dialog>
  );
}
