import { toast } from "sonner";

/** Copy `text` to the clipboard, confirming via a toast ("Copy failed" on error). */
export async function copyText(text: string, successMsg = "Copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMsg);
  } catch {
    toast.error("Copy failed");
  }
}
