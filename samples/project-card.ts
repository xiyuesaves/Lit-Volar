import { css, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('project-card')
export class ProjectCard extends LitElement {
  static styles = css`
    :host {
      --project-card-accent: rebeccapurple;
    }

    [part='title'] {
      color: var(--project-card-accent);
    }
  `;

  @property() title = '';

  @property({ type: Boolean }) active = false;
}

declare global {
  interface HTMLElementTagNameMap {
    'project-card': ProjectCard;
  }
}
