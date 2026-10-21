import json
import os
import pathlib
import sys
import time

root = pathlib.Path(os.environ['UF_REFRESH_FIXTURE'])
args = ' '.join(sys.argv[1:])
for flag in ('SF_DISABLE_TELEMETRY', 'SFDX_DISABLE_TELEMETRY', 'SF_DISABLE_LOG_FILE', 'SFDX_DISABLE_LOG_FILE'):
    assert os.environ[flag] == 'true'
with (root / 'pids').open('a') as out:
    out.write(f'{os.getpid()} {os.getppid()}\n')

def emit(result):
    print(json.dumps({'status': 0, 'result': result}))

if 'org display' in args:
    with (root / 'entered').open('a') as out:
        out.write('startup\n')
    while not (root / 'release').exists():
        time.sleep(.01)
    if (root / 'fail').exists():
        print(json.dumps({'status': 1, 'message': 'Synthetic startup failure / 合成启动失败'}))
        sys.exit(1)
    target = sys.argv[sys.argv.index('--target-org') + 1] if '--target-org' in sys.argv else 'synthetic@example.invalid'
    emit({'id': '00D000000000001', 'username': target, 'apiVersion': '60.0'})
elif (root / 'fail').exists():
    print(json.dumps({'status': 1, 'message': 'Synthetic acquisition failure / 合成采集失败'}))
    sys.exit(1)
elif 'completions' in args:
    print(json.dumps({'publicDeclarations': {'System': {'String': {'methods': [], 'properties': []}}}}))
elif 'ApexClass' in args:
    emit({'done': True, 'totalSize': 1, 'records': [{'Name': 'Unavailable', 'NamespacePrefix': None, 'SymbolTable': None}]})
elif 'sobject list' in args:
    emit(['Account'])
elif 'EntityDefinition' in args or 'CustomField' in args:
    emit({'done': True, 'totalSize': 0, 'records': []})
elif 'composite' in args:
    print(json.dumps({'compositeResponse': [{'httpStatusCode': 200, 'referenceId': 'r0', 'body': {'name': 'Account', 'fields': [], 'childRelationships': []}}]}))
else:
    raise RuntimeError('Unexpected synthetic CLI command / 意外的合成 CLI 命令: ' + args)
