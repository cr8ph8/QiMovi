import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import ProFormaBudget, { emptyProForma } from "./ProFormaBudget";

interface Doc {
  id: string;
  title: string;
  doc_type: string;
  content: string;
  status: string;
  version: number;
  updated_at: string;
}

export default function ProFormaBudgetSection() {
  const { user } = useAuth();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error: fetchErr } = await supabase
        .from("business_documents")
        .select("*")
        .eq("doc_type", "proforma")
        .limit(1)
        .maybeSingle();

      if (fetchErr) {
        setError(fetchErr.message);
        setLoading(false);
        return;
      }

      if (data) {
        setDoc(data as Doc);
      } else {
        // Create a new proforma document
        const { data: newDoc, error: insertErr } = await supabase
          .from("business_documents")
          .insert({
            title: `Pro Forma Budget — FY ${new Date().getFullYear()}`,
            doc_type: "proforma",
            content: JSON.stringify(emptyProForma()),
            created_by: user.id,
            status: "draft",
          })
          .select()
          .single();

        if (insertErr) {
          setError(insertErr.message);
        } else {
          setDoc(newDoc as Doc);
        }
      }
      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center text-sm text-destructive">
        Failed to load Pro Forma: {error}
      </div>
    );
  }

  if (!doc) return null;

  return <ProFormaBudget doc={doc} />;
}
