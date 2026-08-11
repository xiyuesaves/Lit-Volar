import { newHTMLDataProvider, type IHTMLDataProvider } from 'vscode-html-languageservice';

export const defaultLitEvents = [
  'click', 'input', 'change', 'submit', 'keydown', 'keyup', 'focus', 'blur', 'slotchange',
];
export const defaultLitProperties = ['value', 'checked', 'disabled', 'className', 'innerHTML'];
export const defaultLitBooleans = ['disabled', 'hidden', 'checked', 'required', 'readonly', 'multiple', 'selected'];

export const litHtmlDataProvider: IHTMLDataProvider = newHTMLDataProvider('lit-volar', {
  version: 1.1,
  globalAttributes: [
    ...defaultLitEvents.map(name => ({
      name: `@${name}`,
      description: `Lit event listener binding for the ${name} event.`,
    })),
    ...defaultLitProperties.map(name => ({
      name: `.${name}`,
      description: `Lit property binding for ${name}.`,
    })),
    ...defaultLitBooleans.map(name => ({
      name: `?${name}`,
      description: `Lit boolean attribute binding for ${name}.`,
    })),
  ],
});
