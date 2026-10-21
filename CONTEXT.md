# Salesforce metadata context / Salesforce 元数据领域

The tools operate on Salesforce metadata within a particular user's access scope.
工具在特定用户的访问范围内处理 Salesforce 元数据。

## Language / 术语

**Salesforce org / Salesforce 组织**: A Salesforce organization identified by its organization ID.
由组织 ID 标识的 Salesforce 组织。
_Avoid / 避免混用_: org target / 组织目标。

**Authenticated user / 认证用户**: The Salesforce user whose permissions govern an operation.
其权限决定某项操作访问范围的 Salesforce 用户。
_Avoid / 避免混用_: org / 组织。

**Org target / 组织目标**: The username or Salesforce CLI alias selected for an operation.
为某项操作选择的用户名或 Salesforce CLI 别名。
_Avoid / 避免混用_: organization ID / 组织 ID。

**Metadata visibility context / 元数据可见性上下文**: The organization and authenticated user whose access rights determine the available metadata.
由组织与认证用户共同确定的元数据访问范围。

**CLI alias / CLI 别名**: A mutable Salesforce CLI name for an authenticated username.
Salesforce CLI 中指向认证用户名、可变更的名称。
_Avoid / 避免混用_: display alias / 显示别名。

**Display alias / 显示别名**: A user-chosen label shown by Ultraforce for an org target.
Ultraforce 为组织目标显示的用户自定义名称。
_Avoid / 避免混用_: CLI alias / CLI 别名。
