/** Keep local export bytes alive for WebKit's native Save sheet. */
export function downloadLocalBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const release = () => {
    window.removeEventListener('pagehide', release);
    URL.revokeObjectURL(url);
  };
  // A timeout or component unmount does not mean the native download finished.
  window.addEventListener('pagehide', release, { once: true });
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } catch (error) {
    release();
    throw error;
  }
}
