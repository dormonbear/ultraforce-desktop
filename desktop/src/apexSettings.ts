import { getJson, setJson } from "./store";

/** Whether running anonymous Apex first asks for confirmation (opt-in;
 * default off keeps the one-click run behavior). */
const CONFIRM_RUN_KEY = "settings.confirmApexRun";

export const getConfirmApexRun = (): Promise<boolean> =>
  getJson<boolean>(CONFIRM_RUN_KEY, false);

export const setConfirmApexRun = (value: boolean): Promise<void> =>
  setJson(CONFIRM_RUN_KEY, value);
