import { html } from 'lit';
import './project-card';
import './api-card';

export const projectView = html`
  <project-card .title=${'Project'} ?active=${true}></project-card>
`;

export const apiView = html`<api-card></api-card>`;
