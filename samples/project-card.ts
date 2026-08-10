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

  @property({ type: Number }) test = 0;

  setActive(active: boolean) {
    this.active = active;
    /** Fired after the active state changes. */
    this.dispatchEvent(new CustomEvent<{ active: boolean }>('activate', {
      detail: { active },
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'project-card': ProjectCard;
  }
}
