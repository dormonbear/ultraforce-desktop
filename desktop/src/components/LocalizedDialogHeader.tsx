import { DialogHeader } from "@astryxdesign/core/Dialog";
import { Button } from "@astryxdesign/core/Button";
import { X } from "lucide-react";
import { useI18n } from "../i18n";

/** Preserve the library header while translating its hardcoded close control.
 * 保留组件库标题栏，并翻译其固定英文关闭控件。 */
export function LocalizedDialogHeader({
  onOpenChange,
  endContent,
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  const { t } = useI18n();
  return (
    <DialogHeader
      {...props}
      endContent={
        <span style={onOpenChange ? {
          display: "flex", alignItems: "center", marginBlock: "-8px", marginInlineEnd: "-8px",
        } : undefined}>
          {endContent}
          {onOpenChange && (
            <Button
              isIconOnly
              variant="ghost"
              label={t("Close")}
              icon={<X size={16} />}
              clickAction={() => { onOpenChange(false); }}
            />
          )}
        </span>
      }
    />
  );
}
