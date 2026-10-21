// Monaco 0.54 ships this contribution-registration entry as JavaScript only.
// Its runtime re-exports editor.api.js after registering editor features.
declare module "monaco-editor/esm/vs/editor/edcore.main" {
  export * from "monaco-editor/esm/vs/editor/editor.api";
}
