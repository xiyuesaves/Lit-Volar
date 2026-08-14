# Lit Volar

<p align="center">
  <img src="./lit_Volar.png" alt="Lit Volar logo" width="160">
</p>

English documentation is the primary reference. See [README_CN.md](./README_CN.md) for the Chinese version.

Lit Volar is a VS Code extension for Lit tagged templates. It adds Volar-powered HTML, CSS, and SVG language features while keeping VS Code's built-in TypeScript and JavaScript services in charge of host-language code.

## Requirements

- VS Code `1.90` or newer
- Node.js `20` or newer for development
- pnpm `10` for development and packaging

The extension uses the TypeScript SDK selected by VS Code. It supports TypeScript, JavaScript, TSX, and JSX files.

## Features

### Lit templates

- HTML completion, hover, formatting, symbols, navigation, and Emmet in `html` and `raw` templates.
- CSS completion and validation in `css` templates and nested `<style>` elements.
- SVG-aware HTML features in `svg` templates.
- `${...}` expressions remain TypeScript or JavaScript code and use the built-in VS Code language service.
- Nested templates and expressions preserve source mappings for diagnostics and edits.

### Binding intelligence

- Project-level binding metadata is merged through one registry.
- Native DOM bindings are read from the active VS Code TypeScript SDK and are tag-specific.
- `.property`, `?boolean-attribute`, and `@event` completions insert a Lit expression snippet (`=${}`) for known bindings.
- Writable, non-method DOM properties are offered as `.property` bindings; methods, `on*` fields, readonly-only members, and internal members are excluded.
- Native events are inferred from `on*` callback members and retain their callback parameter type.
- Boolean attributes are read from the HTML language service data for the current tag.
- Lit reactive properties are offered through `.property`, not as duplicate ordinary attributes.
- Completion candidates are deduplicated by label and edit text.
- Unknown bindings keep the normal HTML quoted-value behavior.

### Components and metadata

- TypeScript project analysis discovers `@customElement`, `customElements.define`, `HTMLElementTagNameMap`, Lit reactive properties, events, slots, CSS parts, and CSS custom properties.
- Metadata is merged with this precedence: TypeScript declarations, CEM data, custom HTML data, then built-in DOM data.
- The extension discovers workspace `custom-elements.json`, `package.json#customElements`, manifests from imported dependencies, and configured manifest globs.
- CEM supports completion, hover, and definition navigation when a source path is available.
- CEM types use TypeScript syntax for display. Reliable primitive, literal-union, and array types participate in diagnostics; unresolved complex references are displayed but treated as `any` for analysis.
- Component hover uses TypeScript-style highlighted declarations with the concrete class name, all public reactive properties, and public events. Framework members and generated attribute comments are omitted.
- Lit lifecycle method completion is available in `LitElement` and `ReactiveElement` class bodies, with TypeScript- or JavaScript-aware snippets and duplicate-method suppression.

### Diagnostics, fixes, and navigation

- Lit analyzer diagnostics cover tags, attributes, properties, events, slots, bindings, directives, decorators, registrations, and CSS.
- The default profile enables high-confidence syntax and binding checks. `strict` adds the broader analyzer profile.
- Every rule accepts `off`, `warning`, or `error`; an explicit `litVolar.rules` entry overrides both profiles.
- Analyzer fixes are exposed as LSP quick fixes, including missing imports and registration fixes where supported.
- Definitions and rename work across template tags, closing tags, properties, events, CSS metadata, decorators, registrations, and `HTMLElementTagNameMap`.
- Ordinary TypeScript/JavaScript references and document highlights remain provided by VS Code's built-in language services.

### Refresh and performance

- TypeScript DOM metadata, component metadata, and CEM parsing use project-level incremental caches.
- Manifest JSON is cached by normalized path, modification time, and file size.
- Targeted watchers refresh the server for package files, tsconfig/jsconfig, manifests, and configured custom data; unrelated JSON changes are ignored.
- Configuration and metadata changes are debounced and refresh diagnostics and completion state automatically.
- Lit analysis observes cancellation tokens and the analyzer operation timeout.

## Configuration

All settings use the `litVolar.*` namespace. The extension does not read or contribute `lit-plugin.*` settings.

### Project and rule settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `litVolar.disable` | boolean | `false` | Disable Lit-specific analysis while keeping generic embedded HTML, CSS, and SVG editing. |
| `litVolar.strict` | boolean | `false` | Layer the strict Lit analyzer profile over the default profile. |
| `litVolar.rules` | object | `{}` | Per-rule severity overrides. Values are `off`, `warning`, or `error`. |
| `litVolar.securitySystem` | `off \| ClosureSafeTypes` | `off` | Enable the optional Lit security type system. |
| `litVolar.dontShowSuggestions` | boolean | `false` | Suppress Lit project suggestions. |
| `litVolar.logging` | `off \| error \| warn \| debug \| verbose` | `off` | Set the language-server output-channel logging level. |

The default profile enables `no-missing-import`, `no-unknown-tag-name`, `no-unknown-property`, and `no-legacy-attribute` at warning severity. It also includes `no-unclosed-tag`, `no-unintended-mixed-binding`, binding type checks, directive checks, and name validation. Other rules can be enabled by `strict` or an explicit override.

