import { ArrowLeft, Radio } from "lucide-react";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";

/**
 * Public festival playback used screenplay-table media URLs directly. Keep the
 * surface closed until a rights-checked, public-media projection exists.
 */
export default function FestivalLive() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen px-4 pt-32 pb-20">
        <div className="mx-auto max-w-lg rounded-2xl border border-border/50 bg-card/80 p-10 text-center">
          <Radio className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
          <h1 className="font-display text-2xl font-bold mb-2">Festival live is paused</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Public playback will return after media rights and public-file
            access are verified. Private screenplay and media URLs remain closed.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/seasons">
              <ArrowLeft className="mr-2 h-4 w-4" /> Browse seasons
            </Link>
          </Button>
        </div>
      </main>
    </>
  );
}
