"""Synthetic CLI for native app tests only. / 仅供原生应用测试使用的合成 CLI。"""
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

ORG = "native@example.invalid"
ORG_ID = "00D000000000001"


def native_auth(root, args, result):
    config = root / "rest-url"
    if args[:2] != ["org", "display"] or not config.exists():
        return result
    address = config.read_text(encoding="utf-8").strip()
    try:
        parsed = urlsplit(address)
        valid = (parsed.scheme == "http" and parsed.hostname == "127.0.0.1"
                 and parsed.port is not None and parsed.port > 0
                 and not any((parsed.username, parsed.password, parsed.path, parsed.query, parsed.fragment)))
    except ValueError:
        valid = False
    if not valid:
        raise RuntimeError("Synthetic REST must use loopback / 合成 REST 必须使用回环地址")
    if (root / "block-auth").exists():
        (root / "auth-entered").touch()
        deadline = time.monotonic() + 15
        while not (root / "release-auth").exists():
            if time.monotonic() >= deadline:
                raise RuntimeError("Synthetic auth barrier expired / 合成认证屏障超时")
            time.sleep(0.02)
    return {**result, "instanceUrl": address, "accessToken": "synthetic-native-token"}


def response(args, mode):
    command = " ".join(args)
    if args == ["--version"]:
        return "@salesforce/cli/2.127.2 windows-x64 node-v22.21.1"
    if command.startswith("org list"):
        return {"nonScratchOrgs": [{
            "username": ORG, "alias": "NativeFixture", "isDefaultUsername": True,
            "instanceUrl": "https://native.example.invalid", "isSandbox": True,
        }]}
    if command.startswith("org display"):
        return {"apiVersion": "60.0", "id": ORG_ID, "username": ORG, "instanceUrl": "https://native.example.invalid"}
    if "--target-org" in args and args[args.index("--target-org") + 1] != ORG:
        raise RuntimeError("Unpinned synthetic target / 未固定的合成目标")
    if mode == "offline":
        raise RuntimeError("Synthetic offline acquisition / 合成离线采集")
    if "completions" in command:
        if mode == "stdlib-error":
            raise RuntimeError("Synthetic Tooling stdlib failure / 合成 Tooling 标准库失败")
        return {"publicDeclarations": {"System": {"String": {"methods": [], "properties": []}}}}
    if "ApexClass" in command:
        return {"done": True, "totalSize": 1, "records": [{
            "Name": "NativeService", "NamespacePrefix": None, "SymbolTable": {
                "name": "NativeService", "methods": [{
                    "name": "run", "returnType": "String", "parameters": [], "modifiers": ["public", "static"],
                }], "properties": [],
            },
        }]}
    if "sobject list" in command:
        return ["Synthetic__c"]
    if "EntityDefinition" in command:
        return {"done": True, "totalSize": 1, "records": [{"QualifiedApiName": "Synthetic__c"}]}
    if "CustomField" in command:
        return {"done": True, "totalSize": 0, "records": []}
    if "composite" in command:
        return {"compositeResponse": [{"httpStatusCode": 200, "referenceId": "r0", "body": {
            "name": "Synthetic__c", "label": "Synthetic Object", "labelPlural": "Synthetic Objects",
            "fields": [
                {"name": "Id", "label": "Record ID", "type": "id", "referenceTo": []},
                {"name": "Name", "label": "Native Fixture Name", "type": "string", "referenceTo": []},
            ], "childRelationships": [], "recordTypeInfos": [],
        }}]}
    raise RuntimeError("Unexpected fixture command / 意外的夹具命令: " + command)


def main():
    root = Path(os.environ["UF_NATIVE_FIXTURE"])
    assert (root / "synthetic-only").is_file()
    for flag in ["SF_DISABLE_TELEMETRY", "SFDX_DISABLE_TELEMETRY", "SF_DISABLE_LOG_FILE", "SFDX_DISABLE_LOG_FILE"]:
        assert os.environ.get(flag) == "true", flag
    args = sys.argv[1:]
    mode = (root / "mode").read_text(encoding="utf-8").strip()
    try:
        result = native_auth(root, args, response(args, mode))
    except RuntimeError as error:
        print(json.dumps({"status": 1, "message": str(error)}))
        return 1
    if isinstance(result, str):
        print(result)
    elif "completions" in " ".join(args) or "composite" in " ".join(args):
        print(json.dumps(result))
    else:
        print(json.dumps({"status": 0, "result": result}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
