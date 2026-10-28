import { expect, test, type Page } from "@playwright/test";
import { installMocks } from "./fixtures";

const object = { name: "OwnedObject__c", label: "Owned object label", custom: true, keyPrefix: "a00" };
const field = {
  name: "OwnedPicklist__c", label: "Owned picklist label", fieldType: "picklist", custom: true,
  nillable: false, referenceTo: [], relationshipName: null,
  picklistValues: [
    { label: "Owned label 1", value: "OwnedValue1", active: true, defaultValue: true },
    { label: "Owned label 2", value: "OwnedValue2", active: false, defaultValue: false },
  ],
  restrictedPicklist: true, dependentPicklist: false, calculated: false, calculatedFormula: null,
  length: 0, unique: false, inlineHelpText: "Help text {count} / owned",
};
const detail = {
  ...object, childRelationships: [], fields: [field],
  recordTypes: [{ name: "Owned record", developerName: "Owned_Record", active: true, master: true, available: true }],
};
const responses = {
  schema_list_objects: [object], schema_object_detail: detail,
  schema_search: [{ objectName: object.name, fieldName: field.name, fieldLabel: field.label, snippet: "[Owned] value" }],
  reindex_org: null,
};
type Scope = {
  __ufCalls: { cmd: string; args: Record<string, unknown> }[];
  __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown> };
};

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`schema locale / 对象结构语言: ${language}`, () => {
    test.use({ locale: language });
    const zh = language === "zh-CN";
    const words = zh ? {
      schema: "对象结构", org: "当前组织：DevHub。切换组织", objects: "筛选对象", fields: "筛选字段",
      select: "选择对象以浏览其字段。", records: "记录类型（1）", developer: "开发者名称",
      close: "关闭字段详情", picklist: "选项列表值（2）", label: "标签", value: "值", active: "有效", default: "默认",
      required: "必填", search: "搜索对象结构", clear: "清除搜索", noIndex: "此组织尚未建立索引",
      reindex: "重新索引组织", reindexing: "正在重新索引组织…", schemaError: "对象结构：Owned {count} error",
      refreshError: "对象结构刷新失败：Owned {count} error",
    } : {
      schema: "Schema", org: "Current org: DevHub. Switch org", objects: "Filter objects", fields: "Filter fields",
      select: "Select an object to browse its fields.", records: "Record types (1)", developer: "Developer name",
      close: "Close field detail", picklist: "Picklist values (2)", label: "Label", value: "Value", active: "Active", default: "Default",
      required: "required", search: "Search schema", clear: "Clear search", noIndex: "This org isn’t indexed yet",
      reindex: "Reindex org", reindexing: "Reindexing org…", schemaError: "Schema: Owned {count} error",
      refreshError: "Schema refresh failed: Owned {count} error",
    };

    async function open(page: Page) {
      await page.goto("/");
      await expect(page.getByRole("button", { name: words.org, exact: true })).toBeVisible();
      await page.getByRole("button", { name: words.schema, exact: true }).click();
    }

    test("localizes browsing controls and preserves metadata / 本地化浏览控件并保留元数据", async ({ page }) => {
      await installMocks(page, responses);
      await open(page);
      await expect(page.getByRole("button", { name: words.reindex, exact: true })).toBeVisible();
      await expect(page.getByRole("searchbox", { name: words.objects })).toBeVisible();
      await expect(page.getByText(words.select, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /OwnedObject__c/ }).click();
      await expect(page.getByText(words.records, { exact: true })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: words.developer })).toBeVisible();
      await page.getByRole("button", { name: /OwnedPicklist__c/ }).click();
      await expect(page.getByText(words.required, { exact: true })).toBeVisible();
      const values = page.getByText(words.picklist, { exact: true }).locator("..");
      for (const text of [words.label, words.value, words.active, words.default, "OwnedValue1", "Owned label 1"])
        await expect(values.getByText(text, { exact: true })).toBeVisible();
      await expect(page.getByText("Help text {count} / owned", { exact: true })).toBeVisible();
      if (zh) await page.screenshot({ path: test.info().outputPath("schema-zh.png") });
      await page.getByRole("button", { name: words.close, exact: true }).click();
      await expect(page.getByText("Owned_Record", { exact: true })).toBeVisible();
    });

    test("language changes preserve selection filters and search arguments / 切换语言保留选择筛选及搜索参数", async ({ page }) => {
      await installMocks(page, responses);
      await open(page);
      await page.getByRole("button", { name: /OwnedObject__c/ }).click();
      await page.getByRole("button", { name: /OwnedPicklist__c/ }).click();
      await page.getByRole("searchbox", { name: words.objects }).fill("OwnedObject");
      await page.getByRole("searchbox", { name: words.fields }).fill("Owned");
      const query = "Owned {count} 中文";
      await page.getByRole("searchbox", { name: words.search }).fill(query);
      await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ufCalls
        .filter((call) => call.cmd === "schema_search"))).toEqual([
        { cmd: "schema_search", args: { org: "dev@acme.com", query, limit: 30 } },
      ]);
      const before = await page.evaluate(() => (window as unknown as Scope).__ufCalls.filter((call) => call.cmd.startsWith("schema_")));
      await page.evaluate((next) => {
        Object.defineProperty(navigator, "languages", { configurable: true, value: [next] });
        Object.defineProperty(navigator, "language", { configurable: true, value: next });
        window.dispatchEvent(new Event("languagechange"));
      }, zh ? "en-US" : "zh-CN");
      await expect(page.getByRole("searchbox", { name: zh ? "Filter objects" : "筛选对象" })).toHaveValue("OwnedObject");
      await expect(page.getByRole("searchbox", { name: zh ? "Filter fields" : "筛选字段" })).toHaveValue("Owned");
      await expect(page.getByRole("searchbox", { name: zh ? "Search schema" : "搜索对象结构" })).toHaveValue(query);
      await expect(page.getByRole("button", { name: zh ? "Close field detail" : "关闭字段详情" })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as Scope).__ufCalls.filter((call) => call.cmd.startsWith("schema_")))).toEqual(before);
    });

    test("localizes the no-index recovery action / 本地化缺少索引时的恢复操作", async ({ page }) => {
      await installMocks(page, responses);
      await page.addInitScript(() => {
        const scope = window as unknown as Scope;
        const invoke = scope.__TAURI_INTERNALS__.invoke;
        scope.__TAURI_INTERNALS__.invoke = (command, args, options) => {
          if (command === "schema_list_objects") {
            void invoke(command, args, options);
            return Promise.reject({ code: "no-index", message: "Owned missing index" });
          }
          return invoke(command, args, options);
        };
      });
      await open(page);
      const empty = page.getByText(words.noIndex, { exact: true }).locator("..");
      await empty.getByRole("button", { name: words.reindex, exact: true }).click();
      await expect(page.getByText(words.reindexing, { exact: true })).toBeVisible();
      const calls = await page.evaluate(() => (window as unknown as Scope).__ufCalls.filter((call) => call.cmd === "reindex_org"));
      expect(calls).toHaveLength(1);
      expect(calls[0].args.org).toBe("dev@acme.com");
    });

    test("localizes error context without reinterpreting error text / 本地化错误上下文且不重新解释错误文本", async ({ page }) => {
      await installMocks(page, responses);
      await page.addInitScript(() => {
        const scope = window as unknown as Scope;
        const invoke = scope.__TAURI_INTERNALS__.invoke;
        scope.__TAURI_INTERNALS__.invoke = (command, args, options) => {
          if (command === "schema_search" || command === "reindex_org") {
            void invoke(command, args, options);
            return Promise.reject({ code: "io", message: "Owned {count} error" });
          }
          return invoke(command, args, options);
        };
      });
      await open(page);
      await page.getByRole("searchbox", { name: words.search }).fill("Owned");
      await expect(page.getByText(words.schemaError, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: words.clear, exact: true }).click();
      await expect(page.getByRole("searchbox", { name: words.search })).toHaveValue("");
      await page.getByRole("button", { name: words.reindex, exact: true }).click();
      await expect(page.getByText(words.refreshError, { exact: true })).toBeVisible();
    });
  });
}
