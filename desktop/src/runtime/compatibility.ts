import { ResizeObserver as ResizeObserverFallback } from "@juggle/resize-observer";
import { ensureArrayAt } from "./arrayAt";
import { ensureRandomUUID } from "./randomUUID";

// Run before UI dependencies capture browser constructors or build the file tree. / 在界面依赖捕获浏览器构造器或建立文件树前执行。
ensureArrayAt();
ensureRandomUUID();
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = ResizeObserverFallback;
}
