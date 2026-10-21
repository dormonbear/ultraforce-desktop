"""Synthetic CLI for native app tests only. / 仅供原生应用测试使用的合成 CLI。"""
import json
import os
from pathlib import Path
import sys

ORG = "native@example.invalid"


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
        return {"apiVersion": "60.0", "id": "00DSYNTHETIC", "instanceUrl": "https://native.example.invalid"}
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
        result = response(args, mode)
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
