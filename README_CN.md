# Lit Volar 中文说明

<p align="center">
  <img src="./lit%20Volar.png" alt="Lit Volar logo" width="160">
</p>

英文主文档请查看 `README.md`。

Lit Volar 是一个 VS Code 扩展，为 Lit tagged template 提供 HTML、CSS、SVG 语言能力，并保留 VS Code 内置 TypeScript/JavaScript 服务处理宿主代码。

## 环境要求

- VS Code `1.90` 或更高版本
- 开发需要 Node.js `20` 或更高版本
- 统一使用 pnpm `10` 管理依赖、测试和打包

支持 TypeScript、JavaScript、TSX 和 JSX 文件。

## 功能

### Lit 模板

- 在 `html` 和 `raw` 模板中提供 HTML 补全、Hover、格式化、符号、导航和 Emmet。
- 在 `css` 模板及嵌套 `<style>` 中提供 CSS 补全和诊断。
- 在 `svg` 模板中提供 SVG 感知的 HTML 功能。
- `${...}` 表达式保持为 TypeScript/JavaScript，并由 VS Code 内置语言服务提供补全。
- 嵌套模板和表达式保留源代码映射，诊断和编辑可以正确回到原文件。

### 绑定智能提示

- 使用项目级 BindingRegistry 统一合并绑定元数据。
- 原生 DOM 绑定来自当前 VS Code 使用的 TypeScript SDK，并按标签精确筛选。
- 已知 `.property`、`?boolean-attribute` 和 `@event` 绑定接受补全后会插入 Lit 表达式片段 `=${}`。
- `.property` 只提供可写、非方法的 DOM 成员；排除方法、`on*` 字段、只读成员和内部成员。
- `@event` 从元素类型的 `on*` 回调成员推导，并保留事件参数类型。
- `?boolean` 来自当前标签的 HTML language service boolean attribute 数据。
- Lit reactive property 只提供 `.property`，不会重复生成普通 attribute。
- 候选按 label 和编辑文本去重。
- 未知绑定保留普通 HTML 引号插入行为。

### 组件与元数据

- TypeScript 项目分析自动识别 `@customElement`、`customElements.define`、`HTMLElementTagNameMap`、Lit reactive property、事件、slot、CSS part 和 CSS custom property。
- 元数据优先级为：TypeScript 声明、CEM 补缺、自定义 HTML Data、内置 DOM 数据。
- 自动发现工作区 `custom-elements.json`、`package.json#customElements`、已导入依赖的 manifest，以及配置的 manifest glob。
- CEM 可提供补全、Hover，以及存在源码路径时的定义跳转。
- CEM 类型使用 TypeScript 语法展示；可信的基础类型、字面量联合和数组类型参与诊断，无法解析语义的复杂引用展示但按 `any` 分析。
- 组件 Hover 使用 TypeScript 风格的高亮声明，显示真实 class 名称、全部公开 reactive property 和公开事件，不显示框架成员或生成的 attribute 注释。

### 诊断、修复与导航

- Lit analyzer 诊断覆盖标签、attribute、property、event、slot、绑定、directive、decorator、注册声明和 CSS。
- 默认配置启用低误报语法和绑定检查；`strict` 会叠加完整 analyzer profile。
- 每条规则都支持 `off`、`warning`、`error`；显式 `litVolar.rules` 优先级最高。
- analyzer fix 会转换为 LSP Quick Fix，例如缺失导入和注册声明修复。
- 定义跳转和重命名覆盖模板标签、结束标签、property、event、CSS 元数据、decorator、注册字符串和 `HTMLElementTagNameMap`。
- 普通 TypeScript/JavaScript 引用高亮继续由 VS Code 内置语言服务负责。

### 刷新与性能

- TypeScript DOM 元数据、组件元数据和 CEM 解析使用项目级增量缓存。
- manifest JSON 按规范化路径、修改时间和文件大小缓存。
- 只监听 package 文件、tsconfig/jsconfig、manifest 和配置的 custom data；无关 JSON 修改不会重启服务。
- 配置和元数据修改会防抖刷新 language server、诊断和补全状态。
- Lit 分析遵守 cancellation token 和 analyzer 操作超时。

## 配置

所有配置都使用 `litVolar.*` 命名空间。插件不会读取或贡献 `lit-plugin.*` 配置。

### 项目与规则

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `litVolar.disable` | boolean | `false` | 禁用 Lit 项目分析，但保留通用 HTML、CSS、SVG 编辑能力。 |
| `litVolar.strict` | boolean | `false` | 在默认规则上叠加严格 Lit analyzer profile。 |
| `litVolar.rules` | object | `{}` | 单项规则严重级别覆盖，值为 `off`、`warning` 或 `error`。 |
| `litVolar.securitySystem` | `off \| ClosureSafeTypes` | `off` | 启用可选的 Lit 安全类型系统。 |
| `litVolar.dontShowSuggestions` | boolean | `false` | 隐藏 Lit 项目建议。 |
| `litVolar.logging` | `off \| error \| warn \| debug \| verbose` | `off` | 设置 language server output channel 的日志级别。 |

