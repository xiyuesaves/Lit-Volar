import { html } from 'lit';
import './project-card';

export const projectView = html`
  <project-card .title=${'Project'} ?active=${true}></project-card>
`;
