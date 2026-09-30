// The native host exposes one credential-free action. Browser clients continue
// to use the ordinary local session form; no owner token enters this bridge.
type SessionBridge = { postMessage(message: { action: 'restore' }): Promise<unknown> };
export function desktopSessionBridge(): SessionBridge | undefined {
  return (window as Window & { webkit?: { messageHandlers?: { qiMoviSession?: SessionBridge } } }).webkit?.messageHandlers?.qiMoviSession;
}
