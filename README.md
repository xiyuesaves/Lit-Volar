# Lit Volar

Lit Volar is a VS Code extension that adds HTML, CSS, and SVG language features to Lit tagged templates without replacing VS Code's built-in TypeScript service.

## Features

- HTML features in `html` and `raw` templates
- CSS features in `css` templates and nested `<style>` elements
- SVG markup features in `svg` templates
- Lit event (`@event`), property (`.property`), and boolean (`?attribute`) binding completions
- Completion, hover, diagnostics, formatting, document symbols, colors, and Emmet through Volar language services
- TypeScript completion inside `${...}` expressions from VS Code's built-in TypeScript extension
- Immediate TextMate highlighting for standard `html`, `raw`, `css`, and `svg` tag names

## Development

```sh
pnpm install
pnpm verify
```

Open this directory in VS Code and run **Run Lit Volar Extension** from the Run and Debug view. The Extension Development Host opens the `samples` directory.

Useful manual checks in `samples/lit-demo.ts`:

- Type `<bu` in an HTML template for HTML tag completion.
- Start an attribute with `@`, `.`, or `?` for Lit binding completion.
- Type `col` in a `css` template or nested `style` element for CSS completion.
- Type `this.` inside an interpolation for native TypeScript member completion.
- Edit SVG tags and attributes inside an `svg` template.

## Configuration

- `litVolar.htmlTemplateTags`: defaults to `html` and `raw`
- `litVolar.cssTemplateTags`: defaults to `css`
- `litVolar.svgTemplateTags`: defaults to `svg`

Reload VS Code after changing template tag settings. Semantic features recognize configured aliases and qualified tags such as `lit.html`; TextMate highlighting is intentionally limited to the standard static tag names.

## Current limitations

- Custom element metadata is not yet generated from TypeScript or Custom Elements Manifest files.
- Configured tag aliases receive semantic language features but no generated TextMate highlighting.
- SVG uses the HTML language service's SVG-aware data rather than a separate XML language server.
