// Synthetic CLI only: fixtures and command capture stay inside the owned test root.
// 仅用于合成 CLI：测试数据和命令记录均留在测试专属根目录内。
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.UF_IDENTITY_FIXTURE;
const args = process.argv.slice(2);
for (const flag of ['SF_DISABLE_TELEMETRY', 'SFDX_DISABLE_TELEMETRY', 'SF_DISABLE_LOG_FILE', 'SFDX_DISABLE_LOG_FILE']) {
  if (process.env[flag] !== 'true') throw new Error('Privacy flag missing / 缺少隐私标志');
}
fs.appendFileSync(path.join(root, 'commands.jsonl'), JSON.stringify(args) + '\n');
if (fs.existsSync(path.join(root, 'fail'))) {
  console.log(JSON.stringify({ status: 1, message: 'Synthetic offline / 合成离线' }));
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'orgs.json'), 'utf8'));
const target = args.includes('--target-org') ? args[args.indexOf('--target-org') + 1] : 'first@example.invalid';
const identity = config[target];
if (!identity) throw new Error('Unknown synthetic target / 未知合成目标');
const emit = (result) => console.log(JSON.stringify({ status: 0, result }));
if (args[0] === 'org' && args[1] === 'display') {
  emit({ ...identity, accessToken: 'SYNTHETIC_SECRET_ACCESS', refreshToken: 'SYNTHETIC_SECRET_REFRESH' });
  process.exit(0);
}
if (target !== identity.username) throw new Error('Fetch target was not pinned / 取数目标未固定');
const command = args.join(' ');
if (command.includes('ApexClass') && fs.existsSync(path.join(root, 'pause'))) {
  fs.writeFileSync(path.join(root, 'entered'), target);
  const deadline = Date.now() + 10000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(path.join(root, 'release'))) {
    if (Date.now() >= deadline) throw new Error('Synthetic pause expired / 合成暂停超时');
    Atomics.wait(wait, 0, 0, 10);
  }
}
if (command.includes('completions')) {
  console.log(JSON.stringify({ publicDeclarations: { System: { String: { methods: [], properties: [] } } } }));
} else if (command.includes('ApexClass')) {
  emit({ done: true, totalSize: 1, records: [{ Name: identity.service, NamespacePrefix: null, SymbolTable: { name: identity.service, methods: [], properties: [] } }] });
} else if (args[0] === 'sobject' && args[1] === 'list') {
  emit(['Account']);
} else if (command.includes('EntityDefinition') || command.includes('CustomField')) {
  emit({ done: true, totalSize: 0, records: [] });
} else if (command.includes('composite')) {
  const body = JSON.parse(args[args.indexOf('--body') + 1]);
  console.log(JSON.stringify({ compositeResponse: body.compositeRequest.map((request) => ({
    referenceId: request.referenceId, httpStatusCode: 200,
    body: { name: 'Account', label: identity.label, fields: [
      { name: 'Industry', label: identity.label, type: 'picklist', picklistValues: [
        { label: identity.label, value: identity.service, active: true, defaultValue: false },
      ] },
    ] },
  })) }));
} else {
  throw new Error('Unexpected synthetic command / 意外的合成命令');
}
