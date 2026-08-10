import { css, html, LitElement, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('lit-volar-demo')
export class LitVolarDemo extends LitElement {
  static styles = css`
    :host {
      display: block;
      color: rebeccapurple;
    }

    .record-panel__header {
      width: 15.4cqw;
      display: flex;
      align-items: center;
      justify-content: space-between;

      .record-panel__code {
        font-size: 1cqw;
        display: block;
        font-weight: 900;
        color: #191919;
        line-height: 1.4cqw;

        &::before {
          display: inline-block;
          content: '[';
          color: #999;
        }

        &::after {
          display: inline-block;
          content: ']';
          opacity: 0.5;
        }
      }

      .record-panel__mark {
        height: auto;
        width: 8cqw;
        color: #999;
      }
    }
  `;

  @property() name = 'Volar';

  private readonly attributes = [
    { label: 'Role', value: 'Language tooling', tone: 'accent' },
    { label: 'Engine', value: 'Volar' },
  ];

  render() {
    return html`
      <style>
        button {
          border: 1px solid currentColor;
        }
      </style>
      <button .value=${this.name} ?disabled=${!this.name} @click=${this.handleClick}>
        Hello ${this.name}
      </button>
      <dl class="character-card__attributes">
        ${this.attributes.map(
          (attribute) => html`
            <div class="character-card__attribute">
              <dt
                class="character-card__attribute-label ${attribute.tone
                  ? `character-card__attribute-label--${attribute.tone}`
                  : ''}"
              >
                ${attribute.label}
              </dt>
              <dd class="character-card__attribute-value">${attribute.value}</dd>
            </div>
          `,
        )}
      </dl>
      ${svg`<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" /></svg>`}
    `;
  }

  private handleClick() {
    this.name = this.name === 'Volar' ? 'Lit' : 'Volar';
  }
}
