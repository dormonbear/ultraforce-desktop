import type { Page } from "@playwright/test";

/**
 * Mocked Tauri IPC for the e2e suite. App commands return fixed fixtures;
 * the tauri-plugin-store commands (`plugin:store|*`) are backed by
 * localStorage so persistence survives a page reload (mimicking on-disk).
 */

const LOG = [
  "45.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO",
  ...Array.from(
    { length: 12 },
    (_, i) => `08:00:0${i % 10}.${i} (12${i})|USER_DEBUG|[${i}]|DEBUG|row ${i}`,
  ),
  "08:00:09.9 (999)|FATAL_ERROR|System.NullPointerException: boom",
].join("\n");

const LEVELS = {
  apexCode: "DEBUG",
  apexProfiling: "INFO",
  callout: "INFO",
  dataAccess: "INFO",
  database: "FINEST",
  nba: "NONE",
  system: "DEBUG",
  validation: "INFO",
  visualforce: "INFO",
  wave: "NONE",
  workflow: "INFO",
};

// App-command fixtures (everything that is NOT plugin:store|*).
const RESP: Record<string, unknown> = {
  list_orgs: [
    { username: "dev@acme.com", alias: "DevHub", instance_url: "x", is_default: true },
    { username: "stg@acme.com", alias: "Staging", instance_url: null, is_default: false },
  ],
  set_target_org: null,
  get_debug_config: { traceFlagId: "7tf1", levels: LEVELS },
  set_debug_config: { traceFlagId: "7tf1", levels: LEVELS },
  run_apex: {
    compiled: true,
    success: true,
    compile_problem: null,
    exception_message: null,
    exception_stack_trace: null,
    line: null,
    column: null,
    logs: LOG,
  },
  run_soql: {
    columns: ["Id", "Name", "Industry"],
    rows: Array.from({ length: 12 }, (_, i) => [
      `001xx${i}`,
      `Account ${i}`,
      ["Tech", "Finance"][i % 2],
    ]),
    total_size: 12,
    done: true,
    tree: [],
  },
  list_logs: [],
  refresh_schema_cache: 42,
  soql_complete: [
    { label: "FROM", kind: "keyword", detail: null },
    { label: "WHERE", kind: "keyword", detail: null },
    { label: "Name", kind: "field", detail: null },
  ],
  apex_complete: [
    { label: "@AuraEnabled", kind: "keyword" },
    { label: "@IsTest", kind: "keyword" },
  ],
  soql_diagnostics: [],
  apex_soql_diagnostics: [],
};

/** Installs the mocked IPC before app scripts run. */
async function installMocks(page: Page): Promise<void> {
  await page.addInitScript((resp: Record<string, unknown>) => {
    const SKEY = "__uf_store";
    const readStore = (): Record<string, unknown> => {
      try {
        return JSON.parse(localStorage.getItem(SKEY) ?? "{}");
      } catch {
        return {};
      }
    };
    const writeStore = (o: Record<string, unknown>) =>
      localStorage.setItem(SKEY, JSON.stringify(o));

    const invoke = (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd.startsWith("plugin:store|")) {
        const op = cmd.split("|")[1];
        const store = readStore();
        switch (op) {
          case "load":
          case "get_store":
            return Promise.resolve(1); // resource id
          case "set":
            store[args.key as string] = args.value;
            writeStore(store);
            return Promise.resolve();
          case "get": {
            const key = args.key as string;
            const exists = Object.prototype.hasOwnProperty.call(store, key);
            return Promise.resolve([exists ? store[key] : null, exists]);
          }
          case "has":
            return Promise.resolve(
              Object.prototype.hasOwnProperty.call(store, args.key as string),
            );
          case "keys":
            return Promise.resolve(Object.keys(store));
          case "entries":
            return Promise.resolve(Object.entries(store));
          case "save":
          case "reload":
          case "clear":
          case "reset":
            if (op === "clear" || op === "reset") writeStore({});
            return Promise.resolve();
          default:
            return Promise.resolve(null);
        }
      }
      if (cmd === "plugin:event|listen" || cmd.startsWith("plugin:event|")) {
        return Promise.resolve(0);
      }
      return Promise.resolve(cmd in resp ? resp[cmd] : null);
    };

    // @ts-expect-error — minimal Tauri v2 internals shim for the e2e browser.
    window.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback: (cb: unknown) => cb,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    };
  }, RESP);
}

/** Install mocks, navigate to the dev server, and wait for the app to settle. */
export async function gotoApp(page: Page): Promise<void> {
  await installMocks(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}
