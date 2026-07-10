/// <reference path="../desktop/src/vite-env.d.ts" />

import DesktopApp from '../desktop/src/App';
import { EditorHarness } from './EditorHarness';

export default function App() {
  const isEditorAudit = new URLSearchParams(window.location.search).get('e2e') === '1';
  return isEditorAudit ? <EditorHarness /> : <DesktopApp />;
}
