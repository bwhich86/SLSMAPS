import type { GoogleSession } from './google';

declare global { interface Window { google?: any; gapi?: any; } }

export async function loadPicker(apiKey: string): Promise<void> {
  if (!window.gapi) throw new Error('gapi not loaded');
  await new Promise<void>((resolve) => window.gapi.load('picker', { callback: () => resolve() }));
  window.gapi.client?.setApiKey?.(apiKey);
}

export type PickerResult = { action: string; docs?: any[] };

export function pickFolder(apiKey: string, appId: string|undefined, session: GoogleSession): Promise<string> {
  return new Promise((resolve, reject) => {
    const google = window.google;
    if (!google?.picker) return reject(new Error('Picker not loaded'));

    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true);

    const builder = new google.picker.PickerBuilder()
      .setOAuthToken(session.accessToken)
      .setDeveloperKey(apiKey)
      .addView(view)
      .setCallback((data: PickerResult) => {
        if (data.action === google.picker.Action.PICKED) {
          const id = data.docs?.[0]?.id;
          if (id) resolve(id);
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new Error('Picker cancelled'));
        }
      });

    if (appId) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}
