import { newHTMLDataProvider, type IHTMLDataProvider } from 'vscode-html-languageservice';

const events = [
  'click', 'input', 'change', 'submit', 'keydown', 'keyup', 'focus', 'blur', 'slotchange',
];
const properties = ['value', 'checked', 'disabled', 'className', 'innerHTML'];
const booleans = ['disabled', 'hidden', 'checked', 'required', 'readonly', 'multiple', 'selected'];

export const litHtmlDataProvider: IHTMLDataProvider = newHTMLDataProvider('lit-volar', {
  version: 1.1,
  globalAttributes: [
    ...events.map(name => ({
      name: `@${name}`,
      description: `Lit event listener binding for the ${name} event.`,
    })),
    ...properties.map(name => ({
      name: `.${name}`,
      description: `Lit property binding for ${name}.`,
    })),
    ...booleans.map(name => ({
      name: `?${name}`,
      description: `Lit boolean attribute binding for ${name}.`,
    })),
  ],
});
