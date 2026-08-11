import { LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export class ProjectCardBase extends LitElement {
  @property() inheritedLabel = '';

  emitInherited(value: string) {
    this.dispatchEvent(new CustomEvent<string>('inherited-change', { detail: value }));
  }
}

@customElement('api-card')
export class ApiCardElement extends ProjectCardBase {
  @property({ type: Number }) value1 = 1;
  @property({ type: Number }) value2 = 2;
  @property({ type: Number }) value3 = 3;
  @property({ type: Number }) value4 = 4;
  @property({ type: Number }) value5 = 5;
  @property({ type: Number }) value6 = 6;
  @property({ type: Number }) value7 = 7;
  @property({ type: Number }) value8 = 8;
  @property({ type: Number }) value9 = 9;

  emitCommit(id: number) {
    this.dispatchEvent(new CustomEvent<{ id: number }>('commit', { detail: { id } }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'api-card': ApiCardElement;
  }
}