默认 profile 以 warning 级别启用 `no-missing-import`、`no-unknown-tag-name`、`no-unknown-property` 和 `no-legacy-attribute`，并包含 `no-unclosed-tag`、`no-unintended-mixed-binding`、绑定类型检查、directive 检查和名称校验。其他规则可以通过 `strict` 或显式配置启用。

示例：

```json
{
  "litVolar.strict": true,
  "litVolar.rules": {
    "no-missing-import": "warning",
    "no-unknown-property": "off"
  }
}
```

支持的规则 ID：

`no-unknown-tag-name`、`no-missing-import`、`no-unclosed-tag`、`no-unknown-attribute`、`no-unknown-property`、`no-unknown-event`、`no-unknown-slot`、`no-unintended-mixed-binding`、`no-invalid-boolean-binding`、`no-expressionless-property-binding`、`no-noncallable-event-binding`、`no-boolean-in-attribute-binding`、`no-complex-attribute-binding`、`no-nullable-attribute-binding`、`no-incompatible-type-binding`、`no-invalid-directive-binding`、`no-incompatible-property-type`、`no-invalid-attribute-name`、`no-invalid-tag-name`、`no-invalid-css`、`no-property-visibility-mismatch`、`no-legacy-attribute`、`no-missing-element-type-definition`。

### 标签与元数据

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `litVolar.htmlTemplateTags` | string[] | `['html', 'raw']` | 按 HTML 分析的 tagged template 名称，支持限定名。 |
| `litVolar.cssTemplateTags` | string[] | `['css']` | 按 CSS 分析的 tagged template 名称。 |
| `litVolar.svgTemplateTags` | string[] | `['svg']` | 按 SVG 分析的 tagged template 名称。 |
| `litVolar.globalTags` | string[] | `[]` | 额外的全局标签。 |
| `litVolar.globalAttributes` | string[] | `[]` | 对所有元素接受的 attribute；需要时可加 `.`, `?`, `@` 前缀。 |
| `litVolar.globalEvents` | string[] | `[]` | 对所有元素接受的事件。 |
| `litVolar.customHtmlData` | string[] | `[]` | 相对工作区的 custom HTML data 文件或 glob。 |
| `litVolar.customElementsManifests` | string[] | `[]` | 相对工作区的 CEM 文件或 glob。 |
| `litVolar.maxProjectImportDepth` | integer | `-1` | 项目依赖遍历深度，`-1` 表示不限制。 |
| `litVolar.maxNodeModuleImportDepth` | integer | `1` | node_modules 依赖遍历深度，`-1` 表示不限制。 |

示例：

```json
{
  "litVolar.htmlTemplateTags": ["html", "unsafeStatic"],
  "litVolar.customElementsManifests": ["packages/*/custom-elements.json"],
  "litVolar.customHtmlData": ["config/lit-html-data.json"]
}
```

路径和 glob 均相对工作区解析。相关文件变化后会自动刷新语言服务。

## 开发

使用 pnpm 安装依赖：

```sh
pnpm install
```

常用命令：

```sh
pnpm check          # TypeScript 类型检查
pnpm test           # 单元测试
pnpm build          # 构建 client、server 和 Extension Host 测试
pnpm smoke:lsp      # LSP 冒烟测试
pnpm test:extension # 真实 VS Code Extension Host 测试
pnpm verify         # 按顺序执行完整验证
pnpm package        # 验证并生成 VSIX
pnpm watch          # watch 模式构建
```

交互式开发时，在 VS Code 中打开仓库，并在 Run and Debug 中运行 **Run Lit Volar Extension**。该配置会先构建扩展，再以 `samples` 目录启动 Extension Development Host。

Extension Host 测试默认使用 VS Code `1.90.2`，首次运行时会下载测试版本。也可以设置 `VSCODE_EXECUTABLE_PATH` 使用本机已安装的 VS Code。

服务端使用 esbuild 打包，并由扩展通过 IPC 启动。项目不提供 CLI、`bin`、CLI command 或 CLI activation event。

## 目录结构

- `src/extension.ts`：VS Code client 激活和元数据监听。
- `src/server.ts`：Volar language server 组合。
- `src/languagePlugin.ts`：TypeScript/JavaScript 虚拟代码和 source map。
- `src/litService.ts`：Lit analyzer 项目服务和项目级语言功能。
- `src/bindingRegistry.ts`：DOM、TypeScript、CEM 和 custom data 的统一绑定元数据。
- `src/cemData.ts`：CEM 发现、解析、合并和缓存。
- `src/test`：单元、LSP 和 Extension Host 测试源码。
- `samples`：开发工作区和测试 fixture。

## 已知限制

- 自定义 tag alias 具有语义功能，但没有生成的 TextMate 语法高亮。
- JavaScript 的类型精度取决于 TypeScript 推断和 JSDoc。
- SVG 使用 HTML language service 的 SVG 数据，而不是独立 XML language server。
- 宿主 TypeScript/JavaScript 的补全和诊断仍由 VS Code 内置服务负责。

## License

MIT
