export function formatMessage(message: string, values: Readonly<Record<string, string | number>> = {}): string {
  // Replace once so inserted values never become templates. / 单次替换，避免插入的值成为模板。
  return message.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token,
  );
}
