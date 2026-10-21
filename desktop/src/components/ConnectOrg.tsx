import { formatIpcError } from "../errorFormat";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { MotionDialog } from "./motion/MotionDialog";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useOrgs } from "../org";
import { loginOrg } from "../ipc/org";
import { useI18n } from "../i18n";
import { X } from "lucide-react";

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
  const { t } = useI18n();
  const [env, setEnv] = useState<Env>("production");
  const [customUrl, setCustomUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);

  const login = async () => {
    const instanceUrl = env === "custom" ? customUrl.trim() : INSTANCE_URL[env];
    if (env === "custom" && !instanceUrl) {
      toast.error(t("Enter a custom instance URL"));
      return;
    }
    setBusy(true);
    try {
      await loginOrg({
        instanceUrl: instanceUrl ?? null,
        alias: alias.trim() || null,
        setDefault: true,
      });
      toast.success(t("Org connected"));
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
          label={t("Environment")}
          value={env}
          onChange={(v) => setEnv(v as Env)}
          isDisabled={busy}
          options={[
            {
              value: "production",
              label: t("Production / Developer (login.salesforce.com)"),
            },
            { value: "sandbox", label: t("Sandbox (test.salesforce.com)") },
            { value: "custom", label: t("Custom domain / My Domain…") },
          ]}
        />

        {env === "custom" && (
          <TextInput
            label={t("Instance URL")}
            value={customUrl}
            onChange={(v) => setCustomUrl(v)}
            placeholder="https://mydomain.my.salesforce.com"
            isDisabled={busy}
          />
        )}

        <TextInput
          label={t("Alias (optional)")}
          value={alias}
          onChange={(v) => setAlias(v)}
          placeholder="my-org"
          isDisabled={busy}
        />

        <Button
          label={busy ? t("Waiting for browser…") : t("Log in")}
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
  const { t } = useI18n();
  const { reload } = useOrgs();
  return (
    <MotionDialog isOpen={open} onOpenChange={onOpenChange} width={480}>
      <DialogHeader
        title={t("Connect a Salesforce org")}
        endContent={
          <Button
            isIconOnly
            variant="ghost"
            label={t("Close")}
            icon={<X size={16} />}
            clickAction={() => onOpenChange(false)}
          />
        }
      />
      <div className="flex flex-col gap-4">
        <Text type="supporting" display="block">
          {t("Log in via your browser. Pick the environment, optionally set an alias.")}
        </Text>
        <ConnectOrgForm
          onConnected={() => {
            reload();
            onOpenChange(false);
          }}
        />
      </div>
    </MotionDialog>
  );
}
