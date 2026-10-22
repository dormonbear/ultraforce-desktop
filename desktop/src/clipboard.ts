import { toast } from "sonner";
import { browserLocale, translate } from "./i18n";

/** Copy unchanged content with localized default feedback. / 复制原样内容并提供本地化默认反馈。 */
export async function copyText(text: string, successMsg?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMsg ?? translate(browserLocale(), "Copied"));
  } catch {
    toast.error(translate(browserLocale(), "Copy failed"));
  }
}
