import { useEffect } from "react";

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
}

export function DocTitle({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}
