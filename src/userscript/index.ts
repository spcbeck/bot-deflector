import { ContentOrchestrator } from '../content/index';
import cssText from '../content/content.css?raw';
import { UserscriptBackendClient } from '../core/client';

declare function GM_addStyle(css: string): void;

// Inject Bauhaus styles into page
if (typeof GM_addStyle === 'function') {
  GM_addStyle(cssText);
} else {
  const style = document.createElement('style');
  style.id = 'bot-deflector-styles';
  style.textContent = cssText;
  (document.head || document.documentElement).appendChild(style);
}

// Initialize orchestrator with userscript client
const client = new UserscriptBackendClient();
const orchestrator = new ContentOrchestrator(client);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    orchestrator.init().catch((err) => console.error('[BotDeflector Userscript Error]', err));
  });
} else {
  orchestrator.init().catch((err) => console.error('[BotDeflector Userscript Error]', err));
}