Example:

```json
{
  "litVolar.strict": true,
  "litVolar.rules": {
    "no-missing-import": "warning",
    "no-unknown-property": "off"
  }
}
```

Supported rule IDs are:

`no-unknown-tag-name`, `no-missing-import`, `no-unclosed-tag`, `no-unknown-attribute`, `no-unknown-property`, `no-unknown-event`, `no-unknown-slot`, `no-unintended-mixed-binding`, `no-invalid-boolean-binding`, `no-expressionless-property-binding`, `no-noncallable-event-binding`, `no-boolean-in-attribute-binding`, `no-complex-attribute-binding`, `no-nullable-attribute-binding`, `no-incompatible-type-binding`, `no-invalid-directive-binding`, `no-incompatible-property-type`, `no-invalid-attribute-name`, `no-invalid-tag-name`, `no-invalid-css`, `no-property-visibility-mismatch`, `no-legacy-attribute`, and `no-missing-element-type-definition`.

### Tags and metadata

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `litVolar.htmlTemplateTags` | string[] | `['html', 'raw']` | Tagged template names analyzed as HTML. Qualified names are supported. |
| `litVolar.cssTemplateTags` | string[] | `['css']` | Tagged template names analyzed as CSS. |
| `litVolar.svgTemplateTags` | string[] | `['svg']` | Tagged template names analyzed as SVG. |
| `litVolar.globalTags` | string[] | `[]` | Additional globally available tag names. |
| `litVolar.globalAttributes` | string[] | `[]` | Attributes accepted on every element. Prefix with `.`, `?`, or `@` when appropriate. |
| `litVolar.globalEvents` | string[] | `[]` | Events accepted on every element. |
| `litVolar.customHtmlData` | string[] | `[]` | Custom HTML data files or globs relative to the workspace. |
| `litVolar.customElementsManifests` | string[] | `[]` | CEM files or globs relative to the workspace. |
| `litVolar.maxProjectImportDepth` | integer | `-1` | Maximum project dependency traversal depth; `-1` means unlimited. |
| `litVolar.maxNodeModuleImportDepth` | integer | `1` | Maximum node_modules traversal depth; `-1` means unlimited. |

Example:

```json
{
  "litVolar.htmlTemplateTags": ["html", "unsafeStatic"],
  "litVolar.customElementsManifests": ["packages/*/custom-elements.json"],
  "litVolar.customHtmlData": ["config/lit-html-data.json"]
}
```

Paths and globs are resolved relative to the workspace. Relevant changes refresh the language server automatically.

## Development

Install dependencies with pnpm:

```sh
pnpm install
```

Common commands:

```sh
pnpm check          # TypeScript type check
pnpm test           # Unit tests
pnpm build          # Build client, server, and Extension Host tests
pnpm smoke:lsp      # LSP smoke test
pnpm test:extension # Real VS Code Extension Host test
pnpm verify         # Run the complete verification sequence
pnpm package        # Verify and create a VSIX
pnpm watch          # Rebuild bundles in watch mode
```

For local interactive development, open the repository in VS Code and run **Run Lit Volar Extension** from Run and Debug. The launch configuration builds the extension and opens the `samples` workspace in an Extension Development Host.

### Continuous integration and releases

GitHub Actions verifies every push and pull request. Run the **Build** workflow manually to package the extension and retain the generated VSIX as a workflow artifact for 14 days.

To publish a GitHub Release, update `package.json#version`, commit the change, and push a matching `<version>` or `v<version>` tag, for example `v0.2.0`. The workflow verifies the extension, creates the VSIX, and attaches it to a generated GitHub Release. It rejects tags that do not match the manifest version. This flow uses the repository's automatic `GITHUB_TOKEN` and does not require custom repository secrets.

The Extension Host runner uses VS Code `1.90.2` by default and downloads it on first use. Set `VSCODE_EXECUTABLE_PATH` to use an installed VS Code executable instead.

The server is bundled with esbuild and uses IPC when launched by the extension. There is no CLI, `bin` entry, CLI command, or CLI activation event.

## Project layout

- `src/extension.ts`: VS Code client activation and metadata watchers.
- `src/server.ts`: Volar language server composition.
- `src/languagePlugin.ts`: TypeScript/JavaScript virtual code and source maps.
- `src/litService.ts`: Lit analyzer project service and project-level language features.
- `src/bindingRegistry.ts`: unified DOM, TypeScript, CEM, and custom-data binding metadata.
- `src/cemData.ts`: CEM discovery, parsing, merging, and caching.
- `src/test`: unit, LSP, and Extension Host test sources.
- `samples`: development workspace and fixtures.

## Limitations

- Custom configured tag aliases receive semantic Lit features but do not receive generated TextMate grammar highlighting.
- Type precision in JavaScript depends on TypeScript inference and JSDoc.
- SVG uses the HTML language service's SVG-aware data rather than a separate XML language server.
- The extension intentionally leaves host-language TypeScript/JavaScript completion and diagnostics to VS Code's built-in services.

## License

MIT
