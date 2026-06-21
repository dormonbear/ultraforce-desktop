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

// Fake workspace for the file explorer (plugin:fs / plugin:path mocks).
const WS = "/ws";
type FakeEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
};
const file = (name: string): FakeEntry => ({
  name,
  isDirectory: false,
  isFile: true,
  isSymlink: false,
});
const FAKE_DIRS: Record<string, FakeEntry[]> = {
  [`${WS}/workspace/soql`]: [file("accounts.soql"), file("leads.soql")],
  [`${WS}/workspace/apex`]: [file("hello.apex")],
};
const FAKE_FILES: Record<string, string> = {
  [`${WS}/workspace/soql/accounts.soql`]:
    "SELECT Id, Name, AnnualRevenue FROM Account",
  [`${WS}/workspace/soql/leads.soql`]: "SELECT Id, Company FROM Lead",
  [`${WS}/workspace/apex/hello.apex`]: "System.debug('hi');",
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
  index_org: null,
  reindex_org: null,
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
  await page.addInitScript(
    (bundle: {
      resp: Record<string, unknown>;
      dirs: Record<string, unknown[]>;
      files: Record<string, string>;
    }) => {
    const { resp, dirs, files } = bundle;
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

    // Registered `listen` handlers, keyed by event name, so tests can drive
    // backend-emitted events via `window.__ufEmit(event, payload)`.
    const handlers: Record<string, ((e: unknown) => void)[]> = {};

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
      if (cmd === "plugin:event|listen") {
        const ev = args.event as string;
        const h = args.handler as (e: unknown) => void;
        (handlers[ev] ??= []).push(h);
        return Promise.resolve(0);
      }
      if (cmd.startsWith("plugin:event|")) {
        return Promise.resolve(0);
      }
      if (cmd.startsWith("plugin:path|")) return Promise.resolve("/ws");
      if (cmd === "plugin:fs|read_dir") {
        return Promise.resolve(dirs[(args.path as string)] ?? []);
      }
      if (cmd === "plugin:fs|exists") return Promise.resolve(true);
      if (cmd === "plugin:fs|mkdir") return Promise.resolve(null);
      if (cmd === "plugin:fs|read_text_file" || cmd === "plugin:fs|read_file") {
        const text = files[args.path as string] ?? "";
        return Promise.resolve(Array.from(new TextEncoder().encode(text)));
      }
      if (cmd === "plugin:fs|write_text_file" || cmd === "plugin:fs|write_file") {
        const data = args.data as string | undefined;
        if (data != null) files[args.path as string] = data;
        return Promise.resolve(null);
      }
      if (cmd.startsWith("plugin:fs|")) return Promise.resolve(null);
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
    // @ts-expect-error — test-only hook to deliver a backend event.
    window.__ufEmit = (event: string, payload: unknown) =>
      (handlers[event] ?? []).forEach((h) => h({ event, id: 0, payload }));
    },
    { resp: RESP, dirs: FAKE_DIRS, files: FAKE_FILES },
  );
}

/** Install mocks, navigate to the dev server, and wait for the app to settle. */
export async function gotoApp(page: Page): Promise<void> {
  await installMocks(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}
